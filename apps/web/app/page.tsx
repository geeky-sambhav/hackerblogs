import Link from "next/link";
import { Feed } from "@/components/feed";
import { StampStrip } from "@/components/stamp-strip";

export default function Home() {
  return (
    <>
      <section className="pt-8 pb-6">
        <h1 className="max-w-[24ch] text-4xl leading-[1.1] font-medium tracking-tight text-balance sm:text-5xl">
          Long reads people keep recommending, year after year.
        </h1>
        <p className="mt-4 max-w-[60ch] text-muted-foreground">
          Every piece here was recommended by readers on Hacker News and Reddit in many different months and years, with a
          nudge from Longform, Longreads, Kottke, prizes and other curators. Each square is a year from 2006 to 2026; a
          stamp means readers recommended it that year.
        </p>
        <p className="mt-3 flex items-center gap-3 text-sm text-muted-foreground">
          <StampStrip recYears={[2008, 2009, 2011, 2013, 2014, 2017, 2019, 2022, 2025]} />
          <span>a piece recommended in nine different years</span>
        </p>
        <p className="mt-5 text-[0.95rem]">
          Your picks below are shuffled each visit and learn from what you like. Prefer a reading list?{" "}
          <Link href="/collections" className="text-primary underline">
            Browse the collections
          </Link>
          .
        </p>
      </section>
      <Feed />
    </>
  );
}
