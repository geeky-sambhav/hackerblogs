/** collections — rule-based reading lists. */
import { createNodeDb } from "@hackerreads/db/node";
import { log } from "../lib/log";
import { withClient } from "../lib/pgcopy";

type Def = { slug: string; title: string; description: string; sql: string; limit: number };

const INC = "status = 'included'";

const DEFS: Def[] = [
  {
    slug: "hacker-news-all-timers",
    title: "Hacker News all-timers",
    description: "The pieces Hacker News readers have recommended in the most different months.",
    sql: `SELECT id FROM pieces WHERE ${INC} AND 'hn' = ANY(community_sources) ORDER BY c DESC, score DESC, id`,
    limit: 60,
  },
  {
    slug: "most-durable",
    title: "Still recommended, years later",
    description: "Pieces people kept recommending across the most different years.",
    sql: `SELECT id FROM pieces WHERE ${INC} ORDER BY years DESC, span_months DESC, score DESC, id`,
    limit: 60,
  },
  {
    slug: "prize-winners",
    title: "Prize winners that readers love",
    description: "Pulitzer, National Magazine Award and Polk honorees that people also keep recommending.",
    sql: `SELECT id FROM pieces WHERE ${INC} AND a > 0 ORDER BY a DESC, score DESC, id`,
    limit: 60,
  },
  {
    slug: "longform-classics",
    title: "Longform classics",
    description: "Longform.org picks that readers went on to recommend for years.",
    sql: `SELECT id FROM pieces WHERE ${INC} AND 'longform' = ANY(editorial_sources) ORDER BY score DESC, id`,
    limit: 60,
  },
  {
    slug: "hidden-gems",
    title: "Hidden gems",
    description: "Loved in comment threads, never a front-page hit.",
    sql: `SELECT id FROM pieces WHERE ${INC} AND gem ORDER BY c DESC, score DESC, id`,
    limit: 60,
  },
  {
    slug: "independent-writers",
    title: "Independent writers",
    description: "Essays from personal sites and newsletters.",
    sql: `SELECT p.id FROM pieces p JOIN publications pub ON pub.id = p.publication_id WHERE p.${INC} AND pub.kind = 'independent' ORDER BY p.score DESC, p.id`,
    limit: 60,
  },
  {
    slug: "before-2000",
    title: "Before 2000",
    description: "Older classics people still pass around.",
    sql: `SELECT id FROM pieces WHERE ${INC} AND published_at < '2000-01-01' ORDER BY score DESC, id`,
    limit: 60,
  },
  {
    slug: "the-2000s",
    title: "The 2000s",
    description: "The best of 2000–2009.",
    sql: `SELECT id FROM pieces WHERE ${INC} AND published_at >= '2000-01-01' AND published_at < '2010-01-01' ORDER BY score DESC, id`,
    limit: 60,
  },
  {
    slug: "the-2010s",
    title: "The 2010s",
    description: "The best of 2010–2019.",
    sql: `SELECT id FROM pieces WHERE ${INC} AND published_at >= '2010-01-01' AND published_at < '2020-01-01' ORDER BY score DESC, id`,
    limit: 60,
  },
  {
    slug: "the-2020s",
    title: "The 2020s",
    description: "The best of 2020 so far.",
    sql: `SELECT id FROM pieces WHERE ${INC} AND published_at >= '2020-01-01' ORDER BY score DESC, id`,
    limit: 60,
  },
];

export async function run(): Promise<void> {
  const { pool } = createNodeDb({ max: 1 });
  try {
    await withClient(pool, async (client) => {
      await client.query("BEGIN");
      await client.query("DELETE FROM collection_items");
      await client.query("DELETE FROM collections");
      const areas = (await client.query<{ id: number; slug: string; name: string }>("SELECT id, slug, name FROM areas ORDER BY position")).rows;
      const defs: Def[] = [
        ...DEFS,
        ...areas.map((a) => ({
          slug: `start-here-${a.slug}`,
          title: `Start here: ${a.name}`,
          description: `The twelve most-recommended pieces in ${a.name}.`,
          sql: `SELECT p.id FROM pieces p JOIN piece_areas pa ON pa.piece_id = p.id WHERE p.${INC} AND pa.area_id = ${a.id} ORDER BY pa.weight DESC, p.score DESC, p.id`,
          limit: 12,
        })),
      ];
      const sizes: string[] = [];
      for (const [i, d] of defs.entries()) {
        const ids = (await client.query<{ id: number }>(`${d.sql} LIMIT ${d.limit}`)).rows.map((r) => r.id);
        if (ids.length < 3) continue;
        const ins = await client.query<{ id: number }>(
          "INSERT INTO collections (slug, title, description, position) VALUES ($1, $2, $3, $4) RETURNING id",
          [d.slug, d.title, d.description, i],
        );
        const cid = ins.rows[0]?.id;
        if (cid === undefined) continue;
        await client.query(
          "INSERT INTO collection_items (collection_id, piece_id, position) SELECT $1, x.id, x.ord FROM unnest($2::int[]) WITH ORDINALITY AS x(id, ord)",
          [cid, ids],
        );
        sizes.push(`${d.slug}=${ids.length}`);
      }
      await client.query("COMMIT");
      log(`collections: ${sizes.join(", ")}`);
    });
  } finally {
    await pool.end();
  }
}
