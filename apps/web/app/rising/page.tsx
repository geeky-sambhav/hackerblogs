import type { Metadata } from "next";
import { ListView } from "@/components/list-view";
import { PageTitle } from "@/components/page-title";
import { getShelfList } from "@/lib/catalog";

export const metadata: Metadata = { title: "Rising" };

export default async function RisingPage({ searchParams }: PageProps<"/rising">) {
  const { pieces, areas } = await getShelfList("rising");
  return (
    <>
      <PageTitle title="Rising">
        Published since 2024 and already recommended by several readers. Too new to prove they last, so they get their own shelf.
      </PageTitle>
      <ListView basePath="/rising" pieces={pieces} searchParams={searchParams} areas={areas} hide={["decade"]} diversify />
    </>
  );
}
