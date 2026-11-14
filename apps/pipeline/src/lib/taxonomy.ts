import type { AreaRule } from "./config";

export type TaxonomyInput = {
  url: string;
  title: string | null;
  dek: string | null;
  section: string | null;
  tags: string[];
  publicationSlug: string | null;
};

function normalise(s: string): string {
  return ` ${s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()} `;
}

function hits(haystack: string, keywords: string[]): number {
  let n = 0;
  for (const k of keywords) if (haystack.includes(normalise(k))) n++;
  return n;
}

/** Up to 3 area slugs, best first; "miscellany" when nothing matches. */
export function assignAreas(x: TaxonomyInput, areas: AreaRule[]): { slug: string; weight: number }[] {
  let path = "";
  try {
    path = new URL(x.url).pathname.replace(/[/_-]+/g, " ");
  } catch {
    path = "";
  }
  const tagText = normalise([x.section ?? "", ...x.tags].join(" | "));
  const pathText = normalise(path);
  const titleText = normalise(`${x.title ?? ""} ${x.dek ?? ""}`);
  const scored = areas
    .map((a) => {
      const kw = a.keywords;
      const w =
        3 * hits(tagText, kw) +
        2 * hits(pathText, kw) +
        hits(titleText, kw) +
        (x.publicationSlug && a.publications?.includes(x.publicationSlug) ? 2 : 0);
      return { slug: a.slug, weight: w };
    })
    .filter((s) => s.weight >= 1)
    .sort((p, q) => q.weight - p.weight || p.slug.localeCompare(q.slug));
  if (scored.length === 0) return [{ slug: "miscellany", weight: 1 }];
  const top = scored[0]?.weight ?? 0;
  // a single weak hit still beats "miscellany"; secondary areas must be reasonably strong
  if (top < 2) return scored.slice(0, 1);
  return scored.filter((s, i) => i === 0 || s.weight >= Math.max(2, top / 2)).slice(0, 3);
}
