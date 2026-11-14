import { AWARD_LABELS, EDITORIAL_LABELS, type Award, type EditorialSource } from "@hackerreads/shared";
import type { AwardRef, Paywall } from "./types";

/** The date-stamp strip spans these years (the build covers recommendations up to 2026). */
export const FIRST_YEAR = 2006;
export const LAST_YEAR = 2026;

export const SITE_NAME = "HackerReads";
export const SITE_DESCRIPTION =
  "Long-form articles and essays that readers have kept recommending, year after year.";

export function paywallLabel(p: Paywall | undefined): string | null {
  switch (p) {
    case "free":
      return "Free to read";
    case "metered":
      return "Metered paywall";
    case "paywalled":
      return "Subscription";
    default:
      return null;
  }
}

export function editorialLabel(source: string): string {
  return EDITORIAL_LABELS[source as EditorialSource] ?? source;
}

export function awardLabel(a: AwardRef): string {
  const name = AWARD_LABELS[a.award as Award] ?? a.award;
  const result = a.result === "winner" ? "winner" : a.result === "finalist" ? "finalist" : "";
  const cat = a.category ? ` for ${a.category.replace(/-/g, " ")}` : "";
  return `${a.year} ${name}${cat}${result ? `, ${result}` : ""}`;
}

export function sourceLabel(s: string): string {
  return s === "hn" ? "Hacker News" : s === "reddit" ? "Reddit" : s;
}

export function lengthLabel(l: string | null): string | null {
  return l === "short" ? "Under 3,000 words" : l === "medium" ? "3,000–7,000 words" : l === "long" ? "Over 7,000 words" : null;
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
}
