import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { Pool, PoolClient, QueryResultRow } from "pg";
import { from as copyFrom } from "pg-copy-streams";

export type CopyValue = string | number | boolean | Date | null | undefined | readonly string[];

/** Escape one value for PostgreSQL COPY text format. */
export function copyText(v: CopyValue): string {
  if (v === null || v === undefined) return "\\N";
  if (Array.isArray(v)) return copyText(pgArrayLiteral(v as readonly string[]));
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "boolean") return v ? "t" : "f";
  return String(v).replace(/\\/g, "\\\\").replace(/\t/g, "\\t").replace(/\n/g, "\\n").replace(/\r/g, "\\r");
}

/** Postgres array literal for text[]: {"a","b \"c\""}. */
export function pgArrayLiteral(items: readonly string[]): string {
  return `{${items.map((s) => `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`).join(",")}}`;
}

/** COPY rows into `table (columns)` using an existing client (works inside a transaction). */
export async function copyInto(
  client: PoolClient,
  table: string,
  columns: string[],
  rows: Iterable<CopyValue[]>,
): Promise<number> {
  let n = 0;
  const source = Readable.from(
    (function* () {
      let buf = "";
      for (const r of rows) {
        buf += `${r.map(copyText).join("\t")}\n`;
        n++;
        if (buf.length > 1 << 20) {
          yield buf;
          buf = "";
        }
      }
      if (buf) yield buf;
    })(),
  );
  const sink = client.query(copyFrom(`COPY ${table} (${columns.join(", ")}) FROM STDIN`));
  await pipeline(source, sink);
  return n;
}

/** A failure of the connection itself (the server then rolls back any open transaction). */
export function isConnectionError(err: unknown): boolean {
  const { code, message } = (err ?? {}) as { code?: string; message?: string };
  return (
    ["ECONNRESET", "EPIPE", "ETIMEDOUT", "ECONNREFUSED", "57P01", "57P02", "57P03"].includes(code ?? "") ||
    /Connection terminated|socket disconnected|Query read timeout/i.test(message ?? "")
  );
}

/**
 * A read-only query, retried on a fresh connection when the connection drops mid-result.
 * Only for SELECTs: a retried write could apply twice.
 */
export async function queryWithRetry<R extends QueryResultRow>(
  pool: Pool,
  text: string,
  params: unknown[] = [],
  attempts = 4,
): Promise<R[]> {
  for (let attempt = 1; ; attempt++) {
    const c = await pool.connect();
    try {
      const rows = (await c.query<R>(text, params)).rows;
      c.release();
      return rows;
    } catch (err) {
      const broken = isConnectionError(err);
      // A broken or timed-out connection is destroyed, so the retry gets a fresh one.
      c.release(broken ? (err as Error) : undefined);
      if (!broken || attempt >= attempts) throw err;
      console.warn(`[db] connection lost (${(err as Error).message}); retrying the read (${attempt + 1}/${attempts})`);
      await new Promise((r) => setTimeout(r, 5_000 * attempt));
    }
  }
}

/**
 * Run `fn` on one checked-out client. Callers wrap all their writes in a single transaction
 * that rebuilds their tables from scratch, so when the connection breaks (Neon resets one now
 * and then) the server rolls it back and the whole callback is retried on a fresh connection.
 * Any other error rolls back and is rethrown, so the client never returns to the pool mid-transaction.
 */
export async function withClient<T>(pool: Pool, fn: (c: PoolClient) => Promise<T>, attempts = 3): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    const c = await pool.connect();
    try {
      const result = await fn(c);
      c.release();
      return result;
    } catch (err) {
      if (isConnectionError(err)) {
        c.release(err as Error); // destroy the broken connection
        if (attempt < attempts) {
          console.warn(`[db] connection lost (${(err as Error).message}); retrying the transaction (${attempt + 1}/${attempts})`);
          await new Promise((r) => setTimeout(r, 5_000 * attempt));
          continue;
        }
        throw err;
      }
      const rolledBack = await c.query("ROLLBACK").then(() => true, () => false);
      c.release(rolledBack ? undefined : (err as Error));
      throw err;
    }
  }
}
