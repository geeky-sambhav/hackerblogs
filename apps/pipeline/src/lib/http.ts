/**
 * Polite HTTP client for the pipeline:
 * - identifies itself with a descriptive User-Agent
 * - obeys robots.txt (including Crawl-delay) per origin
 * - one request at a time per host, spaced by `minIntervalMs`
 * - retries 429/5xx with backoff, pausing the whole host (not just the one request)
 * - caches responses on disk (gzip) so re-runs never re-hit sites
 */
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import Bottleneck from "bottleneck";
import robotsParser from "robots-parser";
import { withDeadline } from "./deadline";
import { sha1 } from "./hash";
import { CACHE_DIR, ensureDir } from "./paths";

export const USER_AGENT = "HackerReadsBot/0.1 (+https://github.com/geeky-sambhav/hackerblogs)";
const ROBOTS_AGENT = "HackerReadsBot";
const MAX_BODY_BYTES = 4 * 1024 * 1024;

export type FetchResult = {
  url: string;
  finalUrl: string;
  status: number;
  contentType: string;
  body: string;
  fromCache: boolean;
};

export class RobotsDisallowed extends Error {
  constructor(url: string) {
    super(`robots.txt disallows ${url}`);
  }
}

type Robots = ReturnType<typeof robotsParser>;
const robotsCache = new Map<string, Promise<Robots | null>>();
const limiters = new Map<string, Bottleneck>();

async function loadRobots(origin: string): Promise<Robots | null> {
  const robotsUrl = `${origin}/robots.txt`;
  // A held timer rather than AbortSignal.timeout() (see politeFetch).
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("robots.txt timed out")), 15_000);
  try {
    const res = await fetch(robotsUrl, {
      headers: { "user-agent": USER_AGENT },
      redirect: "follow",
      signal: controller.signal,
    });
    if (res.status === 401 || res.status === 403) {
      return robotsParser(robotsUrl, "User-agent: *\nDisallow: /");
    }
    if (!res.ok) return null; // no robots.txt → everything allowed
    return robotsParser(robotsUrl, (await res.text()).slice(0, 500_000));
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function robotsFor(origin: string): Promise<Robots | null> {
  let p = robotsCache.get(origin);
  if (!p) {
    p = loadRobots(origin);
    robotsCache.set(origin, p);
  }
  return p;
}

export async function isAllowed(url: string): Promise<boolean> {
  const u = new URL(url);
  const robots = await robotsFor(u.origin);
  if (!robots) return true;
  return robots.isAllowed(url, ROBOTS_AGENT) !== false;
}

async function limiterFor(url: string, minIntervalMs: number): Promise<Bottleneck> {
  const u = new URL(url);
  let l = limiters.get(u.host);
  if (!l) {
    const robots = await robotsFor(u.origin);
    const delay = robots?.getCrawlDelay(ROBOTS_AGENT);
    const minTime = Math.max(minIntervalMs, delay ? Math.min(delay, 30) * 1000 : 0);
    l = new Bottleneck({ maxConcurrent: 1, minTime });
    limiters.set(u.host, l);
  }
  return l;
}

function cachePath(key: string): string {
  const h = sha1(key);
  return resolve(ensureDir(resolve(CACHE_DIR, h.slice(0, 2))), `${h}.json.gz`);
}

function readCache(key: string): FetchResult | null {
  const p = cachePath(key);
  if (!existsSync(p)) return null;
  try {
    const r = JSON.parse(gunzipSync(readFileSync(p)).toString("utf8")) as FetchResult;
    return { ...r, fromCache: true };
  } catch {
    return null;
  }
}

/** Remove a cached response (e.g. an API page whose body reported an error). */
export function dropCache(key: string): void {
  rmSync(cachePath(key), { force: true });
}

/** Only successful or definitively-gone responses are worth caching. */
function cacheable(status: number): boolean {
  return (status >= 200 && status < 300) || status === 404 || status === 410;
}

function writeCache(key: string, r: FetchResult): void {
  writeFileSync(cachePath(key), gzipSync(JSON.stringify({ ...r, fromCache: false })));
}

async function readBody(res: Response): Promise<string> {
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BODY_BYTES) {
      reader.cancel().catch(() => {}); // not awaited: cancelling can hang on a stalled stream
      break;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export type PoliteFetchOptions = {
  /** Minimum spacing between requests to the same host. */
  minIntervalMs?: number;
  /** Skip robots.txt (only for public APIs whose docs invite programmatic use). */
  ignoreRobots?: boolean;
  /** Re-use the disk cache (default true). */
  cache?: boolean;
  accept?: string;
  timeoutMs?: number;
  retries?: number;
};

type Exchange = { kind: "ok" | "throttled"; result: FetchResult; waitMs?: number };

/** One request and its body, aborted after `timeoutMs`. */
async function exchange(url: string, accept: string | undefined, timeoutMs: number): Promise<Exchange> {
  // A plain timer, not AbortSignal.timeout(): undici holds that signal weakly, so it can be
  // garbage-collected and never fire.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new TimeoutError(timeoutMs)), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: {
        "user-agent": USER_AGENT,
        accept: accept ?? "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
        "accept-language": "en",
      },
      redirect: "follow",
      signal: controller.signal,
    });
    const base = { url, finalUrl: res.url || url, status: res.status, contentType: res.headers.get("content-type") ?? "", fromCache: false };
    if (res.status === 429 || res.status >= 500) {
      const retryAfter = Number(res.headers.get("retry-after"));
      // Discard the body without waiting on it: cancelling can hang on a stalled stream.
      res.body?.cancel().catch(() => {});
      return {
        kind: "throttled",
        result: { ...base, body: "" },
        waitMs: Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : undefined,
      };
    }
    return { kind: "ok", result: { ...base, body: await readBody(res) } };
  } finally {
    clearTimeout(timer);
  }
}

