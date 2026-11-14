import { describe, expect, it } from "vitest";
import { countWords, extractMeta, splitAuthors, toIsoDate } from "../src/lib/meta";

const body = Array.from({ length: 60 }, (_, i) => `<p>Paragraph ${i} has a number of plain words in it so Readability keeps it as the article body text.</p>`).join("");
const html = `<!doctype html><html lang="en-US"><head>
<title>Fallback | Site</title>
<meta property="og:title" content="The Falling Man">
<meta property="og:description" content="An unforgettable photograph.">
<meta property="og:image" content="/img/falling.jpg">
<meta property="og:site_name" content="Esquire">
<meta property="og:type" content="article">
<meta property="article:published_time" content="2009-09-09T12:00:00Z">
<meta property="article:section" content="Features">
<meta property="article:tag" content="9/11"><meta property="article:tag" content="Photography">
<link rel="canonical" href="https://www.esquire.com/news-politics/a48031/the-falling-man-tom-junod/">
<script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"WebSite","name":"Esquire"},{"@type":"NewsArticle","headline":"The Falling Man","author":[{"@type":"Person","name":"Tom Junod"}],"wordCount":"7600","datePublished":"2009-09-09"}]}</script>
</head><body><article><h1>The Falling Man</h1>${body}</article></body></html>`;

describe("extractMeta", () => {
  it("reads OG, JSON-LD @graph, canonical, lang, tags and counts", () => {
    const m = extractMeta(html, "https://www.esquire.com/x");
    expect(m).toMatchObject({
      title: "The Falling Man",
      dek: "An unforgettable photograph.",
      image: "https://www.esquire.com/img/falling.jpg",
      siteName: "Esquire",
      ogType: "article",
      canonical: "https://www.esquire.com/news-politics/a48031/the-falling-man-tom-junod/",
      publishedAt: "2009-09-09",
      authors: ["Tom Junod"],
      section: "Features",
      tags: ["9/11", "photography"],
      lang: "en-us",
      declaredWordCount: 7600,
      isArticleType: true,
    });
    expect(m.extractedWordCount).toBeNull(); // declared count wins; Readability is skipped
  });
  it("counts words with Readability when no word count is declared", () => {
    const m = extractMeta(html.replace(',"wordCount":"7600"', ""), "https://www.esquire.com/x");
    expect(m.declaredWordCount).toBeNull();
    expect(m.extractedWordCount).toBeGreaterThan(900);
  });
  it("gives up quickly on giant pages instead of hanging", () => {
    const cells = "<div><a href='/x'>link</a> text</div>".repeat(60_000);
    const started = Date.now();
    const m = extractMeta(`<html><head><title>Huge</title></head><body>${cells}</body></html>`, "https://a.com/huge");
    expect(m.title).toBe("Huge");
    expect(m.extractedWordCount).toBeNull();
    expect(Date.now() - started).toBeLessThan(5_000);
  });
  it("falls back to <title> and handles pages without metadata", () => {
    const m = extractMeta("<html><head><title>  Just a title </title></head><body><p>hi</p></body></html>", "https://a.com/");
    expect(m.title).toBe("Just a title");
    expect(m.authors).toEqual([]);
    expect(m.isArticleType).toBe(false);
    expect(m.declaredWordCount).toBeNull();
  });
});

describe("helpers", () => {
  it("splitAuthors", () => {
    expect(splitAuthors(["By Atul Gawande", "https://x.com/a", "Ta-Nehisi Coates and Jane Doe", "Staff"])).toEqual([
      "Atul Gawande",
      "Ta-Nehisi Coates",
      "Jane Doe",
    ]);
  });
  it("toIsoDate", () => {
    expect(toIsoDate("2014-05-21T10:00:00-04:00")).toBe("2014-05-21");
    expect(toIsoDate("May 21, 2014")).toBe("2014-05-21");
    expect(toIsoDate("garbage")).toBeNull();
    expect(toIsoDate("2020-24-05")).toBeNull();
    expect(toIsoDate("2021-02-30")).toBeNull();
    expect(toIsoDate("2020-02-29")).toBe("2020-02-29");
    expect(toIsoDate("0001-01-01")).toBeNull();
  });
  it("countWords", () => {
    expect(countWords("It’s a well-known fact, 42 times.")).toBe(6);
  });
});
