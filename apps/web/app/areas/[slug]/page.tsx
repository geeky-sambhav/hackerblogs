import { Suspense } from "react";
import { PageSkeleton } from "@/components/skeleton";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ListView } from "@/components/list-view";
import { PageTitle } from "@/components/page-title";
import { getAreaList, getCatalog } from "@/lib/catalog";

export async function generateStaticParams() {
  const { areas } = await getCatalog();
  return areas.length ? areas.map((a) => ({ slug: a.slug })) : [{ slug: "__none__" }];
}

export async function generateMetadata({ params }: PageProps<"/areas/[slug]">): Promise<Metadata> {
  const list = await getAreaList((await params).slug);
  return list ? { title: list.entity.name, description: list.entity.description } : {};
}

async function AreaPageContent({ params, searchParams }: PageProps<"/areas/[slug]">) {
  const { slug } = await params;
  const list = await getAreaList(slug);
  if (!list) notFound();
  const { entity: area, pieces, startHere } = list;
  return (
    <>
      <PageTitle title={area.name}>
        <p>{area.description}</p>
        {startHere ? (
          <p className="mt-2">
            New to this shelf?{" "}
            <Link href={`/collections/${startHere}`} className="text-primary underline">
              Start with these twelve
            </Link>
            .
          </p>
        ) : null}
      </PageTitle>
      <ListView basePath={`/areas/${slug}`} pieces={pieces} searchParams={searchParams} hide={["area"]} diversify />
    </>
  );
}

export default function AreaPage(props: PageProps<"/areas/[slug]">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <AreaPageContent {...props} />
    </Suspense>
  );
}
