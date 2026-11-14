import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";

/** Load the monorepo root .env (no-op for variables already set). */
export function loadRootEnv(): void {
  const here = dirname(fileURLToPath(import.meta.url));
  const rootEnv = resolve(here, "../../../.env");
  if (existsSync(rootEnv)) config({ path: rootEnv, quiet: true });
}

export function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing ${name}. Set it in the repo root .env`);
  return v;
}
