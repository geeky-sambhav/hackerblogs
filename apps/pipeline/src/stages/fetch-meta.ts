/**
 * fetch:meta — fetch each candidate page on an included (or auto-checked) site
 * and store bibliographic metadata. One request at a time per host (robots.txt
 * Crawl-delay honoured), many hosts in parallel. Pages are cached on disk.
 *
 * - Redirects and rel=canonical are followed; if the article's real canonical
 *   URL is already another candidate, the two are merged.
 * - Dead pages (host gone, 404/410, redirected to a front page) and pages we
 *   cannot read (robots.txt, bot blocking, 401/403, non-HTML) are flagged in
 *   archive_need; fetch:archive then reads them from the Wayback Machine.
 * - A site that stalls or drops our requests is up but blocking bots, not dead:
 *   its pages are recorded as blocked and keep their original links. After a few
 *   stalls in a row, the rest of that host's pages are recorded without waiting.
 *
 * Fetched: every candidate on an included site, and viable candidates on auto
 * and not-yet-reviewed sites (so a later review needs no refetch).
 *
 * Flags: --refetch (ignore fetched_at), --recheck-untitled (also re-read 2xx pages
 * that yielded no title), --recheck-unreachable (also retry pages recorded as
 * unreachable), --limit=N
 */
import { monitorEventLoopDelay } from "node:perf_hooks";
import pLimit from "p-limit";
import type { Pool, PoolClient } from "pg";
import { canonicalizeUrl, isRootLike } from "@hackerreads/shared";
import { createNodeDb } from "@hackerreads/db/node";
import { RobotsDisallowed, networkErrorKind, politeFetch, type FetchResult, type NetworkErrorKind } from "../lib/http";
import { log } from "../lib/log";
import type { PageMeta } from "../lib/meta";
import { closeReadMeta, readMeta, storedWordCount } from "../lib/page";
import { STATUS, isDeadStatus } from "../lib/status";
import { VIABLE_SQL } from "../lib/viable";

type Row = {
  id: number;
  canonical_url: string;
  first_rec: Date | null;
  paywall: string | null;
  /** Status from an earlier attempt (null = never tried). */
  http_status: number | null;
};

/** Consecutive stalled requests after which a host is treated as blocking us for the rest of the run. */
const BLOCKED_HOST_STREAK = 3;

// Distinct hosts in flight; each host is still limited to 1 request per second (or its crawl-delay).
// Higher values overload the main thread (HTML parsing), and responses then miss their deadline.
const HOST_CONCURRENCY = 64;

function variants(canonical: string): string[] {
  const u = new URL(canonical);
  const path = `${u.pathname}${u.search}`;
  const host = u.hostname;
  const www = host.split(".").length === 2 ? `www.${host}` : null;
  return [
    `https://${host}${path}`,
    ...(www ? [`https://${www}${path}`] : []),
    `http://${host}${path}`,
    ...(www ? [`http://${www}${path}`] : []),
  ];
}

/**
 * `gone`: no variant reached a server (name does not resolve, or no connection could be opened).
 * Anything else (a stall, a dropped connection, a bad certificate, a malformed response) means a
 * server is there: the site is up but will not serve us, and readers keep the original link.
 */
type Failure = { failed: NetworkErrorKind; gone: boolean };

const NO_SERVER: ReadonlySet<NetworkErrorKind> = new Set(["dns", "refused", "connect"]);

/** A stall or dropped connection: the server is up but not serving us. */
const isStall = (kind: NetworkErrorKind) => kind === "timeout" || kind === "reset";

/**
 * Try https/http and www variants, but only on network errors (not HTTP statuses). A stall ends
 * the search: the other variants reach the same server, and each stall costs a full timeout.
 */
