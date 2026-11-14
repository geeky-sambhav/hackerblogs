import { createHash } from "node:crypto";

/** Stable short hash of (platform, user) — usernames are never stored. */
export function personHash(source: string, user: string): string {
  return createHash("sha256").update(`${source}:${user.toLowerCase()}`).digest("hex").slice(0, 16);
}

export function sha1(s: string): string {
  return createHash("sha1").update(s).digest("hex");
}
