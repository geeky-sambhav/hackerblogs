import Link from "next/link";
import type { Piece } from "@/lib/types";

/** Bibliographic line: Author, Publication (italic), Year. */
export function Citation({ piece, linkNames = true }: { piece: Piece; linkNames?: boolean }) {
  const parts: React.ReactNode[] = [];
  if (piece.authors.length > 0) {
    parts.push(
      <span key="a">
        {piece.authors.map((a, i) => (
          <span key={a.slug}>
            {i > 0 ? (i === piece.authors.length - 1 ? " and " : ", ") : null}
            {linkNames ? (
              <Link href={`/authors/${a.slug}`} className="hover:underline">
                {a.name}
              </Link>
            ) : (
              a.name
            )}
          </span>
        ))}
      </span>,
    );
  }
  if (piece.publication) {
    parts.push(
      linkNames ? (
        <Link key="p" href={`/publications/${piece.publication.slug}`} className="italic hover:underline">
          {piece.publication.name}
        </Link>
      ) : (
        <i key="p">{piece.publication.name}</i>
      ),
    );
  }
  if (piece.publishedYear) parts.push(<span key="y">{piece.publishedYear}</span>);
  return (
    <span>
      {parts.map((p, i) => (
        <span key={i}>
          {i > 0 ? ", " : null}
          {p}
        </span>
      ))}
    </span>
  );
}
