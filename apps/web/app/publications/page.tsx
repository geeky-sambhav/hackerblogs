import type { Metadata } from "next";
import Link from "next/link";
import { PageTitle } from "@/components/page-title";
import { getCatalog } from "@/lib/catalog";
import { paywallLabel, plural } from "@/lib/labels";

export const metadata: Metadata = { title: "Publications" };

export default async function PublicationsPage() {
  const { publications } = await getCatalog();
  const publishers = publications.filter((p) => p.kind === "publisher");
  const independents = publications.filter((p) => p.kind === "independent");
  const list = (items: typeof publications) => (
    <ul className="columns-1 gap-8 sm:columns-2">
      {items.map((p) => (
        <li key={p.slug} className="break-inside-avoid py-1.5">
          <Link href={`/publications/${p.slug}`} className="italic hover:underline">
            {p.name}
          </Link>{" "}
          <span className="text-sm text-muted-foreground">
            {plural(p.count, "piece")}
            {paywallLabel(p.paywall) ? `, ${paywallLabel(p.paywall)?.toLowerCase()}` : ""}
          </span>
        </li>
      ))}
    </ul>
  );
  return (
    <>
      <PageTitle title="Publications">Where the pieces were published, by number of pieces in the library.</PageTitle>
      {list(publishers)}
      {independents.length > 0 ? (
        <>
          <h2 className="mt-10 mb-3 text-2xl font-medium">Independent writers</h2>
          {list(independents)}
        </>
      ) : null}
    </>
  );
}
