import { describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {} }));
vi.mock("@hackerreads/db/web", () => ({ getWebDb: () => ({}) }));

const { diversify, parseListParams, runList, toQuery } = await import("@/lib/list");
import type { Piece } from "@/lib/types";

const mk = (id: number, pub: string, extra: Partial<Piece> = {}): Piece => ({
  id,
  slug: `p-${id}`,
  title: `Piece ${id}`,
  url: `https://x.com/${id}`,
  waybackUrl: null,
  dek: null,
  image: null,
  authors: [],
  publication: { slug: pub, name: pub, paywall: "free", kind: "publisher" },
  publishedAt: "2015-01-01",
  publishedYear: 2015,
  lengthBucket: "medium",
  areas: ["science"],
  lane: "classic",
  gem: false,
  score: 100 - id,
  rank: id,
  people: 3,
  years: 3,
  recYears: [2010, 2012, 2015],
  firstRecYear: 2010,
  lastRecYear: 2015,
  communitySources: ["hn"],
  editorial: [],
  awards: [],
  ...extra,
});

describe("list params", () => {
  it("parses and validates", () => {
    expect(parseListParams({ decade: "2010", sort: "newest", length: "long", page: "2", paywall: "free" })).toEqual({
      area: undefined,
      decade: 2010,
      length: "long",
      paywall: "free",
      sort: "newest",
      page: 2,
    });
    expect(parseListParams({ decade: "2015", sort: "bogus", page: "-3", length: "huge" })).toMatchObject({
      decade: undefined,
      sort: "recommended",
      page: 1,
      length: undefined,
    });
  });
  it("round-trips through the query string", () => {
    expect(toQuery({ decade: 2000, sort: "recommended", page: 1 })).toBe("?decade=2000");
    expect(toQuery({ sort: "durable", page: 3 })).toBe("?sort=durable&page=3");
    expect(toQuery({})).toBe("");
  });
});

describe("diversify", () => {
  it("defers, never drops, entries over the per-window cap", () => {
    const pieces = [...Array.from({ length: 8 }, (_, i) => mk(i + 1, "big")), ...Array.from({ length: 6 }, (_, i) => mk(i + 9, `o${i}`))];
    const out = diversify(pieces, 5, 2);
    expect(out).toHaveLength(14);
    expect(new Set(out.map((p) => p.id)).size).toBe(14);
    expect(out.slice(0, 5).filter((p) => p.publication?.slug === "big").length).toBe(2);
    expect(out.slice(0, 2).map((p) => p.id)).toEqual([1, 2]); // best-ranked stay first
  });
  it("is soft: fills slots from the capped publication when nothing else is left", () => {
    const out = diversify([mk(1, "big"), mk(2, "big"), mk(3, "big")], 5, 2);
    expect(out.map((p) => p.id)).toEqual([1, 2, 3]);
  });
});

describe("runList", () => {
  it("filters, sorts and paginates", () => {
    const pieces = Array.from({ length: 50 }, (_, i) => mk(i + 1, `pub${i % 10}`, { publishedYear: i < 10 ? 2005 : 2015, publishedAt: i < 10 ? "2005-01-01" : "2015-01-01" }));
    const r = runList(pieces, { sort: "recommended", page: 1, decade: 2010 });
    expect(r.total).toBe(40);
    expect(r.pages).toBe(1);
    expect(r.items[0]?.id).toBe(11);
    expect(runList(pieces, { sort: "recommended", page: 99 }).page).toBe(2);
  });
});
