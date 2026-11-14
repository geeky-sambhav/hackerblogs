import { describe, expect, it } from "vitest";
import { picksFromMrPost } from "../src/stages/ingest-mr";

describe("picksFromMrPost", () => {
  it("takes every article link from Assorted links posts only", () => {
    const content = `<ol><li><a href="https://aeon.co/essays/a">One</a>.</li><li><a href="https://marginalrevolution.com/x">self</a></li>
      <li><a href="https://twitter.com/y/status/1">tweet</a></li><li><a href="https://www.newyorker.com/magazine/2015/01/01/b">Two</a></li></ol>`;
    expect(picksFromMrPost({ title: "Assorted links", content, url: "https://mr/1", published_at: "2015-02-03T00:00:00Z" }).map((r) => r.url_raw)).toEqual([
      "https://aeon.co/essays/a",
      "https://www.newyorker.com/magazine/2015/01/01/b",
    ]);
    expect(picksFromMrPost({ title: "Thursday assorted links", content })).toHaveLength(2);
    expect(picksFromMrPost({ title: "Why markets work", content })).toEqual([]);
  });
});
