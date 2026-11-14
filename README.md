# HackerReads

HackerReads is inspired by Andrej Karpathy's HackerTube. It takes the same idea and
applies it to writing: a catalog of the best articles and essays from
across the web, the long reads people keep recommending year after year.

Pieces are chosen by evidence (Hacker News and Reddit recommendations spread over many
months and years, plus curators and prizes), deterministically, with no AI labelling.
Every entry links to the original publisher.

## Layout

| Path | What |
|---|---|
| `apps/web` | Next.js 16 site (App Router, Cache Components, Tailwind v4, shadcn) |
| `apps/pipeline` | Node + TypeScript data pipeline (DuckDB for raw data, Postgres for the catalog) |
| `packages/db` | Drizzle schema, migrations and clients for Neon Postgres |
| `packages/shared` | URL canonicalisation, scoring/eligibility rules, feed algorithm (unit-tested) |
| `.data/` | Local, gitignored: raw dumps, crawl caches, `raw.duckdb` |

Secrets live in the root `.env` (`DATABASE_URL`, `DATABASE_URL_POOLED`).

## Commands

```bash
bun install
bun run db:migrate        # apply migrations to Neon
bun run test              # unit tests (shared + pipeline)
bun run typecheck
bun run lint
bun run build             # builds the site (prerenders every page from Neon)
bun run --cwd apps/web dev
```

## Rebuilding the catalog

Run stages in order with `bun run pipeline <stage>` (from the repo root). Crawlers are
polite (robots.txt, one request per second per host) and cache every response under
`.data/cache`, so re-runs are cheap.

1. `.data/download-hn.sh`: download the Hacker News archive (about 12 GB of Parquet).
2. `ingest:hn`: extract story URLs and comment links with DuckDB.
3. `ingest:reddit`: link posts from subreddits in `apps/pipeline/config/sources.yaml` (Arctic Shift).
4. `ingest:longform`, `ingest:longreads`, `ingest:kottke`, `ingest:mr`, `ingest:wayback`: curator picks.
   `ingest:mr` reads Marginal Revolution's research archive; unzip `posts.jsonl` into `.data/raw/mr/` first.
5. `ingest:awards`: Pulitzer, National Magazine Award and Polk honorees.
6. `prescore`: canonicalise URLs, select candidates, push to Postgres, write
   `apps/pipeline/config/domains_review.csv`.
7. Review that CSV (set `status` to include / exclude / auto / review), then `domains:import`.
8. `fetch:meta`: fetch candidate pages for titles, authors, dates, word counts (hours).
9. `score`: filters, eligibility, ranking, cutoff (`--classic=3000 --rising=200`).
10. `taxonomy`, `related`, `collections`, then `report` (writes `apps/pipeline/reports/catalog-report.md`).

Ranking rules are documented in `packages/shared/src/score.ts`; scope filters in
`apps/pipeline/src/lib/filters.ts`.
