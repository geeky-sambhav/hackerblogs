/**
 * ingest:awards — awards and anthologies, written straight to Postgres
 * (`awards` table). They are matched to pieces later, in `score`.
 *
 *   pulitzer  Wikipedia: Feature Writing, Explanatory Reporting, Criticism,
 *             Commentary — winners and finalists (author + publication + year;
 *             the "title" stored is the citation, since Wikipedia lists no titles)
 *   nma       Wikipedia "National Magazine Awards": winners of the writing
 *             categories, with article titles
 *   polk      liu.edu past winners: entries with a quoted title
 *
 * Not included: the Best American anthologies. Their tables of contents are
 * not on Wikipedia, and Open Library's robots.txt disallows its search API.
 */
import * as cheerio from "cheerio";
import { sql } from "drizzle-orm";
import { createNodeDb, schema } from "@hackerreads/db/node";
import { politeFetch, politeJson } from "../lib/http";
import { log } from "../lib/log";

export type AwardRow = {
  award: string;
  category: string;
  year: number;
  result: "winner" | "finalist" | "anthologized";
  title: string;
  publication: string | null;
  author: string | null;
  sourceUrl: string;
};

const MIN_YEAR = 1995;

function clean(s: string): string {
  return s
    .replace(/\[\d+\]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Quoted titles inside a string: "…", “…”. */
export function quotedTitles(s: string): string[] {
  const out: string[] = [];
  for (const m of s.matchAll(/[“"]\s*([^”"]{3,200}?)\s*[,.]?\s*[”"]/g)) {
    const t = clean(m[1] ?? "").replace(/[,.;:]$/, "");
    if (t.length >= 3) out.push(t);
  }
  return out;
}

async function wikiHtml(page: string): Promise<string> {
  const url = `https://en.wikipedia.org/w/api.php?action=parse&page=${encodeURIComponent(page)}&prop=text&format=json&formatversion=2&redirects=1`;
  const r = await politeJson<{ parse?: { text: string }; error?: { info: string } }>(url, {
    minIntervalMs: 1000,
    ignoreRobots: true, // MediaWiki API, intended for programmatic use
  });
  if (!r.parse) throw new Error(`Wikipedia ${page}: ${r.error?.info ?? "no parse"}`);
  return r.parse.text;
}

// ---------------------------------------------------------------- Pulitzer

export function parsePulitzer(html: string, category: string, sourceUrl: string): AwardRow[] {
  const $ = cheerio.load(html);
  const rows: AwardRow[] = [];
  $("table.wikitable").each((_, table) => {
    let year: number | null = null;
    $(table)
      .find("tr")
      .each((__, tr) => {
        const row = $(tr);
        const th = row.find("th").first();
        const yearText = th.length ? clean(th.text()) : "";
        if (/^(19|20)\d{2}/.test(yearText)) year = Number(yearText.slice(0, 4));
        const tds = row.find("td");
        if (tds.length < 3 || year === null || year < MIN_YEAR) return;
        const author = clean($(tds[0]).text());
        const publication = clean($(tds[1]).text());
        const citation = clean($(tds[2]).text()).replace(/^"|"$/g, "");
        if (!author || !citation) return;
        const style = (row.attr("style") ?? "").toLowerCase();
        const winner = style.includes("lightyellow") || $(tds[0]).find("b").length > 0;
        rows.push({
          award: "pulitzer",
          category,
          year,
          result: winner ? "winner" : "finalist",
          title: citation.slice(0, 400),
          publication: publication || null,
          author,
          sourceUrl,
        });
      });
  });
  return rows;
}

// ---------------------------------------------------------------- NMA

const NMA_SECTIONS: Record<string, string> = {
  Feature_Writing: "feature-writing",
  Reporting: "reporting",
  Public_Interest: "public-interest",
  Columns_and_Essays: "columns-and-essays",
  Essays_and_Criticism: "essays-and-criticism",
  Reviews_and_Criticism: "reviews-and-criticism",
  Profile_Writing: "profile-writing",
};

export function parseNma(html: string, sourceUrl: string): AwardRow[] {
  const $ = cheerio.load(html);
  const rows: AwardRow[] = [];
  for (const [id, category] of Object.entries(NMA_SECTIONS)) {
    const heading = $(`[id="${id}"]`).first();
    if (!heading.length) continue;
    const headingBlock = heading.closest(".mw-heading").length ? heading.closest(".mw-heading") : heading.parent();
    const table = headingBlock.nextAll("table.wikitable").first();
    if (!table.length) continue;
    const header = table
      .find("tr")
      .first()
      .find("th")
      .map((_, th) => clean($(th).text()).toLowerCase())
      .get();
    const titleIdx = header.findIndex((h) => h.startsWith("article"));
    const authorIdx = header.findIndex((h) => h.startsWith("author"));
    if (titleIdx < 0) continue;
    let year: number | null = null;
    table.find("tr").each((i, tr) => {
      if (i === 0) return;
      const cells = $(tr).children("th,td");
      const first = clean($(cells[0]).text());
      let offset = 0;
      if (/^(19|20)\d{2}$/.test(first)) {
        year = Number(first);
      } else {
        offset = -1; // year cell spanned from a previous row
      }
      if (year === null || year < MIN_YEAR) return;
      const cell = (idx: number) => (idx + offset >= 0 ? clean($(cells[idx + offset]).text()) : "");
      const magazine = cell(1) || null;
      const author = authorIdx >= 0 ? cell(authorIdx) || null : null;
      for (const title of quotedTitles(cell(titleIdx))) {
        rows.push({ award: "nma", category, year, result: "winner", title, publication: magazine, author, sourceUrl });
      }
    });
  }
  return rows;
}

// ---------------------------------------------------------------- Polk

export function parsePolk(html: string, sourceUrl: string): AwardRow[] {
  const $ = cheerio.load(html);
  const rows: AwardRow[] = [];
  let year: number | null = null;
  $("h5, p").each((_, el) => {
    const node = $(el);
    if (el.tagName === "h5") {
      const m = /((?:19|20)\d{2}) George Polk Award Winners/i.exec(node.text());
      year = m ? Number(m[1]) : null;
      return;
    }
    if (year === null || year < MIN_YEAR) return;
    const text = clean(node.text());
    const cat = /^([^:]{3,60}):/.exec(text);
    if (!cat?.[1] || /career|special award/i.test(cat[1])) return;
    const titles = quotedTitles(text);
    if (titles.length === 0) return;
    const label = cat[1].trim().toLowerCase();
    const strongs = node
      .find("strong")
      .map((__, s) => clean($(s).text()))
      .get()
      // drop the category label however it is split across tags, and quoted titles
      .map((s) => (s.toLowerCase().startsWith(`${label}:`) ? clean(s.slice(label.length + 1)) : s))
      .filter((s) => s && s.replace(/:$/, "").toLowerCase() !== label && !s.endsWith(":") && !/^[“"]/.test(s));
    const trim = (s: string | undefined) => (s ? s.replace(/[,;:.]+$/, "").trim() || null : null);
    const author = trim(strongs[0]);
    const publication = strongs.length > 1 ? trim(strongs[strongs.length - 1]) : null;
    for (const title of titles) {
      rows.push({
        award: "polk",
        category: cat[1].trim().toLowerCase().replace(/\s+/g, "-"),
        year,
        result: "winner",
        title,
        publication,
        author,
        sourceUrl,
      });
    }
  });
  return rows;
}

// ---------------------------------------------------------------- run

export async function run(): Promise<void> {
  const all: AwardRow[] = [];

  const pulitzer: [string, string][] = [
    ["Pulitzer_Prize_for_Feature_Writing", "feature-writing"],
    ["Pulitzer_Prize_for_Explanatory_Reporting", "explanatory-reporting"],
    ["Pulitzer_Prize_for_Criticism", "criticism"],
    ["Pulitzer_Prize_for_Commentary", "commentary"],
  ];
  for (const [page, cat] of pulitzer) {
    const rows = parsePulitzer(await wikiHtml(page), cat, `https://en.wikipedia.org/wiki/${page}`);
    log(`pulitzer ${cat}: ${rows.length}`);
    all.push(...rows);
  }

  const nma = parseNma(await wikiHtml("National_Magazine_Awards"), "https://en.wikipedia.org/wiki/National_Magazine_Awards");
  log(`nma: ${nma.length}`);
  all.push(...nma);

  for (const url of ["https://liu.edu/polk-awards/past-winners"]) {
    const r = await politeFetch(url, { minIntervalMs: 1000 });
    if (r.status !== 200) throw new Error(`Polk ${url}: HTTP ${r.status}`);
    const rows = parsePolk(r.body, url);
    log(`polk ${url.split("/").pop()}: ${rows.length}`);
    all.push(...rows);
  }

  // De-duplicate on the unique key before writing.
  const byKey = new Map<string, AwardRow>();
  for (const r of all) byKey.set(`${r.award}|${r.category}|${r.year}|${r.title}`, r);
  const rows = [...byKey.values()];

  const { db, pool } = createNodeDb();
  try {
    await db.transaction(async (tx) => {
      await tx.delete(schema.awards);
      for (let i = 0; i < rows.length; i += 500) {
        await tx.insert(schema.awards).values(rows.slice(i, i + 500));
      }
    });
    const [{ n }] = (await db.execute(sql`select count(*)::int as n from awards`)).rows as [{ n: number }];
    log(`awards table: ${n} rows`);
  } finally {
    await pool.end();
  }
}
