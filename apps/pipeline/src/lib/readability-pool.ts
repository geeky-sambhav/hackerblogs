/**
 * Readability word counts off the main thread, with a hard time limit per page.
 *
 * Readability can spin for minutes on some pages, and on the main thread that freezes every
 * fetch in flight. Here each page runs in a worker; a worker that overruns is terminated and
 * replaced, and that page gets no count (length unknown).
 */
import { Worker } from "node:worker_threads";

const TSX_API = import.meta.resolve("tsx/esm/api");
const WORKER_URL = new URL("./readability-worker.ts", import.meta.url).href;

type Job = { id: number; html: string; resolve: (words: number | null) => void };

export class ReadabilityPool {
  private idle: Worker[] = [];
  private queue: Job[] = [];
  private nextId = 0;
  private workers = 0;
  timeouts = 0;
  errors = 0;

  constructor(
    private readonly size = 3,
    private readonly timeoutMs = 10_000,
  ) {}

  wordCount(html: string): Promise<number | null> {
    return new Promise((resolve) => {
      this.queue.push({ id: this.nextId++, html, resolve });
      this.pump();
    });
  }

  async close(): Promise<void> {
    const all = this.idle.splice(0);
    this.workers -= all.length;
    await Promise.all(all.map((w) => w.terminate()));
  }

  private spawn(): Worker {
    this.workers++;
    // Loader hooks do not carry over into worker threads, so a small JS bootstrap registers tsx
    // in the worker first and then loads the TypeScript worker module.
    const w = new Worker(
      `import(${JSON.stringify(TSX_API)}).then((tsx) => { tsx.register(); return import(${JSON.stringify(WORKER_URL)}); });`,
      { eval: true },
    );
    w.unref();
    return w;
  }

  private pump(): void {
    while (this.queue.length > 0) {
      const worker = this.idle.pop() ?? (this.workers < this.size ? this.spawn() : null);
      if (!worker) return;
      this.run(worker, this.queue.shift() as Job);
    }
  }

  private run(worker: Worker, job: Job): void {
    let settled = false;
    const finish = (words: number | null, healthy: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      worker.off("message", onMessage);
      worker.off("error", onError);
      job.resolve(words);
      if (healthy) {
        this.idle.push(worker);
      } else {
        this.workers--;
        void worker.terminate();
      }
      this.pump();
    };
    const onMessage = (msg: { id: number; words: number | null }) => {
      if (msg.id === job.id) finish(msg.words, true);
    };
    const onError = (err: Error) => {
      // A crashed worker is replaced; say so loudly, since every page would otherwise get no length.
      if (this.errors++ < 3) console.error(`[readability] worker error: ${err.message}`);
      finish(null, false);
    };
    const timer = setTimeout(() => {
      this.timeouts++;
      finish(null, false);
    }, this.timeoutMs);
    worker.on("message", onMessage);
    worker.on("error", onError);
    worker.postMessage({ id: job.id, html: job.html });
  }
}
