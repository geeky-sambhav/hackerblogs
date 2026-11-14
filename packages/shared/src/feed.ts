/**
 * Personalised home feed, modelled on HackerTube: the browser sends its liked,
 * disliked and seen ids; the server mixes several sources and tells the
 * reader why each pick is there. Pure: same inputs and seed → same feed.
 */
import { mulberry32, shuffle } from "./random";

export type FeedItem = {
  id: number;
  title: string;
  publicationSlug: string;
  areas: string[];
  score: number;
  lane: "classic" | "rising";
  gem: boolean;
  /** Ids of pieces co-recommended by the same readers, strongest first. */
  corec: number[];
  /** Ids of similar pieces (same author / shared areas and tags), strongest first. */
  similar: number[];
};

export type FeedPrefs = {
  liked: number[];
  disliked: number[];
  seen: number[];
};

export type FeedReasonKind =
  | "classic"
  | "gem"
  | "deep"
  | "rising"
  | "explore"
  | "taste"
  | "similar"
  | "corec"
  | "wildcard";

export type FeedReason = {
  kind: FeedReasonKind;
  /** Area slug for explore/taste, liked piece id for similar/corec. */
  ref?: string | number;
};

export type FeedPick = { id: number; reason: FeedReason };

type Weights = Record<FeedReasonKind, number>;

const COLD_START: Weights = {
  classic: 40,
  gem: 15,
  deep: 15,
  rising: 10,
  explore: 10,
  wildcard: 10,
  taste: 0,
  similar: 0,
  corec: 0,
};

const WARM: Weights = {
  similar: 20,
  corec: 15,
  taste: 15,
  classic: 20,
  gem: 10,
  deep: 5,
  rising: 5,
  explore: 5,
  wildcard: 5,
};

const CLASSIC_TOP = 300;
const DEEP_RANGE: [number, number] = [300, 1500];

function pickWeighted(weights: Weights, rand: () => number): FeedReasonKind {
  const entries = Object.entries(weights) as [FeedReasonKind, number][];
  const total = entries.reduce((s, [, w]) => s + w, 0);
  let r = rand() * total;
  for (const [k, w] of entries) {
    r -= w;
    if (r < 0) return k;
  }
  return "wildcard";
}

export function buildFeed(
  items: readonly FeedItem[],
  prefs: FeedPrefs,
  seed: number,
  size = 30,
): FeedPick[] {
  const rand = mulberry32(seed);
  const byId = new Map(items.map((i) => [i.id, i]));
  const excluded = new Set<number>([...prefs.liked, ...prefs.disliked, ...prefs.seen]);
  const used = new Set<number>();
  const perPublication = new Map<string, number>();
  const pubCap = Math.max(2, Math.ceil(size * 0.15));

  const available = items.filter((i) => !excluded.has(i.id));
  const classicsRanked = available
    .filter((i) => i.lane === "classic")
    .sort((a, b) => b.score - a.score || a.id - b.id);

  // Area taste from likes (+1) and dislikes (−1).
  const areaTaste = new Map<string, number>();
  const bump = (ids: number[], delta: number) => {
    for (const id of ids) {
      for (const a of byId.get(id)?.areas ?? []) areaTaste.set(a, (areaTaste.get(a) ?? 0) + delta);
    }
  };
  bump(prefs.liked, 1);
  bump(prefs.disliked, -1);
  const tasteAreas = [...areaTaste.entries()]
    .filter(([, w]) => w > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([a]) => a)
    .slice(0, 4);
  const allAreas = [...new Set(items.flatMap((i) => i.areas))].sort();
  const unexplored = allAreas.filter((a) => !areaTaste.has(a));

  const likedItems = prefs.liked.map((id) => byId.get(id)).filter((x): x is FeedItem => !!x);

  type Candidate = { id: number; reason: FeedReason };
  const pools: Record<FeedReasonKind, Candidate[]> = {
    classic: shuffle(classicsRanked.slice(0, CLASSIC_TOP), rand).map((i) => ({
      id: i.id,
      reason: { kind: "classic" },
    })),
    deep: shuffle(classicsRanked.slice(DEEP_RANGE[0], DEEP_RANGE[1]), rand).map((i) => ({
      id: i.id,
      reason: { kind: "deep" },
    })),
    gem: shuffle(
      available.filter((i) => i.gem),
      rand,
    ).map((i) => ({ id: i.id, reason: { kind: "gem" } })),
    rising: shuffle(
      available.filter((i) => i.lane === "rising"),
      rand,
    ).map((i) => ({ id: i.id, reason: { kind: "rising" } })),
    explore: shuffle(
      available.filter((i) => i.areas.some((a) => unexplored.includes(a))),
      rand,
    ).map((i) => ({
      id: i.id,
      reason: { kind: "explore", ref: i.areas.find((a) => unexplored.includes(a)) },
    })),
    taste: shuffle(
      available.filter((i) => i.areas.some((a) => tasteAreas.includes(a))),
      rand,
    ).map((i) => ({
      id: i.id,
      reason: { kind: "taste", ref: i.areas.find((a) => tasteAreas.includes(a)) },
    })),
    similar: shuffle(
      likedItems.flatMap((l) =>
        l.similar.slice(0, 8).map((id) => ({ id, reason: { kind: "similar", ref: l.id } as FeedReason })),
      ),
      rand,
    ),
    corec: shuffle(
      likedItems.flatMap((l) =>
        l.corec.slice(0, 8).map((id) => ({ id, reason: { kind: "corec", ref: l.id } as FeedReason })),
      ),
      rand,
    ),
    wildcard: shuffle(available, rand).map((i) => ({ id: i.id, reason: { kind: "wildcard" } })),
  };

  const weights: Weights = { ...(likedItems.length > 0 ? WARM : COLD_START) };
  if (pools.rising.length === 0) weights.rising = 0;

  const out: FeedPick[] = [];
  const take = (kind: FeedReasonKind): boolean => {
    const pool = pools[kind];
    while (pool.length > 0) {
      const c = pool.shift() as Candidate;
      if (used.has(c.id) || excluded.has(c.id)) continue;
      const item = byId.get(c.id);
      if (!item) continue;
      const n = perPublication.get(item.publicationSlug) ?? 0;
      if (n >= pubCap) continue;
      used.add(c.id);
      perPublication.set(item.publicationSlug, n + 1);
      out.push({ id: c.id, reason: c.reason });
      return true;
    }
    return false;
  };

  let guard = 0;
  while (out.length < size && guard < size * 20) {
    guard++;
    const kind = pickWeighted(weights, rand);
    if (!take(kind)) {
      weights[kind] = 0;
      if (Object.values(weights).every((w) => w === 0)) break;
    }
  }
  return out;
}
