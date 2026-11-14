/**
 * related — "more like this" without ML:
 *   corec   readers who recommended both pieces (Jaccard over hashed people)
 *   author  same author
 *   topic   shared areas and tags
 */
import { createNodeDb } from "@hackerreads/db/node";
import { log } from "../lib/log";
import { copyInto, withClient } from "../lib/pgcopy";

const PER_PIECE = 10;

export async function run(): Promise<void> {
  const { pool } = createNodeDb({ max: 1 });
  try {
    await withClient(pool, async (client) => {
      await client.query("BEGIN");
      await client.query("DELETE FROM related");

      // co-recommendation: people who recommended both (prolific accounts capped to avoid noise)
      const corec = await client.query(`
        INSERT INTO related (piece_id, related_id, reason, weight)
        WITH inc AS (SELECT id FROM pieces WHERE status = 'included'),
        pm AS (
          SELECT DISTINCT m.piece_id, m.person_hash FROM mentions m JOIN inc ON inc.id = m.piece_id
        ),
        people AS (SELECT person_hash FROM pm GROUP BY 1 HAVING count(*) BETWEEN 2 AND 300),
        sizes AS (SELECT piece_id, count(*) n FROM pm GROUP BY 1),
        pairs AS (
          SELECT a.piece_id p, b.piece_id q, count(*) shared
          FROM pm a JOIN pm b ON a.person_hash = b.person_hash AND a.piece_id <> b.piece_id
          JOIN people pe ON pe.person_hash = a.person_hash
          GROUP BY 1, 2 HAVING count(*) >= 2
        ),
        ranked AS (
          SELECT p, q, shared::real / (sa.n + sb.n - shared) AS j,
                 row_number() OVER (PARTITION BY p ORDER BY shared::real / (sa.n + sb.n - shared) DESC, shared DESC, q) rn
          FROM pairs JOIN sizes sa ON sa.piece_id = p JOIN sizes sb ON sb.piece_id = q
        )
        SELECT p, q, 'corec', j FROM ranked WHERE rn <= ${PER_PIECE}`);

      // same author
      const author = await client.query(`
        INSERT INTO related (piece_id, related_id, reason, weight)
        SELECT p, q, 'author', 1 FROM (
          SELECT a.piece_id p, b.piece_id q,
                 row_number() OVER (PARTITION BY a.piece_id ORDER BY pq.score DESC, b.piece_id) rn
          FROM piece_authors a JOIN piece_authors b ON a.author_id = b.author_id AND a.piece_id <> b.piece_id
          JOIN pieces pq ON pq.id = b.piece_id
          GROUP BY a.piece_id, b.piece_id, pq.score
        ) x WHERE rn <= ${PER_PIECE}
        ON CONFLICT DO NOTHING`);

      // topic: shared areas + tag overlap, computed here
      const rows = (
        await client.query<{ id: number; score: number; areas: number[]; tags: string[] }>(`
          SELECT p.id, p.score, coalesce(array_agg(pa.area_id) FILTER (WHERE pa.area_id IS NOT NULL), '{}') AS areas, p.tags
          FROM pieces p LEFT JOIN piece_areas pa ON pa.piece_id = p.id
          WHERE p.status = 'included' GROUP BY p.id`)
      ).rows.map((r) => ({ ...r, areaSet: new Set(r.areas), tagSet: new Set(r.tags.slice(0, 20)) }));
      const links: [number, number, string, number][] = [];
      for (const a of rows) {
        const best: { id: number; w: number }[] = [];
        for (const b of rows) {
          if (a.id === b.id) continue;
          let shared = 0;
          for (const x of a.areaSet) if (b.areaSet.has(x)) shared++;
          if (shared === 0) continue;
          let tagShared = 0;
          for (const x of a.tagSet) if (b.tagSet.has(x)) tagShared++;
          const tagUnion = a.tagSet.size + b.tagSet.size - tagShared;
          const w = shared / Math.max(a.areaSet.size, b.areaSet.size) + (tagUnion ? (2 * tagShared) / tagUnion : 0) + b.score / 1000;
          best.push({ id: b.id, w });
        }
        best.sort((x, y) => y.w - x.w || x.id - y.id);
        for (const b of best.slice(0, PER_PIECE)) links.push([a.id, b.id, "topic", Math.round(b.w * 1000) / 1000]);
      }
      await copyInto(client, "related", ["piece_id", "related_id", "reason", "weight"], links);
      await client.query("COMMIT");
      log(`related: corec=${corec.rowCount}, author=${author.rowCount}, topic=${links.length}`);
    });
  } finally {
    await pool.end();
  }
}
