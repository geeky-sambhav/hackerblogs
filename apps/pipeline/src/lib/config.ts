import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "yaml";
import { DEFAULT_THRESHOLDS, type RewriteRule, type ThresholdConfig } from "@hackerreads/shared";
import { CONFIG_DIR } from "./paths";

function readYaml<T>(name: string): T {
  return parse(readFileSync(resolve(CONFIG_DIR, name), "utf8")) as T;
}

export type SubredditConfig = { name: string; minScore: number };

export type SourcesConfig = {
  thresholds: Partial<Omit<ThresholdConfig, "redditSubPoints">>;
  subreddits: SubredditConfig[];
};

export function sourcesConfig(): SourcesConfig {
  return readYaml<SourcesConfig>("sources.yaml");
}

export function thresholds(): ThresholdConfig {
  const c = sourcesConfig();
  const redditSubPoints: Record<string, number> = {};
  for (const s of c.subreddits) redditSubPoints[s.name.toLowerCase()] = s.minScore;
  return { ...DEFAULT_THRESHOLDS, ...c.thresholds, redditSubPoints };
}

export function rewriteRules(): RewriteRule[] {
  return readYaml<{ rules: RewriteRule[] }>("url_rewrites.yaml").rules ?? [];
}

export type PublicationConfig = {
  slug: string;
  name: string;
  domains: string[];
  paywall: "free" | "metered" | "paywalled";
  kind: "publisher" | "independent";
  /** Optional regexes on the URL path; when set, only matching paths belong to the publication. */
  includePaths?: string[];
};

export function publicationsConfig(): PublicationConfig[] {
  return readYaml<{ publications: PublicationConfig[] }>("publications.yaml").publications;
}

export type DomainRules = {
  /** Site keys or host suffixes that are never article sources. */
  exclude: string[];
};

export function domainRules(): DomainRules {
  return readYaml<DomainRules>("domain_rules.yaml");
}

export type AreaRule = {
  slug: string;
  name: string;
  description: string;
  /** Lowercase keywords matched as whole words in tags/section/path/title/dek. */
  keywords: string[];
  /** Publication slugs whose pieces default into this area. */
  publications?: string[];
};

export function taxonomyConfig(): AreaRule[] {
  return readYaml<{ areas: AreaRule[] }>("taxonomy.yaml").areas;
}
