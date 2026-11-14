/**
 * ingest:mr — Marginal Revolution "Assorted links" posts, read from MR's own
 * research archive (https://marginalrevolution.com/ai-archive/, baseline zip
 * extracted to .data/raw/mr/posts.jsonl). Every article link in an "Assorted
 * links" post is a pick. No crawling.
 */
import { createReadStream, existsSync } from "node:fs";
import { createInterface } from "node:readline";
import { resolve } from "node:path";
import { duck } from "../lib/duck";
import { JsonlWriter, RAW_DIR, loadEditorial, rawFile, type EditorialRow } from "../lib/jsonl";
import { articleLinks } from "../lib/links";
import { log } from "../lib/log";

type MrPost = { title?: string; content?: string; url?: string; published_at?: string };

export function picksFromMrPost(p: MrPost): EditorialRow[] {
  if (!/\bassorted links\b/i.test(p.title ?? "")) return [];
  const year = Number((p.published_at ?? "").slice(0, 4)) || null;
  return articleLinks(p.content ?? "", ["marginalrevolution.com"]).map((url_raw) => ({
    source: "mr",
    kind: "pick" as const,
    year,
    url_raw,
    ref_url: p.url ?? null,
    title: null,
  }));
}

export async function run(args: string[]): Promise<void> {
  const src = resolve(RAW_DIR, "mr", "posts.jsonl");
  const file = rawFile("mr.jsonl");
  if (!args.includes("--load-only")) {
    if (!existsSync(src)) throw new Error(`Missing ${src}: download and unzip MR's ai-archive baseline first`);
    const out = new JsonlWriter<EditorialRow>(file);
    const rl = createInterface({ input: createReadStream(src), crlfDelay: Infinity });
    let posts = 0;
    for await (const line of rl) {
      if (!line.trim()) continue;
      const p = JSON.parse(line) as MrPost;
      posts++;
      for (const r of picksFromMrPost(p)) out.write(r);
    }
    await out.close();
    log(`mr: ${posts.toLocaleString()} posts → ${out.count.toLocaleString()} picks`);
  }
  if (args.includes("--fetch-only")) return;
  await loadEditorial(await duck(), "mr", file);
  log("loaded into editorial_raw");
}
