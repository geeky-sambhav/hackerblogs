/**
 * Article metadata from a page's HTML: Open Graph / Twitter tags, JSON-LD
 * (schema.org Article family), <link rel=canonical>, <html lang>, and a word
 * count (JSON-LD wordCount, else Readability's extracted text). No text is
 * stored — only counts and bibliographic fields.
 */
import { Readability } from "@mozilla/readability";
import * as cheerio from "cheerio";
import { parseHTML } from "linkedom";

export type PageMeta = {
  title: string | null;
  dek: string | null;
  image: string | null;
  siteName: string | null;
  ogType: string | null;
  canonical: string | null;
  publishedAt: string | null; // YYYY-MM-DD
  authors: string[];
  section: string | null;
  tags: string[];
  lang: string | null;
  declaredWordCount: number | null;
  extractedWordCount: number | null;
  isArticleType: boolean;
};

/** Pages with more elements than this get no extracted length (Readability throws past it). */
const MAX_READABILITY_ELEMENTS = 15_000;
/** About 60k words of page text: longer than any single long read, typical of archive/index pages. */
const MAX_READABILITY_TEXT_CHARS = 400_000;

const ARTICLE_TYPES = /^(article|newsarticle|blogposting|reportagenewsarticle|analysisnewsarticle|opinionnewsarticle|reviewnewsarticle|scholarlyarticle|socialmediaposting|techarticle|backgroundnewsarticle|posting)$/i;

function text(s: string | undefined | null): string | null {
  if (!s) return null;
  const t = s.replace(/\s+/g, " ").trim();
  return t || null;
}

