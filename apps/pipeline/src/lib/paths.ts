import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

export const PIPELINE_DIR = resolve(here, "../..");
export const REPO_DIR = resolve(PIPELINE_DIR, "../..");
export const CONFIG_DIR = resolve(PIPELINE_DIR, "config");
export const DATA_DIR = resolve(REPO_DIR, ".data");
export const HN_DIR = resolve(DATA_DIR, "hn");
export const CACHE_DIR = resolve(DATA_DIR, "cache");
export const RAW_DUCKDB = resolve(DATA_DIR, "raw.duckdb");

export function ensureDir(p: string): string {
  mkdirSync(p, { recursive: true });
  return p;
}
