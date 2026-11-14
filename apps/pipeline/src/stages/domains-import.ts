/**
 * domains:import — apply the reviewed config/domains_review.csv.
 * Edit the `status` column: include | exclude | auto (checked automatically
 * at fetch time) | review (leave undecided; not fetched).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createNodeDb } from "@hackerreads/db/node";
import { parseCsv } from "../lib/csv";
import { log } from "../lib/log";
import { CONFIG_DIR } from "../lib/paths";

const VALID = new Set(["include", "exclude", "auto", "review"]);

export async function run(): Promise<void> {
  const rows = parseCsv(readFileSync(resolve(CONFIG_DIR, "domains_review.csv"), "utf8"));
  const header = rows.shift() ?? [];
  const di = header.indexOf("domain");
  const si = header.indexOf("status");
  if (di < 0 || si < 0) throw new Error("domains_review.csv needs 'domain' and 'status' columns");
  const updates: [string, string][] = [];
  for (const r of rows) {
    const domain = (r[di] ?? "").trim();
    const status = (r[si] ?? "").trim().toLowerCase();
    if (!domain) continue;
    if (!VALID.has(status)) throw new Error(`Invalid status "${status}" for ${domain}`);
    updates.push([domain, status]);
  }
  const { pool } = createNodeDb({ max: 1 });
  try {
    await pool.query("BEGIN");
    for (const [domain, status] of updates) {
      await pool.query("UPDATE domains SET status = $2, note = $3 WHERE domain = $1", [
        domain,
        status,
        status === "include" || status === "exclude" ? "reviewed" : null,
      ]);
    }
    await pool.query("COMMIT");
    const tally = (await pool.query<{ status: string; n: number }>("SELECT status, count(*)::int n FROM domains GROUP BY 1 ORDER BY 1")).rows;
    log(`applied ${updates.length} rows → ${tally.map((t) => `${t.status}=${t.n}`).join(", ")}`);
  } finally {
    await pool.end();
  }
}
