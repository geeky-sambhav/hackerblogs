import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { createNodeDb } from "./node";

const here = dirname(fileURLToPath(import.meta.url));
const { db, pool } = createNodeDb({ max: 1 });
try {
  // Extensions must exist before migrations that create trigram indexes.
  await pool.query("CREATE EXTENSION IF NOT EXISTS pg_trgm");
  await migrate(db, { migrationsFolder: resolve(here, "../drizzle") });
  console.log("migrations applied");
} finally {
  await pool.end();
}
