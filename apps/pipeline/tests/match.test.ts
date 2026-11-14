import { describe, expect, it } from "vitest";
import { cleanTitle, matchScore, publicationMatches, similarity, stripSiteSuffix, surnames } from "../src/lib/match";

const piece = {
  id: 1,
  title: "The Invisible Army | The New Yorker",
  byline: "Sarah Stillman",
  publicationNames: ["The New Yorker"],
  domain: "newyorker.com",
  year: 2011,
};

describe("matching helpers", () => {
  it("similarity is 1 for equal titles modulo punctuation and articles", () => {
    expect(similarity("The Apostate", "apostate")).toBe(1);
    expect(similarity("Joplin!", "Joplin")).toBe(1);
    expect(similarity("Joplin", "The Hell After Isis")).toBeLessThan(0.2);
  });
  it("strips site suffixes", () => {
    expect(stripSiteSuffix("The Falling Man | Esquire")).toBe("The Falling Man");
    expect(stripSiteSuffix("No Suffix Here")).toBe("No Suffix Here");
  });
  it("surnames", () => {
    expect(surnames("Michael Isikoff and Evan Thomas")).toEqual(["isikoff", "thomas"]);
    expect(surnames("Martin Luther King Jr.")).toEqual(["king"]);
  });
  it("publication matching via names or domain", () => {
    expect(publicationMatches("The New Yorker", [], "newyorker.com")).toBe(true);
    expect(publicationMatches("New York", ["New York Magazine"], "nymag.com")).toBe(true);
    expect(publicationMatches("Esquire", ["GQ"], "gq.com")).toBe(false);
  });
});

describe("matchScore", () => {
  it("matches titled awards on title + author/publication + year", () => {
    const a = { award: "nma", year: 2012, title: "The Invisible Army", author: "Sarah Stillman", publication: "The New Yorker", titled: true };
    expect(matchScore(a, piece)).toBeGreaterThan(1);
    expect(matchScore({ ...a, year: 2016 }, piece)).toBe(0); // year too far
    expect(matchScore({ ...a, title: "Something Else Entirely" }, piece)).toBe(0);
  });
  it("matches Pulitzer citations on author + publication + year only", () => {
    const a = { award: "pulitzer", year: 2012, title: "for a gripping account…", author: "Sarah Stillman", publication: "The New Yorker", titled: false };
    expect(matchScore(a, piece)).toBe(0.9);
    expect(matchScore({ ...a, publication: "The Atlantic" }, piece)).toBe(0);
    expect(matchScore(a, { ...piece, year: null })).toBe(0);
  });
});

describe("cleanTitle", () => {
  it("strips site-name suffixes only", () => {
    expect(cleanTitle("Your brain does not process information | Aeon Essays", ["Aeon"], "aeon.co")).toBe("Your brain does not process information");
    expect(cleanTitle("The Falling Man - Esquire", [], "esquire.com")).toBe("The Falling Man");
    expect(cleanTitle("Hackers and Painters", ["Paul Graham"], "paulgraham.com")).toBe("Hackers and Painters");
    expect(cleanTitle("Losing Earth – The Decade We Almost Stopped Climate Change", ["The New York Times Magazine"], "nytimes.com")).toBe(
      "Losing Earth – The Decade We Almost Stopped Climate Change",
    );
    expect(cleanTitle("Why X | Features | The Guardian", ["The Guardian"], "theguardian.com")).toBe("Why X | Features");
  });
});
