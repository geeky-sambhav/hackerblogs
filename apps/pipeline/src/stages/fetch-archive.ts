/**
 * fetch:archive — read pages flagged by fetch:meta from the Wayback Machine.
 *
 *   archive_need = 'dead'  → store the snapshot link (readers get it instead of the dead URL)
 *                            and fill metadata from the snapshot
 *   archive_need = 'meta'  → fill missing metadata only; readers keep the original link
 *
 * Only pieces that could still make the catalog are looked up, strongest first: archive.org is
 * one slow, shared queue. "Could make it" means community score C + D within reach of the
 * classic cutoff (estimated as the C + D of the Nth strongest viable piece, N = --reach,
 * default 3× the classic target to allow for exclusions, less the most E and A can add), or a
 * recent first recommendation (Rising lane). Pieces never looked up keep their flag, so a later
 * run (for example with a larger --reach) picks them up.
 *
 * Flags: --reach=N, --limit=N
 */
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import pLimit from "p-limit";
import { createNodeDb } from "@hackerreads/db/node";
import { DeadlineExceeded, withDeadline } from "../lib/deadline";
import { log } from "../lib/log";
import { DATA_DIR } from "../lib/paths";
import type { PageMeta } from "../lib/meta";
import { ArchiveUnavailable, closeReadMeta, storedWordCount, wayback, waybackMeta } from "../lib/page";
import { DEAD_SQL } from "../lib/status";
import { RISING_FIRST_REC, VIABLE_SQL } from "../lib/viable";
import { CLASSIC_TARGET } from "./score";

/** The most 0.5·E + 0.5·A can add to a score (E and A are each capped at 4). */
const MAX_EDITORIAL_AND_ACCLAIM_BOOST = 4;
/** Rows in flight; each archive host still serves one request at a time. */
const CONCURRENCY = 4;
/** Consecutive failed lookups after which archive.org is treated as down for this run. */
const MAX_FAIL_STREAK = 25;
/**
 * Backstop per row (two lookups, each with its own retries and host queue). A row past this is
 * deferred, so one stuck request cannot hold a slot for the rest of the run.
 */
const ROW_DEADLINE_MS = 20 * 60_000;

type Row = { id: number; canonical_url: string; first_rec: Date | null; paywall: string | null; archive_need: "dead" | "meta" };

const LOCK_FILE = resolve(DATA_DIR, "fetch-archive.lock");

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * One archive pass at a time: archive.org is a single polite queue, so two passes would double
 * the request rate. A second pass (e.g. one chained after fetch:meta while an earlier pass runs
 * alongside it) waits, then picks up only the pages flagged since.
 */
async function acquireLock(): Promise<() => void> {
  let announced = false;
  for (;;) {
    try {
      writeFileSync(LOCK_FILE, String(process.pid), { flag: "wx" });
      return () => rmSync(LOCK_FILE, { force: true });
    } catch {
      let holder: number;
      try {
        holder = Number(readFileSync(LOCK_FILE, "utf8"));
      } catch {
        continue; // released between our two calls: try again
      }
      if (!Number.isInteger(holder) || holder <= 0 || !alive(holder)) {
        rmSync(LOCK_FILE, { force: true }); // stale lock from a pass that died
        continue;
      }
      if (!announced) log(`another archive pass (pid ${holder}) is running; waiting for it to finish`);
      announced = true;
      await new Promise((r) => setTimeout(r, 10_000));
    }
  }
}

export async function run(args: string[]): Promise<void> {
  const release = await acquireLock();
  try {
    await runLocked(args);
  } finally {
    release();
  }
}

