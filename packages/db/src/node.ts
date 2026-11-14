import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "./schema";
import { loadRootEnv, requireEnv } from "./env";

export { schema };

/**
 * Postgres pool + Drizzle for Node scripts (pipeline, migrations).
 *
 * Every wait has a deadline. A connection that breaks without an error (seen with Neon during
 * TLS setup) would otherwise leave a query pending with nothing keeping Node alive, and the run
 * ends early with exit code 13 ("unsettled top-level await"), skipping its cleanup.
 *   connectionTimeoutMillis  getting a client, including opening a new connection
 *   queryTimeoutMs           per query (default 30 min; stages whose queries are all small pass less)
 * Keep-alive probes start after 10 s idle: routers between here and Neon silently drop quiet
 * connections, and a stage that computes for minutes between queries would otherwise come back
 * to a dead socket.
 */
export function createNodeDb(opts: { max?: number; queryTimeoutMs?: number } = {}) {
  loadRootEnv();
  const pool = new pg.Pool({
    // pg treats sslmode=require as verify-full today; say so explicitly.
    connectionString: requireEnv("DATABASE_URL").replace(/sslmode=(require|prefer|verify-ca)\b/, "sslmode=verify-full"),
    max: opts.max ?? 4,
    connectionTimeoutMillis: 60_000, // Neon can take a while to wake from autosuspend
    keepAlive: true,
    keepAliveInitialDelayMillis: 10_000,
    query_timeout: opts.queryTimeoutMs ?? 30 * 60_000,
  });
  // Neon may terminate idle connections (compute restarts, autosuspend). The pool drops the
  // broken client and opens a new one on the next query; without a listener the error crashes Node.
  pool.on("error", (err) => {
    console.warn(`[db] idle connection dropped: ${err.message}`);
  });
  // A connection can also break while checked out (ECONNRESET mid-query). That error is emitted
  // on the client, not the pool; the query in flight still rejects, so the caller sees it.
  pool.on("connect", (client) => {
    client.on("error", (err) => {
      console.warn(`[db] connection error: ${err.message}`);
    });
  });
  const db = drizzle(pool, { schema });
  return { db, pool };
}

export type NodeDb = ReturnType<typeof createNodeDb>["db"];
