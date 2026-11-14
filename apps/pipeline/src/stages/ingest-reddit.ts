/**
 * ingest:reddit — link posts from the configured subreddits via the Arctic
 * Shift API (an archive of Reddit; posts only). Flags: --load-only, --fetch-only.
 */
import { duck } from "../lib/duck";
import { sourcesConfig } from "../lib/config";
import { dropCache, politeFetch } from "../lib/http";
import { JsonlWriter, loadMentions, rawFile, type MentionRow } from "../lib/jsonl";
import { log } from "../lib/log";

type Post = {
  id: string;
  author: string | null;
  created_utc: number;
  score: number | null;
  url: string | null;
  title: string | null;
  subreddit: string;
  num_comments: number | null;
};

const API = "https://arctic-shift.photon-reddit.com/api/posts/search";
const FIELDS = "id,author,created_utc,score,url,title,subreddit,num_comments";

/** One API page; retries server-side timeouts (HTTP 422/429/5xx with a JSON error). */
async function fetchPage(url: string): Promise<Post[]> {
  for (let attempt = 0; ; attempt++) {
    const r = await politeFetch(url, {
      ignoreRobots: true, // public API intended for programmatic access
      minIntervalMs: 1100,
      accept: "application/json",
    });
    let body: { data: Post[] | null; error?: string | null } | null = null;
    try {
      body = JSON.parse(r.body) as { data: Post[] | null; error?: string | null };
    } catch {
      body = null;
    }
    if (r.status >= 200 && r.status < 300 && body && !body.error) return body.data ?? [];
    dropCache(url);
    const msg = body?.error ?? `HTTP ${r.status}`;
    const retryable = r.status === 422 || r.status === 429 || r.status >= 500 || /timeout|slow down/i.test(msg);
    if (!retryable || attempt >= 8) throw new Error(`Arctic Shift: ${msg} (${url})`);
    log(`Arctic Shift said "${msg}"; backing off`);
    await new Promise((res) => setTimeout(res, 5000 * (attempt + 1)));
  }
}

export async function run(args: string[]): Promise<void> {
  const file = rawFile("reddit.jsonl");
  if (!args.includes("--load-only")) {
    const out = new JsonlWriter<MentionRow>(file);
    for (const { name } of sourcesConfig().subreddits) {
      let after: number | string = "2005-06-01";
      let n = 0;
      const seen = new Set<string>();
      for (;;) {
        // limit=auto returns 100–1000 posts depending on server load
        const url = `${API}?subreddit=${encodeURIComponent(name)}&limit=auto&sort=asc&after=${after}&fields=${FIELDS}`;
        const posts = await fetchPage(url);
        let fresh = 0;
        for (const p of posts) {
          if (seen.has(p.id)) continue;
          seen.add(p.id);
          fresh++;
          if (!p.url || !/^https?:\/\//i.test(p.url)) continue;
          out.write({
            source: "reddit",
            item_id: p.id,
            person: p.author && p.author !== "[deleted]" ? p.author : `deleted:${p.id}`,
            ts: new Date(p.created_utc * 1000).toISOString(),
            kind: "post",
            points: p.score ?? 0,
            own_text_len: null,
            subreddit: p.subreddit,
            url_raw: p.url,
            title: p.title,
          });
          n++;
        }
        const last = posts.at(-1);
        if (!last || fresh === 0) break;
        // `after` is inclusive-ish at second granularity; step back 1s and rely on `seen`.
        after = Math.max(typeof after === "number" ? after + 1 : 0, last.created_utc - 1);
      }
      log(`r/${name}: ${n.toLocaleString()} link posts`);
    }
    await out.close();
    log(`reddit.jsonl: ${out.count.toLocaleString()} rows`);
  }
  if (args.includes("--fetch-only")) return;
  const c = await duck();
  await loadMentions(c, "reddit", file);
  log("loaded into mentions_raw");
}
