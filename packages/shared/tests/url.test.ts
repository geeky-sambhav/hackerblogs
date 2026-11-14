import { describe, expect, it } from "vitest";
import { canonicalizeUrl, decodeHrefEntities, siteKey, isRootLike } from "../src/url";

describe("canonicalizeUrl", () => {
  it("normalises scheme, www, trailing slash and tracking params", () => {
    expect(
      canonicalizeUrl("http://www.newyorker.com/magazine/2009/03/30/hellhole/?utm_source=x&mbid=social"),
    ).toBe("https://newyorker.com/magazine/2009/03/30/hellhole");
  });
  it("keeps identifying query params and sorts them", () => {
    expect(canonicalizeUrl("https://example.com/article.php?z=1&id=42&utm_medium=rss")).toBe(
      "https://example.com/article.php?id=42&z=1",
    );
  });
  it("collapses amp and mobile variants", () => {
    expect(canonicalizeUrl("https://amp.theguardian.com/news/2017/long-read/amp")).toBe(
      "https://theguardian.com/news/2017/long-read",
    );
    expect(canonicalizeUrl("https://m.example.org/a/b/")).toBe("https://example.org/a/b");
  });
  it("never collapses a real last segment into its parent", () => {
    expect(canonicalizeUrl("https://en.wikipedia.org/wiki/AMP")).toBe("https://en.wikipedia.org/wiki/AMP");
    expect(canonicalizeUrl("https://en.wikipedia.org/wiki/Print")).toBe("https://en.wikipedia.org/wiki/Print");
    expect(canonicalizeUrl("https://github.com/ampproject/amp")).toBe("https://github.com/ampproject/amp");
    expect(canonicalizeUrl("https://example.com/essays/all")).toBe("https://example.com/essays/all");
    expect(canonicalizeUrl("https://example.com/2019/05/story/amp/")).toBe("https://example.com/2019/05/story");
  });
  it("keeps non-default ports", () => {
    expect(canonicalizeUrl("https://example.com:8443/a")).toBe("https://example.com:8443/a");
    expect(canonicalizeUrl("http://example.com:80/a")).toBe("https://example.com/a");
  });
  it("drops fragments and index files", () => {
    expect(canonicalizeUrl("https://example.com/essays/index.html#part-2")).toBe("https://example.com/essays");
  });
  it("decodes HN-style entities and strips trailing prose punctuation", () => {
    expect(canonicalizeUrl("https:&#x2F;&#x2F;aeon.co&#x2F;essays&#x2F;foo).")).toBe("https://aeon.co/essays/foo");
    expect(canonicalizeUrl("https://en.wikipedia.org/wiki/Foo_(bar)")).toBe("https://en.wikipedia.org/wiki/Foo_(bar)");
  });
  it("rejects non-http and junk", () => {
    expect(canonicalizeUrl("mailto:a@b.com")).toBeNull();
    expect(canonicalizeUrl("javascript:alert(1)")).toBeNull();
    expect(canonicalizeUrl("https://localhost/x")).toBeNull();
    expect(canonicalizeUrl("http://127.0.0.1/x")).toBeNull();
    expect(canonicalizeUrl("")).toBeNull();
  });
  it("does not strip www from a bare two-label host", () => {
    expect(canonicalizeUrl("https://m.co/x")).toBe("https://m.co/x");
  });
  it("unwraps archive and redirect wrappers", () => {
    expect(canonicalizeUrl("https://web.archive.org/web/20150101000000/http://www.newyorker.com/magazine/2009/03/30/hellhole")).toBe(
      "https://newyorker.com/magazine/2009/03/30/hellhole",
    );
    expect(canonicalizeUrl("http://web.archive.org/web/2015id_/http:/example.com/a")).toBe("https://example.com/a");
    expect(canonicalizeUrl("https://12ft.io/proxy?q=https%3A%2F%2Fwww.theatlantic.com%2Fx%2F")).toBe("https://theatlantic.com/x");
    expect(canonicalizeUrl("https://12ft.io/https://www.wired.com/story/foo/")).toBe("https://wired.com/story/foo");
    expect(canonicalizeUrl("https://www.google.com/url?q=https://aeon.co/essays/y&sa=D")).toBe("https://aeon.co/essays/y");
    expect(canonicalizeUrl("https://web.archive.org/")).toBe("https://web.archive.org/");
  });
  it("applies publisher rewrite rules", () => {
    const rules = [{ host: "newyorker.com", pattern: "^/reporting/(\\d{4}/\\d{2}/\\d{2})/(.+)$", replace: "/magazine/$1/$2" }];
    expect(canonicalizeUrl("https://www.newyorker.com/reporting/2009/03/30/hellhole", rules)).toBe(
      "https://newyorker.com/magazine/2009/03/30/hellhole",
    );
  });
});

describe("helpers", () => {
  it("decodes entities", () => {
    expect(decodeHrefEntities("a&amp;b&#x3D;c")).toBe("a&b=c");
  });
  it("siteKey splits multi-tenant hosts", () => {
    expect(siteKey("https://medium.com/@alice/post-1")).toBe("medium.com/@alice");
    expect(siteKey("https://foo.substack.com/p/x")).toBe("foo.substack.com");
  });
  it("isRootLike", () => {
    expect(isRootLike("https://example.com/")).toBe(true);
    expect(isRootLike("https://example.com/x")).toBe(false);
  });
});
