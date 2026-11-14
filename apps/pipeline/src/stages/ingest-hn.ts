/**
 * ingest:hn — extract every story URL and every link inside a comment from the
 * local copy of the open-index/hacker-news Parquet files (.data/hn).
 */
import { existsSync } from "node:fs";
import { duck, lit, rows } from "../lib/duck";
import { log } from "../lib/log";
import { HN_DIR } from "../lib/paths";
import { ensureStaging } from "../lib/staging";

export async function run(): Promise<void> {
  if (!existsSync(HN_DIR)) throw new Error(`No HN data in ${HN_DIR}. Run .data/download-hn.sh first.`);
  const glob = lit(`${HN_DIR}/*/*.parquet`);
  const c = await duck();
  await ensureStaging(c);
  await c.run("DELETE FROM mentions_raw WHERE source = 'hn'");

  log("HN stories…");
  await c.run(`
    INSERT INTO mentions_raw
    SELECT 'hn', id::VARCHAR, "by", time, 'story', score, NULL, NULL, url, title
    FROM read_parquet(${glob})
    WHERE type = 1
      AND url IS NOT NULL AND url <> ''
      AND coalesce(dead, 0) = 0 AND coalesce(deleted, 0) = 0
      AND "by" IS NOT NULL AND "by" <> ''
  `);

  log("HN comments with links…");
  await c.run(`
    INSERT INTO mentions_raw
    WITH c AS (
      SELECT id, "by" AS person, time AS ts, text
      FROM read_parquet(${glob})
      WHERE type = 2
        AND coalesce(dead, 0) = 0 AND coalesce(deleted, 0) = 0
        AND "by" IS NOT NULL AND "by" <> ''
        AND text LIKE '%href=%'
    ),
    l AS (
      SELECT
        id, person, ts,
        unnest(regexp_extract_all(text, 'href="([^"]+)"', 1)) AS url_raw,
        length(trim(regexp_replace(
          regexp_replace(
            regexp_replace(
              regexp_replace(text, '<a\\s[^>]*>.*?</a>', ' ', 'g'),
            '<[^>]+>', ' ', 'g'),
          '&[#a-zA-Z0-9]+;', ' ', 'g'),
        '\\s+', ' ', 'g'))) AS own_len
      FROM c
    )
    SELECT DISTINCT 'hn', id::VARCHAR, person, ts, 'comment', NULL::INTEGER, own_len::INTEGER, NULL, url_raw, NULL
    FROM l
    WHERE url_raw LIKE 'http%'
  `);

  const [stats] = await rows<{ kind: string; n: bigint }>(
    c,
    "SELECT string_agg(kind || '=' || n::VARCHAR, ', ') AS kind, 0 AS n FROM (SELECT kind, count(*) n FROM mentions_raw WHERE source='hn' GROUP BY kind)",
  );
  log(`HN mentions: ${stats?.kind ?? "none"}`);
}
