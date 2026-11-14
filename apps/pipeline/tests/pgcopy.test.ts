import type { Pool, PoolClient } from "pg";
import { describe, expect, it, vi } from "vitest";
import { copyText, isConnectionError, pgArrayLiteral, queryWithRetry, withClient } from "../src/lib/pgcopy";

function fakePool() {
  const released: unknown[] = [];
  const queries: string[] = [];
  const client = {
    query: vi.fn(async (sql: string) => {
      queries.push(sql);
      return { rows: [] };
    }),
    release: (err?: unknown) => released.push(err),
  } as unknown as PoolClient;
  const pool = { connect: async () => client } as unknown as Pool;
  return { pool, released, queries };
}

describe("COPY text escaping", () => {
  it("escapes specials and nulls", () => {
    expect(copyText(null)).toBe("\\N");
    expect(copyText("a\tb\nc\\d\r")).toBe("a\\tb\\nc\\\\d\\r");
    expect(copyText(true)).toBe("t");
    expect(copyText(12)).toBe("12");
    expect(copyText(new Date("2020-01-02T03:04:05Z"))).toBe("2020-01-02T03:04:05.000Z");
  });
  it("encodes text arrays", () => {
    expect(pgArrayLiteral(["a", 'b "c"', "d\\e"])).toBe('{"a","b \\"c\\"","d\\\\e"}');
    // the array literal's backslashes are escaped again for COPY
    expect(copyText(["x\\y"])).toBe('{"x\\\\\\\\y"}');
    expect(copyText([])).toBe("{}");
  });
});

describe("withClient", () => {
  it("tells connection failures from query errors", () => {
    expect(isConnectionError(Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" }))).toBe(true);
    expect(isConnectionError(new Error("Connection terminated unexpectedly"))).toBe(true);
    expect(isConnectionError(Object.assign(new Error("syntax error"), { code: "42601" }))).toBe(false);
  });

  it("retries the whole transaction on a fresh connection when the connection drops", async () => {
    vi.useFakeTimers();
    const { pool, released } = fakePool();
    let calls = 0;
    const done = withClient(pool, async () => {
      if (++calls === 1) throw Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" });
      return "ok";
    });
    await vi.runAllTimersAsync();
    expect(await done).toBe("ok");
    expect(calls).toBe(2);
    expect(released[0]).toBeInstanceOf(Error); // broken client destroyed
    expect(released[1]).toBeUndefined();
    vi.useRealTimers();
  });

  it("rolls back and rethrows any other error", async () => {
    const { pool, released, queries } = fakePool();
    await expect(
      withClient(pool, async () => {
        throw new Error("bad data");
      }),
    ).rejects.toThrow("bad data");
    expect(queries).toEqual(["ROLLBACK"]);
    expect(released).toEqual([undefined]);
  });
});

describe("queryWithRetry", () => {
  it("retries a read whose connection drops, but not a bad query", async () => {
    vi.useFakeTimers();
    let calls = 0;
    const released: unknown[] = [];
    const client = {
      query: async (sql: string) => {
        calls++;
        if (sql === "bad") throw Object.assign(new Error("syntax error"), { code: "42601" });
        if (calls === 1) throw new Error("Query read timeout");
        return { rows: [{ ok: 1 }] };
      },
      release: (err?: unknown) => released.push(err),
    };
    const pool = { connect: async () => client } as unknown as Pool;
    const read = queryWithRetry(pool, "SELECT 1");
    await vi.runAllTimersAsync();
    expect(await read).toEqual([{ ok: 1 }]);
    expect(calls).toBe(2);
    await expect(queryWithRetry(pool, "bad")).rejects.toThrow("syntax error");
    expect(calls).toBe(3);
    expect(released[0]).toBeInstanceOf(Error); // timed-out connection destroyed, not reused
    expect(released.slice(1)).toEqual([undefined, undefined]);
    vi.useRealTimers();
  });
});
