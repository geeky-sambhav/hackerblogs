/**
 * A hard deadline on any promise. Aborting a fetch normally settles everything waiting on it,
 * but not always (e.g. cancelling a response body), and a promise left pending after its own
 * timer fired has nothing keeping Node alive: a run then ends early with exit code 13. The
 * deadline's timer keeps the process alive and always settles the race.
 */
export class DeadlineExceeded extends Error {
  constructor(label: string, ms: number) {
    super(`${label}: no result after ${Math.round(ms / 1000)} s`);
    this.name = "DeadlineExceeded";
  }
}

export function withDeadline<T>(work: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new DeadlineExceeded(label, ms)), ms);
  });
  return Promise.race([work, deadline]).finally(() => clearTimeout(timer));
}
