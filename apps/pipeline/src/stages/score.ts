/**
 * score — final selection.
 *
 * For every fetched piece on an included/auto site: recompute community stats
 * from its mentions (after fetch:meta merges), editorial and acclaim scores,
 * apply scope filters and eligibility, then rank and cut:
 *   classic lane → top CLASSIC_TARGET, rising lane → top RISING_TARGET.
 * Also: award matching, publications for new sites, authors, slugs, gems.
 *
 * Flags: --classic=N, --rising=N to change the cutoffs.
 */
import type { Pool, PoolClient } from "pg";
import {
  acclaimScore,
  communityStats,
  editorialScore,
  eligibility,
  pieceSlug,
  slugify,
  totalScore,
  type Award,
  type AwardHit,
  type AwardResult,
  type EditorialPick,
  type Mention,
} from "@hackerreads/shared";
import { createNodeDb } from "@hackerreads/db/node";
import { thresholds } from "../lib/config";
import { exclusionReason } from "../lib/filters";
import { log } from "../lib/log";
import { cleanTitle, matchScore, type MatchAward, type MatchPiece } from "../lib/match";
import { copyInto, queryWithRetry, withClient } from "../lib/pgcopy";

export const CLASSIC_TARGET = 3000;
const RISING_TARGET = 200;
const GEM_MAX_HN_POINTS = 100;
const PLATFORM_HOSTS = /(^|\.)(substack\.com|medium\.com|blogspot\.com|wordpress\.com|github\.io|tumblr\.com|ghost\.io|bearblog\.dev|micro\.blog)$/;

type PieceRow = {
  id: number;
  canonical_url: string;
  url: string;
  domain: string;
  domain_status: string;
  publication_id: number | null;
  publication_paywall: string | null;
  title: string | null;
  source_title: string | null;
  byline: string | null;
  publication_name: string | null;
  published_at: string | null;
  word_count: number | null;
  lang: string | null;
  section: string | null;
  tags: string[];
  http_status: number | null;
  wayback_url: string | null;
  first_rec: Date | null;
  is_article: boolean | null;
};

function lengthBucket(words: number | null): string | null {
  if (words === null) return null;
  if (words < 3000) return "short";
  if (words < 7000) return "medium";
  return "long";
}

function humanizeDomain(domain: string): string {
  const host = domain.split("/")[0] ?? domain;
  const base = host.replace(/\.(com|org|net|co\.uk|co|io|us|info|blog)$/, "");
  const parts = base.split(".");
  return parts[parts.length - 1] ?? base;
}

