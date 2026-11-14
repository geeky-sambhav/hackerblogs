/**
 * HackerReads data pipeline. Usage: bun run pipeline <stage> [<stage> …]
 */
import { log } from "./lib/log";

const STAGES: Record<string, () => Promise<{ run: (args: string[]) => Promise<void> }>> = {
  "ingest:hn": () => import("./stages/ingest-hn"),
  "ingest:reddit": () => import("./stages/ingest-reddit"),
  "ingest:longform": () => import("./stages/ingest-longform"),
  "ingest:longreads": () => import("./stages/ingest-longreads"),
  "ingest:kottke": () => import("./stages/ingest-kottke"),
  "ingest:mr": () => import("./stages/ingest-mr"),
  "ingest:wayback": () => import("./stages/ingest-wayback"),
  "ingest:awards": () => import("./stages/ingest-awards"),
  prescore: () => import("./stages/prescore"),
  "domains:import": () => import("./stages/domains-import"),
  "fetch:meta": () => import("./stages/fetch-meta"),
  "fetch:archive": () => import("./stages/fetch-archive"),
  score: () => import("./stages/score"),
  taxonomy: () => import("./stages/taxonomy"),
  related: () => import("./stages/related"),
  collections: () => import("./stages/collections"),
  report: () => import("./stages/report"),
};

const [stage, ...args] = process.argv.slice(2);
if (!stage || !(stage in STAGES)) {
  console.log(`Usage: bun run pipeline <stage> [args]\n\nStages (in order):\n  ${Object.keys(STAGES).join("\n  ")}`);
  process.exit(stage ? 1 : 0);
}

const started = Date.now();
log(`▶ ${stage}`);
// Fires only if the event loop empties while the stage is still awaiting something: a promise
// nothing will ever settle. Say so plainly instead of Node's bare exit code 13.
process.on("beforeExit", () => {
  log(`✘ ${stage} stopped early: it was waiting on work that can never finish (a hung request or query); re-run it to resume`);
  process.exit(13);
});
const mod = await (STAGES[stage] as () => Promise<{ run: (args: string[]) => Promise<void> }>)();
await mod.run(args);
log(`✔ ${stage} in ${((Date.now() - started) / 1000).toFixed(0)}s`);
process.exit(0);
