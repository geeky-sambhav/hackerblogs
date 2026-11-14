import "server-only";
import { sql } from "drizzle-orm";
import { cacheLife, cacheTag } from "next/cache";
import { getWebDb } from "@hackerreads/db/web";
import type { Area, AwardRef, Catalog, Collection, Paywall, Piece } from "./types";

type Row = Record<string, unknown>;

async function query<T extends Row>(q: ReturnType<typeof sql>): Promise<T[]> {
  const res = await getWebDb().execute(q);
  return res.rows as T[];
}

/** Everything the site renders, loaded once per cache lifetime. */
export async function getCatalog(): Promise<Catalog> {
  "use cache";
  cacheLife("max");
  cacheTag("catalog");

  const [pieceRows, authorRows, areaLinks, areaRows, awardRows, collectionRows] = await Promise.all([
    query<{
      id: number;
      slug: string;
      title: string;
      url: string;
      wayback_url: string | null;
      dek: string | null;
      image_url: string | null;
      pub_slug: string | null;
      pub_name: string | null;
      pub_paywall: string | null;
      pub_kind: string | null;
      published_at: string | null;
      length_bucket: Piece["lengthBucket"];
      lane: Piece["lane"];
      gem: boolean;
      score: number;
      rank: number;
      people: number;
      years: number;
      rec_years: number[];
      first_rec_year: number | null;
      last_rec_year: number | null;
      community_sources: string[];
      editorial_sources: string[];
    }>(sql`
      SELECT p.id, p.slug, p.title, p.url, p.wayback_url, p.dek, p.image_url,
             pub.slug AS pub_slug, pub.name AS pub_name, pub.paywall AS pub_paywall, pub.kind AS pub_kind,
             p.published_at::text AS published_at, p.length_bucket, p.lane, p.gem, p.score, p.rank,
             p.people, p.years, p.rec_years,
             extract(year FROM p.first_rec)::int AS first_rec_year, extract(year FROM p.last_rec)::int AS last_rec_year,
             p.community_sources, p.editorial_sources
      FROM pieces p LEFT JOIN publications pub ON pub.id = p.publication_id
      WHERE p.status = 'included' AND p.slug IS NOT NULL
      ORDER BY p.rank`),
    query<{ piece_id: number; slug: string; name: string }>(sql`
      SELECT pa.piece_id, a.slug, a.name FROM piece_authors pa JOIN authors a ON a.id = pa.author_id
      ORDER BY pa.piece_id, pa.position`),
    query<{ piece_id: number; slug: string }>(sql`
      SELECT pa.piece_id, a.slug FROM piece_areas pa JOIN areas a ON a.id = pa.area_id
      ORDER BY pa.piece_id, pa.weight DESC, a.position`),
    query<{ slug: string; name: string; description: string }>(sql`SELECT slug, name, description FROM areas ORDER BY position`),
    query<{ piece_id: number; award: string; category: string | null; year: number; result: string }>(sql`
      SELECT m.piece_id, a.award, a.category, a.year, a.result
      FROM award_matches m JOIN awards a ON a.id = m.award_id ORDER BY a.year`),
    query<{ slug: string; title: string; description: string; piece_ids: number[] }>(sql`
      SELECT c.slug, c.title, c.description, array_agg(ci.piece_id ORDER BY ci.position) AS piece_ids
      FROM collections c JOIN collection_items ci ON ci.collection_id = c.id
      GROUP BY c.id ORDER BY c.position`),
  ]);

  const group = <T extends { piece_id: number }>(rows: T[]) => {
    const m = new Map<number, T[]>();
    for (const r of rows) {
      const list = m.get(r.piece_id);
      if (list) list.push(r);
      else m.set(r.piece_id, [r]);
    }
    return m;
  };
  const authorsBy = group(authorRows);
  const areasBy = group(areaLinks);
  const awardsBy = group(awardRows);

  const pieces: Piece[] = pieceRows.map((r) => ({
    id: r.id,
    slug: r.slug,
    title: r.title,
    url: r.url,
    waybackUrl: r.wayback_url,
    dek: r.dek,
    image: r.image_url,
    authors: (authorsBy.get(r.id) ?? []).map((a) => ({ slug: a.slug, name: a.name })),
    publication:
      r.pub_slug && r.pub_name
        ? {
            slug: r.pub_slug,
            name: r.pub_name,
            paywall: (r.pub_paywall ?? "unknown") as Paywall,
            kind: r.pub_kind === "independent" ? "independent" : "publisher",
          }
        : null,
    publishedAt: r.published_at,
    publishedYear: r.published_at ? Number(r.published_at.slice(0, 4)) : null,
    lengthBucket: r.length_bucket,
    areas: (areasBy.get(r.id) ?? []).map((a) => a.slug),
    lane: r.lane,
    gem: r.gem,
    score: Number(r.score),
    rank: r.rank,
    people: r.people,
    years: r.years,
    recYears: (r.rec_years ?? []).map(Number),
    firstRecYear: r.first_rec_year,
    lastRecYear: r.last_rec_year,
    communitySources: r.community_sources ?? [],
    editorial: r.editorial_sources ?? [],
    awards: (awardsBy.get(r.id) ?? []).map((a): AwardRef => ({ award: a.award, category: a.category, year: a.year, result: a.result })),
  }));

  const areaCounts = new Map<string, number>();
  const pubCounts = new Map<string, { ref: NonNullable<Piece["publication"]>; count: number }>();
  const authorCounts = new Map<string, { slug: string; name: string; count: number }>();
  for (const p of pieces) {
    for (const a of p.areas) areaCounts.set(a, (areaCounts.get(a) ?? 0) + 1);
    if (p.publication) {
      const e = pubCounts.get(p.publication.slug) ?? { ref: p.publication, count: 0 };
      e.count++;
      pubCounts.set(p.publication.slug, e);
    }
    for (const a of p.authors) {
      const e = authorCounts.get(a.slug) ?? { ...a, count: 0 };
      e.count++;
      authorCounts.set(a.slug, e);
    }
  }
  const areas: Area[] = areaRows
    .map((a) => ({ ...a, count: areaCounts.get(a.slug) ?? 0 }))
    .filter((a) => a.count > 0);
  const collections: Collection[] = collectionRows.map((c) => ({
    slug: c.slug,
    title: c.title,
    description: c.description,
    pieceIds: c.piece_ids.map(Number),
  }));

  return {
    pieces,
    areas,
    publications: [...pubCounts.values()].map((e) => ({ ...e.ref, count: e.count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
    authors: [...authorCounts.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
    collections,
  };
}

/*
 * Per-page loaders for list pages. A list page reads searchParams, so it is prerendered as a
 * shell plus resume data, and the resume data holds every cache entry the page read directly.
 * Reading getCatalog() there stored the whole catalog (1.7 MB) with each of ~2,000 author and
 * publication pages and broke the build. Each loader below is its own small cache entry;
 * getCatalog() inside it is not stored again (nested cache reads are not saved for resume).
 */
type ListData<T> = { entity: T; pieces: Piece[]; areas: Area[] };

export async function getAuthorList(slug: string): Promise<ListData<Catalog["authors"][number]> | null> {
  "use cache";
  cacheLife("max");
  cacheTag("catalog");
  const { authors, pieces, areas } = await getCatalog();
  const entity = authors.find((a) => a.slug === slug);
  return entity ? { entity, pieces: pieces.filter((p) => p.authors.some((a) => a.slug === slug)), areas } : null;
}

export async function getPublicationList(slug: string): Promise<ListData<Catalog["publications"][number]> | null> {
  "use cache";
  cacheLife("max");
  cacheTag("catalog");
  const { publications, pieces, areas } = await getCatalog();
  const entity = publications.find((p) => p.slug === slug);
  return entity ? { entity, pieces: pieces.filter((p) => p.publication?.slug === slug), areas } : null;
}

export async function getAreaList(slug: string): Promise<(ListData<Area> & { startHere: string | null }) | null> {
  "use cache";
  cacheLife("max");
  cacheTag("catalog");
  const { areas, pieces, collections } = await getCatalog();
  const entity = areas.find((a) => a.slug === slug);
  if (!entity) return null;
  const startHere = collections.find((c) => c.slug === `start-here-${slug}`)?.slug ?? null;
  return { entity, pieces: pieces.filter((p) => p.areas.includes(slug)), areas, startHere };
}

export async function getDecadeList(decade: number): Promise<ListData<number> | null> {
  "use cache";
  cacheLife("max");
  cacheTag("catalog");
  const { pieces, areas } = await getCatalog();
  const inDecade = pieces.filter((p) => decadeOf(p.publishedYear) === decade);
  return inDecade.length ? { entity: decade, pieces: inDecade, areas } : null;
}

export async function getShelfList(shelf: "gems" | "rising"): Promise<ListData<string>> {
  "use cache";
  cacheLife("max");
  cacheTag("catalog");
  const { pieces, areas } = await getCatalog();
  return { entity: shelf, pieces: pieces.filter((p) => (shelf === "gems" ? p.gem : p.lane === "rising")), areas };
}

export async function getCollection(slug: string): Promise<Collection | null> {
  "use cache";
  cacheLife("max");
  cacheTag("catalog");
  return (await getCatalog()).collections.find((c) => c.slug === slug) ?? null;
}

/** Areas only (small), for pages that need the area names but no pieces. */
export async function getAreas(): Promise<Area[]> {
  "use cache";
  cacheLife("max");
  cacheTag("catalog");
  return (await getCatalog()).areas;
}

// Cached on their own for the same reason as the list loaders: a page that read getCatalog()
// directly would carry the whole catalog in its build result (see getAuthorList).
export async function getPieceBySlug(slug: string): Promise<Piece | null> {
  "use cache";
  cacheLife("max");
  cacheTag("catalog");
  const { pieces } = await getCatalog();
  return pieces.find((p) => p.slug === slug) ?? null;
}

export async function piecesByIds(ids: number[]): Promise<Piece[]> {
  "use cache";
  cacheLife("max");
  cacheTag("catalog");
  const { pieces } = await getCatalog();
  const byId = new Map(pieces.map((p) => [p.id, p]));
  return ids.map((id) => byId.get(id)).filter((p): p is Piece => !!p);
}

export type RelatedSets = { corec: number[]; author: number[]; topic: number[] };

/** "More like this" for one piece. */
export async function getRelated(id: number): Promise<RelatedSets> {
  "use cache";
  cacheLife("max");
  cacheTag("catalog");
  const rows = await query<{ related_id: number; reason: string }>(sql`
    SELECT related_id, reason FROM related WHERE piece_id = ${id} ORDER BY reason, weight DESC, related_id`);
  const out: RelatedSets = { corec: [], author: [], topic: [] };
  for (const r of rows) {
    if (r.reason === "corec" || r.reason === "author" || r.reason === "topic") out[r.reason].push(r.related_id);
  }
  return out;
}

/** Related ids for every piece (for the feed). */
export async function getRelatedIndex(): Promise<Record<number, RelatedSets>> {
  "use cache";
  cacheLife("max");
  cacheTag("catalog");
  const rows = await query<{ piece_id: number; related_id: number; reason: string }>(sql`
    SELECT piece_id, related_id, reason FROM related ORDER BY piece_id, reason, weight DESC, related_id`);
  const out: Record<number, RelatedSets> = {};
  for (const r of rows) {
    const e = (out[r.piece_id] ??= { corec: [], author: [], topic: [] });
    if (r.reason === "corec" || r.reason === "author" || r.reason === "topic") e[r.reason].push(r.related_id);
  }
  return out;
}

export type SearchFilters = { q: string; area?: string; decade?: number; length?: string; paywall?: string };

/** Full-text search (Postgres websearch syntax), trigram fallback for typos. Returns ids by relevance. */
export async function searchPieceIds(q: string): Promise<number[]> {
  "use cache";
  cacheLife("hours");
  cacheTag("catalog");
  const term = q.trim().slice(0, 200);
  if (!term) return [];
  const fts = await query<{ id: number }>(sql`
    SELECT id FROM pieces
    WHERE status = 'included' AND search @@ websearch_to_tsquery('english', ${term})
    ORDER BY ts_rank(search, websearch_to_tsquery('english', ${term})) DESC, score DESC
    LIMIT 200`);
  if (fts.length > 0) return fts.map((r) => r.id);
  const fuzzy = await query<{ id: number }>(sql`
    SELECT id FROM pieces
    WHERE status = 'included' AND (title % ${term} OR byline ILIKE ${`%${term}%`})
    ORDER BY similarity(title, ${term}) DESC, score DESC
    LIMIT 100`);
  return fuzzy.map((r) => r.id);
}

export function decadeOf(year: number | null): number | null {
  return year === null ? null : Math.floor(year / 10) * 10;
}

export function applyFilters(pieces: Piece[], f: Omit<SearchFilters, "q">): Piece[] {
  return pieces.filter(
    (p) =>
      (!f.area || p.areas.includes(f.area)) &&
      (f.decade === undefined || decadeOf(p.publishedYear) === f.decade) &&
      (!f.length || p.lengthBucket === f.length) &&
      (!f.paywall || (f.paywall === "free" ? p.publication?.paywall === "free" : p.publication?.paywall !== "free")),
  );
}
