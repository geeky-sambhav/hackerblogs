/** taxonomy — assign 1–3 areas to every included piece (rules in config/taxonomy.yaml). */
import { createNodeDb } from "@hackerreads/db/node";
import { taxonomyConfig } from "../lib/config";
import { log } from "../lib/log";
import { copyInto, withClient } from "../lib/pgcopy";
import { assignAreas } from "../lib/taxonomy";

const MISC = { slug: "miscellany", name: "Miscellany", description: "Everything that refuses to fit in one box." };

export async function run(): Promise<void> {
  const areas = taxonomyConfig();
  const { pool } = createNodeDb({ max: 1 });
  try {
    await withClient(pool, async (client) => {
      await client.query("BEGIN");
      const all = [...areas.map((a) => ({ slug: a.slug, name: a.name, description: a.description })), MISC];
      for (const [i, a] of all.entries()) {
        await client.query(
          `INSERT INTO areas (slug, name, description, position) VALUES ($1, $2, $3, $4)
           ON CONFLICT (slug) DO UPDATE SET name = excluded.name, description = excluded.description, position = excluded.position`,
          [a.slug, a.name, a.description, i],
        );
      }
      await client.query("DELETE FROM areas WHERE NOT (slug = ANY($1))", [all.map((a) => a.slug)]);
      const areaIds = new Map(
        (await client.query<{ id: number; slug: string }>("SELECT id, slug FROM areas")).rows.map((r) => [r.slug, r.id]),
      );
      const pieces = (
        await client.query<{ id: number; url: string; title: string | null; dek: string | null; section: string | null; tags: string[]; pub_slug: string | null; curator_tags: string | null }>(`
          SELECT p.id, p.canonical_url AS url, p.title, p.dek, p.section, p.tags, pub.slug AS pub_slug,
                 (SELECT string_agg(tags, ',') FROM editorial_picks ep WHERE ep.piece_id = p.id AND tags IS NOT NULL) AS curator_tags
          FROM pieces p LEFT JOIN publications pub ON pub.id = p.publication_id
          WHERE p.status = 'included'`)
      ).rows;
      await client.query("DELETE FROM piece_areas");
      const links: [number, number, number][] = [];
      const tally = new Map<string, number>();
      for (const p of pieces) {
        const assigned = assignAreas(
          {
            url: p.url,
            title: p.title,
            dek: p.dek,
            section: p.section,
            tags: [...p.tags, ...(p.curator_tags ? p.curator_tags.split(",") : [])],
            publicationSlug: p.pub_slug,
          },
          areas,
        );
        for (const a of assigned) {
          const id = areaIds.get(a.slug);
          if (id === undefined) continue;
          links.push([p.id, id, a.weight]);
          tally.set(a.slug, (tally.get(a.slug) ?? 0) + 1);
        }
      }
      await copyInto(client, "piece_areas", ["piece_id", "area_id", "weight"], links);
      await client.query("COMMIT");
      log(`areas: ${[...tally].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join(", ")}`);
    });
  } finally {
    await pool.end();
  }
}
