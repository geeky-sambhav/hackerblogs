import * as cheerio from "cheerio";
import { canonicalizeUrl, isRootLike } from "@hackerreads/shared";
import { makeClassifier } from "./sites";

const classify = makeClassifier();

/** Outbound article-like links in an HTML fragment, in document order, de-duplicated. */
export function articleLinks(html: string, selfHosts: string[] = []): string[] {
  const $ = cheerio.load(html);
  const out: string[] = [];
  const seen = new Set<string>();
  $("a[href]").each((_, el) => {
    const href = ($(el).attr("href") ?? "").trim();
    if (!/^https?:\/\//i.test(href)) return;
    const canon = canonicalizeUrl(href);
    if (!canon || seen.has(canon)) return;
    const host = new URL(canon).hostname;
    if (selfHosts.some((h) => host === h || host.endsWith(`.${h}`))) return;
    if (isRootLike(canon)) return;
    if (classify(canon).preset === "exclude") return;
    seen.add(canon);
    out.push(href);
  });
  return out;
}
