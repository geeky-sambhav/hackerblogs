"use client";

/**
 * Browser-only reader state (no accounts): liked, disliked, reading list and
 * history. Each list keeps a small snapshot so the Library page works offline.
 */
import { useSyncExternalStore } from "react";

export type SavedPiece = { id: number; slug: string; title: string; publication: string | null; year: number | null; at: number };
export type ListName = "liked" | "disliked" | "later" | "history";
export type ReaderState = Record<ListName, SavedPiece[]>;

const KEY = "hackerreads:v1";
const HISTORY_MAX = 200;
const EMPTY: ReaderState = { liked: [], disliked: [], later: [], history: [] };

let cache: ReaderState | null = null;
const listeners = new Set<() => void>();

function isSaved(x: unknown): x is SavedPiece {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  return typeof o.id === "number" && typeof o.slug === "string" && typeof o.title === "string";
}

function sanitize(raw: unknown): ReaderState {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const list = (k: ListName) => (Array.isArray(o[k]) ? (o[k] as unknown[]).filter(isSaved) : []);
  return { liked: list("liked"), disliked: list("disliked"), later: list("later"), history: list("history").slice(0, HISTORY_MAX) };
}

/** Current state straight from storage (use in event handlers and effects, not render). */
export function readState(): ReaderState {
  return read();
}

function read(): ReaderState {
  if (cache) return cache;
  try {
    const raw = window.localStorage.getItem(KEY);
    cache = raw ? sanitize(JSON.parse(raw)) : EMPTY;
  } catch {
    cache = EMPTY;
  }
  return cache;
}

function write(next: ReaderState): void {
  cache = next;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // storage full or blocked: keep the in-memory copy for this visit
  }
  for (const l of listeners) l();
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY) {
      cache = null;
      fn();
    }
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(fn);
    window.removeEventListener("storage", onStorage);
  };
}

export function useReaderState(): ReaderState {
  return useSyncExternalStore(subscribe, read, () => EMPTY);
}

export function has(state: ReaderState, list: ListName, id: number): boolean {
  return state[list].some((p) => p.id === id);
}

export function toggle(list: ListName, piece: Omit<SavedPiece, "at">): void {
  const s = read();
  const on = s[list].some((p) => p.id === piece.id);
  const next: ReaderState = { ...s, [list]: on ? s[list].filter((p) => p.id !== piece.id) : [{ ...piece, at: Date.now() }, ...s[list]] };
  // liking and disliking are exclusive
  if (!on && list === "liked") next.disliked = s.disliked.filter((p) => p.id !== piece.id);
  if (!on && list === "disliked") next.liked = s.liked.filter((p) => p.id !== piece.id);
  write(next);
}

export function remember(piece: Omit<SavedPiece, "at">): void {
  const s = read();
  const history = [{ ...piece, at: Date.now() }, ...s.history.filter((p) => p.id !== piece.id)].slice(0, HISTORY_MAX);
  write({ ...s, history });
}

export function clearList(list: ListName): void {
  write({ ...read(), [list]: [] });
}

export function exportState(): string {
  return JSON.stringify({ app: "hackerreads", version: 1, exportedAt: new Date().toISOString(), ...read() }, null, 2);
}

/** Merge an exported file into the current state. Returns the number of pieces added. */
export function importState(json: string): number {
  const incoming = sanitize(JSON.parse(json));
  const s = read();
  let added = 0;
  const merge = (k: ListName) => {
    const ids = new Set(s[k].map((p) => p.id));
    const extra = incoming[k].filter((p) => !ids.has(p.id));
    added += extra.length;
    return [...s[k], ...extra];
  };
  const liked = merge("liked");
  const likedIds = new Set(liked.map((p) => p.id));
  // liking and disliking stay exclusive; a like wins
  const disliked = merge("disliked").filter((p) => !likedIds.has(p.id));
  write({ liked, disliked, later: merge("later"), history: merge("history").slice(0, HISTORY_MAX) });
  return added;
}
