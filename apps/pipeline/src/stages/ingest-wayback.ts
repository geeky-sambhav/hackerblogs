/**
 * ingest:wayback — curators whose archives only survive in the Wayback Machine:
 * Arts & Letters Daily (2006 →) and The Browser (2008 – 2018, when its homepage
 * still linked picks directly). One snapshot per week; every outbound article
 * link on the snapshot is a "pick". Flags: --load-only, --fetch-only.
 */
import { duck } from "../lib/duck";
import { politeFetch, politeJson } from "../lib/http";
import { JsonlWriter, loadEditorial, rawFile, type EditorialRow } from "../lib/jsonl";
import { articleLinks } from "../lib/links";
import { log } from "../lib/log";

type Target = { source: "ald" | "browser"; url: string; from: number; to: number; selfHosts: string[] };

const TARGETS: Target[] = [
  { source: "ald", url: "aldaily.com/", from: 2006, to: 2026, selfHosts: ["aldaily.com", "chronicle.com", "archive.org"] },
  { source: "browser", url: "thebrowser.com/", from: 2008, to: 2018, selfHosts: ["thebrowser.com", "fivebooks.com", "archive.org"] },
];

const WAYBACK_INTERVAL_MS = 3000; // ~20 requests/minute

function weekly(timestamps: string[]): string[] {
  const out: string[] = [];
  let last = 0;
  for (const ts of timestamps.sort()) {
    const t = Date.UTC(Number(ts.slice(0, 4)), Number(ts.slice(4, 6)) - 1, Number(ts.slice(6, 8)));
    if (t - last >= 7 * 86_400_000) {
      out.push(ts);
      last = t;
    }
  }
  return out;
}

export async function run(args: string[]): Promise<void> {
  for (const target of TARGETS) {
    const file = rawFile(`${target.source}.jsonl`);
    if (!args.includes("--load-only")) {
      const cdx = await politeJson<string[][]>(
        `https://web.archive.org/cdx/search/cdx?url=${target.url}&from=${target.from}&to=${target.to}&output=json&fl=timestamp&filter=statuscode:200&collapse=timestamp:8`,
        { minIntervalMs: WAYBACK_INTERVAL_MS, timeoutMs: 120_000 },
      );
      const snapshots = weekly(cdx.slice(1).map((r) => r[0] ?? "").filter(Boolean));
      log(`${target.source}: ${snapshots.length} weekly snapshots`);
      const out = new JsonlWriter<EditorialRow>(file);
      let i = 0;
      for (const ts of snapshots) {
        i++;
        try {
          const res = await politeFetch(`https://web.archive.org/web/${ts}id_/http://${target.url}`, {
            minIntervalMs: WAYBACK_INTERVAL_MS,
            timeoutMs: 60_000,
          });
          if (res.status !== 200) continue;
          for (const url_raw of articleLinks(res.body, target.selfHosts)) {
            out.write({
              source: target.source,
              kind: "pick",
              year: Number(ts.slice(0, 4)),
              url_raw,
              ref_url: `https://web.archive.org/web/${ts}/http://${target.url}`,
              title: null,
            });
          }
        } catch (err) {
          log(`${target.source} ${ts}: ${(err as Error).message}`);
        }
        if (i % 50 === 0) log(`${target.source}: ${i}/${snapshots.length} snapshots, ${out.count.toLocaleString()} links`);
      }
      await out.close();
      log(`${target.source}.jsonl: ${out.count.toLocaleString()} links`);
    }
    if (!args.includes("--fetch-only")) await loadEditorial(await duck(), target.source, file);
  }
}
