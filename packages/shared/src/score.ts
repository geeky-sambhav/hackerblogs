/**
 * Deterministic ranking for HackerReads.
 *
 * score = C + D + 0.5·E + 0.5·A
 *   C  community: distinct months with a qualifying recommendation event,
 *      +0.5 per month containing a "big" event. A person's comments count once per piece
 *      (their first): someone pasting the same link every month (hiring-thread boilerplate,
 *      a signature) is one recommendation, not one per month. Stories and posts always count,
 *      since they qualify only on points, which come from other people.
 *   D  durability: 0.5 × (distinct years with events − 1), capped at 4
 *   E  editorial picks (weighted, capped at 4)
 *   A  acclaim: awards and anthologies (weighted, capped at 4)
 */

export const COMMUNITY_SOURCES = ["hn", "reddit", "lobsters", "metafilter"] as const;
export type CommunitySource = (typeof COMMUNITY_SOURCES)[number];
export type MentionKind = "story" | "comment" | "post";

export type Mention = {
  source: CommunitySource;
  kind: MentionKind;
  /** Opaque, stable per (platform, user). */
  person: string;
  /** Milliseconds since epoch (UTC). */
  ts: number;
  points: number | null;
  /** Characters of the commenter's own text (links and markup removed). */
  ownTextLen: number | null;
  /** Reddit only. */
  subreddit?: string | null;
};

export type ThresholdConfig = {
  hnStoryPoints: number;
  hnBigPoints: number;
  commentOwnText: number;
  redditDefaultPoints: number;
  redditBigPoints: number;
  /** Per-subreddit post-score thresholds (lowercase names). */
  redditSubPoints: Record<string, number>;
  lobstersPoints: number;
};

export const DEFAULT_THRESHOLDS: ThresholdConfig = {
  hnStoryPoints: 50,
  hnBigPoints: 300,
  commentOwnText: 100,
  redditDefaultPoints: 50,
  redditBigPoints: 1000,
  redditSubPoints: {},
  lobstersPoints: 10,
};

export function qualifies(m: Mention, t: ThresholdConfig = DEFAULT_THRESHOLDS): boolean {
  if (m.kind === "comment") return (m.ownTextLen ?? 0) >= t.commentOwnText;
  switch (m.source) {
    case "hn":
      return (m.points ?? 0) >= t.hnStoryPoints;
    case "reddit": {
      const sub = (m.subreddit ?? "").toLowerCase();
      const min = t.redditSubPoints[sub] ?? t.redditDefaultPoints;
      return (m.points ?? 0) >= min;
    }
    case "lobsters":
      return (m.points ?? 0) >= t.lobstersPoints;
    case "metafilter":
      return true;
  }
}

export function isBig(m: Mention, t: ThresholdConfig = DEFAULT_THRESHOLDS): boolean {
  if (m.kind === "comment") return false;
  if (m.source === "hn") return (m.points ?? 0) >= t.hnBigPoints;
  if (m.source === "reddit") return (m.points ?? 0) >= t.redditBigPoints;
  return false;
}