export async function run(args: string[]): Promise<void> {
  const num = (flag: string, d: number) => Number(args.find((a) => a.startsWith(`--${flag}=`))?.split("=")[1] ?? d);
  const classicTarget = num("classic", CLASSIC_TARGET);
  const risingTarget = num("rising", RISING_TARGET);
  const t = thresholds();
  const { pool } = createNodeDb({ max: 2, queryTimeoutMs: 10 * 60_000 });
  try {
    const pieces = await queryWithRetry<PieceRow>(
      pool,
      `
        SELECT p.id, p.canonical_url, p.url, p.domain, d.status AS domain_status, p.publication_id,
               pub.paywall AS publication_paywall, p.title, p.source_title, p.byline, p.publication_name,
               p.published_at::text AS published_at, p.word_count, p.lang, p.section, p.tags,
               p.http_status, p.wayback_url, p.first_rec, p.is_article
        FROM pieces p
        JOIN domains d ON d.domain = p.domain
        LEFT JOIN publications pub ON pub.id = p.publication_id
        WHERE p.fetched_at IS NOT NULL`,
    );
    log(`${pieces.length.toLocaleString()} fetched pieces`);

    const mentionsBy = new Map<number, Mention[]>();
    for await (const m of readMentions(pool)) {
      const list = mentionsBy.get(m.piece_id) ?? [];
      list.push({
        source: m.source as Mention["source"],
        kind: m.kind as Mention["kind"],
        person: m.person_hash,
        ts: m.ts.getTime(),
        points: m.points,
        ownTextLen: m.own_text_len,
        subreddit: m.subreddit,
      });
      mentionsBy.set(m.piece_id, list);
    }

    const picksBy = new Map<number, EditorialPick[]>();
    const curatorTags = new Map<number, string[]>();
    for (const p of (
      await pool.query<{ piece_id: number; source: string; kind: string; tags: string | null }>(
        "SELECT piece_id, source, kind, tags FROM editorial_picks WHERE piece_id IS NOT NULL",
      )
    ).rows) {
      const list = picksBy.get(p.piece_id) ?? [];
      list.push({ source: p.source as EditorialPick["source"], kind: p.kind as EditorialPick["kind"] });
      picksBy.set(p.piece_id, list);
      if (p.tags) curatorTags.set(p.piece_id, [...(curatorTags.get(p.piece_id) ?? []), ...p.tags.split(",")]);
    }

    // ---- award matching
    const awards = (
      await pool.query<{ id: number; award: string; year: number; title: string; author: string | null; publication: string | null; result: string }>(
        "SELECT id, award, year, title, author, publication, result FROM awards",
      )
    ).rows;
    const pubNames = new Map<number, string>(
      (await pool.query<{ id: number; name: string }>("SELECT id, name FROM publications")).rows.map((r) => [r.id, r.name]),
    );
    const matchPieces: MatchPiece[] = pieces.map((p) => ({
      id: p.id,
      title: p.title ?? p.source_title,
      byline: p.byline,
      publicationNames: [p.publication_name, p.publication_id ? (pubNames.get(p.publication_id) ?? null) : null],
      domain: p.domain,
      year: p.published_at ? Number(p.published_at.slice(0, 4)) : null,
    }));
    const byYear = new Map<number | null, MatchPiece[]>();
    for (const p of matchPieces) {
      const list = byYear.get(p.year) ?? [];
      list.push(p);
      byYear.set(p.year, list);
    }
    const hitsBy = new Map<number, AwardHit[]>();
    const awardMatches: [number, number, number][] = [];
    for (const a of awards) {
      const ma: MatchAward = { award: a.award, year: a.year, title: a.title, author: a.author, publication: a.publication, titled: a.award !== "pulitzer" };
      // only pieces from plausible years (matchScore re-checks the window)
      const pool2 = [a.year - 2, a.year - 1, a.year, null].flatMap((y) => byYear.get(y) ?? []);
      const scored = pool2.map((p) => ({ id: p.id, s: matchScore(ma, p) })).filter((x) => x.s > 0);
      let winners: { id: number; s: number }[] = [];
      if (ma.titled) {
        // titled awards: the single best title match
        const best = scored.sort((x, y) => y.s - x.s || x.id - y.id)[0];
        if (best) winners = [best];
      } else if (scored.length <= 3) {
        // Pulitzer citations carry no title: credit every piece by that writer at that
        // publication in the award window (a series), and nothing when it is ambiguous.
        winners = scored;
      }
      for (const w of winners) {
        awardMatches.push([a.id, w.id, w.s]);
        const list = hitsBy.get(w.id) ?? [];
        list.push({ award: a.award as Award, result: a.result as AwardResult });
        hitsBy.set(w.id, list);
      }
    }
    log(`awards matched: ${awardMatches.length} of ${awards.length}`);

    // ---- per-piece evaluation
    type Evaluated = {
      row: PieceRow;
      reason: string | null;
      lane: "classic" | "rising";
      score: number;
      c: number;
      d: number;
      e: number;
      a: number;
      curators: number;
      stats: ReturnType<typeof communityStats>;
    };
    const evaluated: Evaluated[] = [];
    for (const row of pieces) {
      const stats = communityStats(mentionsBy.get(row.id) ?? [], t);
      const { e, curators } = editorialScore(picksBy.get(row.id) ?? []);
      const a = acclaimScore(hitsBy.get(row.id) ?? []);
      // Undated pieces stay in the classic lane (rising requires a known 2024+ publication date).
      const publishedYear = row.published_at ? Number(row.published_at.slice(0, 4)) : null;
      const { eligible, lane } = eligibility({ community: stats, e, curators, a, publishedYear });
      let reason: string | null = null;
      if (row.domain_status !== "include" && row.domain_status !== "auto") reason = "site-not-included";
      else if (!(row.title ?? row.source_title)) reason = "no-title";
      else {
        reason = exclusionReason({
          url: row.canonical_url,
          title: row.title ?? row.source_title,
          section: row.section,
          tags: [...row.tags, ...(curatorTags.get(row.id) ?? [])],
          lang: row.lang,
          wordCount: row.word_count,
          // trusted when length is unknown: sites marked include (config publications or reviewed)
          knownPublication: row.domain_status === "include",
          httpStatus: row.http_status,
          waybackUrl: row.wayback_url,
          recommendedYears: stats.years,
        });
      }
      // Sites nobody reviewed must look like an article: declared article type plus a byline or date.
      if (!reason && row.domain_status === "auto" && !(row.is_article && (row.byline || row.published_at))) reason = "not-article-like";
      if (!reason && !eligible) reason = "not-enough-signal";
      evaluated.push({ row, reason, lane, score: totalScore(stats.c, stats.d, e, a), c: stats.c, d: stats.d, e, a, curators, stats });
    }

    // ---- cutoffs
    const byScore = (x: Evaluated, y: Evaluated) => y.score - x.score || y.stats.people - x.stats.people || x.row.id - y.row.id;
    const eligibleClassic = evaluated.filter((x) => !x.reason && x.lane === "classic").sort(byScore);
    const eligibleRising = evaluated.filter((x) => !x.reason && x.lane === "rising").sort(byScore);
    for (const x of eligibleClassic.slice(classicTarget)) x.reason = "below-cutoff";
    for (const x of eligibleRising.slice(risingTarget)) x.reason = "below-cutoff";
    const included = [...eligibleClassic.slice(0, classicTarget), ...eligibleRising.slice(0, risingTarget)];
    log(
      `eligible classic=${eligibleClassic.length} rising=${eligibleRising.length} → included ${included.length}` +
        (eligibleClassic.length ? `; classic cutoff score ${eligibleClassic[Math.min(classicTarget, eligibleClassic.length) - 1]?.score}` : ""),
    );

    // gems: community score in the top 40% of included classics, but never big on HN
    const classicC = included.filter((x) => x.lane === "classic").map((x) => x.c).sort((p, q) => q - p);
    const gemCut = classicC[Math.floor(classicC.length * 0.4)] ?? Number.POSITIVE_INFINITY;
    const reasons = new Map<string, number>();
    for (const x of evaluated) if (x.reason) reasons.set(x.reason, (reasons.get(x.reason) ?? 0) + 1);
    log(`exclusions: ${[...reasons].sort((p, q) => q[1] - p[1]).map(([k, v]) => `${k}=${v}`).join(", ")}`);

    await withClient(pool, async (client) => {
      await client.query("BEGIN");
      // award matches
      await client.query("UPDATE awards SET piece_id = NULL, match_score = NULL");
      await client.query("DELETE FROM award_matches");
      await copyInto(client, "award_matches", ["award_id", "piece_id", "match_score"], awardMatches);
      // awards.piece_id keeps the strongest match for quick lookups
      await client.query(`
        UPDATE awards a SET piece_id = m.piece_id, match_score = m.match_score
        FROM (SELECT DISTINCT ON (award_id) award_id, piece_id, match_score FROM award_matches
              ORDER BY award_id, match_score DESC, piece_id) m
        WHERE m.award_id = a.id`);

      const includedIds = new Set(included.map((x) => x.row.id));
      const pubIdFor = await ensurePublications(client, included.map((x) => x.row));

      await client.query(`CREATE TEMP TABLE score_in (
        id int, status text, exclude_reason text, lane text, gem boolean, score real, c real, d real, e real, a real,
        people int, months int, years int, span_months int, curators int, first_rec timestamptz, last_rec timestamptz,
        hn_max_points int, community_sources text[], publication_id int, length_bucket text, slug text, rank int,
        publication_name text, rec_years text, title text
      ) ON COMMIT DROP`);
      const rankOf = new Map<number, number>();
      [...included].sort(byScore).forEach((x, i) => rankOf.set(x.row.id, i + 1));
      await copyInto(
        client,
        "score_in",
        [
          "id", "status", "exclude_reason", "lane", "gem", "score", "c", "d", "e", "a", "people", "months", "years",
          "span_months", "curators", "first_rec", "last_rec", "hn_max_points", "community_sources", "publication_id",
          "length_bucket", "slug", "rank", "publication_name", "rec_years", "title",
        ],
        evaluated.map((x) => {
          const inc = includedIds.has(x.row.id);
          const pubId = x.row.publication_id ?? pubIdFor.get(x.row.domain) ?? null;
          return [
            x.row.id,
            inc ? "included" : "excluded",
            inc ? null : x.reason,
            x.lane,
            inc && x.lane === "classic" && x.c >= gemCut && x.stats.hnMaxPoints < GEM_MAX_HN_POINTS,
            x.score,
            x.c,
            x.d,
            x.e,
            x.a,
            x.stats.people,
            x.stats.months,
            x.stats.years,
            x.stats.spanMonths,
            x.curators,
            x.stats.firstRec ? new Date(x.stats.firstRec) : null,
            x.stats.lastRec ? new Date(x.stats.lastRec) : null,
            x.stats.hnMaxPoints,
            x.stats.sources,
            pubId,
            lengthBucket(x.row.word_count),
            inc
              ? pieceSlug(
                  cleanTitle(x.row.title ?? x.row.source_title ?? "", [x.row.publication_name, pubId ? pubNames.get(pubId) : null], x.row.domain),
                  x.row.id,
                )
              : null,
            rankOf.get(x.row.id) ?? null,
            pubId ? (pubNames.get(pubId) ?? x.row.publication_name) : x.row.publication_name,
            `{${x.stats.yearList.join(",")}}`,
            cleanTitle(x.row.title ?? x.row.source_title ?? "", [x.row.publication_name, pubId ? pubNames.get(pubId) : null], x.row.domain),
          ];
        }),
      );
      await client.query(`
        UPDATE pieces p SET
          status = s.status, exclude_reason = s.exclude_reason, lane = s.lane, gem = s.gem, score = s.score,
          c = s.c, d = s.d, e = s.e, a = s.a, people = s.people, months = s.months, years = s.years,
          span_months = s.span_months, curators = s.curators, first_rec = s.first_rec, last_rec = s.last_rec,
          hn_max_points = s.hn_max_points, community_sources = s.community_sources,
          publication_id = s.publication_id, length_bucket = s.length_bucket, slug = s.slug, rank = s.rank,
          publication_name = s.publication_name, rec_years = s.rec_years::smallint[],
          title = s.title,
          paywall = (SELECT paywall FROM publications WHERE id = s.publication_id),
          editorial_sources = coalesce((SELECT array_agg(DISTINCT source ORDER BY source) FROM editorial_picks ep WHERE ep.piece_id = p.id), '{}')
        FROM score_in s WHERE s.id = p.id`);

      await rebuildAuthors(client, included.map((x) => x.row));
      await client.query("COMMIT");
    });

    const lanes = (await pool.query<{ lane: string; n: number }>("SELECT lane, count(*)::int n FROM pieces WHERE status = 'included' GROUP BY 1")).rows;
    log(`included: ${lanes.map((l) => `${l.lane}=${l.n}`).join(", ")}`);
  } finally {
    await pool.end();
  }
}

