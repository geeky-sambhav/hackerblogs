import { resolve } from "node:path";
import { config } from "dotenv";
import type { NextConfig } from "next";

// Secrets live in the monorepo root .env (shared with the pipeline).
config({ path: resolve(process.cwd(), "../../.env"), quiet: true });

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  transpilePackages: ["@hackerreads/db", "@hackerreads/shared"],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
