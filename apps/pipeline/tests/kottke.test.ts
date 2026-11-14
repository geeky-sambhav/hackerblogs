import { describe, expect, it } from "vitest";
import { parseKottkePage } from "../src/stages/ingest-kottke";

const html = `<div class="post"><div class="post-meta">posted <a href="/15/06/x"><time datetime="2015-06-30T15:48:08Z">Jun 30</time></a> by <a href="http://www.kottke.org">Jason</a></div>
<h2><a href="/15/06/x">The Big Story</a></h2>
<p><a href="https://twitter.com/someone">@someone</a> found <a href="https://www.theatlantic.com/magazine/archive/2015/07/a-piece/123/">this piece</a> and <a href="https://example.com/second">another</a>.</p>
<a href="/tag/books">books</a><a href="/tag/best%20of">best of</a>
<div class="share-menu"><a href="https://bsky.app/intent/compose?text=x">share</a></div></div>
<div class="post"><div class="post-meta"><time datetime="2015-06-29T10:00:00Z"></time></div><h2><a href="/15/06/y">No links</a></h2><p>Just text.</p></div>`;

describe("parseKottkePage", () => {
  it("takes the first article link per post with tags", () => {
    expect(parseKottkePage(html)).toEqual([
      {
        source: "kottke",
        kind: "pick",
        year: 2015,
        url_raw: "https://www.theatlantic.com/magazine/archive/2015/07/a-piece/123/",
        ref_url: "https://kottke.org/15/06/x",
        title: "The Big Story",
        tags: "books,best of",
      },
    ]);
  });
});
