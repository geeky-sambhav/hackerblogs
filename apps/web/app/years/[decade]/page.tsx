import { Suspense } from "react";
import { PageSkeleton } from "@/components/skeleton";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ListView } from "@/components/list-view";
import { PageTitle } from "@/components/page-title";
import { decadeOf, getCatalog, getDecadeList } from "@/lib/catalog";

function parse(decade: string): number | null {
  const m = /^(\d{4})s$/.exec(decade);
  return m && Number(m[1]) % 10 === 0 ? Number(m[1]) : null;
}

export async function generateStaticParams() {
  const { pieces } = await getCatalog();
  const ds = [...new Set(pieces.map((p) => decadeOf(p.publishedYear)).filter((d): d is number => d !== null))];
  return ds.length ? ds.map((d) => ({ decade: `${d}s` })) : [{ decade: "2010s" }];
}

export async function generateMetadata({ params }: PageProps<"/years/[decade]">): Promise<Metadata> {
  const d = parse((await params).decade);
  return d ? { title: `The ${d}s` } : {};
}

async function DecadePageContent({ params, searchParams }: PageProps<"/years/[decade]">) {
  const { decade } = await params;
  const d = parse(decade);
  if (d === null) notFound();
  const list = await getDecadeList(d);
  if (!list) notFound();
  const { pieces: inDecade, areas } = list;
  return (
    <>
      <PageTitle title={`The ${d}s`}>Pieces first published between {d} and {d + 9}.</PageTitle>
      <ListView basePath={`/years/${decade}`} pieces={inDecade} searchParams={searchParams} areas={areas} hide={["decade"]} diversify />
    </>
  );
}

export default function DecadePage(props: PageProps<"/years/[decade]">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <DecadePageContent {...props} />
    </Suspense>
  );
}
