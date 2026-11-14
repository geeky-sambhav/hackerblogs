/**
 * Matching award entries to pieces without ML: trigram title similarity
 * (pg_trgm-style) plus author surname, publication and year checks.
 */

export function normalizeTitle(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[’'"“”‘]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/^(the|a|an) /, "")
    .trim();
}

function trigrams(s: string): Set<string> {
  const out = new Set<string>();
  for (const word of s.split(" ").filter(Boolean)) {
    const w = `  ${word} `;
    for (let i = 0; i < w.length - 2; i++) out.add(w.slice(i, i + 3));
  }
  return out;
}

/** Jaccard similarity of word trigrams (same idea as pg_trgm's similarity()). */
export function similarity(a: string, b: string): number {
  const A = trigrams(normalizeTitle(a));
  const B = trigrams(normalizeTitle(b));
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const g of A) if (B.has(g)) inter++;
  return inter / (A.size + B.size - inter);
}

/** Strip a site suffix from a page title: "The Falling Man | Esquire" → "The Falling Man". */
export function stripSiteSuffix(title: string): string {
  return title.replace(/\s+[|–—-]\s+[^|–—-]{2,60}$/, "").trim();
}

export function surnames(names: string): string[] {
  return names
    .split(/\s*(?:,|&|\band\b|;)\s*/i)
    .map((n) => n.replace(/\b(jr|sr|ii|iii|iv)\.?$/i, "").trim())
    .map((n) => n.split(/\s+/).at(-1) ?? "")
    .map((n) => n.toLowerCase().replace(/[^a-zÀ-ɏ-]/g, ""))
    .filter((n) => n.length >= 3 && !["staff", "the", "editors"].includes(n));
}

function compact(s: string): string {
  return s
    .toLowerCase()
    .replace(/^the\s+/, "")
    .replace(/\b(magazine|the|inc|com)\b/g, "")
    .replace(/[^a-z0-9]/g, "");
}

export function publicationMatches(awardPub: string | null, names: (string | null | undefined)[], domain: string): boolean {
  if (!awardPub) return false;
  const a = compact(awardPub);
  if (a.length < 3) return false;
  const d = domain.replace(/\.(com|org|net|co\.uk|co|us)$/, "").replace(/[^a-z0-9]/g, "");
  if (d.includes(a) || a.includes(d)) return true;
  return names.some((n) => {
    if (!n) return false;
    const b = compact(n);
    return b.length >= 3 && (b.includes(a) || a.includes(b));
  });
}

export type MatchPiece = {
  id: number;
  title: string | null;
  byline: string | null;
  publicationNames: (string | null)[];
  domain: string;
  year: number | null;
};

export type MatchAward = {
  award: string;
  year: number;
  title: string;
  author: string | null;
  publication: string | null;
  /** Pulitzer rows carry a citation, not a title. */
  titled: boolean;
};

export function matchScore(a: MatchAward, p: MatchPiece): number {
  const authorHit =
    !!a.author && !!p.byline && surnames(a.author).some((s) => surnames(p.byline ?? "").includes(s));
  const pubHit = publicationMatches(a.publication, p.publicationNames, p.domain);
  if (!a.titled) {
    // author + publication + year (award year Y honours work from Y-1, sometimes Y)
    if (!authorHit || !pubHit || p.year === null) return 0;
    return p.year === a.year - 1 || p.year === a.year ? 0.9 : 0;
  }
  if (!p.title) return 0;
  if (p.year !== null && (p.year < a.year - 2 || p.year > a.year)) return 0;
  const sim = similarity(a.title, stripSiteSuffix(p.title));
  if (sim < 0.55 || !(authorHit || pubHit)) return 0;
  return sim + (authorHit ? 0.2 : 0) + (pubHit ? 0.1 : 0);
}

/**
 * Remove a trailing " | Site", " – Site" or " - Site" segment when it names the
 * publication or site (so real subtitles after a dash are kept).
 */
export function cleanTitle(title: string, names: (string | null | undefined)[], domain: string): string {
  const m = /^(.{8,}?)\s+[|–—-]\s+([^|–—-]{2,80})$/.exec(title.trim());
  if (!m?.[1] || !m[2]) return title.trim();
  const suffix = compact(m[2]);
  const host = domain.split("/")[0]?.replace(/\.(com|org|net|co\.uk|co|io|us)$/, "").replace(/[^a-z0-9]/g, "") ?? "";
  const named = names.some((n) => {
    const c = n ? compact(n) : "";
    return c.length >= 3 && (suffix.includes(c) || c.includes(suffix));
  });
  if (named || (host.length >= 3 && (suffix.includes(host) || host.includes(suffix)))) return cleanTitle(m[1], names, domain);
  return title.trim();
}
