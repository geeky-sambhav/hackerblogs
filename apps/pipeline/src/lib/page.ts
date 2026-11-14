/**
 * Shared by fetch:meta and fetch:archive: page metadata (Readability in a worker pool with a
 * time limit) and Wayback Machine lookups.
 */
import { politeFetch, politeJson } from "./http";
import { log } from "./log";
import { extractMeta, type PageMeta } from "./meta";
import { ReadabilityPool } from "./readability-pool";

let readability: ReadabilityPool | null = null;

/** Page metadata; the Readability word count runs off the main thread. */
export async function readMeta(html: string, pageUrl: string): Promise<PageMeta> {
  const meta = extractMeta(html, pageUrl, { readability: false });
  if (meta.declaredWordCount === null) {
    readability ??= new ReadabilityPool();
    meta.extractedWordCount = await readability.wordCount(html);
  }
  return meta;
}

export async function closeReadMeta(): Promise<void> {
  if (!readability) return;
  log(`readability: ${readability.timeouts} pages timed out, ${readability.errors} worker errors (length unknown)`);
  await readability.close();
  readability = null;
}

/** Word count to store. Paywalled pages expose only a teaser: an extracted count under 800 means "unknown". */
export function storedWordCount(meta: PageMeta | null, paywall: string | null): number | null {
  if (!meta) return null;
  if (meta.declaredWordCount !== null) return meta.declaredWordCount;
  const words = meta.extractedWordCount;
  return words !== null && words < 800 && (paywall === "metered" || paywall === "paywalled") ? null : words;
}

// Internet Archive endpoints: archive.org (availability API) and web.archive.org (snapshots)
// are separate hosts, each with its own one-at-a-time limiter.
const AVAILABILITY_INTERVAL_MS = 1500;
const SNAPSHOT_INTERVAL_MS = 2000;

/**
 * archive.org could not answer (rate limit, outage, network). Not the same as "no snapshot":
 * the caller should keep the page flagged and try again on a later run.
 */
export class ArchiveUnavailable extends Error {
  constructor(cause: unknown) {
    super(`archive.org unavailable: ${(cause as Error)?.message ?? String(cause)}`, { cause });
  }
}

/** The availability-API request for a page (also the disk-cache key of its answer). */
export function waybackLookupUrl(url: string, near: Date | null): string {
  const ts = (near ?? new Date("2015-01-01")).toISOString().slice(0, 10).replace(/-/g, "");
  return `https://archive.org/wayback/available?url=${encodeURIComponent(url)}&timestamp=${ts}`;
}

/** Closest successful snapshot to `near` (defaults to 2015); null when there is none. Throws ArchiveUnavailable. */
export async function wayback(url: string, near: Date | null): Promise<string | null> {
  let r: { archived_snapshots?: { closest?: { available?: boolean; url?: string; status?: string } } };
  try {
    r = await politeJson(waybackLookupUrl(url, near), { minIntervalMs: AVAILABILITY_INTERVAL_MS, timeoutMs: 60_000 });
  } catch (err) {
    throw new ArchiveUnavailable(err);
  }
  const c = r.archived_snapshots?.closest;
  if (c?.available && c.url && (c.status ?? "200").startsWith("2")) return c.url.replace(/^http:/, "https:");
  return null;
}

/** Metadata read from a snapshot's raw (id_) copy; null if the snapshot is unusable. Throws ArchiveUnavailable. */
export async function waybackMeta(snapshotUrl: string): Promise<PageMeta | null> {
  const raw = snapshotUrl.replace(/\/web\/(\d+)\//, "/web/$1id_/");
  let r: Awaited<ReturnType<typeof politeFetch>>;
  try {
    r = await politeFetch(raw, { minIntervalMs: SNAPSHOT_INTERVAL_MS, timeoutMs: 60_000 });
  } catch (err) {
    throw new ArchiveUnavailable(err);
  }
  if (r.status === 429 || r.status >= 500) throw new ArchiveUnavailable(new Error(`HTTP ${r.status}`));
  if (r.status !== 200 || !/html/i.test(r.contentType || "text/html")) return null;
  return await readMeta(r.body, raw);
}
