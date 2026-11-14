import Link from "next/link";
import { Citation } from "@/components/citation";
import { PieceActions } from "@/components/piece-actions";
import { StampStrip } from "@/components/stamp-strip";
import { Thumb } from "@/components/thumb";
import { plural } from "@/lib/labels";
import type { Piece } from "@/lib/types";

type Props = { piece: Piece; reason?: string; showImage?: boolean };

export function snapshot(piece: Piece) {
  return {
    id: piece.id,
    slug: piece.slug,
    title: piece.title,
    publication: piece.publication?.name ?? null,
    year: piece.publishedYear,
  };
}

/** One bibliography entry. */
export function PieceEntry({ piece, reason, showImage = true }: Props) {
  return (
    <article className="group grid grid-cols-[1fr_auto] gap-x-5 py-5">
      <div className="min-w-0">
        {reason ? <p className="mb-1 text-sm text-muted-foreground">{reason}</p> : null}
        <h3 className="text-xl leading-snug font-medium text-balance">
          <Link href={`/read/${piece.slug}`} className="hover:underline">
            {piece.title}
          </Link>
        </h3>
        <p className="mt-1 text-[0.95rem] text-muted-foreground">
          <Citation piece={piece} />
        </p>
        {piece.dek ? <p className="mt-2 line-clamp-2 text-[0.95rem] leading-relaxed">{piece.dek}</p> : null}
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
          <StampStrip recYears={piece.recYears} />
          <span>
            {plural(piece.people, "reader")}, {plural(piece.years, "year")}
          </span>
          {piece.awards.length > 0 ? <span className="text-stamp">Prize honoree</span> : null}
          <PieceActions piece={snapshot(piece)} className="-ml-1 opacity-80 group-hover:opacity-100" />
        </div>
      </div>
      {showImage && piece.image ? (
        <Link href={`/read/${piece.slug}`} tabIndex={-1} aria-hidden className="hidden sm:block">
          <Thumb
            src={piece.image}
            className="mt-1 aspect-[4/3] w-28 rounded-sm grayscale-[35%] transition group-hover:grayscale-0"
          />
        </Link>
      ) : null}
    </article>
  );
}

export function PieceList({ pieces, reasons }: { pieces: Piece[]; reasons?: Map<number, string> }) {
  if (pieces.length === 0) return <p className="py-8 text-muted-foreground">Nothing here yet.</p>;
  return (
    <div className="divide-y divide-border/70">
      {pieces.map((p) => (
        <PieceEntry key={p.id} piece={p} reason={reasons?.get(p.id)} />
      ))}
    </div>
  );
}
