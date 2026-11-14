import { describe, expect, it } from "vitest";
import {
  acclaimScore,
  communityStats,
  editorialScore,
  eligibility,
  totalScore,
  type Mention,
} from "../src/score";

const t = (iso: string) => Date.parse(iso);
const comment = (person: string, iso: string, len = 150): Mention => ({
  source: "hn",
  kind: "comment",
  person,
  ts: t(iso),
  points: null,
  ownTextLen: len,
});

describe("communityStats", () => {
  it("counts only qualifying events", () => {
    const s = communityStats([
      comment("a", "2010-01-05T00:00:00Z"),
      comment("b", "2010-01-20T00:00:00Z", 20), // too short
      { source: "hn", kind: "story", person: "c", ts: t("2012-06-01T00:00:00Z"), points: 40, ownTextLen: null }, // < 50 pts
      { source: "hn", kind: "story", person: "d", ts: t("2015-06-01T00:00:00Z"), points: 400, ownTextLen: null }, // big
    ]);
    expect(s.people).toBe(2);
    expect(s.months).toBe(2);
    expect(s.bigMonths).toBe(1);
    expect(s.c).toBe(2.5);
    expect(s.years).toBe(2);
    expect(s.d).toBe(0.5);
    expect(s.spanMonths).toBe(65);
    expect(s.hnMaxPoints).toBe(400);
    expect(s.yearList).toEqual([2010, 2015]);
  });
  it("same person across platforms counts twice; same month once", () => {
    const s = communityStats([
      comment("x", "2020-03-01T00:00:00Z"),
      { source: "reddit", kind: "post", person: "x", ts: t("2020-03-02T00:00:00Z"), points: 60, ownTextLen: null, subreddit: "TrueReddit" },
    ]);
    expect(s.people).toBe(2);
    expect(s.months).toBe(1);
  });
  it("respects per-subreddit thresholds", () => {
    const m: Mention = { source: "reddit", kind: "post", person: "p", ts: t("2020-01-01T00:00:00Z"), points: 25, ownTextLen: null, subreddit: "LongReads" };
    expect(communityStats([m]).people).toBe(0);
    expect(
      communityStats([m], {
        hnStoryPoints: 50, hnBigPoints: 300, commentOwnText: 100, redditDefaultPoints: 50,
        redditBigPoints: 1000, redditSubPoints: { longreads: 20 }, lobstersPoints: 10,
      }).people,
    ).toBe(1);
  });
  it("counts a repeat commenter once, at their first comment", () => {
    // one person pasting the link every month (hiring-thread boilerplate) is one recommendation
    const spam = Array.from({ length: 25 }, (_, i) => comment("boiler", `${2016 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}-15T00:00:00Z`));
    const s = communityStats([...spam].reverse());
    expect(s.people).toBe(1);
    expect(s.months).toBe(1);
    expect(s.years).toBe(1);
    expect(s.firstRec).toBe(t("2016-01-15T00:00:00Z"));
    // stories still count each time: their points come from other people
    const reposts = communityStats([
      { source: "hn", kind: "story", person: "op", ts: t("2014-01-01T00:00:00Z"), points: 120, ownTextLen: null },
      { source: "hn", kind: "story", person: "op", ts: t("2019-01-01T00:00:00Z"), points: 90, ownTextLen: null },
      comment("op", "2020-01-01T00:00:00Z"),
    ]);
    expect(reposts.months).toBe(3);
    expect(reposts.people).toBe(1);
  });
  it("caps durability at 4", () => {
    const ms = Array.from({ length: 15 }, (_, i) => comment(`p${i}`, `${2008 + i}-05-01T00:00:00Z`));
    expect(communityStats(ms).d).toBe(4);
  });
});

describe("editorial and acclaim", () => {
  it("weights and caps editorial", () => {
    expect(editorialScore([{ source: "longreads", kind: "best_of" }, { source: "longreads", kind: "best_of" }])).toEqual({ e: 2, curators: 1 });
    expect(
      editorialScore([
        { source: "longform", kind: "pick" },
        { source: "longreads", kind: "pick" },
        { source: "longreads", kind: "best_of" },
        { source: "kottke", kind: "pick" },
      ]).e,
    ).toBe(4);
  });
  it("weights awards, best result per award, capped", () => {
    expect(acclaimScore([{ award: "pulitzer", result: "finalist" }, { award: "pulitzer", result: "winner" }])).toBe(3);
    expect(acclaimScore([{ award: "polk", result: "winner" }, { award: "best_american_essays", result: "anthologized" }])).toBe(3.5);
    expect(acclaimScore([{ award: "nma", result: "winner" }, { award: "pulitzer", result: "winner" }])).toBe(4);
    expect(acclaimScore([{ award: "polk", result: "finalist" }])).toBe(0);
  });
  it("total score", () => {
    expect(totalScore(5, 2, 2, 3)).toBe(9.5);
  });
});

describe("eligibility", () => {
  const base = { e: 0, curators: 0, a: 0, publishedYear: 2012 };
  it("classic durable rule needs a 12-month span or a pick/award", () => {
    expect(eligibility({ ...base, community: { people: 3, months: 3, spanMonths: 11 } }).eligible).toBe(false);
    expect(eligibility({ ...base, community: { people: 3, months: 3, spanMonths: 12 } }).eligible).toBe(true);
    expect(eligibility({ ...base, a: 1.5, community: { people: 3, months: 3, spanMonths: 2 } }).eligible).toBe(true);
  });
  it("classic curated rule", () => {
    expect(eligibility({ ...base, e: 2, curators: 2, community: { people: 2, months: 2, spanMonths: 0 } }).eligible).toBe(true);
    expect(eligibility({ ...base, e: 2, curators: 1, community: { people: 2, months: 2, spanMonths: 0 } }).eligible).toBe(false);
  });
  it("awards never qualify alone", () => {
    expect(eligibility({ ...base, a: 4, e: 4, curators: 3, community: { people: 0, months: 0, spanMonths: 0 } }).eligible).toBe(false);
    expect(eligibility({ ...base, publishedYear: 2025, a: 4, community: { people: 0, months: 0, spanMonths: 0 } }).eligible).toBe(false);
  });
  it("rising lane", () => {
    expect(eligibility({ ...base, publishedYear: 2025, community: { people: 2, months: 2, spanMonths: 1 } })).toEqual({ eligible: true, lane: "rising" });
    expect(eligibility({ ...base, publishedYear: 2025, e: 1, curators: 1, community: { people: 1, months: 1, spanMonths: 0 } }).eligible).toBe(true);
    expect(eligibility({ ...base, publishedYear: 2025, community: { people: 1, months: 1, spanMonths: 0 } }).eligible).toBe(false);
  });
});
