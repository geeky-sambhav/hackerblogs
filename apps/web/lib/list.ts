import { applyFilters, decadeOf } from "./catalog";
import type { Piece } from "./types";

export const PAGE_SIZE = 40;
export const SORTS = { recommended: "Most recommended", durable: "Recommended over most years", newest: "Newest", oldest: "Oldest" } as const;
export type Sort = keyof typeof SORTS;

export type ListParams = {
  area?: string;
  decade?: number;
  length?: string;
  paywall?: string;
  sort: Sort;
  page: number;
};

function one(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

export function parseListParams(sp: Record<string, string | string[] | undefined>): ListParams {
  const decade = Number(one(sp.decade));
  const sort = one(sp.sort);
  const length = one(sp.length);
  const paywall = one(sp.paywall);
  const page = Number(one(sp.page));
  return {
    area: one(sp.area) || undefined,
    decade: Number.isInteger(decade) && decade >= 1900 && decade <= 2100 && decade % 10 === 0 ? decade : undefined,
    length: length === "short" || length === "medium" || length === "long" ? length : undefined,
    paywall: paywall === "free" || paywall === "paid" ? paywall : undefined,
    sort: sort && sort in SORTS ? (sort as Sort) : "recommended",
    page: Number.isInteger(page) && page > 1 ? page : 1,
  };
}

export function toQuery(p: Partial<ListParams>): string {
  const q = new URLSearchParams();
  if (p.area) q.set("area", p.area);
  if (p.decade !== undefined) q.set("decade", String(p.decade));
  if (p.length) q.set("length", p.length);
  if (p.paywall) q.set("paywall", p.paywall);
  if (p.sort && p.sort !== "recommended") q.set("sort", p.sort);
  if (p.page && p.page > 1) q.set("page", String(p.page));
  const s = q.toString();
  return s ? `?${s}` : "";
}

export function sortPieces(pieces: Piece[], sort: Sort): Piece[] {
  const out = pieces.slice();
  const year = (p: Piece) => p.publishedAt ?? "";
  switch (sort) {
    case "recommended":
      return out.sort((a, b) => a.rank - b.rank);
    case "durable":
      return out.sort((a, b) => b.years - a.years || a.rank - b.rank);
    case "newest":
      return out.sort((a, b) => year(b).localeCompare(year(a)) || a.rank - b.rank);
    case "oldest":
      return out.sort((a, b) => (year(a) || "9999").localeCompare(year(b) || "9999") || a.rank - b.rank);
  }
}

/**
 * Soft per-publication cap: within each window of `window` entries, at most
 * `cap` from one publication; overflow is deferred, never dropped.
 */
export function diversify(pieces: Piece[], window = 20, cap = 4): Piece[] {
  const out: Piece[] = [];
  let pending = pieces.slice();
  while (pending.length > 0) {
    const counts = new Map<string, number>();
    const start = out.length - (out.length % window);
    for (const p of out.slice(start)) {
      const k = p.publication?.slug ?? `#${p.id}`;
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    const idx = pending.findIndex((p) => (counts.get(p.publication?.slug ?? `#${p.id}`) ?? 0) < cap);
    const take = idx === -1 ? 0 : idx;
    out.push(pending[take] as Piece);
    pending = [...pending.slice(0, take), ...pending.slice(take + 1)];
  }
  return out;
}

export function runList(pieces: Piece[], p: ListParams, opts: { diversify?: boolean } = {}) {
  const filtered = applyFilters(pieces, p);
  let sorted = sortPieces(filtered, p.sort);
  if (opts.diversify && p.sort === "recommended") sorted = diversify(sorted);
  const pages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const page = Math.min(p.page, pages);
  return { total: sorted.length, page, pages, items: sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE) };
}

export function decadesOf(pieces: Piece[]): number[] {
  return [...new Set(pieces.map((p) => decadeOf(p.publishedYear)).filter((d): d is number => d !== null))].sort((a, b) => a - b);
}
