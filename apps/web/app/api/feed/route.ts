import { buildFeed, type FeedItem, type FeedPick } from "@hackerreads/shared";
import { getCatalog, getRelatedIndex } from "@/lib/catalog";
import type { FeedCard, Piece } from "@/lib/types";

const MAX_IDS = 5000;

function ids(v: unknown): number[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is number => Number.isSafeInteger(x) && x > 0).slice(0, MAX_IDS);
}

function reasonText(pick: FeedPick, byId: Map<number, Piece>, areaNames: Map<string, string>): string {
  const ref = pick.reason.ref;
  const refTitle = typeof ref === "number" ? byId.get(ref)?.title : undefined;
  const areaName = typeof ref === "string" ? areaNames.get(ref) : undefined;
  switch (pick.reason.kind) {
    case "classic":
      return "One of the most-recommended pieces";
    case "gem":
      return "Hidden gem: loved in comment threads, never a front-page hit";
    case "deep":
      return "Deep cut";
    case "rising":
      return "Rising: published recently and already recommended";
    case "explore":
      return areaName ? `Something different: ${areaName}` : "Something different";
    case "taste":
      return areaName ? `More ${areaName}, which you like` : "Close to what you like";
    case "similar":
      return refTitle ? `Because you liked “${refTitle}”` : "Similar to something you liked";
    case "corec":
      return refTitle ? `Readers who recommended “${refTitle}” also recommended this` : "Recommended by the same readers";
    case "wildcard":
      return "Random pick";
  }
}

export async function POST(request: Request): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Send a JSON body." }, { status: 400 });
  }
  const seed = Number.isSafeInteger(body.seed) ? (body.seed as number) : 1;
  const size = Math.min(60, Math.max(1, Number.isSafeInteger(body.size) ? (body.size as number) : 30));

  const [catalog, related] = await Promise.all([getCatalog(), getRelatedIndex()]);
  const byId = new Map(catalog.pieces.map((p) => [p.id, p]));
  const items: FeedItem[] = catalog.pieces.map((p) => ({
    id: p.id,
    title: p.title,
    publicationSlug: p.publication?.slug ?? `site:${p.id}`,
    // the catch-all area says nothing about taste
    areas: p.areas.filter((a) => a !== "miscellany"),
    score: p.score,
    lane: p.lane,
    gem: p.gem,
    corec: related[p.id]?.corec ?? [],
    similar: [...(related[p.id]?.author ?? []), ...(related[p.id]?.topic ?? [])],
  }));
  const picks = buildFeed(
    items,
    { liked: ids(body.liked), disliked: ids(body.disliked), seen: [...ids(body.seen), ...ids(body.exclude)] },
    seed,
    size,
  );
  const areaNames = new Map(catalog.areas.map((a) => [a.slug, a.name]));
  const cards: FeedCard[] = picks.flatMap((pick) => {
    const p = byId.get(pick.id);
    if (!p) return [];
    return [
      {
        id: p.id,
        slug: p.slug,
        title: p.title,
        authors: p.authors.map((a) => a.name),
        publication: p.publication?.name ?? null,
        year: p.publishedYear,
        image: p.image,
        recYears: p.recYears,
        people: p.people,
        reason: reasonText(pick, byId, areaNames),
      },
    ];
  });
  return Response.json({ cards }, { headers: { "cache-control": "no-store" } });
}
