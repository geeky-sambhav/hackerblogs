import { describe, expect, it } from "vitest";
import { buildFeed, type FeedItem } from "../src/feed";
import { idFromPieceSlug, pieceSlug, slugify } from "../src/slug";

const items: FeedItem[] = Array.from({ length: 400 }, (_, i) => ({
  id: i + 1,
  title: `Piece ${i + 1}`,
  publicationSlug: `pub${i % 20}`,
  areas: [`area${i % 6}`],
  score: 1000 - i,
  lane: i % 25 === 0 ? "rising" : "classic",
  gem: i % 7 === 0,
  corec: [((i + 1) % 400) + 1, ((i + 2) % 400) + 1],
  similar: [((i + 3) % 400) + 1],
}));

describe("buildFeed", () => {
  it("is deterministic for a seed and returns unique picks", () => {
    const a = buildFeed(items, { liked: [], disliked: [], seen: [] }, 42, 30);
    const b = buildFeed(items, { liked: [], disliked: [], seen: [] }, 42, 30);
    expect(a).toEqual(b);
    expect(a).toHaveLength(30);
    expect(new Set(a.map((p) => p.id)).size).toBe(30);
  });
  it("never returns liked, disliked or seen pieces", () => {
    const prefs = { liked: [1, 2, 3], disliked: [4, 5], seen: Array.from({ length: 50 }, (_, i) => i + 6) };
    const feed = buildFeed(items, prefs, 7, 30);
    const banned = new Set([...prefs.liked, ...prefs.disliked, ...prefs.seen]);
    expect(feed.every((p) => !banned.has(p.id))).toBe(true);
  });
  it("applies the per-publication soft cap", () => {
    const feed = buildFeed(items, { liked: [], disliked: [], seen: [] }, 3, 30);
    const counts = new Map<string, number>();
    for (const p of feed) {
      const pub = items[p.id - 1]?.publicationSlug ?? "";
      counts.set(pub, (counts.get(pub) ?? 0) + 1);
    }
    expect(Math.max(...counts.values())).toBeLessThanOrEqual(5);
  });
  it("uses likes for similar/corec/taste reasons", () => {
    const feed = buildFeed(items, { liked: [10, 20, 30], disliked: [], seen: [] }, 11, 30);
    const kinds = new Set(feed.map((p) => p.reason.kind));
    expect(kinds.has("similar") || kinds.has("corec") || kinds.has("taste")).toBe(true);
  });
  it("handles tiny catalogs without looping forever", () => {
    const feed = buildFeed(items.slice(0, 3), { liked: [], disliked: [], seen: [] }, 1, 30);
    expect(feed.length).toBeLessThanOrEqual(3);
  });
});

describe("slugs", () => {
  it("slugify", () => {
    expect(slugify("The Case for Reparations")).toBe("the-case-for-reparations");
    expect(slugify("Café & Crème — 2014’s")).toBe("cafe-and-creme-2014s");
  });
  it("round-trips ids", () => {
    expect(idFromPieceSlug(pieceSlug("Frank Sinatra Has a Cold", 123))).toBe(123);
    expect(idFromPieceSlug("nope")).toBeNull();
  });
});
