import type { Metadata } from "next";
import { ListView } from "@/components/list-view";
import { PageTitle } from "@/components/page-title";
import { getShelfList } from "@/lib/catalog";

export const metadata: Metadata = { title: "Hidden gems" };

export default async function GemsPage({ searchParams }: PageProps<"/gems">) {
  const { pieces, areas } = await getShelfList("gems");
  return (
    <>
      <PageTitle title="Hidden gems">
        Recommended again and again in comment threads, but never a big hit on the Hacker News front page.
      </PageTitle>
      <ListView basePath="/gems" pieces={pieces} searchParams={searchParams} areas={areas} diversify />
    </>
  );
}
