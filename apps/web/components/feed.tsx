"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { PieceActions } from "@/components/piece-actions";
import { StampStrip } from "@/components/stamp-strip";
import { Thumb } from "@/components/thumb";
import { readState, type ReaderState } from "@/lib/storage";
import type { FeedCard } from "@/lib/types";

const PAGE = 24;

async function load(state: ReaderState, exclude: number[], seed: number): Promise<FeedCard[]> {
  const res = await fetch("/api/feed", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      liked: state.liked.map((p) => p.id),
      disliked: state.disliked.map((p) => p.id),
      seen: state.history.map((p) => p.id),
      exclude,
      seed,
      size: PAGE,
    }),
  });
  if (!res.ok) throw new Error(`The feed could not load (HTTP ${res.status}).`);
  return ((await res.json()) as { cards: FeedCard[] }).cards;
}

function citation(c: FeedCard) {
  const parts: React.ReactNode[] = [];
  if (c.authors.length) parts.push(c.authors.join(", "));
  if (c.publication) parts.push(<i key="p">{c.publication}</i>);
  if (c.year) parts.push(String(c.year));
  return parts.map((p, i) => (
    <span key={i}>
      {i > 0 ? ", " : null}
      {p}
    </span>
  ));
}

export function Feed() {
  const [cards, setCards] = useState<FeedCard[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const seedRef = useRef(0);
  const started = useRef(false);

  const more = useCallback(
    async (current: FeedCard[]) => {
      setBusy(true);
      setError(null);
      try {
        seedRef.current += 1;
        // Read storage at request time: during hydration the hook state is still the empty server snapshot.
        const next = await load(readState(), current.map((c) => c.id), seedRef.current);
        setCards([...current, ...next]);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    // A new random seed per visit reshuffles the home page, as on HackerTube.
    seedRef.current = Math.floor(Math.random() * 2 ** 30);
    void more([]);
  }, [more]);

  if (cards === null) {
    return error ? <p className="py-8 text-destructive">{error}</p> : <p className="py-8 text-muted-foreground">Pulling cards from the catalog…</p>;
  }
  if (cards.length === 0) return <p className="py-8 text-muted-foreground">You have seen everything. Clear your history in Your library to start over.</p>;

  return (
    <div>
      <div className="divide-y divide-border/70">
        {cards.map((c) => (
          <article key={c.id} className="group grid grid-cols-[1fr_auto] gap-x-5 py-5">
            <div className="min-w-0">
              <p className="mb-1 text-sm text-muted-foreground">{c.reason}</p>
              <h3 className="text-xl leading-snug font-medium text-balance">
                <Link href={`/read/${c.slug}`} className="hover:underline">
                  {c.title}
                </Link>
              </h3>
              <p className="mt-1 text-[0.95rem] text-muted-foreground">{citation(c)}</p>
              <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
                <StampStrip recYears={c.recYears} />
                <PieceActions
                  piece={{ id: c.id, slug: c.slug, title: c.title, publication: c.publication, year: c.year }}
                  className="-ml-1"
                />
              </div>
            </div>
            {c.image ? (
              <Link href={`/read/${c.slug}`} tabIndex={-1} aria-hidden className="hidden sm:block">
                <Thumb src={c.image} className="mt-1 aspect-[4/3] w-28 rounded-sm grayscale-[35%] transition group-hover:grayscale-0" />
              </Link>
            ) : null}
          </article>
        ))}
      </div>
      {error ? <p className="py-4 text-destructive">{error}</p> : null}
      <button
        type="button"
        disabled={busy}
        onClick={() => void more(cards)}
        className="mt-6 rounded-md border border-border px-4 py-2 text-[0.95rem] hover:bg-muted disabled:opacity-60"
      >
        {busy ? "Loading…" : "Show more"}
      </button>
    </div>
  );
}
