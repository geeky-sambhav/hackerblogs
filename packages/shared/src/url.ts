/**
 * URL canonicalisation shared by the pipeline (to merge mentions of the same
 * article) and the web app. Pure and deterministic.
 */

/** Query parameters that never identify a document (tracking, sharing, paging-all). */
const DROP_PARAMS = new Set([
  "fbclid",
  "gclid",
  "dclid",
  "msclkid",
  "mc_cid",
  "mc_eid",
  "mkt_tok",
  "_ga",
  "_gl",
  "ref",
  "ref_src",
  "ref_url",
  "referer",
  "referrer",
  "src",
  "source",
  "via",
  "smid",
  "smtyp",
  "cmpid",
  "cmp",
  "intcmp",
  "icid",
  "partner",
  "rss",
  "share",
  "sh",
  "ftag",
  "mbid",
  "xid",
  "sr_share",
  "sharetype",
  "unlocked_article_code",
  "gift",
  "giftcopy",
  "accesstoken",
  "pagewanted",
  "single",
  "currentpage",
  "printable",
  "print",
  "ncid",
  "ocid",
  "s_cid",
  "spm",
  "amp",
  "outputtype",
  "mod",
  "hpt",
  "hp",
  "_r",
  "emc",
  "nl",
  "pgtype",
  "abt",
  "abg",
  "campaign_id",
  "campaignid",
  "utm",
  "trk",
  "trkcampaign",
  "guccounter",
  "guce_referrer",
  "guce_referrer_sig",
  "wpisrc",
  "wpmm",
  "wpmk",
  "noredirect",
  "reflink",
  "fsrc",
  "mobile",
  "m",
  "si",
  "feature",
]);

const DROP_PARAM_PREFIXES = ["utm_", "pk_", "mtm_", "hsa_", "__hs", "vero_", "oly_", "at_", "sc_"];

/** Host prefixes that are aliases of the main site. */
const HOST_PREFIXES = ["www.", "www2.", "m.", "mobile.", "amp.", "beta."];

/**
 * AMP renderings ("/article/amp", "/article/amp.html"): lowercase only, and only
 * when at least two path segments precede it, so "/wiki/AMP" or "/ampproject/amp"
 * are never collapsed into their parent.
 */
const AMP_SUFFIX_RE = /^(\/[^/]+\/[^/]+(?:\/[^/]+)*)\/amp(?:\.html)?\/?$/;
const INDEX_FILE_RE = /\/index\.(html?|php|asp|aspx)$/i;

const HTML_ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&#x26;": "&",
  "&#38;": "&",
  "&#x2F;": "/",
  "&#x2f;": "/",
  "&#47;": "/",
  "&#x3D;": "=",
  "&#x3d;": "=",
  "&#61;": "=",
  "&#x3F;": "?",
  "&#x3f;": "?",
  "&#63;": "?",
  "&#x23;": "#",
  "&#35;": "#",
  "&#x27;": "'",
  "&#39;": "'",
  "&quot;": '"',
  "&#x25;": "%",
  "&#37;": "%",
  "&#x3A;": ":",
  "&#x3a;": ":",
  "&#58;": ":",
};

