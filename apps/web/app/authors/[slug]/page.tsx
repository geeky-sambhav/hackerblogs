import { Suspense } from "react";
import { PageSkeleton } from "@/components/skeleton";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ListView } from "@/components/list-view";
import { PageTitle } from "@/components/page-title";
import { getAuthorList, getCatalog } from "@/lib/catalog";
import { plural } from "@/lib/labels";

export async function generateStaticParams() {
  const { authors } = await getCatalog();
  return authors.length ? authors.map((a) => ({ slug: a.slug })) : [{ slug: "__none__" }];
}

export async function generateMetadata({ params }: PageProps<"/authors/[slug]">): Promise<Metadata> {
  const list = await getAuthorList((await params).slug);
  return list ? { title: list.entity.name } : {};
}

async function AuthorPageContent({ params, searchParams }: PageProps<"/authors/[slug]">) {
  const { slug } = await params;
  const list = await getAuthorList(slug);
  if (!list) notFound();
  const { entity: author, pieces: theirs, areas } = list;
  return (
    <>
      <PageTitle title={author.name}>{plural(theirs.length, "piece")} in the library.</PageTitle>
      <ListView basePath={`/authors/${slug}`} pieces={theirs} searchParams={searchParams} areas={areas} />
    </>
  );
}

export default function AuthorPage(props: PageProps<"/authors/[slug]">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <AuthorPageContent {...props} />
    </Suspense>
  );
}
