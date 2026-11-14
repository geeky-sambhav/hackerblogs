import type { Metadata } from "next";
import { Suspense } from "react";
import { PageTitle } from "@/components/page-title";
import { PieceList } from "@/components/piece-entry";
import { getAreas, piecesByIds, searchPieceIds } from "@/lib/catalog";
import { plural } from "@/lib/labels";

export const metadata: Metadata = { title: "Search" };

function one(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v) ?? "";
}

async function Results({ searchParams }: { searchParams: PageProps<"/search">["searchParams"] }) {
  const sp = await searchParams;
  const q = one(sp.q).trim();
  const area = one(sp.area);
  const areas = await getAreas();
  const form = (
    <form action="/search" role="search" className="flex flex-wrap gap-2">
      <label htmlFor="q" className="sr-only">
        Search titles, writers, publications and topics
      </label>
      <input
        id="q"
        name="q"
        type="search"
        defaultValue={q}
        placeholder="Try: Gawande, fermentation, “con man”"
        className="min-w-0 flex-1 rounded-md border border-input bg-card px-3 py-2 text-base"
      />
      <label htmlFor="area" className="sr-only">
        Area
      </label>
      <select id="area" name="area" defaultValue={area} className="rounded-md border border-input bg-card px-2 py-2 text-base">
        <option value="">All areas</option>
        {areas.map((a) => (
          <option key={a.slug} value={a.slug}>
            {a.name}
          </option>
        ))}
      </select>
      <button type="submit" className="rounded-md bg-primary px-4 py-2 text-primary-foreground hover:bg-primary/90">
        Search
      </button>
    </form>
  );
  if (!q) {
    return (
      <>
        {form}
        <p className="mt-6 text-muted-foreground">
          Search matches words in titles, writers, publications, descriptions and tags. Use quotes for a phrase and a minus
          sign to leave a word out.
        </p>
      </>
    );
  }
  const ids = await searchPieceIds(q);
  let pieces = await piecesByIds(ids);
  if (area) pieces = pieces.filter((p) => p.areas.includes(area));
  return (
    <>
      {form}
      <p className="mt-6 text-sm text-muted-foreground">
        {pieces.length === 0 ? `Nothing matches “${q}”. Check the spelling or try a broader word.` : `${plural(pieces.length, "piece")} for “${q}”`}
      </p>
      <PieceList pieces={pieces} />
    </>
  );
}

export default function SearchPage({ searchParams }: PageProps<"/search">) {
  return (
    <>
      <PageTitle title="Search" />
      <Suspense fallback={<p className="text-muted-foreground">Searching…</p>}>
        <Results searchParams={searchParams} />
      </Suspense>
    </>
  );
}
