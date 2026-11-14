import { Suspense } from "react";
import { PageSkeleton } from "@/components/skeleton";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ListView } from "@/components/list-view";
import { PageTitle } from "@/components/page-title";
import { getCatalog, getPublicationList } from "@/lib/catalog";
import { paywallLabel, plural } from "@/lib/labels";

export async function generateStaticParams() {
  const { publications } = await getCatalog();
  return publications.length ? publications.map((p) => ({ slug: p.slug })) : [{ slug: "__none__" }];
}

export async function generateMetadata({ params }: PageProps<"/publications/[slug]">): Promise<Metadata> {
  const list = await getPublicationList((await params).slug);
  return list ? { title: list.entity.name } : {};
}

async function PublicationPageContent({ params, searchParams }: PageProps<"/publications/[slug]">) {
  const { slug } = await params;
  const list = await getPublicationList(slug);
  if (!list) notFound();
  const { entity: pub, pieces: theirs, areas } = list;
  const access = paywallLabel(pub.paywall);
  return (
    <>
      <PageTitle title={pub.name}>
        {plural(theirs.length, "piece")} in the library{access ? `. ${access}.` : "."}
      </PageTitle>
      <ListView basePath={`/publications/${slug}`} pieces={theirs} searchParams={searchParams} areas={areas} />
    </>
  );
}

export default function PublicationPage(props: PageProps<"/publications/[slug]">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <PublicationPageContent {...props} />
    </Suspense>
  );
}
