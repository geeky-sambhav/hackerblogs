/**
 * ingest:longform — every recommendation in the frozen Longform.org archive
 * (April 2010 – December 2022), paging through https://longform.org/?p=N.
 * Pass --load-only to skip fetching, --fetch-only to skip the DuckDB load.
 */
import * as cheerio from "cheerio";
import { duck } from "../lib/duck";
import { politeFetch } from "../lib/http";
import { JsonlWriter, loadEditorial, rawFile, type EditorialRow } from "../lib/jsonl";
import { log, progress } from "../lib/log";

const BASE = "https://longform.org";

function parseYear(s: string): number | null {
  const m = /(19|20)\d{2}/.exec(s);
  return m ? Number(m[0]) : null;
}

export function parseLongformPage(html: string): { rows: EditorialRow[]; lastPage: number | null } {
  const $ = cheerio.load(html);
  const rows: EditorialRow[] = [];
  $("article.post").each((_, el) => {
    const a = $(el);
    const labels = (a.attr("data-labels") ?? "").split(/\s+/).filter(Boolean);
    if (labels.includes("podcast") || a.hasClass("post--promo")) return;
    const link = a.find("a.post__link").first().attr("href");
    if (!link || !/^https?:\/\//.test(link) || /^https?:\/\/(www\.)?longform\.org\//.test(link)) return;
    const title = a.find(".post__title__highlight").first().text().trim() || a.find(".post__title").first().text().trim();
    const authors = a
      .find(".post__author__link")
      .map((__, x) => $(x).text().trim())
      .get()
      .filter(Boolean);
    rows.push({
      source: "longform",
      kind: "pick",
      year: parseYear(a.find(".post__date").first().text()),
      url_raw: link,
      ref_url: a.find("a.post__permalink").attr("href") ?? null,
      title: title || null,
      tags: labels.join(",") || null,
      author: authors.join(", ") || null,
      publication: a.find(".post__publication").first().text().trim() || null,
    });
  });
  const pages = $(".pagination a[href*='?p=']")
    .map((_, x) => Number(/[?&]p=(\d+)/.exec($(x).attr("href") ?? "")?.[1] ?? 0))
    .get();
  return { rows, lastPage: pages.length ? Math.max(...pages) : null };
}

export async function run(args: string[]): Promise<void> {
  const file = rawFile("longform.jsonl");
  if (!args.includes("--load-only")) {
    const out = new JsonlWriter<EditorialRow>(file);
    const first = await politeFetch(`${BASE}/?p=1`, { minIntervalMs: 1000 });
    let { lastPage } = parseLongformPage(first.body);
    if (!lastPage) throw new Error("Longform: could not find the last page number");
    const tick = progress("longform pages");
    for (let p = 1; p <= lastPage; p++) {
      const res = p === 1 ? first : await politeFetch(`${BASE}/?p=${p}`, { minIntervalMs: 1000 });
      if (res.status !== 200) throw new Error(`Longform page ${p}: HTTP ${res.status}`);
      const parsed = parseLongformPage(res.body);
      for (const r of parsed.rows) out.write(r);
      if (parsed.lastPage && parsed.lastPage > lastPage) lastPage = parsed.lastPage;
      tick(p, lastPage);
    }
    await out.close();
    log(`longform.jsonl: ${out.count.toLocaleString()} picks`);
  }
  if (args.includes("--fetch-only")) return;
  await loadEditorial(await duck(), "longform", file);
  log("loaded into editorial_raw");
}
