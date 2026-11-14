/**
 * ingest:kottke — kottke.org monthly archives (2005 → now), ?page=N until empty.
 * Each post's first outbound article link is a "pick". Flags: --load-only, --fetch-only.
 */
import * as cheerio from "cheerio";
import { duck } from "../lib/duck";
import { politeFetch } from "../lib/http";
import { JsonlWriter, loadEditorial, rawFile, type EditorialRow } from "../lib/jsonl";
import { articleLinks } from "../lib/links";
import { log } from "../lib/log";

const START_YEAR = 2005;

export function parseKottkePage(html: string): EditorialRow[] {
  const $ = cheerio.load(html);
  const rows: EditorialRow[] = [];
  $("div.post").each((_, el) => {
    const post = $(el);
    const dt = post.find("time[datetime]").first().attr("datetime") ?? "";
    const year = Number(dt.slice(0, 4)) || null;
    const permalink = post.find("h2 a").first().attr("href") ?? null;
    const tags = post
      .find("a[href^='/tag/']")
      .map((__, a) => decodeURIComponent(($(a).attr("href") ?? "").slice(5)))
      .get()
      .filter(Boolean);
    // Only the post body: drop share menus and meta before collecting links.
    post.find(".post-meta, .post-actions, .share-menu, .share-dropdown").remove();
    const first = articleLinks(post.html() ?? "", ["kottke.org"])[0];
    if (!first) return;
    rows.push({
      source: "kottke",
      kind: "pick",
      year,
      url_raw: first,
      ref_url: permalink ? new URL(permalink, "https://kottke.org").toString() : null,
      title: post.find("h2").first().text().trim() || null,
      tags: [...new Set(tags)].join(",") || null,
    });
  });
  return rows;
}

export async function run(args: string[]): Promise<void> {
  const file = rawFile("kottke.jsonl");
  if (!args.includes("--load-only")) {
    const out = new JsonlWriter<EditorialRow>(file);
    const now = new Date();
    for (let y = START_YEAR; y <= now.getUTCFullYear(); y++) {
      for (let m = 1; m <= 12; m++) {
        if (y === now.getUTCFullYear() && m > now.getUTCMonth() + 1) break;
        const base = `https://kottke.org/${String(y % 100).padStart(2, "0")}/${String(m).padStart(2, "0")}/`;
        for (let page = 1; page <= 40; page++) {
          const url = page === 1 ? base : `${base}?page=${page}`;
          const res = await politeFetch(url, { minIntervalMs: 1000 });
          if (res.status === 404) break;
          if (res.status !== 200) throw new Error(`Kottke ${url}: HTTP ${res.status}`);
          const $ = cheerio.load(res.body);
          if ($("div.post").length === 0) break;
          for (const r of parseKottkePage(res.body)) out.write(r);
        }
      }
      log(`kottke ${y}: ${out.count.toLocaleString()} picks so far`);
    }
    await out.close();
  }
  if (args.includes("--fetch-only")) return;
  await loadEditorial(await duck(), "kottke", file);
  log("loaded into editorial_raw");
}