async function fetchArticle(canonical: string): Promise<FetchResult | "robots" | Failure> {
  let failed: NetworkErrorKind = "other";
  let gone = true;
  for (const url of variants(canonical)) {
    try {
      return await politeFetch(url, { minIntervalMs: 1000, retries: 1, timeoutMs: 30_000 });
    } catch (err) {
      if (err instanceof RobotsDisallowed) return "robots";
      failed = networkErrorKind(err);
      if (!NO_SERVER.has(failed)) gone = false;
      if (isStall(failed)) break;
    }
  }
  return { failed, gone };
}

function sameSite(a: string, b: string): boolean {
  try {
    const ha = new URL(a).hostname.replace(/^www\./, "");
    const hb = new URL(b).hostname.replace(/^www\./, "");
    return ha === hb || ha.endsWith(`.${hb}`) || hb.endsWith(`.${ha}`);
  } catch {
    return false;
  }
}

/** Move mentions and picks of `fromId` onto `toId`, remember its URLs as aliases, delete it. */
async function mergeInto(client: PoolClient, fromId: number, toId: number): Promise<void> {
  await client.query("BEGIN");
  try {
    await client.query(
      `INSERT INTO mentions (piece_id, source, source_item_id, person_hash, ts, kind, points, own_text_len, subreddit)
       SELECT $2, source, source_item_id, person_hash, ts, kind, points, own_text_len, subreddit FROM mentions WHERE piece_id = $1
       ON CONFLICT DO NOTHING`,
      [fromId, toId],
    );
    await client.query("UPDATE editorial_picks SET piece_id = $2 WHERE piece_id = $1", [fromId, toId]);
    await client.query(
      `UPDATE pieces t SET alias_urls = (
         SELECT coalesce(array_agg(DISTINCT u), '{}') FROM unnest(t.alias_urls || f.alias_urls || f.canonical_url) u WHERE u <> t.canonical_url)
       FROM pieces f WHERE t.id = $2 AND f.id = $1`,
      [fromId, toId],
    );
    await client.query("DELETE FROM pieces WHERE id = $1", [fromId]);
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  }
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === "23505";
}

type Outcome = "fetched" | "merged" | "retry-later";

type Counters = { dead: number; robots: number; blocked: number };

/**
 * Fetch one page and store what it yields. `hostBlocking` skips the request: the host has
 * stalled several requests in a row, so the page is recorded as blocked straight away.
 */
