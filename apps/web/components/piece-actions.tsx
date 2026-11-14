"use client";

import { Bookmark, ThumbsDown, ThumbsUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { has, remember, toggle, useReaderState, type SavedPiece } from "@/lib/storage";

type Props = { piece: Omit<SavedPiece, "at">; className?: string };

export function PieceActions({ piece, className }: Props) {
  const state = useReaderState();
  const buttons = [
    { list: "later" as const, on: has(state, "later", piece.id), Icon: Bookmark, label: ["Save for later", "Saved for later"] },
    { list: "liked" as const, on: has(state, "liked", piece.id), Icon: ThumbsUp, label: ["More like this", "Liked"] },
    { list: "disliked" as const, on: has(state, "disliked", piece.id), Icon: ThumbsDown, label: ["Fewer like this", "Shown less"] },
  ];
  return (
    <span className={cn("inline-flex items-center gap-1", className)}>
      {buttons.map(({ list, on, Icon, label }) => (
        <button
          key={list}
          type="button"
          aria-pressed={on}
          title={on ? label[1] : label[0]}
          aria-label={`${on ? label[1] : label[0]}: ${piece.title}`}
          onClick={() => toggle(list, piece)}
          className={cn(
            "inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
            on && "text-stamp hover:text-stamp",
          )}
        >
          <Icon className="size-4" fill={on ? "currentColor" : "none"} aria-hidden />
        </button>
      ))}
    </span>
  );
}

/** Records a visit in history when the reader follows the link out. */
export function ReadLink({ piece, href, children, className }: Props & { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      onClick={() => remember(piece)}
      className={className}
    >
      {children}
    </a>
  );
}