/** Create publications for included pieces on sites not in config (one per site key). */
async function ensurePublications(client: PoolClient, rows: PieceRow[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const bySite = new Map<string, Map<string, number>>();
  for (const r of rows) {
    if (r.publication_id !== null) continue;
    const names = bySite.get(r.domain) ?? new Map<string, number>();
    const n = r.publication_name?.trim();
    if (n && n.length <= 80) names.set(n, (names.get(n) ?? 0) + 1);
    bySite.set(r.domain, names);
  }
  for (const [domain, names] of bySite) {
    const name = [...names.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? humanizeDomain(domain);
    const host = domain.split("/")[0] ?? domain;
    const kind = PLATFORM_HOSTS.test(host) || domain.includes("/") ? "independent" : "publisher";
    let slug = slugify(name) || slugify(domain);
    const taken = await client.query<{ id: number; homepage: string | null }>("SELECT id, homepage FROM publications WHERE slug = $1", [slug]);
    const existing = taken.rows[0];
    if (existing && existing.homepage === `https://${domain}`) {
      out.set(domain, existing.id);
      await client.query("UPDATE domains SET publication_id = $2 WHERE domain = $1", [domain, existing.id]);
      continue;
    }
    if (existing) slug = slugify(`${name} ${domain}`);
    const ins = await client.query<{ id: number }>(
      `INSERT INTO publications (slug, name, paywall, kind, homepage) VALUES ($1, $2, 'unknown', $3, $4)
       ON CONFLICT (slug) DO UPDATE SET name = excluded.name RETURNING id`,
      [slug, name, kind, `https://${domain}`],
    );
    const id = ins.rows[0]?.id;
    if (id !== undefined) {
      out.set(domain, id);
      await client.query("UPDATE domains SET publication_id = $2 WHERE domain = $1", [domain, id]);
    }
  }
  return out;
}

/** Authors and piece_authors for included pieces, from the byline. */
async function rebuildAuthors(client: PoolClient, rows: PieceRow[]): Promise<void> {
  await client.query("DELETE FROM piece_authors");
  const authorIds = new Map<string, number>();
  for (const r of (await client.query<{ id: number; slug: string }>("SELECT id, slug FROM authors")).rows) authorIds.set(r.slug, r.id);
  const links: [number, number, number][] = [];
  for (const r of rows) {
    if (!r.byline) continue;
    const names = r.byline.split(/\s*,\s*/).filter(Boolean).slice(0, 6);
    for (const [i, name] of names.entries()) {
      const slug = slugify(name);
      if (!slug) continue;
      let id = authorIds.get(slug);
      if (id === undefined) {
        const ins = await client.query<{ id: number }>(
          "INSERT INTO authors (slug, name) VALUES ($1, $2) ON CONFLICT (slug) DO UPDATE SET name = authors.name RETURNING id",
          [slug, name],
        );
        id = ins.rows[0]?.id;
        if (id === undefined) continue;
        authorIds.set(slug, id);
      }
      if (!links.some(([p, a]) => p === r.id && a === id)) links.push([r.id, id, i]);
    }
  }
  await copyInto(client, "piece_authors", ["piece_id", "author_id", "position"], links);
  await client.query("DELETE FROM authors a WHERE NOT EXISTS (SELECT 1 FROM piece_authors pa WHERE pa.author_id = a.id)");
}

type MentionRow = { piece_id: number; source: string; kind: string; person_hash: string; ts: Date; points: number | null; own_text_len: number | null; subreddit: string | null };

/**
 * All mentions, in id ranges: one 1M-row result takes minutes to stream, and Neon has been
 * dropping connections that long. Each range is retried on its own.
 */
async function* readMentions(pool: Pool, step = 100_000): AsyncGenerator<MentionRow> {
  const [bounds] = await queryWithRetry<{ lo: number | null; hi: number | null }>(pool, "SELECT min(id)::int lo, max(id)::int hi FROM mentions");
  if (bounds?.lo == null || bounds.hi == null) return;
  for (let from = bounds.lo; from <= bounds.hi; from += step) {
    yield* await queryWithRetry<MentionRow>(
      pool,
      "SELECT piece_id, source, kind, person_hash, ts, points, own_text_len, subreddit FROM mentions WHERE id >= $1 AND id < $2",
      [from, from + step],
    );
  }
}