async function processRow(pool: Pool, row: Row, counters: Counters, hostBlocking: boolean): Promise<{ outcome: Outcome; stalled: boolean }> {
  const res: FetchResult | "robots" | Failure = hostBlocking ? { failed: "timeout", gone: false } : await fetchArticle(row.canonical_url);
  let meta: PageMeta | null = null;
  let status: number | null = null;
  let finalUrl: string | null = null;
  const failure = typeof res === "object" && "failed" in res ? res : null;
  const stalled = failure !== null && isStall(failure.failed);
  if (res === "robots") {
    counters.robots++;
    status = STATUS.robots;
  } else if (failure !== null) {
    status = failure.gone ? STATUS.unreachable : STATUS.blocked;
  } else {
    const page = res as FetchResult;
    status = page.status;
    finalUrl = page.finalUrl;
    if (page.status >= 200 && page.status < 300 && /html/i.test(page.contentType || "text/html")) {
      meta = await readMeta(page.body, page.finalUrl);
    }
  }

  // Network failures, 429 and 5xx are final only when a separate, earlier run saw the same
  // result: a single stall can come from our own load rather than the site.
  const transient = failure !== null || status === 429 || (status !== null && status >= 500);
  if (transient && row.http_status !== status) {
    await pool.query("UPDATE pieces SET http_status = $2 WHERE id = $1", [row.id, status]);
    return { outcome: "retry-later", stalled };
  }

  // Redirected to a front page: the article is gone (dead site, parked domain, paywall wall).
  const toFrontPage = !!finalUrl && status !== null && status >= 200 && status < 300 && isRootLike(canonicalizeUrl(finalUrl) ?? finalUrl);
  if (toFrontPage) {
    meta = null;
    status = STATUS.frontPage;
  }

  const isDead = isDeadStatus(status);
  if (isDead) counters.dead++;
  if (status === STATUS.blocked) counters.blocked++;
  // The Wayback Machine is consulted later by fetch:archive, only for pieces strong enough to
  // matter: inline lookups funnel every host through one slow archive.org queue.
  //   dead → link readers to an archived copy and read metadata from it
  //   live but unreadable (robots.txt, bot blocking, 401/403/451, non-HTML) → borrow metadata, keep the original link
  const archiveNeed = isDead ? "dead" : !meta ? "meta" : null;

  // Real canonical URL: rel=canonical (same site, not a front page), else the final URL.
  let newCanonical = row.canonical_url;
  let linkUrl = row.canonical_url;
  if (!isDead && finalUrl && status !== null && status >= 200 && status < 300) {
    const relCanon =
      meta?.canonical && sameSite(meta.canonical, finalUrl) && !isRootLike(canonicalizeUrl(meta.canonical) ?? "/") ? meta.canonical : null;
    const chosen = relCanon ?? finalUrl;
    const canon = canonicalizeUrl(chosen);
    if (canon && !isRootLike(canon)) {
      newCanonical = canon;
      linkUrl = chosen;
    }
  }
  const crossSite = !sameSite(newCanonical, row.canonical_url);

  const wordCount = storedWordCount(meta, row.paywall);

  const client = await pool.connect();
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      if (newCanonical !== row.canonical_url) {
        const existing = await client.query<{ id: number }>("SELECT id FROM pieces WHERE canonical_url = $1", [newCanonical]);
        const target = existing.rows[0];
        if (target && target.id !== row.id) {
          // Only merge within one site; a cross-site redirect onto another piece keeps both as they are.
          if (crossSite) {
            newCanonical = row.canonical_url;
          } else {
            await mergeInto(client, row.id, target.id);
            return { outcome: "merged", stalled };
          }
        }
      }
      try {
        await client.query(
          `UPDATE pieces SET
             alias_urls = CASE WHEN $2 <> canonical_url THEN array_append(alias_urls, canonical_url) ELSE alias_urls END,
             canonical_url = $2, url = $3,
             title = $4, dek = $5, image_url = $6, byline = $7, publication_name = $8,
             published_at = $9, word_count = $10, lang = $11, section = $12, tags = $13,
             tags_text = $14, http_status = $15, archive_need = $16, is_article = $17, fetched_at = now(),
             wayback_url = CASE WHEN $18 THEN wayback_url ELSE NULL END,
             status = CASE WHEN status = 'candidate' THEN 'fetched' ELSE status END
           WHERE id = $1`,
          [
            row.id,
            newCanonical,
            linkUrl,
            meta?.title ?? null,
            meta?.dek ?? null,
            meta?.image ?? null,
            meta?.authors.length ? meta.authors.join(", ") : null,
            meta?.siteName ?? null,
            meta?.publishedAt ?? null,
            wordCount,
            meta?.lang ?? null,
            meta?.section ?? null,
            meta?.tags ?? [],
            meta?.tags.join(" ") ?? null,
            status,
            archiveNeed,
            meta ? meta.isArticleType : null,
            isDead, // a live page keeps its own link: drop any archived copy from an earlier run
          ],
        );
        return { outcome: "fetched", stalled };
      } catch (err) {
        // Another host's row claimed the same canonical URL a moment ago: merge on the retry.
        if (!isUniqueViolation(err) || attempt > 0) throw err;
      }
    }
    return { outcome: "fetched", stalled };
  } finally {
    client.release();
  }
}

