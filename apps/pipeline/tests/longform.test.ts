import { describe, expect, it } from "vitest";
import { parseLongformPage } from "../src/stages/ingest-longform";

const html = `
<article class="post post--podcast js-post" data-labels="podcast"><a href="http://longform.org/posts/pod" class="post__link"><h2 class="post__title"><span class="post__title__highlight">Pod</span></h2></a></article>
<article class="post post--single js-post" data-labels="science food">
  <a href="http://www.grubstreet.com/2017/01/robot-chef.html" class="post__link"><h2 class="post__title js-post-title"><span class="post__title__highlight"> The Chef of the Future </span></h2></a>
  <p class="post__byline"><span class="post__author"><a href="/archive/writers/x" class="post__author__link">David Marchese</a></span>
  <a href="/archive/publications/new-york" class="post__publication">New York</a><span class="post__date">Jan 2017</span>
  <a href="https://longform.org/posts/the-chef" class="post__permalink">Permalink</a></p>
</article>
<p>see <a href="https://blog.example.com/?p=2264647">a wp link</a></p>
<div class="cells pagination"><a href="/?p=199">Newer</a><a href="/?p=523">523</a></div>`;

describe("parseLongformPage", () => {
  it("extracts picks and skips podcasts", () => {
    const { rows, lastPage } = parseLongformPage(html);
    expect(lastPage).toBe(523);
    expect(rows).toEqual([
      {
        source: "longform",
        kind: "pick",
        year: 2017,
        url_raw: "http://www.grubstreet.com/2017/01/robot-chef.html",
        ref_url: "https://longform.org/posts/the-chef",
        title: "The Chef of the Future",
        tags: "science,food",
        author: "David Marchese",
        publication: "New York",
      },
    ]);
  });
});
