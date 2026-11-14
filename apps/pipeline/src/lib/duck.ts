import { DuckDBInstance, type DuckDBConnection } from "@duckdb/node-api";
import { DATA_DIR, RAW_DUCKDB, ensureDir } from "./paths";

let instance: DuckDBInstance | undefined;

/** Connection to the local staging database (.data/raw.duckdb). */
export async function duck(): Promise<DuckDBConnection> {
  ensureDir(DATA_DIR);
  instance ??= await DuckDBInstance.create(RAW_DUCKDB);
  const c = await instance.connect();
  await c.run("SET TimeZone = 'UTC'");
  return c;
}

export async function rows<T = Record<string, unknown>>(c: DuckDBConnection, sql: string): Promise<T[]> {
  const r = await c.runAndReadAll(sql);
  return r.getRowObjectsJS() as T[];
}

/** SQL string literal. */
export function lit(s: string): string {
  return `'${s.replaceAll("'", "''")}'`;
}