async function runLocked(args: string[]): Promise<void> {
  const num = (flag: string) => {
    const v = args.find((a) => a.startsWith(`--${flag}=`))?.split("=")[1];
    return v ? Number(v) : null;
  };
  const reach = num("reach") ?? CLASSIC_TARGET * 3;
  const limit = num("limit");
  const { pool } = createNodeDb({ max: 4, queryTimeoutMs: 120_000 });
  try {
    // Self-healing: an earlier pass may have cleared a flag after a failed lookup (before failures
    // were told apart from "no snapshot"). Re-flag every fetched page still missing what the
    // archive should supply; pages genuinely without a snapshot come back from the disk cache.
    const reflagged = await pool.query(
      `UPDATE pieces SET archive_need = CASE WHEN ${DEAD_SQL} THEN 'dead' ELSE 'meta' END
       WHERE archive_need IS NULL AND fetched_at IS NOT NULL AND http_status IS NOT NULL
         AND ((${DEAD_SQL} AND wayback_url IS NULL) OR (NOT ${DEAD_SQL} AND title IS NULL))`,
    );
    if (reflagged.rowCount) log(`re-flagged ${reflagged.rowCount.toLocaleString()} pages still missing a snapshot or metadata`);

    const [floor] = (
      await pool.query<{ cd: number | null }>(
        `SELECT (c + d)::float8 AS cd FROM pieces p
         WHERE ${VIABLE_SQL} AND p.status <> 'excluded'
         ORDER BY c + d DESC OFFSET $1 LIMIT 1`,
        [reach - 1],
      )
    ).rows;
    const minCd = Math.max(0, (floor?.cd ?? 0) - MAX_EDITORIAL_AND_ACCLAIM_BOOST);
    const rows = (
      await pool.query<Row>(
        `SELECT p.id, p.canonical_url, p.first_rec, pub.paywall, p.archive_need
         FROM pieces p
         JOIN domains d ON d.domain = p.domain
         LEFT JOIN publications pub ON pub.id = p.publication_id
         WHERE p.archive_need IS NOT NULL
           AND d.status IN ('include', 'auto', 'review')
           AND ${VIABLE_SQL}
           AND (p.c + p.d >= $1 OR p.first_rec >= '${RISING_FIRST_REC}')
         ORDER BY p.c + p.d DESC, p.id
         ${limit ? `LIMIT ${limit}` : ""}`,
        [minCd],
      )
    ).rows;
    const flagged = (await pool.query<{ n: number }>("SELECT count(*)::int n FROM pieces WHERE archive_need IS NOT NULL")).rows[0]?.n ?? 0;
    log(`${rows.length.toLocaleString()} of ${flagged.toLocaleString()} flagged pages within reach (C + D ≥ ${minCd.toFixed(2)}, or recent)`);

    let done = 0;
    let snapshots = 0;
    let withMeta = 0;
    let deferred = 0;
    let failStreak = 0;
    let gaveUp = false;
    const started = Date.now();
    const limitRows = pLimit(CONCURRENCY);
    await Promise.all(
      rows.map((row) =>
        limitRows(async () => {
          if (gaveUp) return;
          try {
            let snap: string | null;
            let meta: PageMeta | null;
            try {
              ({ snap, meta } = await withDeadline(
                (async () => {
                  const s = await wayback(row.canonical_url, row.first_rec);
                  return { snap: s, meta: s ? await waybackMeta(s) : null };
                })(),
                ROW_DEADLINE_MS,
                `archive lookup for ${row.canonical_url}`,
              ));
              failStreak = 0;
            } catch (err) {
              if (err instanceof DeadlineExceeded) {
                log(`${err.message}; deferred to a later run`);
                deferred++;
                return;
              }
              if (!(err instanceof ArchiveUnavailable)) throw err;
              // Keep the flag: a later run tries again.
              deferred++;
              if (++failStreak >= MAX_FAIL_STREAK && !gaveUp) {
                gaveUp = true;
                log(`archive.org failed ${MAX_FAIL_STREAK} lookups in a row (${err.message}); stopping, run fetch:archive again later`);
              }
              return;
            }
            if (snap) snapshots++;
            if (meta) withMeta++;
            // Fill only what the live fetch could not; a dead page's link becomes the snapshot.
            await pool.query(
              `UPDATE pieces SET
                 wayback_url = CASE WHEN $2 = 'dead' THEN coalesce($3, wayback_url) ELSE wayback_url END,
                 title = coalesce(title, $4), dek = coalesce(dek, $5), image_url = coalesce(image_url, $6),
                 byline = coalesce(byline, $7), publication_name = coalesce(publication_name, $8),
                 published_at = coalesce(published_at, $9), word_count = coalesce(word_count, $10),
                 lang = coalesce(lang, $11), section = coalesce(section, $12),
                 tags = CASE WHEN cardinality(tags) = 0 THEN $13 ELSE tags END,
                 tags_text = coalesce(tags_text, $14), is_article = coalesce(is_article, $15),
                 archive_need = NULL
               WHERE id = $1`,
              [
                row.id,
                row.archive_need,
                snap,
                meta?.title ?? null,
                meta?.dek ?? null,
                meta?.image ?? null,
                meta?.authors.length ? meta.authors.join(", ") : null,
                meta?.siteName ?? null,
                meta?.publishedAt ?? null,
                storedWordCount(meta, row.paywall),
                meta?.lang ?? null,
                meta?.section ?? null,
                meta?.tags ?? [],
                meta?.tags.length ? meta.tags.join(" ") : null,
                meta ? meta.isArticleType : null,
              ],
            );
          } catch (err) {
            log(`error on ${row.canonical_url}: ${(err as Error).message}`);
          } finally {
            done++;
            if (done % 100 === 0) {
              const rate = done / ((Date.now() - started) / 1000);
              log(
                `${done.toLocaleString()} / ${rows.length.toLocaleString()} (${rate.toFixed(2)}/s) snapshots=${snapshots} with metadata=${withMeta} deferred=${deferred}`,
              );
            }
          }
        }),
      ),
    );
    log(`done: ${done.toLocaleString()} looked up, ${snapshots} snapshots, ${withMeta} with metadata, ${deferred} deferred to a later run`);
  } finally {
    await closeReadMeta();
    await pool.end();
  }
}
