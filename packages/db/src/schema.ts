import { sql, type SQL } from "drizzle-orm";
import {
  boolean,
  customType,
  date,
  index,
  integer,
  pgTable,
  primaryKey,
  real,
  serial,
  smallint,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

const tsvector = customType<{ data: string }>({
  dataType() {
    return "tsvector";
  },
});

export const publications = pgTable("publications", {
  id: serial("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  /** free | metered | paywalled */
  paywall: text("paywall").notNull().default("free"),
  /** publisher | independent */
  kind: text("kind").notNull().default("publisher"),
  homepage: text("homepage"),
});

export const domains = pgTable("domains", {
  /** Site key: canonical host, or host/first-segment for multi-tenant hosts. */
  domain: text("domain").primaryKey(),
  publicationId: integer("publication_id").references(() => publications.id),
  /** include | exclude | review */
  status: text("status").notNull().default("review"),
  candidateCount: integer("candidate_count").notNull().default(0),
  sampleTitles: text("sample_titles").array().notNull().default(sql`'{}'::text[]`),
  note: text("note"),
});

export const pieces = pgTable(
  "pieces",
  {
    id: serial("id").primaryKey(),
    slug: text("slug").unique(),
    canonicalUrl: text("canonical_url").notNull().unique(),
    /** Earlier canonical URLs of this piece (redirected or merged variants). */
    aliasUrls: text("alias_urls").array().notNull().default(sql`'{}'::text[]`),
    /** URL to link to (final URL after redirects). */
    url: text("url").notNull(),
    domain: text("domain").notNull(),
    publicationId: integer("publication_id").references(() => publications.id),
    title: text("title"),
    /** Title seen on HN/Reddit etc., used before metadata is fetched. */
    sourceTitle: text("source_title"),
    dek: text("dek"),
    imageUrl: text("image_url"),
    byline: text("byline"),
    publicationName: text("publication_name"),
    publishedAt: date("published_at"),
    wordCount: integer("word_count"),
    /** short | medium | long */
    lengthBucket: text("length_bucket"),
    lang: text("lang"),
    /** Page declares itself an article (og:type article or schema.org Article JSON-LD). */
    isArticle: boolean("is_article"),
    section: text("section"),
    tags: text("tags").array().notNull().default(sql`'{}'::text[]`),
    tagsText: text("tags_text"),
    paywall: text("paywall"),
    /** candidate | fetched | included | excluded */
    status: text("status").notNull().default("candidate"),
    excludeReason: text("exclude_reason"),
    /** HTTP status of the article fetch; 0 = unreachable, -1 = robots.txt disallows us, -2 = redirected to the front page. */
    httpStatus: smallint("http_status"),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }),
    waybackUrl: text("wayback_url"),
    /** Set by fetch:meta when the Wayback Machine is needed: 'dead' (link + metadata) or 'meta' (metadata only). fetch:archive clears it. */
    archiveNeed: text("archive_need"),
    altFreeUrl: text("alt_free_url"),
    /** classic | rising */
    lane: text("lane"),
    gem: boolean("gem").notNull().default(false),
    score: real("score").notNull().default(0),
    c: real("c").notNull().default(0),
    d: real("d").notNull().default(0),
    e: real("e").notNull().default(0),
    a: real("a").notNull().default(0),
    people: integer("people").notNull().default(0),
    months: integer("months").notNull().default(0),
    years: integer("years").notNull().default(0),
    spanMonths: integer("span_months").notNull().default(0),
    curators: integer("curators").notNull().default(0),
    firstRec: timestamp("first_rec", { withTimezone: true }),
    lastRec: timestamp("last_rec", { withTimezone: true }),
    hnMaxPoints: integer("hn_max_points").notNull().default(0),
    /** Years with a qualifying recommendation (for the date-stamp strip). */
    recYears: smallint("rec_years").array().notNull().default(sql`'{}'::smallint[]`),
    communitySources: text("community_sources").array().notNull().default(sql`'{}'::text[]`),
    editorialSources: text("editorial_sources").array().notNull().default(sql`'{}'::text[]`),
    rank: integer("rank"),
    search: tsvector("search").generatedAlwaysAs(
      (): SQL =>
        sql`setweight(to_tsvector('english', coalesce(${pieces.title}, '')), 'A') || setweight(to_tsvector('english', coalesce(${pieces.byline}, '') || ' ' || coalesce(${pieces.publicationName}, '')), 'B') || setweight(to_tsvector('english', coalesce(${pieces.dek}, '') || ' ' || coalesce(${pieces.tagsText}, '')), 'C')`,
    ),
  },
  (t) => [
    index("pieces_status_idx").on(t.status),
    index("pieces_domain_idx").on(t.domain),
    index("pieces_score_idx").on(t.score),
    index("pieces_search_idx").using("gin", t.search),
    index("pieces_title_trgm_idx").using("gin", sql`${t.title} gin_trgm_ops`),
  ],
);