function absolutise(url: string | null, base: string): string | null {
  if (!url) return null;
  try {
    const u = new URL(url, base);
    return u.protocol === "http:" || u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
}

export function toIsoDate(s: string | null | undefined): string | null {
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s.trim());
  if (m) {
    const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
    // Only real calendar dates: some sites emit day and month swapped ("2020-24-05").
    const check = new Date(Date.UTC(y, mo - 1, d));
    const real = check.getUTCFullYear() === y && check.getUTCMonth() === mo - 1 && check.getUTCDate() === d;
    if (real && y >= 1900 && y <= 2100) return `${m[1]}-${m[2]}-${m[3]}`;
    return null;
  }
  // Non-ISO strings ("May 21, 2014") parse as local midnight: read the local calendar date.
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getFullYear();
  if (y < 1900 || y > 2100) return null;
  return `${y}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

function* walkJsonLd(node: Json): Generator<Record<string, Json>> {
  if (Array.isArray(node)) {
    for (const n of node) yield* walkJsonLd(n);
  } else if (node && typeof node === "object") {
    yield node;
    const graph = node["@graph"];
    if (graph) yield* walkJsonLd(graph);
  }
}

function typesOf(o: Record<string, Json>): string[] {
  const t = o["@type"];
  if (typeof t === "string") return [t];
  if (Array.isArray(t)) return t.filter((x): x is string => typeof x === "string");
  return [];
}

function names(v: Json | undefined): string[] {
  if (!v) return [];
  if (typeof v === "string") return [v];
  if (Array.isArray(v)) return v.flatMap((x) => names(x));
  if (typeof v === "object") {
    const n = (v as Record<string, Json>).name;
    return typeof n === "string" ? [n] : [];
  }
  return [];
}

function strings(v: Json | undefined): string[] {
  if (!v) return [];
  if (typeof v === "string") return v.split(",").map((s) => s.trim()).filter(Boolean);
  if (Array.isArray(v)) return v.flatMap((x) => strings(x));
  return [];
}

/** Clean an author string: drop "By", URLs, emails, and split "A and B". */
export function splitAuthors(raw: string[]): string[] {
  const out: string[] = [];
  for (const r of raw) {
    let s = r.replace(/^\s*by\s+/i, "").trim();
    if (!s || /^https?:\/\//i.test(s) || s.includes("@") || s.length > 80) continue;
    s = s.replace(/\s*\|.*$/, "");
    for (const part of s.split(/\s*(?:,|&|\band\b)\s*/i)) {
      const name = part.trim().replace(/\.$/, "");
      if (name.length >= 3 && /\p{L}/u.test(name) && !/^(staff|editors?|the editors|admin|guest)$/i.test(name)) out.push(name);
    }
  }
  return [...new Set(out)];
}

export function countWords(s: string): number {
  const m = s.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu);
  return m ? m.length : 0;
}

/**
 * Word count of the main text, via Readability. Readability is roughly quadratic on big flat pages
 * (link density reads innerText per node), so giant pages get no count (length unknown). Callers
 * that cannot afford a slow page run this in a worker with a timeout (see readability-worker.ts).
 */
export function readabilityWordCount(html: string): number | null {
  try {
    const { document } = parseHTML(html);
    // Readability's own maxElemsToParse uses getElementsByTagName("*"), which linkedom answers with 0.
    if (document.querySelectorAll("*").length > MAX_READABILITY_ELEMENTS) return null;
    if ((document.body?.textContent?.length ?? 0) > MAX_READABILITY_TEXT_CHARS) return null;
    const article = new Readability(document as unknown as Document, { charThreshold: 200 }).parse();
    return article?.textContent ? countWords(article.textContent) : null;
  } catch {
    return null;
  }
}

/** `readability: false` leaves extractedWordCount null so the caller can compute it elsewhere. */
export function extractMeta(html: string, pageUrl: string, opts: { readability?: boolean } = {}): PageMeta {
  const $ = cheerio.load(html);
  const meta = (sel: string) => text($(sel).first().attr("content"));
  const metaAll = (sel: string) =>
    $(sel)
      .map((_, el) => text($(el).attr("content")))
      .get()
      .filter((x): x is string => !!x);

  let ldArticle: Record<string, Json> | null = null;
  $('script[type="application/ld+json"]').each((_, el) => {
    if (ldArticle) return;
    try {
      const parsed = JSON.parse($(el).text()) as Json;
      for (const o of walkJsonLd(parsed)) {
        if (typesOf(o).some((t) => ARTICLE_TYPES.test(t))) {
          ldArticle = o;
          return;
        }
      }
    } catch {
      // malformed JSON-LD is common; ignore
    }
  });
  const ld = ldArticle as Record<string, Json> | null;
  const ldStr = (k: string) => (ld && typeof ld[k] === "string" ? text(ld[k] as string) : null);

  const title =
    meta('meta[property="og:title"]') ??
    meta('meta[name="twitter:title"]') ??
    ldStr("headline") ??
    text($("title").first().text());
  const dek = meta('meta[property="og:description"]') ?? meta('meta[name="description"]') ?? meta('meta[name="twitter:description"]') ?? ldStr("description");
  const ldImage = ld?.image;
  const ldImageUrl =
    typeof ldImage === "string"
      ? ldImage
      : Array.isArray(ldImage) && typeof ldImage[0] === "string"
        ? ldImage[0]
        : ldImage && typeof ldImage === "object" && !Array.isArray(ldImage) && typeof ldImage.url === "string"
          ? ldImage.url
          : null;
  const image = absolutise(
    meta('meta[property="og:image:secure_url"]') ?? meta('meta[property="og:image"]') ?? meta('meta[name="twitter:image"]') ?? ldImageUrl,
    pageUrl,
  );

  const published = toIsoDate(
    meta('meta[property="article:published_time"]') ??
      ldStr("datePublished") ??
      meta('meta[name="date"]') ??
      meta('meta[name="publish-date"]') ??
      meta('meta[name="parsely-pub-date"]') ??
      meta('meta[itemprop="datePublished"]') ??
      text($("time[datetime]").first().attr("datetime")),
  );

  const rawAuthors = [
    ...names(ld?.author),
    ...metaAll('meta[name="author"]'),
    ...metaAll('meta[property="article:author"]').filter((a) => !/^https?:/i.test(a)),
    ...metaAll('meta[name="parsely-author"]'),
    ...metaAll('meta[name="sailthru.author"]'),
  ];

  const section = meta('meta[property="article:section"]') ?? (ld ? (strings(ld.articleSection)[0] ?? null) : null);
  const tags = [...new Set([...metaAll('meta[property="article:tag"]'), ...strings(ld?.keywords)].map((t) => t.toLowerCase()))].slice(0, 30);

  const declared = ld?.wordCount;
  const declaredWordCount =
    typeof declared === "number" ? declared : typeof declared === "string" && /^\d+$/.test(declared) ? Number(declared) : null;

  const extractedWordCount = declaredWordCount === null && opts.readability !== false ? readabilityWordCount(html) : null;

  const ogType = meta('meta[property="og:type"]');
  return {
    title,
    dek,
    image,
    siteName: meta('meta[property="og:site_name"]') ?? (ld ? names((ld as Record<string, Json>).publisher)[0] ?? null : null),
    ogType,
    canonical: absolutise(text($('link[rel="canonical"]').first().attr("href")), pageUrl),
    publishedAt: published,
    authors: splitAuthors(rawAuthors),
    section,
    tags,
    lang: text($("html").attr("lang"))?.toLowerCase() ?? null,
    declaredWordCount: declaredWordCount && declaredWordCount > 0 ? declaredWordCount : null,
    extractedWordCount,
    isArticleType: !!ld || /article/i.test(ogType ?? ""),
  };
}
