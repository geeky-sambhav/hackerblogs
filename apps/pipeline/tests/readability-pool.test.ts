import { afterAll, describe, expect, it } from "vitest";
import { ReadabilityPool } from "../src/lib/readability-pool";

const page = `<html><body><article>${"<p>word word word word word word word word word word word word.</p>".repeat(100)}</article></body></html>`;

describe("ReadabilityPool", () => {
  const pool = new ReadabilityPool(2, 10_000);
  afterAll(() => pool.close());

  it("counts words in a worker", async () => {
    expect(await Promise.all([pool.wordCount(page), pool.wordCount(page), pool.wordCount(page)])).toEqual([1200, 1200, 1200]);
    expect(pool.errors).toBe(0);
  });

  it("gives up on a page that overruns the time limit and keeps working", async () => {
    const tight = new ReadabilityPool(1, 1);
    expect(await tight.wordCount(page)).toBeNull();
    expect(tight.timeouts).toBe(1);
    await tight.close();
    expect(await pool.wordCount(page)).toBe(1200);
  });
});