export const authors = pgTable("authors", {
  id: serial("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
});

export const pieceAuthors = pgTable(
  "piece_authors",
  {
    pieceId: integer("piece_id")
      .notNull()
      .references(() => pieces.id, { onDelete: "cascade" }),
    authorId: integer("author_id")
      .notNull()
      .references(() => authors.id, { onDelete: "cascade" }),
    position: smallint("position").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.pieceId, t.authorId] }), index("piece_authors_author_idx").on(t.authorId)],
);

export const mentions = pgTable(
  "mentions",
  {
    id: serial("id").primaryKey(),
    pieceId: integer("piece_id")
      .notNull()
      .references(() => pieces.id, { onDelete: "cascade" }),
    /** hn | reddit | lobsters | metafilter */
    source: text("source").notNull(),
    sourceItemId: text("source_item_id").notNull(),
    /** Short hash of (platform, user). Usernames are never stored. */
    personHash: text("person_hash").notNull(),
    ts: timestamp("ts", { withTimezone: true }).notNull(),
    /** story | comment | post */
    kind: text("kind").notNull(),
    points: integer("points"),
    ownTextLen: integer("own_text_len"),
    subreddit: text("subreddit"),
  },
  (t) => [
    uniqueIndex("mentions_unique").on(t.source, t.sourceItemId, t.pieceId),
    index("mentions_piece_idx").on(t.pieceId),
    index("mentions_person_idx").on(t.personHash),
  ],
);

export const editorialPicks = pgTable(
  "editorial_picks",
  {
    id: serial("id").primaryKey(),
    /** longform | longreads | kottke | mr | browser | ald */
    source: text("source").notNull(),
    /** pick | best_of */
    kind: text("kind").notNull(),
    year: smallint("year"),
    rawUrl: text("raw_url").notNull(),
    canonicalUrl: text("canonical_url").notNull(),
    refUrl: text("ref_url"),
    title: text("title"),
    /** Curator labels (Longform sections, Kottke tags), comma-separated. */
    tags: text("tags"),
    pieceId: integer("piece_id").references(() => pieces.id, { onDelete: "set null" }),
  },
  (t) => [
    uniqueIndex("editorial_unique").on(t.source, t.kind, t.canonicalUrl),
    index("editorial_canonical_idx").on(t.canonicalUrl),
    index("editorial_piece_idx").on(t.pieceId),
  ],
);

export const awards = pgTable(
  "awards",
  {
    id: serial("id").primaryKey(),
    award: text("award").notNull(),
    category: text("category"),
    year: smallint("year").notNull(),
    /** winner | finalist | anthologized */
    result: text("result").notNull(),
    title: text("title").notNull(),
    publication: text("publication"),
    author: text("author"),
    sourceUrl: text("source_url"),
    pieceId: integer("piece_id").references(() => pieces.id, { onDelete: "set null" }),
    matchScore: real("match_score"),
  },
  (t) => [
    uniqueIndex("awards_unique").on(t.award, t.category, t.year, t.title),
    index("awards_piece_idx").on(t.pieceId),
  ],
);

/** Pieces credited with an award (a Pulitzer for a series can credit several). */
export const awardMatches = pgTable(
  "award_matches",
  {
    awardId: integer("award_id")
      .notNull()
      .references(() => awards.id, { onDelete: "cascade" }),
    pieceId: integer("piece_id")
      .notNull()
      .references(() => pieces.id, { onDelete: "cascade" }),
    matchScore: real("match_score").notNull(),
  },
  (t) => [primaryKey({ columns: [t.awardId, t.pieceId] }), index("award_matches_piece_idx").on(t.pieceId)],
);

export const areas = pgTable("areas", {
  id: serial("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  position: smallint("position").notNull().default(0),
});

export const pieceAreas = pgTable(
  "piece_areas",
  {
    pieceId: integer("piece_id")
      .notNull()
      .references(() => pieces.id, { onDelete: "cascade" }),
    areaId: integer("area_id")
      .notNull()
      .references(() => areas.id, { onDelete: "cascade" }),
    weight: real("weight").notNull().default(1),
  },
  (t) => [primaryKey({ columns: [t.pieceId, t.areaId] }), index("piece_areas_area_idx").on(t.areaId)],
);

export const related = pgTable(
  "related",
  {
    pieceId: integer("piece_id")
      .notNull()
      .references(() => pieces.id, { onDelete: "cascade" }),
    relatedId: integer("related_id")
      .notNull()
      .references(() => pieces.id, { onDelete: "cascade" }),
    /** corec | author | topic */
    reason: text("reason").notNull(),
    weight: real("weight").notNull(),
  },
  (t) => [primaryKey({ columns: [t.pieceId, t.relatedId, t.reason] })],
);

export const collections = pgTable("collections", {
  id: serial("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  position: smallint("position").notNull().default(0),
});

export const collectionItems = pgTable(
  "collection_items",
  {
    collectionId: integer("collection_id")
      .notNull()
      .references(() => collections.id, { onDelete: "cascade" }),
    pieceId: integer("piece_id")
      .notNull()
      .references(() => pieces.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
  },
  (t) => [primaryKey({ columns: [t.collectionId, t.pieceId] })],
);
