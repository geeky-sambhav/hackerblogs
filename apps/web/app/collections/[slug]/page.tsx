import { Suspense } from "react";
import { PageSkeleton } from "@/components/skeleton";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageTitle } from "@/components/page-title";
import { PieceList } from "@/components/piece-entry";
import { getCatalog, getCollection, piecesByIds } from "@/lib/catalog";

export async function generateStaticParams() {
  const { collections } = await getCatalog();
  return collections.length ? collections.map((c) => ({ slug: c.slug })) : [{ slug: "__none__" }];
}

export async function generateMetadata({ params }: PageProps<"/collections/[slug]">): Promise<Metadata> {
  const c = await getCollection((await params).slug);
  return c ? { title: c.title, description: c.description } : {};
}

async function CollectionPageContent({ params }: PageProps<"/collections/[slug]">) {
  const { slug } = await params;
  const c = await getCollection(slug);
  if (!c) notFound();
  const pieces = await piecesByIds(c.pieceIds);
  return (
    <>
      <PageTitle title={c.title}>{c.description}</PageTitle>
      <PieceList pieces={pieces} />
    </>
  );
}

export default function CollectionPage(props: PageProps<"/collections/[slug]">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <CollectionPageContent {...props} />
    </Suspense>
  );
}
