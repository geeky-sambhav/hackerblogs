import { createWriteStream, existsSync, type WriteStream } from "node:fs";
import { resolve } from "node:path";
import type { DuckDBConnection } from "@duckdb/node-api";
import { lit } from "./duck";
import { DATA_DIR, ensureDir } from "./paths";
import { ensureStaging } from "./staging";

export const RAW_DIR = resolve(DATA_DIR, "raw");

export type MentionRow = {
  source: string;
  item_id: string;
  person: string;
  ts: string; // ISO 8601
  kind: "story" | "comment" | "post";
  points: number | null;
  own_text_len: number | null;
  subreddit: string | null;
  url_raw: string;
  title: string | null;
};

export type EditorialRow = {
  source: string;
  kind: "pick" | "best_of";
  year: number | null;
  url_raw: string;
  ref_url: string | null;
  title: string | null;
  tags?: string | null;
  author?: string | null;
  publication?: string | null;
};

export function rawFile(name: string): string {
  return resolve(ensureDir(RAW_DIR), name);
}

export class JsonlWriter<T> {
  private stream: WriteStream;
  count = 0;
  constructor(path: string) {
    this.stream = createWriteStream(path, { flags: "w" });
  }
  write(row: T): void {
    this.stream.write(`${JSON.stringify(row)}\n`);
    this.count++;
  }
  close(): Promise<void> {
    return new Promise((res, rej) => this.stream.end((err?: Error | null) => (err ? rej(err) : res())));
  }
}

/** Replace a source's rows in mentions_raw with the contents of a JSONL file. */
export async function loadMentions(c: DuckDBConnection, source: string, file: string): Promise<void> {
  await ensureStaging(c);
  await c.run(`DELETE FROM mentions_raw WHERE source = ${lit(source)}`);
  if (!existsSync(file)) return;
  await c.run(`
    INSERT INTO mentions_raw
    SELECT source, item_id, person, ts::TIMESTAMPTZ, kind, points, own_text_len, subreddit, url_raw, title
    FROM read_json(${lit(file)}, format = 'newline_delimited', ignore_errors = true, columns = {
      source: 'VARCHAR', item_id: 'VARCHAR', person: 'VARCHAR', ts: 'VARCHAR', kind: 'VARCHAR',
      points: 'INTEGER', own_text_len: 'INTEGER', subreddit: 'VARCHAR', url_raw: 'VARCHAR', title: 'VARCHAR'
    })
  `);
}

/** Replace a source's rows in editorial_raw with the contents of a JSONL file. */
export async function loadEditorial(c: DuckDBConnection, source: string, file: string): Promise<void> {
  await ensureStaging(c);
  await c.run(`DELETE FROM editorial_raw WHERE source = ${lit(source)}`);
  if (!existsSync(file)) return;
  await c.run(`
    INSERT INTO editorial_raw
    (source, kind, year, url_raw, ref_url, title, tags, author, publication)
    SELECT DISTINCT source, kind, year, url_raw, ref_url, title, tags, author, publication
    FROM read_json(${lit(file)}, format = 'newline_delimited', ignore_errors = true, columns = {
      source: 'VARCHAR', kind: 'VARCHAR', year: 'INTEGER', url_raw: 'VARCHAR', ref_url: 'VARCHAR', title: 'VARCHAR',
      tags: 'VARCHAR', author: 'VARCHAR', publication: 'VARCHAR'
    })
  `);
}
