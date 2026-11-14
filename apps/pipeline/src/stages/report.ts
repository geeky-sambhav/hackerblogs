/**
 * report — catalog report for the cutoff review:
 * apps/pipeline/reports/catalog-report.md
 */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createNodeDb } from "@hackerreads/db/node";
import { log } from "../lib/log";
import { similarity } from "../lib/match";
import { PIPELINE_DIR, ensureDir } from "../lib/paths";

/** Widely recommended long reads, used to sanity-check recall (title matching only). */
const CANARIES = [
  "The Case for Reparations",
  "The Falling Man",
  "Frank Sinatra Has a Cold",
  "The Cost Conundrum",
  "Is Google Making Us Stupid?",
  "What Is Code?",
  "How to Do What You Love",
  "Meditations on Moloch",
  "Why the Future Doesn't Need Us",
  "My Four Months as a Private Prison Guard",
  "The Mind of a Con Man",
  "Losing Earth: The Decade We Almost Stopped Climate Change",
  "The Overprotected Kid",
  "The Coddling of the American Mind",
  "Hellhole",
  "Teach Yourself Programming in Ten Years",
  "Maker's Schedule, Manager's Schedule",
  "Beating the Averages",
  "The Invisible Army",
  "The Apostate",
];

export async function run(): Promise<void> {
  const { pool } = createNodeDb({ max: 1 });
  const q = async <T extends Record<string, unknown>>(sql: string) => (await pool.query<T>(sql)).rows;
  try {
    const lanes = await q<{ lane: string; n: number }>("SELECT lane, count(*)::int n FROM pieces WHERE status='included' GROUP BY 1 ORDER BY 1");
    const statuses = await q<{ status: string; n: number }>("SELECT status, count(*)::int n FROM pieces GROUP BY 1 ORDER BY 2 DESC");
    const reasons = await q<{ r: string; n: number }>("SELECT exclude_reason r, count(*)::int n FROM pieces WHERE status='excluded' GROUP BY 1 ORDER BY 2 DESC");
    const pubs = await q<{ name: string; n: number }>(
      "SELECT coalesce(pub.name, p.domain) name, count(*)::int n FROM pieces p LEFT JOIN publications pub ON pub.id = p.publication_id WHERE p.status='included' GROUP BY 1 ORDER BY 2 DESC LIMIT 40",
    );
    const decades = await q<{ d: string; n: number }>(
      "SELECT coalesce((extract(year from published_at)::int / 10 * 10)::text || 's', 'unknown') d, count(*)::int n FROM pieces WHERE status='included' GROUP BY 1 ORDER BY 1",
    );
    const areas = await q<{ name: string; n: number }>(
      "SELECT a.name, count(*)::int n FROM piece_areas pa JOIN areas a ON a.id = pa.area_id JOIN pieces p ON p.id = pa.piece_id WHERE p.status='included' GROUP BY 1 ORDER BY 2 DESC",
    );
    const [quality] = await q<Record<string, number>>(`
      SELECT count(*)::int total,
        count(*) FILTER (WHERE wayback_url IS NOT NULL)::int dead_with_archive,
        count(*) FILTER (WHERE image_url IS NULL)::int no_image,
        count(*) FILTER (WHERE published_at IS NULL)::int no_date,
        count(*) FILTER (WHERE byline IS NULL)::int no_byline,
        count(*) FILTER (WHERE word_count IS NULL)::int no_length,
        count(*) FILTER (WHERE http_status = -1)::int robots_blocked,
        count(*) FILTER (WHERE 'hn' = ANY(community_sources))::int with_hn,
        count(*) FILTER (WHERE 'reddit' = ANY(community_sources))::int with_reddit,
        count(*) FILTER (WHERE cardinality(editorial_sources) > 0)::int with_editorial,
        count(*) FILTER (WHERE a > 0)::int with_award,
        count(*) FILTER (WHERE gem)::int gems
      FROM pieces WHERE status='included'`);
    const top = await q<{ rank: number; title: string; pub: string; year: number | null; people: number; years: number; score: number; url: string }>(`
      SELECT p.rank, p.title, coalesce(pub.name, p.domain) pub, extract(year from p.published_at)::int AS year, p.people, p.years, p.score, p.url
      FROM pieces p LEFT JOIN publications pub ON pub.id = p.publication_id
      WHERE p.status='included' ORDER BY p.rank LIMIT 100`);
    const sample = await q<{ title: string; pub: string; url: string; lane: string }>(`
      SELECT p.title, coalesce(pub.name, p.domain) pub, p.url, p.lane
      FROM pieces p LEFT JOIN publications pub ON pub.id = p.publication_id
      WHERE p.status='included' ORDER BY md5(p.id::text) LIMIT 50`);
    // Match on the page title and on the title people shared it under: publishers retitle
    // pieces online ("Hellhole" is now "Is Long-Term Solitary Confinement Torture?").
    const titles = await q<{ title: string; source_title: string | null; status: string; reason: string | null }>(
      "SELECT coalesce(title, source_title) title, source_title, status, exclude_reason reason FROM pieces WHERE coalesce(title, source_title) IS NOT NULL",
    );
    const canaryRows = CANARIES.map((c) => {
      let best: { title: string; status: string; reason: string | null; s: number } | null = null;
      for (const t of titles) {
        const s = Math.max(similarity(c, t.title), t.source_title ? similarity(c, t.source_title) : 0);
        if (s >= 0.7 && (!best || s > best.s || (s === best.s && t.status === "included"))) best = { title: t.title, status: t.status, reason: t.reason, s };
      }
      return { canary: c, found: best };
    });
    const recall = canaryRows.filter((r) => r.found?.status === "included").length;

    const esc = (s: string | null | undefined) => (s ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");
    const pct = (n: number | undefined) => (quality?.total ? `${(((n ?? 0) / quality.total) * 100).toFixed(1)}%` : "–");
    const md = [
      "# HackerReads catalog report",
      "",
      `Generated ${new Date().toISOString()}.`,
      "",
      "## Totals",
      "",
      `Included: ${lanes.map((l) => `**${l.n}** ${l.lane}`).join(", ")}.`,
      "",
      `All pieces by status: ${statuses.map((s) => `${s.status} ${s.n}`).join(", ")}.`,
      "",
      "| Exclusion reason | Pieces |",
      "|---|---|",
      ...reasons.map((r) => `| ${r.r} | ${r.n} |`),
      "",
      "## Data quality (included pieces)",
      "",
      "| Measure | Count | Share |",
      "|---|---|---|",
      ...(
        [
          ["Recommended on Hacker News", quality?.with_hn],
          ["Recommended on Reddit", quality?.with_reddit],
          ["Has an editorial pick", quality?.with_editorial],
          ["Matched an award", quality?.with_award],
          ["Hidden gems", quality?.gems],
          ["Dead link, archived copy used", quality?.dead_with_archive],
          ["Blocked by robots.txt (metadata from archive or HN)", quality?.robots_blocked],
          ["No preview image", quality?.no_image],
          ["No publication date", quality?.no_date],
          ["No byline", quality?.no_byline],
          ["Length unknown (trusted publication)", quality?.no_length],
        ] as [string, number | undefined][]
      ).map(([k, v]) => `| ${k} | ${v ?? 0} | ${pct(v)} |`),
      "",
      `## Canary recall: ${recall} / ${CANARIES.length}`,
      "",
      "| Canary | Best match | Status |",
      "|---|---|---|",
      ...canaryRows.map((r) => `| ${esc(r.canary)} | ${esc(r.found?.title) || "—"} | ${r.found ? `${r.found.status}${r.found.reason ? ` (${r.found.reason})` : ""}` : "not a candidate"} |`),
      "",
      "## By publication (top 40)",
      "",
      "| Publication | Pieces |",
      "|---|---|",
      ...pubs.map((p) => `| ${esc(p.name)} | ${p.n} |`),
      "",
      "## By decade",
      "",
      "| Decade | Pieces |",
      "|---|---|",
      ...decades.map((d) => `| ${d.d} | ${d.n} |`),
      "",
      "## By area",
      "",
      "| Area | Pieces |",
      "|---|---|",
      ...areas.map((a) => `| ${esc(a.name)} | ${a.n} |`),
      "",
      "## Top 100",
      "",
      "| # | Title | Publication | Year | People | Years | Score |",
      "|---|---|---|---|---|---|---|",
      ...top.map((t) => `| ${t.rank} | [${esc(t.title)}](${t.url}) | ${esc(t.pub)} | ${t.year ?? ""} | ${t.people} | ${t.years} | ${t.score} |`),
      "",
      "## Random 50 for a hand check",
      "",
      ...sample.map((s) => `- [${esc(s.title)}](${s.url}) — ${esc(s.pub)}${s.lane === "rising" ? " (rising)" : ""}`),
      "",
    ].join("\n");
    const out = resolve(ensureDir(resolve(PIPELINE_DIR, "reports")), "catalog-report.md");
    writeFileSync(out, md);
    log(`report → ${out} (canary recall ${recall}/${CANARIES.length})`);
  } finally {
    await pool.end();
  }
}
