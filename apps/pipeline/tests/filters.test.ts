import { describe, expect, it } from "vitest";
import { exclusionReason, type FilterInput } from "../src/lib/filters";

const base: FilterInput = {
  url: "https://example.com/essays/on-walking",
  title: "On Walking",
  section: "Essays",
  tags: [],
  lang: "en",
  wordCount: 4000,
  knownPublication: false,
  httpStatus: 200,
  waybackUrl: null,
  recommendedYears: 2,
};

describe("exclusionReason", () => {
  it("keeps a normal long essay", () => expect(exclusionReason(base)).toBeNull());
  it("length rules", () => {
    expect(exclusionReason({ ...base, wordCount: 700 })).toBe("too-short");
    expect(exclusionReason({ ...base, wordCount: null })).toBe("unknown-length");
    expect(exclusionReason({ ...base, wordCount: null, knownPublication: true })).toBeNull();
  });
  it("language", () => {
    expect(exclusionReason({ ...base, lang: "en-gb" })).toBeNull();
    expect(exclusionReason({ ...base, lang: "de" })).toBe("not-english");
  });
  it("fiction and poetry, but not nonfiction or sci-fi criticism", () => {
    expect(exclusionReason({ ...base, section: "Fiction" })).toBe("fiction-or-poetry");
    expect(exclusionReason({ ...base, url: "https://newyorker.com/magazine/2010/01/01/x", tags: ["fiction"] })).toBe("fiction-or-poetry");
    expect(exclusionReason({ ...base, url: "https://x.org/poems/ode" })).toBe("fiction-or-poetry");
    expect(exclusionReason({ ...base, tags: ["non-fiction", "science fiction"] })).toBeNull();
  });
  it("short interviews only", () => {
    expect(exclusionReason({ ...base, title: "An Interview with Ursula Le Guin", wordCount: 1500 })).toBe("short-interview");
    expect(exclusionReason({ ...base, title: "An Interview with Ursula Le Guin", wordCount: 6000 })).toBeNull();
  });
  it("news, unless tagged as a long read", () => {
    expect(exclusionReason({ ...base, section: "World news" })).toBe("news");
    expect(exclusionReason({ ...base, url: "https://x.com/2020/live/updates" })).toBe("news");
    expect(exclusionReason({ ...base, section: "News", tags: ["the long read"] })).toBeNull();
    // recommended across five or more years: not timely, whatever the section says
    expect(exclusionReason({ ...base, section: "News", recommendedYears: 5 })).toBeNull();
    expect(exclusionReason({ ...base, section: "News", recommendedYears: 4 })).toBe("news");
  });
  it("dead links need an archived copy", () => {
    expect(exclusionReason({ ...base, httpStatus: 404 })).toBe("dead-link");
    expect(exclusionReason({ ...base, httpStatus: -2 })).toBe("dead-link"); // redirected to the front page
    expect(exclusionReason({ ...base, httpStatus: -2, waybackUrl: "https://web.archive.org/web/2015/x" })).toBeNull();
    // Up but blocking bots, or robots.txt: alive, so never a dead link.
    expect(exclusionReason({ ...base, httpStatus: -3 })).toBeNull();
    expect(exclusionReason({ ...base, httpStatus: -1 })).toBeNull();
    expect(exclusionReason({ ...base, httpStatus: 404, waybackUrl: "https://web.archive.org/web/2015/x" })).toBeNull();
    expect(exclusionReason({ ...base, httpStatus: -1 })).toBeNull(); // robots-blocked but live
  });
});
