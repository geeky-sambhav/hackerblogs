import type { Metadata } from "next";
import Link from "next/link";
import { PageTitle } from "@/components/page-title";
import { getCatalog } from "@/lib/catalog";
import { plural } from "@/lib/labels";

export const metadata: Metadata = { title: "Collections" };

export default async function CollectionsPage() {
  const { collections } = await getCatalog();
  const themed = collections.filter((c) => !c.slug.startsWith("start-here-"));
  const starters = collections.filter((c) => c.slug.startsWith("start-here-"));
  const item = (c: (typeof collections)[number]) => (
    <li key={c.slug} className="py-4">
      <Link href={`/collections/${c.slug}`} className="text-xl font-medium hover:underline">
        {c.title}
      </Link>
      <span className="ml-2 text-sm text-muted-foreground">{plural(c.pieceIds.length, "piece")}</span>
      <p className="text-[0.95rem] text-muted-foreground">{c.description}</p>
    </li>
  );
  return (
    <>
      <PageTitle title="Collections">
        <p>Reading lists built from the evidence: durability, prizes, curators, decades.</p>
        <p className="mt-2">
          Also on the shelves:{" "}
          <Link href="/gems" className="text-primary underline">hidden gems</Link>,{" "}
          <Link href="/rising" className="text-primary underline">rising pieces</Link> and{" "}
          <Link href="/publications" className="text-primary underline">every publication</Link>.
        </p>
      </PageTitle>
      <ul className="divide-y divide-border/70">{themed.map(item)}</ul>
      {starters.length > 0 ? (
        <>
          <h2 className="mt-12 text-2xl font-medium">Start here, by area</h2>
          <ul className="divide-y divide-border/70">{starters.map(item)}</ul>
        </>
      ) : null}
    </>
  );
}
