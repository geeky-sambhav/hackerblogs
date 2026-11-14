const t0 = Date.now();

export function log(...args: unknown[]): void {
  const s = ((Date.now() - t0) / 1000).toFixed(1).padStart(7);
  console.log(`[${s}s]`, ...args);
}

/** Logs progress at most every `everyMs`. */
export function progress(label: string, everyMs = 5000) {
  let last = 0;
  return (done: number, total?: number) => {
    const now = Date.now();
    if (now - last < everyMs && done !== total) return;
    last = now;
    log(`${label}: ${done.toLocaleString()}${total ? ` / ${total.toLocaleString()}` : ""}`);
  };
}