function monthKey(ts: number): string {
  const d = new Date(ts);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function monthIndex(ts: number): number {
  const d = new Date(ts);
  return d.getUTCFullYear() * 12 + d.getUTCMonth();
}

export type CommunityStats = {
  people: number;
  months: number;
  bigMonths: number;
  years: number;
  /** Whole months between the first and last qualifying event. */
  spanMonths: number;
  firstRec: number | null;
  lastRec: number | null;
  hnMaxPoints: number;
  sources: CommunitySource[];
  /** Distinct calendar years (UTC) with a qualifying event, ascending. */
  yearList: number[];
  c: number;
  d: number;
};

export function communityStats(
  mentions: readonly Mention[],
  t: ThresholdConfig = DEFAULT_THRESHOLDS,
): CommunityStats {
  const people = new Set<string>();
  const months = new Set<string>();
  const bigMonths = new Set<string>();
  const years = new Set<number>();
  const sources = new Set<CommunitySource>();
  let first: number | null = null;
  let last: number | null = null;
  let hnMaxPoints = 0;

  const commented = new Set<string>();
  // Oldest first, so a repeat commenter's first comment is the one that counts.
  for (const m of [...mentions].sort((a, b) => a.ts - b.ts)) {
    if (m.source === "hn" && m.kind === "story") hnMaxPoints = Math.max(hnMaxPoints, m.points ?? 0);
    if (!qualifies(m, t)) continue;
    const person = `${m.source}:${m.person}`;
    if (m.kind === "comment") {
      if (commented.has(person)) continue;
      commented.add(person);
    }
    people.add(person);
    const mk = monthKey(m.ts);
    months.add(mk);
    if (isBig(m, t)) bigMonths.add(mk);
    years.add(new Date(m.ts).getUTCFullYear());
    sources.add(m.source);
    if (first === null || m.ts < first) first = m.ts;
    if (last === null || m.ts > last) last = m.ts;
  }

  const c = months.size + 0.5 * bigMonths.size;
  const d = Math.min(4, 0.5 * Math.max(0, years.size - 1));
  return {
    people: people.size,
    months: months.size,
    bigMonths: bigMonths.size,
    years: years.size,
    spanMonths: first !== null && last !== null ? monthIndex(last) - monthIndex(first) : 0,
    firstRec: first,
    lastRec: last,
    hnMaxPoints,
    sources: COMMUNITY_SOURCES.filter((s) => sources.has(s)),
    yearList: [...years].sort((a, b) => a - b),
    c,
    d,
  };
}

export const EDITORIAL_SOURCES = ["longform", "longreads", "kottke", "mr", "browser", "ald"] as const;
export type EditorialSource = (typeof EDITORIAL_SOURCES)[number];
export type EditorialKind = "pick" | "best_of";
export type EditorialPick = { source: EditorialSource; kind: EditorialKind };

export const EDITORIAL_LABELS: Record<EditorialSource, string> = {
  longform: "Longform",
  longreads: "Longreads",
  kottke: "Kottke",
  mr: "Marginal Revolution",
  browser: "The Browser",
  ald: "Arts & Letters Daily",
};

function editorialWeight(p: EditorialPick): number {
  if (p.source === "longreads" && p.kind === "best_of") return 2;
  return 1;
}

export function editorialScore(picks: readonly EditorialPick[]): { e: number; curators: number } {
  const seen = new Map<string, number>();
  const curators = new Set<EditorialSource>();
  for (const p of picks) {
    const key = `${p.source}:${p.kind}`;
    seen.set(key, Math.max(seen.get(key) ?? 0, editorialWeight(p)));
    curators.add(p.source);
  }
  let e = 0;
  for (const w of seen.values()) e += w;
  return { e: Math.min(4, e), curators: curators.size };
}

export const AWARDS = [
  "pulitzer",
  "nma",
  "polk",
  "livingston",
  "kavli",
  "orwell",
  "best_american_essays",
  "best_american_science",
] as const;
export type Award = (typeof AWARDS)[number];
export type AwardResult = "winner" | "finalist" | "anthologized";
export type AwardHit = { award: Award; result: AwardResult };

export const AWARD_LABELS: Record<Award, string> = {
  pulitzer: "Pulitzer Prize",
  nma: "National Magazine Award",
  polk: "George Polk Award",
  livingston: "Livingston Award",
  kavli: "AAAS Kavli Award",
  orwell: "Orwell Prize",
  best_american_essays: "The Best American Essays",
  best_american_science: "The Best American Science and Nature Writing",
};

function awardWeight(h: AwardHit): number {
  if (h.award === "pulitzer" || h.award === "nma") {
    return h.result === "winner" ? 3 : h.result === "finalist" ? 1.5 : 0;
  }
  if (h.award === "best_american_essays" || h.award === "best_american_science") {
    return h.result === "anthologized" ? 2 : 0;
  }
  return h.result === "winner" ? 1.5 : 0;
}

export function acclaimScore(hits: readonly AwardHit[]): number {
  const best = new Map<Award, number>();
  for (const h of hits) best.set(h.award, Math.max(best.get(h.award) ?? 0, awardWeight(h)));
  let a = 0;
  for (const w of best.values()) a += w;
  return Math.min(4, a);
}

export function totalScore(c: number, d: number, e: number, a: number): number {
  return Math.round((c + d + 0.5 * e + 0.5 * a) * 100) / 100;
}

export const RISING_FROM_YEAR = 2024;
export type Lane = "classic" | "rising";

export type EligibilityInput = {
  community: Pick<CommunityStats, "people" | "months" | "spanMonths">;
  e: number;
  curators: number;
  a: number;
  publishedYear: number | null;
};

export function laneFor(publishedYear: number | null): Lane {
  return publishedYear !== null && publishedYear >= RISING_FROM_YEAR ? "rising" : "classic";
}

export function classicEligible(x: EligibilityInput): boolean {
  const { people, months, spanMonths } = x.community;
  const durable = people >= 3 && months >= 3 && (spanMonths >= 12 || x.e + x.a >= 1);
  const curated = people >= 2 && months >= 2 && x.e >= 2 && x.curators >= 2;
  return durable || curated;
}

export function risingEligible(x: EligibilityInput): boolean {
  const { people, months } = x.community;
  return (people >= 2 && months >= 2) || (people >= 1 && x.e >= 1);
}

export function eligibility(x: EligibilityInput): { eligible: boolean; lane: Lane } {
  const lane = laneFor(x.publishedYear);
  const eligible = lane === "classic" ? classicEligible(x) : classicEligible(x) || risingEligible(x);
  return { eligible, lane };
}
