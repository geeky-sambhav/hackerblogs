import { siteKey } from "@hackerreads/shared";
import { domainRules, publicationsConfig, type DomainRules, type PublicationConfig } from "./config";

export type SiteClass = {
  siteKey: string;
  publication: PublicationConfig | null;
  /** include: known publication; exclude: rule-excluded; null: needs review. */
  preset: "include" | "exclude" | null;
  reason: string | null;
};

type Compiled = {
  pubs: { pub: PublicationConfig; domains: string[]; paths: RegExp[] }[];
  exact: Set<string>;
  suffix: string[];
  prefix: string[];
};

function compile(pubs: PublicationConfig[], rules: DomainRules): Compiled {
  const exact = new Set<string>();
  const suffix: string[] = [];
  const prefix: string[] = [];
  for (const r of rules.exclude) {
    if (r.startsWith("=")) exact.add(r.slice(1));
    else if (r.startsWith("^")) prefix.push(r.slice(1));
    else suffix.push(r);
  }
  return {
    pubs: pubs.map((pub) => ({
      pub,
      domains: pub.domains,
      paths: (pub.includePaths ?? []).map((p) => new RegExp(p)),
    })),
    exact,
    suffix,
    prefix,
  };
}

function hostMatches(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

export function makeClassifier(
  pubs: PublicationConfig[] = publicationsConfig(),
  rules: DomainRules = domainRules(),
) {
  const c = compile(pubs, rules);
  return (canonicalUrl: string): SiteClass => {
    const key = siteKey(canonicalUrl);
    let u: URL;
    try {
      u = new URL(canonicalUrl);
    } catch {
      return { siteKey: key, publication: null, preset: "exclude", reason: "bad-url" };
    }
    const host = u.hostname;
    for (const p of c.pubs) {
      if (!p.domains.some((d) => hostMatches(host, d))) continue;
      if (p.paths.length > 0 && !p.paths.some((re) => re.test(u.pathname))) {
        return { siteKey: key, publication: null, preset: "exclude", reason: `outside ${p.pub.slug} section` };
      }
      return { siteKey: key, publication: p.pub, preset: "include", reason: null };
    }
    if (c.exact.has(key)) return { siteKey: key, publication: null, preset: "exclude", reason: "rule" };
    if (c.prefix.some((p) => host.startsWith(p))) return { siteKey: key, publication: null, preset: "exclude", reason: "rule" };
    if (c.suffix.some((r) => key === r || key.endsWith(`.${r}`) || host === r || host.endsWith(`.${r}`))) {
      return { siteKey: key, publication: null, preset: "exclude", reason: "rule" };
    }
    if (/\.(pdf|png|jpe?g|gif|svg|mp4|mp3|zip|gz|tar|exe|dmg|webp|mov|ppt|pptx|docx?|xlsx?|epub|mobi)$/i.test(u.pathname)) {
      return { siteKey: key, publication: null, preset: "exclude", reason: "non-html" };
    }
    return { siteKey: key, publication: null, preset: null, reason: null };
  };
}
