/**
 * prescore — pick candidate URLs and push them to Postgres.
 *
 * 1. Load every crawled JSONL into the local DuckDB staging tables.
 * 2. Canonicalise every distinct raw URL (shared canonicalizeUrl) → url_map.
 * 3. Aggregate community signals per canonical URL in SQL, using the same
 *    thresholds as packages/shared/src/score.ts.
 * 4. Keep candidates (rules below), classify their sites, and write
 *    publications, domains, pieces, mentions and editorial_picks to Postgres.
 * 5. Write config/domains_review.csv for the one-time site review.
 *
 * Candidate rules (before metadata is fetched):
 *   - ≥2 people across ≥2 months, or
 *   - ≥1 person and at least one editorial pick, or
 *   - on a known publication: ≥1 person and ≥2 mentions in total (old URL
 *     variants get merged after redirects are followed in fetch:meta).
 * Rule-excluded sites and site front pages are dropped.
 */
import { existsSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { DuckDBConnection } from "@duckdb/node-api";
import { canonicalizeUrl, communityStats, isRootLike, type Mention, type ThresholdConfig } from "@hackerreads/shared";
import { createNodeDb } from "@hackerreads/db/node";
import { publicationsConfig, rewriteRules, thresholds } from "../lib/config";
import { duck, lit, rows } from "../lib/duck";
import { personHash } from "../lib/hash";
import { loadEditorial, loadMentions, rawFile } from "../lib/jsonl";
import { log } from "../lib/log";
import { CONFIG_DIR } from "../lib/paths";
import { copyInto, withClient } from "../lib/pgcopy";
import { makeClassifier, type SiteClass } from "../lib/sites";
import { ensureStaging } from "../lib/staging";
import { isViable } from "../lib/viable";

const EDITORIAL_FILES = ["longform", "longreads", "kottke", "mr", "ald", "browser"];
/** Sites with fewer viable candidates are checked automatically at fetch time (article rules). */
const REVIEW_MIN_VIABLE = 20;

export function qualifyingSql(t: ThresholdConfig): string {
  const subCases = Object.entries(t.redditSubPoints)
    .map(([sub, min]) => `WHEN ${lit(sub)} THEN ${Number(min)}`)
    .join(" ");
  const redditMin = subCases ? `CASE lower(subreddit) ${subCases} ELSE ${t.redditDefaultPoints} END` : String(t.redditDefaultPoints);
  return `(
    (kind = 'comment' AND coalesce(own_text_len, 0) >= ${t.commentOwnText})
    OR (source = 'hn' AND kind = 'story' AND coalesce(points, 0) >= ${t.hnStoryPoints})
    OR (source = 'reddit' AND kind = 'post' AND coalesce(points, 0) >= ${redditMin})
    OR (source = 'lobsters' AND kind = 'story' AND coalesce(points, 0) >= ${t.lobstersPoints})
    OR (source = 'metafilter' AND kind <> 'comment')
  )`;
}

async function loadRaw(c: DuckDBConnection): Promise<void> {
  for (const name of EDITORIAL_FILES) {
    const f = rawFile(`${name}.jsonl`);
    if (existsSync(f)) await loadEditorial(c, name, f);
  }
  const reddit = rawFile("reddit.jsonl");
  if (existsSync(reddit)) await loadMentions(c, "reddit", reddit);
  const counts = await rows<{ s: string }>(
    c,
    `SELECT string_agg(source || '=' || n::VARCHAR, ', ' ORDER BY source) AS s FROM (
       SELECT source, count(*) n FROM mentions_raw GROUP BY 1 UNION ALL SELECT source, count(*) FROM editorial_raw GROUP BY 1)`,
  );
  log(`staged rows: ${counts[0]?.s}`);
}

async function fillUrlMap(c: DuckDBConnection): Promise<void> {
  const rules = rewriteRules();
  // Rebuilt every run so changes to canonicalizeUrl or the rewrite rules always apply (~2 min).
  await c.run("DELETE FROM url_map");
  await c.run(`
    CREATE OR REPLACE TEMP TABLE todo AS
    SELECT row_number() OVER () AS rn, url_raw FROM (
      SELECT url_raw FROM mentions_raw UNION SELECT url_raw FROM editorial_raw
    ) u
    WHERE NOT EXISTS (SELECT 1 FROM url_map m WHERE m.url_raw = u.url_raw)
  `);
  const [{ n }] = (await rows<{ n: bigint }>(c, "SELECT count(*) AS n FROM todo")) as [{ n: bigint }];
  const total = Number(n);
  log(`canonicalising ${total.toLocaleString()} raw URLs`);
  const BATCH = 250_000;
  for (let start = 1; start <= total; start += BATCH) {
    const batch = await rows<{ url_raw: string }>(
      c,
      `SELECT url_raw FROM todo WHERE rn >= ${start} AND rn < ${start + BATCH}`,
    );
    const app = await c.createAppender("url_map");
    for (const { url_raw } of batch) {
      app.appendVarchar(url_raw);
      const canon = canonicalizeUrl(url_raw, rules);
      if (canon) app.appendVarchar(canon);
      else app.appendNull();
      app.endRow();
    }
    app.flushSync();
    app.closeSync();
    log(`url_map: ${Math.min(start + BATCH - 1, total).toLocaleString()} / ${total.toLocaleString()}`);
  }
}

type Agg = {
  canonical_url: string;
  people: number;
  months: number;
  total: number;
  has_editorial: boolean;
};

async function aggregate(c: DuckDBConnection, t: ThresholdConfig): Promise<Agg[]> {
  await c.run(`
    CREATE OR REPLACE TEMP TABLE agg AS
    WITH m AS (
      SELECT u.canonical_url, r.*, ${qualifyingSql(t)} AS q
      FROM mentions_raw r JOIN url_map u USING (url_raw)
      WHERE u.canonical_url IS NOT NULL
    ),
    e AS (
      SELECT DISTINCT u.canonical_url FROM editorial_raw r JOIN url_map u USING (url_raw)
      WHERE u.canonical_url IS NOT NULL
    )
    SELECT
      row_number() OVER () AS rn,
      m.canonical_url,
      count(DISTINCT m.source || ':' || m.person) FILTER (WHERE q)::INTEGER AS people,
      count(DISTINCT strftime(m.ts, '%Y-%m')) FILTER (WHERE q)::INTEGER AS months,
      count(*)::INTEGER AS total,
      bool_or(e.canonical_url IS NOT NULL) AS has_editorial
    FROM m LEFT JOIN e USING (canonical_url)
    GROUP BY m.canonical_url
    HAVING count(DISTINCT m.source || ':' || m.person) FILTER (WHERE q) >= 1
       -- necessary for every candidate rule below (≥2 people, an editorial pick, or ≥2 mentions)
       AND (count(*) >= 2 OR bool_or(e.canonical_url IS NOT NULL))
  `);
  const [{ n }] = (await rows<{ n: bigint }>(c, "SELECT count(*) AS n FROM agg")) as [{ n: bigint }];
  const total = Number(n);
  log(`${total.toLocaleString()} URLs have a qualifying recommendation and a second mention or pick`);
  const out: Agg[] = [];
  const BATCH = 500_000;
  for (let start = 1; start <= total; start += BATCH) {
    const batch = await rows<Agg>(
      c,
      `SELECT canonical_url, people, months, total, has_editorial FROM agg WHERE rn >= ${start} AND rn < ${start + BATCH}`,
    );
    for (const r of batch) out.push(r);
  }
  return out;
}

export function isCandidate(a: Agg, cls: SiteClass): boolean {
  if (cls.preset === "exclude" || isRootLike(a.canonical_url)) return false;
  if (a.people >= 2 && a.months >= 2) return true;
  if (a.people >= 1 && a.has_editorial) return true;
  if (cls.publication && a.people >= 1 && a.total >= 2) return true;
  return false;
}

type MentionOut = {
  canonical_url: string;
  source: string;
  item_id: string;
  person: string;
  ts: Date;
  kind: string;
  points: number | null;
  own_text_len: number | null;
  subreddit: string | null;
  title: string | null;
};

type PickOut = {
  canonical_url: string;
  source: string;
  kind: string;
  year: number | null;
  url_raw: string;
  ref_url: string | null;
  title: string | null;
  tags: string | null;
};

function mostCommon(values: (string | null | undefined)[]): string | null {
  const counts = new Map<string, number>();
  for (const v of values) {
    const s = v?.trim();
    if (s) counts.set(s, (counts.get(s) ?? 0) + 1);
  }
  let best: string | null = null;
  let bestN = 0;
  for (const [s, n] of counts) {
    if (n > bestN) {
      best = s;
      bestN = n;
    }
  }
  return best;
}

export async function run(): Promise<void> {
  const t = thresholds();
  const classify = makeClassifier();
  const c = await duck();
  await ensureStaging(c);
  await loadRaw(c);
  await fillUrlMap(c);
  const aggs = await aggregate(c, t);

  // URLs that fetch:meta found to be variants (redirects, rel=canonical, merges) of another piece.
  const aliasOf = new Map<string, string>();
  {
    const { pool: aliasPool } = createNodeDb({ max: 1 });
    try {
      for (const r of (
        await aliasPool.query<{ canonical_url: string; alias: string }>(
          "SELECT canonical_url, unnest(alias_urls) AS alias FROM pieces WHERE cardinality(alias_urls) > 0",
        )
      ).rows) {
        aliasOf.set(r.alias, r.canonical_url);
      }
    } finally {
      await aliasPool.end();
    }
  }
  const resolveAlias = (u: string) => aliasOf.get(u) ?? u;

  // Group raw canonical URLs by the piece they resolve to; a known alias always counts.
  const byResolved = new Map<string, { agg: Agg; members: string[] }>();
  for (const a of aggs) {
    const target = resolveAlias(a.canonical_url);
    const cls = classify(target);
    if (!aliasOf.has(a.canonical_url) && !isCandidate(a, cls)) continue;
    const e = byResolved.get(target);
    if (e) {
      e.members.push(a.canonical_url);
      e.agg = {
        canonical_url: target,
        people: Math.max(e.agg.people, a.people),
        months: Math.max(e.agg.months, a.months),
        total: e.agg.total + a.total,
        has_editorial: e.agg.has_editorial || a.has_editorial,
      };
    } else {
      byResolved.set(target, { agg: { ...a, canonical_url: target }, members: [a.canonical_url] });
    }
  }
  const classes = new Map<string, SiteClass>();
  const candidates: Agg[] = [];
  const memberOf = new Map<string, string>();
  for (const [target, e] of byResolved) {
    candidates.push(e.agg);
    classes.set(target, classify(target));
    for (const m of e.members) memberOf.set(m, target);
  }
  log(`${candidates.length.toLocaleString()} candidates (${aliasOf.size.toLocaleString()} known aliases)`);

  // Candidate list back into DuckDB to pull their mentions and picks.
  await c.run("CREATE OR REPLACE TEMP TABLE cand (canonical_url VARCHAR PRIMARY KEY, target VARCHAR NOT NULL)");
  const app = await c.createAppender("cand");
  for (const [member, target] of memberOf) {
    app.appendVarchar(member);
    app.appendVarchar(target);
    app.endRow();
  }
  app.flushSync();
  app.closeSync();

  const mentions = await rows<MentionOut>(
    c,
    `SELECT DISTINCT ON (cand.target, r.source, r.item_id)
       cand.target AS canonical_url, r.source, r.item_id, r.person, r.ts, r.kind, r.points, r.own_text_len, r.subreddit, r.title
     FROM mentions_raw r JOIN url_map u USING (url_raw) JOIN cand ON cand.canonical_url = u.canonical_url`,
  );
  const picks = await rows<PickOut>(
    c,
    `SELECT DISTINCT ON (cand.target, r.source, r.kind)
       cand.target AS canonical_url, r.source, r.kind, r.year, r.url_raw, r.ref_url, r.title, r.tags
     FROM editorial_raw r JOIN url_map u USING (url_raw) JOIN cand ON cand.canonical_url = u.canonical_url
     ORDER BY cand.target, r.source, r.kind, r.year`,
  );
  log(`${mentions.length.toLocaleString()} mentions, ${picks.length.toLocaleString()} editorial picks for candidates`);

  const mentionsByUrl = new Map<string, MentionOut[]>();
  for (const m of mentions) {
    const list = mentionsByUrl.get(m.canonical_url);
    if (list) list.push(m);
    else mentionsByUrl.set(m.canonical_url, [m]);
  }
  const picksByUrl = new Map<string, PickOut[]>();
  for (const p of picks) {
    const list = picksByUrl.get(p.canonical_url);
    if (list) list.push(p);
    else picksByUrl.set(p.canonical_url, [p]);
  }

  const { pool } = createNodeDb({ max: 2 });
  try {
    await withClient(pool, async (client) => {
      await client.query("BEGIN");

      // publications from config
      const pubs = publicationsConfig();
      for (const p of pubs) {
        await client.query(
          `INSERT INTO publications (slug, name, paywall, kind, homepage) VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (slug) DO UPDATE SET name = excluded.name, paywall = excluded.paywall, kind = excluded.kind, homepage = excluded.homepage`,
          [p.slug, p.name, p.paywall, p.kind, `https://${p.domains[0]}`],
        );
      }
      const pubIds = new Map<string, number>(
        (await client.query<{ id: number; slug: string }>("SELECT id, slug FROM publications")).rows.map((r) => [r.slug, r.id]),
      );

      // pieces (upsert, keeping any fetched metadata)
      await client.query(`CREATE TEMP TABLE pieces_in (
        canonical_url text, domain text, publication_id int, source_title text,
        people int, months int, years int, span_months int, c real, d real,
        first_rec timestamptz, last_rec timestamptz, hn_max_points int,
        community_sources text[], editorial_sources text[]
      ) ON COMMIT DROP`);
      const pieceRows = candidates.map((a) => {
        const ms = mentionsByUrl.get(a.canonical_url) ?? [];
        const stats = communityStats(
          ms.map(
            (m): Mention => ({
              source: m.source as Mention["source"],
              kind: m.kind as Mention["kind"],
              person: m.person,
              ts: new Date(m.ts).getTime(),
              points: m.points,
              ownTextLen: m.own_text_len,
              subreddit: m.subreddit,
            }),
          ),
          t,
        );
        const cls = classes.get(a.canonical_url) as SiteClass;
        const ps = picksByUrl.get(a.canonical_url) ?? [];
        const title = mostCommon([...ms.map((m) => m.title), ...ps.map((p) => p.title)]);
        return [
          a.canonical_url,
          cls.siteKey,
          cls.publication ? (pubIds.get(cls.publication.slug) ?? null) : null,
          title,
          stats.people,
          stats.months,
          stats.years,
          stats.spanMonths,
          stats.c,
          stats.d,
          stats.firstRec ? new Date(stats.firstRec) : null,
          stats.lastRec ? new Date(stats.lastRec) : null,
          stats.hnMaxPoints,
          stats.sources,
          [...new Set(ps.map((p) => p.source))].sort(),
        ] as const;
      });
      await copyInto(
        client,
        "pieces_in",
        [
          "canonical_url",
          "domain",
          "publication_id",
          "source_title",
          "people",
          "months",
          "years",
          "span_months",
          "c",
          "d",
          "first_rec",
          "last_rec",
          "hn_max_points",
          "community_sources",
          "editorial_sources",
        ],
        pieceRows.map((r) => [...r]),
      );
      await client.query("CREATE INDEX ON pieces_in (canonical_url)");
      await client.query("ANALYZE pieces_in");
      await client.query(`
        INSERT INTO pieces (canonical_url, url, domain, publication_id, source_title, people, months, years, span_months,
                            c, d, first_rec, last_rec, hn_max_points, community_sources, editorial_sources)
        SELECT canonical_url, canonical_url, domain, publication_id, source_title, people, months, years, span_months,
               c, d, first_rec, last_rec, hn_max_points, community_sources, editorial_sources
        FROM pieces_in
        ON CONFLICT (canonical_url) DO UPDATE SET
          domain = excluded.domain, publication_id = coalesce(excluded.publication_id, pieces.publication_id),
          source_title = excluded.source_title, people = excluded.people, months = excluded.months,
          years = excluded.years, span_months = excluded.span_months, c = excluded.c, d = excluded.d,
          first_rec = excluded.first_rec, last_rec = excluded.last_rec, hn_max_points = excluded.hn_max_points,
          community_sources = excluded.community_sources, editorial_sources = excluded.editorial_sources`);
      const removed = await client.query(
        `DELETE FROM pieces p WHERE p.status = 'candidate'
           AND NOT EXISTS (SELECT 1 FROM pieces_in i WHERE i.canonical_url = p.canonical_url)`,
      );
      log(`pieces upserted: ${pieceRows.length.toLocaleString()} (dropped ${removed.rowCount ?? 0} stale candidates)`);

      const ids = new Map<string, number>(
        (await client.query<{ id: number; canonical_url: string }>("SELECT id, canonical_url FROM pieces")).rows.map((r) => [
          r.canonical_url,
          r.id,
        ]),
      );

      // mentions (replace) — usernames are hashed here and never leave this machine
      await client.query("TRUNCATE mentions");
      const nMentions = await copyInto(
        client,
        "mentions",
        ["piece_id", "source", "source_item_id", "person_hash", "ts", "kind", "points", "own_text_len", "subreddit"],
        (function* () {
          for (const m of mentions) {
            const id = ids.get(m.canonical_url);
            if (id === undefined) continue;
            yield [id, m.source, m.item_id, personHash(m.source, m.person), new Date(m.ts), m.kind, m.points, m.own_text_len, m.subreddit];
          }
        })(),
      );
      log(`mentions copied: ${nMentions.toLocaleString()}`);

      // editorial picks (replace)
      await client.query("TRUNCATE editorial_picks");
      const nPicks = await copyInto(
        client,
        "editorial_picks",
        ["source", "kind", "year", "raw_url", "canonical_url", "ref_url", "title", "tags", "piece_id"],
        (function* () {
          for (const p of picks) {
            yield [p.source, p.kind, p.year, p.url_raw, p.canonical_url, p.ref_url, p.title, p.tags, ids.get(p.canonical_url) ?? null];
          }
        })(),
      );
      log(`editorial picks copied: ${nPicks.toLocaleString()}`);

      // domains: counts + samples; presets from config always win, a human's review is kept
      // per site: viable candidates (could still qualify) decide whether a human review is worth it
      const bySite = new Map<string, { cls: SiteClass; n: number; samples: string[] }>();
      for (let i = 0; i < candidates.length; i++) {
        const a = candidates[i] as Agg;
        const cls = classes.get(a.canonical_url) as SiteClass;
        const entry = bySite.get(cls.siteKey) ?? { cls, n: 0, samples: [] };
        const r = pieceRows[i];
        const viable =
          !!r &&
          isViable({
            people: r[4] as number,
            months: r[5] as number,
            curators: (r[14] as string[]).length,
            firstRec: r[10] as Date | null,
          });
        if (viable) {
          entry.n++;
          const title = r?.[3];
          if (entry.samples.length < 3 && typeof title === "string") entry.samples.push(title);
        }
        bySite.set(cls.siteKey, entry);
      }
      await client.query(`CREATE TEMP TABLE domains_in (domain text, publication_id int, preset text, candidate_count int, sample_titles text[]) ON COMMIT DROP`);
      await copyInto(
        client,
        "domains_in",
        ["domain", "publication_id", "preset", "candidate_count", "sample_titles"],
        [...bySite.entries()].map(([key, e]) => [
          key,
          e.cls.publication ? (pubIds.get(e.cls.publication.slug) ?? null) : null,
          e.cls.preset ?? (e.n < REVIEW_MIN_VIABLE ? "auto" : "review"),
          e.n,
          e.samples,
        ]),
      );
      await client.query(`
        INSERT INTO domains (domain, publication_id, status, candidate_count, sample_titles)
        SELECT domain, publication_id, preset, candidate_count, sample_titles FROM domains_in
        ON CONFLICT (domain) DO UPDATE SET
          publication_id = excluded.publication_id,
          candidate_count = excluded.candidate_count,
          sample_titles = excluded.sample_titles,
          status = CASE
            WHEN excluded.status IN ('include', 'exclude') AND excluded.publication_id IS NOT NULL THEN excluded.status
            WHEN domains.status IN ('include', 'exclude') AND domains.note = 'reviewed' THEN domains.status
            ELSE excluded.status END`);
      await client.query(`DELETE FROM domains d WHERE coalesce(d.note, '') <> 'reviewed'
        AND NOT EXISTS (SELECT 1 FROM pieces p WHERE p.domain = d.domain)`);
      await client.query("COMMIT");
    });

    // domains_review.csv for the human review
    const reviewRows = (
      await pool.query<{ domain: string; status: string; candidate_count: number; sample_titles: string[]; publication: string | null }>(
        `SELECT d.domain, d.status, d.candidate_count, d.sample_titles, p.name AS publication
         FROM domains d LEFT JOIN publications p ON p.id = d.publication_id
         WHERE d.status <> 'auto'
         ORDER BY d.candidate_count DESC, d.domain`,
      )
    ).rows;
    const csvCell = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
    const csv = [
      // auto sites (fewer than REVIEW_MIN_VIABLE viable candidates) are omitted; set any of them here to override
      "domain,status,candidates,publication,sample_titles",
      ...reviewRows.map((r) =>
        [r.domain, r.status, String(r.candidate_count), r.publication ?? "", r.sample_titles.join(" | ")].map(csvCell).join(","),
      ),
    ].join("\n");
    const out = resolve(CONFIG_DIR, "domains_review.csv");
    writeFileSync(out, `${csv}\n`);
    const tally = (await pool.query<{ status: string; n: number }>("SELECT status, count(*)::int n FROM domains GROUP BY 1 ORDER BY 1")).rows;
    log(`domains: ${tally.map((t) => `${t.status}=${t.n}`).join(", ")}; ${reviewRows.length} rows → ${out}`);
  } finally {
    await pool.end();
  }
}
