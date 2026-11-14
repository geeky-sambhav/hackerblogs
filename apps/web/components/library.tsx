"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { clearList, exportState, importState, toggle, useReaderState, type ListName } from "@/lib/storage";
import { cn } from "@/lib/utils";

const TABS: { list: ListName; label: string; empty: string }[] = [
  { list: "later", label: "Reading list", empty: "Nothing saved yet. Use the bookmark button on any piece." },
  { list: "liked", label: "Liked", empty: "Pieces you like shape your home page. Use the thumbs-up button." },
  { list: "history", label: "History", empty: "Pieces you open appear here, and stop showing up on your home page." },
  { list: "disliked", label: "Shown less", empty: "Pieces you mark with thumbs-down are hidden from your home page." },
];

export function Library() {
  const state = useReaderState();
  const [tab, setTab] = useState<ListName>("later");
  const [message, setMessage] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const current = TABS.find((t) => t.list === tab) ?? TABS[0];
  const items = state[tab];

  return (
    <div>
      <div role="tablist" aria-label="Library lists" className="flex flex-wrap gap-1 border-b border-border">
        {TABS.map((t) => (
          <button
            key={t.list}
            role="tab"
            type="button"
            aria-selected={tab === t.list}
            onClick={() => setTab(t.list)}
            className={cn(
              "-mb-px border-b-2 px-3 py-2 text-[0.95rem]",
              tab === t.list ? "border-stamp text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {t.label} <span className="text-sm text-muted-foreground">{state[t.list].length}</span>
          </button>
        ))}
      </div>
      <div role="tabpanel" className="py-2">
        {items.length === 0 ? (
          <p className="py-6 text-muted-foreground">{current?.empty}</p>
        ) : (
          <ul className="divide-y divide-border/70">
            {items.map((p) => (
              <li key={p.id} className="flex items-baseline justify-between gap-4 py-3">
                <span>
                  <Link href={`/read/${p.slug}`} className="text-lg hover:underline">
                    {p.title}
                  </Link>
                  <span className="text-[0.95rem] text-muted-foreground">
                    {p.publication ? (
                      <>
                        , <i>{p.publication}</i>
                      </>
                    ) : null}
                    {p.year ? `, ${p.year}` : ""}
                  </span>
                </span>
                {tab !== "history" ? (
                  <button type="button" onClick={() => toggle(tab, p)} className="shrink-0 text-sm text-muted-foreground underline hover:text-foreground">
                    Remove
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        {items.length > 0 ? (
          <button
            type="button"
            onClick={() => {
              if (window.confirm(`Clear all ${items.length} pieces from ${current?.label}?`)) clearList(tab);
            }}
            className="mt-4 text-sm text-muted-foreground underline hover:text-foreground"
          >
            Clear {current?.label.toLowerCase()}
          </button>
        ) : null}
      </div>

      <section className="mt-12 border-t border-border pt-6">
        <h2 className="text-xl font-medium">Move your library</h2>
        <div className="mt-3 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => {
              const blob = new Blob([exportState()], { type: "application/json" });
              const a = document.createElement("a");
              a.href = URL.createObjectURL(blob);
              a.download = `hackerreads-library-${new Date().toISOString().slice(0, 10)}.json`;
              a.click();
              URL.revokeObjectURL(a.href);
              setMessage("Exported your library.");
            }}
            className="rounded-md border border-border px-4 py-2 hover:bg-muted"
          >
            Export library
          </button>
          <button type="button" onClick={() => fileRef.current?.click()} className="rounded-md border border-border px-4 py-2 hover:bg-muted">
            Import library
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              try {
                const added = importState(await file.text());
                setMessage(`Imported ${added} ${added === 1 ? "piece" : "pieces"}.`);
              } catch {
                setMessage("That file is not a HackerReads library export.");
              } finally {
                e.target.value = "";
              }
            }}
          />
        </div>
        {message ? (
          <p role="status" className="mt-3 text-sm text-muted-foreground">
            {message}
          </p>
        ) : null}
      </section>
    </div>
  );
}
