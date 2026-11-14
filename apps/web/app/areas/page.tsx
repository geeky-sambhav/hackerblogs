import type { Metadata } from "next";
import Link from "next/link";
import { PageTitle } from "@/components/page-title";
import { getCatalog } from "@/lib/catalog";
import { plural } from "@/lib/labels";

export const metadata: Metadata = { title: "Areas" };

export default async function AreasPage() {
  const { areas } = await getCatalog();
  return (
    <>
      <PageTitle title="Areas">Every piece is filed under one to three areas, from its tags, section and title.</PageTitle>
      <ul className="divide-y divide-border/70">
        {areas.map((a) => (
          <li key={a.slug} className="py-4">
            <Link href={`/areas/${a.slug}`} className="text-xl font-medium hover:underline">
              {a.name}
            </Link>
            <span className="ml-2 text-sm text-muted-foreground">{plural(a.count, "piece")}</span>
            <p className="text-[0.95rem] text-muted-foreground">{a.description}</p>
          </li>
        ))}
      </ul>
    </>
  );
}