const ENTITY_RE = /&(?:amp|quot|#x[0-9a-fA-F]+|#\d+);/g;

/** Decode the handful of HTML entities that appear inside hrefs in forum HTML. */
export function decodeHrefEntities(input: string): string {
  return input.replace(ENTITY_RE, (m) => HTML_ENTITIES[m] ?? m);
}

/** Strip punctuation that commonly trails a URL pasted into prose. */
function stripTrailingPunctuation(u: string): string {
  let s = u.trim();
  for (;;) {
    const last = s.at(-1);
    if (last === undefined) return s;
    if (".,;:!?'\"*>".includes(last)) {
      s = s.slice(0, -1);
      continue;
    }
    if (last === ")") {
      const opens = (s.match(/\(/g) ?? []).length;
      const closes = (s.match(/\)/g) ?? []).length;
      if (closes > opens) {
        s = s.slice(0, -1);
        continue;
      }
    }
    if (last === "]") {
      const opens = (s.match(/\[/g) ?? []).length;
      const closes = (s.match(/\]/g) ?? []).length;
      if (closes > opens) {
        s = s.slice(0, -1);
        continue;
      }
    }
    return s;
  }
}

export type RewriteRule = {
  /** Canonical host the rule applies to (after www/m. stripping). */
  host: string;
  /** Regex matched against the pathname. */
  pattern: string;
  /** Replacement (supports $1..$n). */
  replace: string;
};

function compileRules(rules: readonly RewriteRule[]) {
  return rules.map((r) => ({ host: r.host, re: new RegExp(r.pattern), replace: r.replace }));
}

const compiledCache = new WeakMap<readonly RewriteRule[], ReturnType<typeof compileRules>>();

export function canonicalHost(hostname: string): string {
  let h = hostname.toLowerCase().replace(/\.$/, "");
  let changed = true;
  while (changed) {
    changed = false;
    for (const p of HOST_PREFIXES) {
      // Keep at least "name.tld".
      if (h.startsWith(p) && h.slice(p.length).includes(".")) {
        h = h.slice(p.length);
        changed = true;
      }
    }
  }
  return h;
}

const WAYBACK_RE = /^\/web\/\d{1,14}[a-z_]*\/(.+)$/i;

/**
 * Unwrap links that wrap another URL: Wayback Machine copies, 12ft.io,
 * Google / Facebook / Tumblr redirectors. Returns the inner URL or null.
 */
export function unwrapUrl(u: URL): string | null {
  const host = u.hostname.toLowerCase();
  if (host === "web.archive.org" || host === "wayback.archive.org") {
    const m = WAYBACK_RE.exec(u.pathname + u.search);
    if (m?.[1]) return m[1].replace(/^(https?):\/(?!\/)/i, "$1://");
    return null;
  }
  if (host === "12ft.io" || host === "www.12ft.io") {
    const q = u.searchParams.get("q");
    if (q) return q;
    const rest = (u.pathname + u.search).replace(/^\/(proxy\/?)?/, "");
    return /^https?:/i.test(rest) ? rest.replace(/^(https?):\/(?!\/)/i, "$1://") : null;
  }
  if ((host === "google.com" || host === "www.google.com") && u.pathname === "/url") {
    return u.searchParams.get("q") ?? u.searchParams.get("url");
  }
  if (host === "l.facebook.com" || host === "lm.facebook.com") return u.searchParams.get("u");
  if (host === "t.umblr.com") return u.searchParams.get("z");
  return null;
}

/**
 * Canonicalise an article URL. Returns null for anything that is not a usable
 * http(s) document URL.
 */
export function canonicalizeUrl(raw: string, rules: readonly RewriteRule[] = []): string | null {
  if (!raw) return null;
  let s = stripTrailingPunctuation(decodeHrefEntities(raw));
  if (s.startsWith("//")) s = `https:${s}`;
  if (!/^https?:\/\//i.test(s)) return null;

  let u: URL;
  try {
    u = new URL(s);
    for (let i = 0; i < 3; i++) {
      const inner = unwrapUrl(u);
      if (!inner || !/^https?:\/\//i.test(inner)) break;
      u = new URL(inner);
    }
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  if (u.username || u.password) return null;

  const host = canonicalHost(u.hostname);
  if (!host.includes(".") || /^\d+\.\d+\.\d+\.\d+$/.test(host)) return null;

  let path = u.pathname.replace(/\/{2,}/g, "/");
  path = path.replace(INDEX_FILE_RE, "/");
  path = path.replace(AMP_SUFFIX_RE, "$1");
  if (path.length > 1) path = path.replace(/\/+$/, "");
  if (path === "") path = "/";
  try {
    // Normalise percent-encoding case without changing meaning.
    path = encodeURI(decodeURI(path));
  } catch {
    // keep as-is if it contains malformed escapes
  }

  const kept: [string, string][] = [];
  for (const [k, v] of u.searchParams) {
    const lk = k.toLowerCase();
    if (DROP_PARAMS.has(lk)) continue;
    if (DROP_PARAM_PREFIXES.some((p) => lk.startsWith(p))) continue;
    kept.push([k, v]);
  }
  kept.sort((a, b) => (a[0] === b[0] ? a[1].localeCompare(b[1]) : a[0].localeCompare(b[0])));
  const qs = new URLSearchParams(kept).toString();

  if (rules.length > 0) {
    let compiled = compiledCache.get(rules);
    if (!compiled) {
      compiled = compileRules(rules);
      compiledCache.set(rules, compiled);
    }
    for (const r of compiled) {
      if (r.host === host && r.re.test(path)) {
        path = path.replace(r.re, r.replace);
      }
    }
  }

  const port = u.port && u.port !== "80" && u.port !== "443" ? `:${u.port}` : "";
  return `https://${host}${port}${path}${qs ? `?${qs}` : ""}`;
}

/** Host of an already-canonical URL. */
export function hostOf(canonicalUrl: string): string {
  try {
    return new URL(canonicalUrl).hostname;
  } catch {
    return "";
  }
}

/**
 * Site key used for the domain review: the canonical host, except for
 * multi-tenant platforms where the first path segment is the publication
 * (e.g. medium.com/@user, medium.com/some-pub).
 */
const PATH_TENANT_HOSTS = new Set(["medium.com", "github.com", "sites.google.com"]);

export function siteKey(canonicalUrl: string): string {
  try {
    const u = new URL(canonicalUrl);
    const host = u.hostname;
    if (PATH_TENANT_HOSTS.has(host)) {
      const seg = u.pathname.split("/").filter(Boolean)[0];
      return seg ? `${host}/${seg}` : host;
    }
    return host;
  } catch {
    return "";
  }
}

/** True when a URL is a site's front page / section index rather than a document. */
export function isRootLike(canonicalUrl: string): boolean {
  try {
    const u = new URL(canonicalUrl);
    return (u.pathname === "/" || u.pathname === "") && u.search === "";
  } catch {
    return true;
  }
}
