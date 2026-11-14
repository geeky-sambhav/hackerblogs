import type { Metadata } from "next";
import Link from "next/link";
import { PageTitle } from "@/components/page-title";

export const metadata: Metadata = { title: "About" };

const h2 = "mt-10 text-2xl font-medium";
const p = "mt-3 max-w-[66ch]";
const a = "text-primary underline";

export default function AboutPage() {
  return (
    <article className="pb-6">
      <PageTitle title="How pieces are chosen">
        HackerReads lists long-form articles and essays that readers have recommended over and over, across many years. A
        piece gets in on evidence, not on where it was published.
      </PageTitle>

      <h2 className={h2}>The evidence</h2>
      <p className={p}>
        Most of the weight comes from readers. We count a recommendation when someone links a piece in a Hacker News or Reddit
        comment with at least a hundred characters of their own words, or when a submission of it scores well (50 points on
        Hacker News, a per-community threshold on Reddit). Each person counts once. What matters most is how many different
        months and years people kept doing it.
      </p>
      <p className={p}>
        Curators add a smaller boost: Longform, Longreads (including its year-end best-of lists), Kottke, Marginal
        Revolution, Arts &amp; Letters Daily and The Browser. So do prizes: the Pulitzer Prize (feature writing, explanatory
        reporting, criticism and commentary), the National Magazine Awards and the George Polk Awards. A prize alone never
        gets a piece in.
      </p>
      <p className={p}>
        The score is the number of months with a recommendation, plus a bonus for months with a very popular submission,
        plus a bonus for each additional year, plus half the curator and prize points. No AI model reads, labels or
        summarises anything; every rule is plain arithmetic you could check by hand.
      </p>

      <h2 className={h2}>What counts</h2>
      <p className={p}>
        English-language nonfiction of at least 800 words: reported features, profiles, essays, criticism, science and
        history writing, and long interviews. Fiction, poetry, short interviews and news coverage are left out. A piece needs
        recommendations spread over at least a year, unless a curator or prize also vouches for it. Pieces published since
        2024 can&apos;t have proved that yet, so they sit on their own{" "}
        <Link href="/rising" className={a}>
          Rising
        </Link>{" "}
        shelf.
      </p>

      <h2 className={h2}>Reading</h2>
      <p className={p}>
        Every entry links to the original publisher, and nothing is republished here. Titles, writers and the short
        description come from the publisher&apos;s own page. When an original page has disappeared, we link to its copy in
        the Internet Archive. Paywall labels describe the publication in general, not each article.
      </p>
      <p className={p}>
        Your likes, reading list and history stay in your browser. There are no accounts and no tracking.
      </p>

      <h2 className={h2}>Data sources</h2>
      <ul className="mt-3 max-w-[66ch] list-disc space-y-1 pl-5">
        <li>
          Hacker News: the{" "}
          <a href="https://huggingface.co/datasets/open-index/hacker-news" className={a}>
            open-index/hacker-news
          </a>{" "}
          dataset (ODC-By 1.0), through August 2026.
        </li>
        <li>
          Reddit: link posts from selected communities, via the{" "}
          <a href="https://github.com/ArthurHeitmann/arctic_shift" className={a}>
            Arctic Shift
          </a>{" "}
          archive. Usernames are never stored, only one-way hashes.
        </li>
        <li>
          <a href="https://longform.org" className={a}>Longform</a> (2010–2022), <a href="https://longreads.com" className={a}>Longreads</a>,{" "}
          <a href="https://kottke.org" className={a}>Kottke</a>, Marginal Revolution&apos;s{" "}
          <a href="https://marginalrevolution.com/ai-archive/" className={a}>research archive</a>, and Arts &amp; Letters Daily
          and The Browser through the <a href="https://web.archive.org" className={a}>Wayback Machine</a>.
        </li>
        <li>Prize lists from Wikipedia and the George Polk Awards at Long Island University.</li>
      </ul>
      <p className={p}>
        The idea comes from asking what a long-reads library would look like if readers, over many years, did the
        choosing.
      </p>
    </article>
  );
}
