export type Paywall = "free" | "metered" | "paywalled" | "unknown";

export type PublicationRef = {
  slug: string;
  name: string;
  paywall: Paywall;
  kind: "publisher" | "independent";
};

export type AuthorRef = { slug: string; name: string };

export type AwardRef = { award: string; category: string | null; year: number; result: string };

export type Piece = {
  id: number;
  slug: string;
  title: string;
  url: string;
  waybackUrl: string | null;
  dek: string | null;
  image: string | null;
  authors: AuthorRef[];
  publication: PublicationRef | null;
  publishedAt: string | null; // YYYY-MM-DD
  publishedYear: number | null;
  lengthBucket: "short" | "medium" | "long" | null;
  areas: string[]; // area slugs, strongest first
  lane: "classic" | "rising";
  gem: boolean;
  score: number;
  rank: number;
  people: number;
  years: number;
  recYears: number[];
  firstRecYear: number | null;
  lastRecYear: number | null;
  communitySources: string[];
  editorial: string[];
  awards: AwardRef[];
};

export type Area = { slug: string; name: string; description: string; count: number };

export type Collection = { slug: string; title: string; description: string; pieceIds: number[] };

export type Catalog = {
  pieces: Piece[];
  areas: Area[];
  publications: (PublicationRef & { count: number })[];
  authors: (AuthorRef & { count: number })[];
  collections: Collection[];
};

/** Compact card sent to the browser by the feed API. */
export type FeedCard = {
  id: number;
  slug: string;
  title: string;
  authors: string[];
  publication: string | null;
  year: number | null;
  image: string | null;
  recYears: number[];
  people: number;
  reason: string;
};
