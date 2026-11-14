import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DeadlineExceeded, withDeadline } from "../src/lib/deadline";
import { networkErrorKind, politeFetch } from "../src/lib/http";

let server: Server;
let base = "";
let throttled = 0;

beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.url === "/robots.txt") {
      res.writeHead(404).end();
    } else if (req.url === "/stall") {
      // Headers and a first chunk, then the body stalls forever.
      res.writeHead(200, { "content-type": "text/html" });
      res.write("<html><body>");
    } else if (req.url === "/stall-503") {
      // An error status whose body never finishes: discarding it must not hang the request.
      res.writeHead(503, { "content-type": "text/html" });
      res.write("<html><body>busy");
    } else if (req.url === "/reset") {
      req.socket.destroy();
    } else if (req.url === "/throttled") {
      if (throttled++ === 0) res.writeHead(429, { "retry-after": "1" }).end();
      else res.writeHead(200, { "content-type": "text/plain" }).end("ok");
    } else {
      res.writeHead(200, { "content-type": "text/plain" }).end("ok");
    }
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => {
  server.closeAllConnections();
  server.close();
});

const opts = { cache: false, retries: 0, minIntervalMs: 0 } as const;

async function failureKind(url: string, timeoutMs = 2000) {
  try {
    await politeFetch(url, { ...opts, timeoutMs, ignoreRobots: true });
  } catch (err) {
    return networkErrorKind(err);
  }
  return "succeeded";
}

describe("politeFetch", () => {
  it("gives up on a response whose body stalls, and calls it a timeout", async () => {
    const started = Date.now();
    expect(await failureKind(`${base}/stall`, 500)).toBe("timeout");
    expect(Date.now() - started).toBeLessThan(3000);
  });

  it("tells a dropped connection from a host that is gone", async () => {
    expect(await failureKind(`${base}/reset`)).toBe("reset");
    // A port that was just listening and is now closed: nothing there.
    const closed = createServer();
    await new Promise<void>((r) => closed.listen(0, "127.0.0.1", r));
    const port = (closed.address() as AddressInfo).port;
    await new Promise((r) => closed.close(r));
    expect(await failureKind(`http://127.0.0.1:${port}/`)).toBe("refused");
    expect(await failureKind("http://hackerreads-test.invalid/")).toBe("dns");
  });

  it("waits out a 429 before retrying", async () => {
    const started = Date.now();
    const r = await politeFetch(`${base}/throttled`, { ...opts, retries: 1 });
    expect(r.status).toBe(200);
    expect(Date.now() - started).toBeGreaterThanOrEqual(950);
  });

  it("returns an error status even when its body stalls", async () => {
    const started = Date.now();
    const r = await politeFetch(`${base}/stall-503`, { ...opts, timeoutMs: 2000 });
    expect(r.status).toBe(503);
    expect(Date.now() - started).toBeLessThan(2000);
  });
});

describe("withDeadline", () => {
  it("settles a promise that would never settle", async () => {
    const never = new Promise<number>(() => {});
    await expect(withDeadline(never, 50, "never")).rejects.toBeInstanceOf(DeadlineExceeded);
    expect(networkErrorKind(new DeadlineExceeded("x", 1))).toBe("timeout");
  });
  it("passes results and errors through", async () => {
    await expect(withDeadline(Promise.resolve(7), 1000, "ok")).resolves.toBe(7);
    await expect(withDeadline(Promise.reject(new Error("boom")), 1000, "err")).rejects.toThrow("boom");
  });
});
