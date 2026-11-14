import type { DuckDBConnection } from "@duckdb/node-api";

/** Local staging tables (DuckDB, .data/raw.duckdb). */
export async function ensureStaging(c: DuckDBConnection): Promise<void> {
  await c.run(`
    CREATE TABLE IF NOT EXISTS mentions_raw (
      source VARCHAR NOT NULL,       -- hn | reddit | lobsters | metafilter
      item_id VARCHAR NOT NULL,      -- id of the story/comment/post on that platform
      person VARCHAR NOT NULL,       -- platform username (never leaves this machine)
      ts TIMESTAMPTZ NOT NULL,
      kind VARCHAR NOT NULL,         -- story | comment | post
      points INTEGER,
      own_text_len INTEGER,
      subreddit VARCHAR,
      url_raw VARCHAR NOT NULL,
      title VARCHAR
    );
    CREATE TABLE IF NOT EXISTS editorial_raw (
      source VARCHAR NOT NULL,       -- longform | longreads | kottke | mr | browser | ald
      kind VARCHAR NOT NULL,         -- pick | best_of
      year INTEGER,
      url_raw VARCHAR NOT NULL,
      ref_url VARCHAR,
      title VARCHAR
    );
    ALTER TABLE editorial_raw ADD COLUMN IF NOT EXISTS tags VARCHAR;         -- comma-separated labels
    ALTER TABLE editorial_raw ADD COLUMN IF NOT EXISTS author VARCHAR;
    ALTER TABLE editorial_raw ADD COLUMN IF NOT EXISTS publication VARCHAR;
    CREATE TABLE IF NOT EXISTS url_map (
      url_raw VARCHAR PRIMARY KEY,
      canonical_url VARCHAR          -- NULL when the raw URL is not usable
    );
  `);
}