export async function run(args: string[]): Promise<void> {
  const refetch = args.includes("--refetch");
  // Pages fetched before front-page redirects were recorded as dead: re-read them (cache hits).
  const recheckUntitled = args.includes("--recheck-untitled");
  // Pages recorded as unreachable or blocked: try them again (a second identical result makes it final).
  const recheckUnreachable = args.includes("--recheck-unreachable");
  const limitArg = args.find((a) => a.startsWith("--limit="));
  const limit = limitArg ? Number(limitArg.split("=")[1]) : null;
  const { pool } = createNodeDb({ max: 10, queryTimeoutMs: 120_000 });
  try {
    const rows = (
      await pool.query<Row>(
        `SELECT p.id, p.canonical_url, p.first_rec, pub.paywall, p.http_status
         FROM pieces p
         JOIN domains d ON d.domain = p.domain
         LEFT JOIN publications pub ON pub.id = p.publication_id
         WHERE d.status IN ('include', 'auto', 'review')
           AND (d.status = 'include' OR ${VIABLE_SQL})
           ${refetch ? "" : `AND (p.fetched_at IS NULL${recheckUntitled ? " OR (p.http_status BETWEEN 200 AND 299 AND p.title IS NULL)" : ""}${recheckUnreachable ? ` OR p.http_status IN (${STATUS.unreachable}, ${STATUS.blocked})` : ""})`}
         ORDER BY p.id ${limit ? `LIMIT ${limit}` : ""}`,
      )
    ).rows;
    log(`${rows.length.toLocaleString()} pages to fetch`);

    const byHost = new Map<string, Row[]>();
    for (const r of rows) {
      const h = new URL(r.canonical_url).hostname;
      const list = byHost.get(h);
      if (list) list.push(r);
      else byHost.set(h, [r]);
    }
    let done = 0;
    let merged = 0;
    let retryLater = 0;
    const counters: Counters = { dead: 0, robots: 0, blocked: 0 };
    const blockingHosts = new Set<string>();
    // Event-loop lag, logged with progress: high lag means our own load, not the sites, is slow.
    const loopDelay = monitorEventLoopDelay({ resolution: 20 });
    loopDelay.enable();
    const started = Date.now();
    const hostLimit = pLimit(HOST_CONCURRENCY);
    // Largest hosts first so the long queues start early.
    const hosts = [...byHost.entries()].sort((a, b) => b[1].length - a[1].length);

    await Promise.all(
      hosts.map(([host, list]) =>
        hostLimit(async () => {
          let stallStreak = 0;
          for (const row of list) {
            try {
              const hostBlocking = stallStreak >= BLOCKED_HOST_STREAK;
              const { outcome, stalled } = await processRow(pool, row, counters, hostBlocking);
              stallStreak = stalled ? stallStreak + 1 : 0;
              if (stallStreak === BLOCKED_HOST_STREAK && !blockingHosts.has(host)) {
                blockingHosts.add(host);
                log(`${host} stalled ${BLOCKED_HOST_STREAK} requests in a row: recording its other ${list.length - list.indexOf(row) - 1} pages as blocked`);
              }
              if (outcome === "merged") merged++;
              if (outcome === "retry-later") retryLater++;
            } catch (err) {
              log(`error on ${row.canonical_url}: ${(err as Error).message}`);
            } finally {
              done++;
              if (done % 250 === 0) {
                const rate = done / ((Date.now() - started) / 1000);
                const lag = `${Math.round(loopDelay.percentile(99) / 1e6)}/${Math.round(loopDelay.max / 1e6)}ms`;
                loopDelay.reset();
                log(
                  `${done.toLocaleString()} / ${rows.length.toLocaleString()} (${rate.toFixed(1)}/s) merged=${merged} dead=${counters.dead} robots=${counters.robots} blocked=${counters.blocked} retry-later=${retryLater} loop-lag p99/max=${lag}`,
                );
              }
            }
          }
        }),
      ),
    );
    log(
      `done: ${done.toLocaleString()} processed, merged=${merged}, dead=${counters.dead}, robots=${counters.robots}, blocked=${counters.blocked} (${blockingHosts.size} hosts), retry next run=${retryLater}`,
    );
  } finally {
    await closeReadMeta();
    await pool.end();
  }
}
