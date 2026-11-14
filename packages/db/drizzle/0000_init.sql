CREATE TABLE "areas" (
	"id" serial PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"position" smallint DEFAULT 0 NOT NULL,
	CONSTRAINT "areas_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "authors" (
	"id" serial PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	CONSTRAINT "authors_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "awards" (
	"id" serial PRIMARY KEY NOT NULL,
	"award" text NOT NULL,
	"category" text,
	"year" smallint NOT NULL,
	"result" text NOT NULL,
	"title" text NOT NULL,
	"publication" text,
	"author" text,
	"source_url" text,
	"piece_id" integer,
	"match_score" real
);
--> statement-breakpoint
CREATE TABLE "collection_items" (
	"collection_id" integer NOT NULL,
	"piece_id" integer NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "collection_items_collection_id_piece_id_pk" PRIMARY KEY("collection_id","piece_id")
);
--> statement-breakpoint
CREATE TABLE "collections" (
	"id" serial PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"position" smallint DEFAULT 0 NOT NULL,
	CONSTRAINT "collections_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "domains" (
	"domain" text PRIMARY KEY NOT NULL,
	"publication_id" integer,
	"status" text DEFAULT 'review' NOT NULL,
	"candidate_count" integer DEFAULT 0 NOT NULL,
	"sample_titles" text[] DEFAULT '{}'::text[] NOT NULL,
	"note" text
);
--> statement-breakpoint
CREATE TABLE "editorial_picks" (
	"id" serial PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"kind" text NOT NULL,
	"year" smallint,
	"raw_url" text NOT NULL,
	"canonical_url" text NOT NULL,
	"ref_url" text,
	"title" text,
	"piece_id" integer
);
--> statement-breakpoint
CREATE TABLE "mentions" (
	"id" serial PRIMARY KEY NOT NULL,
	"piece_id" integer NOT NULL,
	"source" text NOT NULL,
	"source_item_id" text NOT NULL,
	"person_hash" text NOT NULL,
	"ts" timestamp with time zone NOT NULL,
	"kind" text NOT NULL,
	"points" integer,
	"own_text_len" integer,
	"subreddit" text
);
--> statement-breakpoint
CREATE TABLE "piece_areas" (
	"piece_id" integer NOT NULL,
	"area_id" integer NOT NULL,
	"weight" real DEFAULT 1 NOT NULL,
	CONSTRAINT "piece_areas_piece_id_area_id_pk" PRIMARY KEY("piece_id","area_id")
);
--> statement-breakpoint
CREATE TABLE "piece_authors" (
	"piece_id" integer NOT NULL,
	"author_id" integer NOT NULL,
	"position" smallint DEFAULT 0 NOT NULL,
	CONSTRAINT "piece_authors_piece_id_author_id_pk" PRIMARY KEY("piece_id","author_id")
);
--> statement-breakpoint
CREATE TABLE "pieces" (
	"id" serial PRIMARY KEY NOT NULL,
	"slug" text,
	"canonical_url" text NOT NULL,
	"url" text NOT NULL,
	"domain" text NOT NULL,
	"publication_id" integer,
	"title" text,
	"source_title" text,
	"dek" text,
	"image_url" text,
	"byline" text,
	"publication_name" text,
	"published_at" date,
	"word_count" integer,
	"length_bucket" text,
	"lang" text,
	"section" text,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"tags_text" text,
	"paywall" text,
	"status" text DEFAULT 'candidate' NOT NULL,
	"exclude_reason" text,
	"http_status" smallint,
	"fetched_at" timestamp with time zone,
	"wayback_url" text,
	"alt_free_url" text,
	"lane" text,
	"gem" boolean DEFAULT false NOT NULL,
	"score" real DEFAULT 0 NOT NULL,
	"c" real DEFAULT 0 NOT NULL,
	"d" real DEFAULT 0 NOT NULL,
	"e" real DEFAULT 0 NOT NULL,
	"a" real DEFAULT 0 NOT NULL,
	"people" integer DEFAULT 0 NOT NULL,
	"months" integer DEFAULT 0 NOT NULL,
	"years" integer DEFAULT 0 NOT NULL,
	"span_months" integer DEFAULT 0 NOT NULL,
	"curators" integer DEFAULT 0 NOT NULL,
	"first_rec" timestamp with time zone,
	"last_rec" timestamp with time zone,
	"hn_max_points" integer DEFAULT 0 NOT NULL,
	"community_sources" text[] DEFAULT '{}'::text[] NOT NULL,
	"editorial_sources" text[] DEFAULT '{}'::text[] NOT NULL,
	"rank" integer,
	"search" "tsvector" GENERATED ALWAYS AS (setweight(to_tsvector('english', coalesce("pieces"."title", '')), 'A') || setweight(to_tsvector('english', coalesce("pieces"."byline", '') || ' ' || coalesce("pieces"."publication_name", '')), 'B') || setweight(to_tsvector('english', coalesce("pieces"."dek", '') || ' ' || coalesce("pieces"."tags_text", '')), 'C')) STORED,
	CONSTRAINT "pieces_slug_unique" UNIQUE("slug"),
	CONSTRAINT "pieces_canonical_url_unique" UNIQUE("canonical_url")
);
--> statement-breakpoint
CREATE TABLE "publications" (
	"id" serial PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"paywall" text DEFAULT 'free' NOT NULL,
	"kind" text DEFAULT 'publisher' NOT NULL,
	"homepage" text,
	CONSTRAINT "publications_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "related" (
	"piece_id" integer NOT NULL,
	"related_id" integer NOT NULL,
	"reason" text NOT NULL,
	"weight" real NOT NULL,
	CONSTRAINT "related_piece_id_related_id_reason_pk" PRIMARY KEY("piece_id","related_id","reason")
);
--> statement-breakpoint
ALTER TABLE "awards" ADD CONSTRAINT "awards_piece_id_pieces_id_fk" FOREIGN KEY ("piece_id") REFERENCES "public"."pieces"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_items" ADD CONSTRAINT "collection_items_collection_id_collections_id_fk" FOREIGN KEY ("collection_id") REFERENCES "public"."collections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_items" ADD CONSTRAINT "collection_items_piece_id_pieces_id_fk" FOREIGN KEY ("piece_id") REFERENCES "public"."pieces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "domains" ADD CONSTRAINT "domains_publication_id_publications_id_fk" FOREIGN KEY ("publication_id") REFERENCES "public"."publications"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "editorial_picks" ADD CONSTRAINT "editorial_picks_piece_id_pieces_id_fk" FOREIGN KEY ("piece_id") REFERENCES "public"."pieces"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mentions" ADD CONSTRAINT "mentions_piece_id_pieces_id_fk" FOREIGN KEY ("piece_id") REFERENCES "public"."pieces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "piece_areas" ADD CONSTRAINT "piece_areas_piece_id_pieces_id_fk" FOREIGN KEY ("piece_id") REFERENCES "public"."pieces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "piece_areas" ADD CONSTRAINT "piece_areas_area_id_areas_id_fk" FOREIGN KEY ("area_id") REFERENCES "public"."areas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "piece_authors" ADD CONSTRAINT "piece_authors_piece_id_pieces_id_fk" FOREIGN KEY ("piece_id") REFERENCES "public"."pieces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "piece_authors" ADD CONSTRAINT "piece_authors_author_id_authors_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."authors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pieces" ADD CONSTRAINT "pieces_publication_id_publications_id_fk" FOREIGN KEY ("publication_id") REFERENCES "public"."publications"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "related" ADD CONSTRAINT "related_piece_id_pieces_id_fk" FOREIGN KEY ("piece_id") REFERENCES "public"."pieces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "related" ADD CONSTRAINT "related_related_id_pieces_id_fk" FOREIGN KEY ("related_id") REFERENCES "public"."pieces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "awards_unique" ON "awards" USING btree ("award","category","year","title");--> statement-breakpoint
CREATE INDEX "awards_piece_idx" ON "awards" USING btree ("piece_id");--> statement-breakpoint
CREATE UNIQUE INDEX "editorial_unique" ON "editorial_picks" USING btree ("source","kind","canonical_url");--> statement-breakpoint
CREATE INDEX "editorial_canonical_idx" ON "editorial_picks" USING btree ("canonical_url");--> statement-breakpoint
CREATE UNIQUE INDEX "mentions_unique" ON "mentions" USING btree ("source","source_item_id","piece_id");--> statement-breakpoint
CREATE INDEX "mentions_piece_idx" ON "mentions" USING btree ("piece_id");--> statement-breakpoint
CREATE INDEX "mentions_person_idx" ON "mentions" USING btree ("person_hash");--> statement-breakpoint
CREATE INDEX "piece_areas_area_idx" ON "piece_areas" USING btree ("area_id");--> statement-breakpoint
CREATE INDEX "piece_authors_author_idx" ON "piece_authors" USING btree ("author_id");--> statement-breakpoint
CREATE INDEX "pieces_status_idx" ON "pieces" USING btree ("status");--> statement-breakpoint
CREATE INDEX "pieces_domain_idx" ON "pieces" USING btree ("domain");--> statement-breakpoint
CREATE INDEX "pieces_score_idx" ON "pieces" USING btree ("score");--> statement-breakpoint
CREATE INDEX "pieces_search_idx" ON "pieces" USING gin ("search");--> statement-breakpoint
CREATE INDEX "pieces_title_trgm_idx" ON "pieces" USING gin ("title" gin_trgm_ops);