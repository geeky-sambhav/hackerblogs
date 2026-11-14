import { describe, expect, it } from "vitest";
import { picksFromPost } from "../src/stages/ingest-longreads";

const post = (html: string) => ({
  id: 1,
  date: "2017-03-15T10:00:00",
  link: "https://longreads.com/2017/03/15/x/",
  title: { rendered: "Living In These Curated Times" },
  tags: [],
  content: { rendered: html },
});

describe("picksFromPost", () => {
  it("takes the first article link, skipping homepages and social links", () => {
    const rows = picksFromPost(
      post(`<a href="https://twitter.com/x">t</a><a href="https://thebaffler.com/">home</a>
            <a href="https://thebaffler.com/salvos/outsmarted?src=longreads">piece</a>
            <a href="https://longreads.com/2017/01/01/other/">ours</a><a href="https://example.com/related">rel</a>`),
      null,
    );
    expect(rows).toEqual([
      {
        source: "longreads",
        kind: "pick",
        year: 2017,
        url_raw: "https://thebaffler.com/salvos/outsmarted?src=longreads",
        ref_url: "https://longreads.com/2017/03/15/x/",
        title: "Living In These Curated Times",
      },
    ]);
  });
  it("takes every article link in a best-of list", () => {
    const rows = picksFromPost(post(`<a href="https://esquire.com/a/b">1</a><a href="https://dmagazine.com/c">2</a>`), 2012);
    expect(rows.map((r) => [r.kind, r.year, r.url_raw])).toEqual([
      ["best_of", 2012, "https://esquire.com/a/b"],
      ["best_of", 2012, "https://dmagazine.com/c"],
    ]);
  });
  it("returns nothing for originals without outbound links", () => {
    expect(picksFromPost(post("<p>An original essay</p>"), null)).toEqual([]);
  });
});
