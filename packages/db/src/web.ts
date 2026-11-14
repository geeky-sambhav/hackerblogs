import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";

export { schema };

let cached: ReturnType<typeof make> | undefined;

function make() {
  const url = process.env.DATABASE_URL_POOLED ?? process.env.DATABASE_URL;
  if (!url) throw new Error("Missing DATABASE_URL_POOLED / DATABASE_URL");
  return drizzle(neon(url), { schema });
}

/** Drizzle over Neon's HTTP driver, for the Next.js server. */
export function getWebDb() {
  cached ??= make();
  return cached;
}

export type WebDb = ReturnType<typeof getWebDb>;
