/** URL-safe slug: lowercase ASCII words joined by "-". */
export function slugify(input: string, maxLength = 80): string {
  const s = input
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (s.length <= maxLength) return s;
  const cut = s.slice(0, maxLength);
  const lastDash = cut.lastIndexOf("-");
  return (lastDash > 20 ? cut.slice(0, lastDash) : cut).replace(/-+$/g, "");
}

/** Slug for a piece: title slug plus its id, so slugs are unique and stable. */
export function pieceSlug(title: string, id: number): string {
  const base = slugify(title, 70);
  return base ? `${base}-${id}` : String(id);
}

/** Inverse of pieceSlug: the trailing numeric id, or null. */
export function idFromPieceSlug(slug: string): number | null {
  const m = /(?:^|-)(\d+)$/.exec(slug);
  if (!m?.[1]) return null;
  const n = Number(m[1]);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}
