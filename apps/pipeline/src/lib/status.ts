/**
 * pieces.http_status: the HTTP status of the last fetch, or one of these sentinels.
 *
 * Dead (readers get the Wayback copy, or the piece is dropped): unreachable, front-page
 * redirect, 404, 410. Blocked and robots pages are alive: readers keep the original link.
 */
export const STATUS = {
  /** The host is gone: on every variant the name did not resolve or no connection could be opened. */
  unreachable: 0,
  /** robots.txt disallows us. */
  robots: -1,
  /** Answered 2xx, but only after redirecting to the site's front page. */
  frontPage: -2,
  /** A server answered but would not serve us (stall, dropped connection, bad TLS, malformed reply). */
  blocked: -3,
} as const;

export const DEAD_STATUSES = [STATUS.unreachable, STATUS.frontPage, 404, 410] as const;

export function isDeadStatus(status: number | null): boolean {
  return status !== null && (DEAD_STATUSES as readonly number[]).includes(status);
}

/** Same rule in SQL (unqualified column, so it works with or without a table alias). */
export const DEAD_SQL = `(http_status IN (${DEAD_STATUSES.join(", ")}))`;
