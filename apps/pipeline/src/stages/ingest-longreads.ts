/**
 * ingest:longreads — Longreads picks (WordPress REST API). A regular post's pick
 * is its first outbound article link; posts tagged best-of-YYYY are year-end
 * lists, so every outbound article link in them is a "best_of" pick.
 * Flags: --load-only, --fetch-only.
 */
import { duck } from "../lib/duck";
import { USER_AGENT, politeFetch } from "../lib/http";
import { JsonlWriter, loadEditorial, rawFile, type EditorialRow } from "../lib/jsonl";
import { articleLinks } from "../lib/links";
import { log, progress } from "../lib/log";

const API = "https://longreads.com/wp-json/wp/v2";

type WpPost = { id: number; date: string; link: string; title: { rendered: string }; tags: number[]; content: { rendered: string } };
type WpTag = { id: number; slug: string };

function decodeTitle(s: string): string {
  return s
    .replace(/<[^>]+>/g, "")
    .replace(/&#8217;|&#8216;/g, "’")
    .replace(/&#8220;|&#8221;/g, '"')
    .replace(/&#8211;/g, "–")
    .replace(/&#8212;/g, "—")
    .replace(/&amp;/g, "&")
    .replace(/&#038;/g, "&")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCharCode(Number(n)))
    .trim();
}

async function getJson<T>(url: string): Promise<{ data: T }> {
  const r = await politeFetch(url, { minIntervalMs: 1000, accept: "application/json", timeoutMs: 60_000 });
  if (r.status !== 200) throw new Error(`HTTP ${r.status} for ${url}`);
  return { data: JSON.parse(r.body) as T };
}

export function picksFromPost(post: WpPost, bestOfYear: number | null): EditorialRow[] {
  const links = articleLinks(post.content.rendered, ["longreads.com"]);
  const year = Number(post.date.slice(0, 4)) || null;
  const title = decodeTitle(post.title.rendered);
  if (bestOfYear !== null) {
    return links.map((url_raw) => ({
      source: "longreads",
      kind: "best_of" as const,
      year: bestOfYear,
      url_raw,
      ref_url: post.link,
      title: null,
    }));
  }
  const first = links[0];
  return first ? [{ source: "longreads", kind: "pick" as const, year, url_raw: first, ref_url: post.link, title }] : [];
}

export async function run(args: string[]): Promise<void> {
  const file = rawFile("longreads.jsonl");
  if (!args.includes("--load-only")) {
    const { data: tags } = await getJson<WpTag[]>(`${API}/tags?search=best-of&per_page=100&_fields=id,slug`);
    const bestOfTags = new Map<number, number>();
    for (const t of tags) {
      const m = /^best-of-(20\d{2})(?:-\d+)?$/.exec(t.slug);
      if (m) bestOfTags.set(t.id, Number(m[1]));
    }
    log(`best-of tags: ${[...bestOfTags.values()].sort().join(", ")}`);

    const out = new JsonlWriter<EditorialRow>(file);
    const head = await fetch(`${API}/posts?per_page=100&_fields=id`, {
      method: "HEAD",
      headers: { "user-agent": USER_AGENT },
    });
    const totalPages = Number(head.headers.get("x-wp-totalpages") ?? 0);
    if (!totalPages) throw new Error("Longreads: unknown page count");
    const tick = progress("longreads pages");
    for (let page = 1; page <= totalPages; page++) {
      const { data: posts } = await getJson<WpPost[]>(
        `${API}/posts?per_page=100&page=${page}&orderby=id&order=asc&_fields=id,date,link,title,tags,content`,
      );
      for (const p of posts) {
        const bestOf = p.tags.map((t) => bestOfTags.get(t)).find((y): y is number => y !== undefined) ?? null;
        for (const row of picksFromPost(p, bestOf)) out.write(row);
      }
      tick(page, totalPages);
    }
    await out.close();
    log(`longreads.jsonl: ${out.count.toLocaleString()} picks`);
  }
  if (args.includes("--fetch-only")) return;
  await loadEditorial(await duck(), "longreads", file);
  log("loaded into editorial_raw");
}