export async function politeFetch(url: string, opts: PoliteFetchOptions = {}): Promise<FetchResult> {
  const useCache = opts.cache ?? true;
  if (useCache) {
    const hit = readCache(url);
    if (hit) return hit;
  }
  if (!opts.ignoreRobots && !(await isAllowed(url))) throw new RobotsDisallowed(url);

  const host = new URL(url).host;
  const limiter = await limiterFor(url, opts.minIntervalMs ?? 1000);
  const retries = opts.retries ?? 3;
  const timeoutMs = opts.timeoutMs ?? 30_000;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      // The whole exchange (headers and body) runs inside the host's slot, under one deadline
      // started when the request goes out, not while it waits in the host's queue.
      const outcome = await limiter.schedule(async () => {
        // A host that answered 429/5xx is paused for everyone queued on it, not just this request.
        const pause = (pausedUntil.get(host) ?? 0) - Date.now();
        if (pause > 0) await sleep(pause);
        return withDeadline(exchange(url, opts.accept, timeoutMs), timeoutMs + 10_000, `fetch ${url}`);
      });
      if (outcome.kind === "throttled") {
        pausedUntil.set(host, Math.max(pausedUntil.get(host) ?? 0, Date.now() + Math.min(outcome.waitMs ?? 5000 * 2 ** attempt, 120_000)));
        if (attempt < retries) continue;
      }
      const result = outcome.result;
      if (useCache && cacheable(result.status)) writeCache(url, result);
      return result;
    } catch (err) {
      lastErr = err;
      if (attempt < retries) await sleep(2000 * 2 ** attempt);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

const pausedUntil = new Map<string, number>();

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export class TimeoutError extends Error {
  constructor(ms: number) {
    super(`timed out after ${ms} ms`);
    this.name = "TimeoutError";
  }
}

/**
 * Why a request failed at the network level:
 *   dns      the host name does not resolve (site gone)
 *   refused  nothing listening (site gone or down)
 *   connect  no connection could be opened in time (host down or unreachable)
 *   tls      certificate or handshake failure
 *   timeout  no answer, or a body that stalled (slow site, or one quietly blocking bots)
 *   reset    connection dropped mid-request (often bot blocking)
 *   other    anything else
 */
export type NetworkErrorKind = "dns" | "refused" | "connect" | "tls" | "timeout" | "reset" | "other";

export function networkErrorKind(err: unknown): NetworkErrorKind {
  const seen = new Set<unknown>();
  let e: unknown = err;
  while (e && typeof e === "object" && !seen.has(e)) {
    seen.add(e);
    const { code, name, message } = e as { code?: string; name?: string; message?: string };
    if (code === "UND_ERR_CONNECT_TIMEOUT" || code === "ETIMEDOUT") return "connect";
    if (e instanceof TimeoutError || name === "TimeoutError" || name === "DeadlineExceeded" || code === "UND_ERR_HEADERS_TIMEOUT" || code === "UND_ERR_BODY_TIMEOUT") return "timeout";
    if (code === "ENOTFOUND" || code === "EAI_AGAIN" || code === "EAI_NONAME" || code === "EAI_FAIL") return "dns";
    if (code === "ECONNREFUSED" || code === "EHOSTUNREACH" || code === "ENETUNREACH") return "refused";
    if ((code && /CERT|SSL|TLS|SELF_SIGNED|UNABLE_TO_VERIFY|ALTNAME/.test(code)) || (message && /certificate|ssl|tls/i.test(message))) return "tls";
    if (code === "ECONNRESET" || code === "EPIPE" || code === "UND_ERR_SOCKET" || code === "UND_ERR_CLOSED") return "reset";
    e = (e as { cause?: unknown }).cause;
  }
  return "other";
}

/** Whether a successful response for `url` is already in the disk cache. */
export function isCached(url: string): boolean {
  return existsSync(cachePath(url));
}

export async function politeJson<T>(url: string, opts: PoliteFetchOptions = {}): Promise<T> {
  const r = await politeFetch(url, { accept: "application/json", ...opts });
  if (r.status < 200 || r.status >= 300) throw new Error(`HTTP ${r.status} for ${url}`);
  return JSON.parse(r.body) as T;
}
