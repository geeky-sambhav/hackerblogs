import type { Metadata } from "next";
import Link from "next/link";
import { PageTitle } from "@/components/page-title";
import { decadeOf, getCatalog } from "@/lib/catalog";
import { plural } from "@/lib/labels";

export const metadata: Metadata = { title: "Browse by decade" };

export default async function YearsPage() {
  const { pieces } = await getCatalog();
  const counts = new Map<number, number>();
  for (const p of pieces) {
    const d = decadeOf(p.publishedYear);
    if (d !== null) counts.set(d, (counts.get(d) ?? 0) + 1);
  }
  const decades = [...counts.entries()].sort((a, b) => b[0] - a[0]);
  return (
    <>
      <PageTitle title="Browse by decade">By the year each piece was first published.</PageTitle>
      <ul className="divide-y divide-border/70">
        {decades.map(([d, n]) => (
          <li key={d} className="py-4">
            <Link href={`/years/${d}s`} className="text-xl font-medium hover:underline">
              The {d}s
            </Link>
            <span className="ml-2 text-sm text-muted-foreground">{plural(n, "piece")}</span>
          </li>
        ))}
      </ul>
    </>
  );
}
