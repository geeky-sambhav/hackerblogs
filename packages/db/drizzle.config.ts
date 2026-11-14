import { defineConfig } from "drizzle-kit";
import { loadRootEnv, requireEnv } from "./src/env";

loadRootEnv();

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema.ts",
  out: "./drizzle",
  dbCredentials: { url: requireEnv("DATABASE_URL") },
});
