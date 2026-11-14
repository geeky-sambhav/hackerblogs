/**
 * Scope filters (deterministic): length, language, fiction/poetry, short
 * interviews, news. Returns an exclusion reason or null.
 */
import { isDeadStatus } from "./status";

export const MIN_WORDS = 800;
export const INTERVIEW_MIN_WORDS = 2500;

export type FilterInput = {
  url: string;
  title: string | null;
  section: string | null;
  tags: string[]; // page tags + curator labels, lowercase
  lang: string | null;
  wordCount: number | null;
  /** Known publication (config): trusted to be long-form when length is unknown. */
  knownPublication: boolean;
  httpStatus: number | null;
  waybackUrl: string | null;
  /** Distinct years in which people recommended the piece. */
  recommendedYears: number;
};

/**
 * A piece people keep recommending across this many different years is not timely, whatever
 * its section says (Esquire files "The Falling Man" under News & Politics).
 */
export const DURABLE_YEARS = 5;

const FICTION_TOKENS = new Set(["fiction", "short story", "short stories", "poem", "poems", "poetry", "verse", "flash fiction"]);
const FICTION_PATH = /\/(fiction|poems?|poetry|short-stor(y|ies))(\/|$)/i;
const INTERVIEW = /\b(interview|interviews|q\s?&\s?a|in conversation)\b/i;
const NEWS_SECTIONS = new Set(["news", "world news", "us news", "uk news", "breaking news", "live", "live news", "latest news"]);
const NEWS_PATH = /\/(live|liveblog|live-news|live-updates|breaking)(\/|-|$)/i;
const LONG_READ_TAG = /\b(long ?reads?|the long read)\b/i;

function pathOf(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return "";
  }
}

export function exclusionReason(x: FilterInput): string | null {
  if (isDeadStatus(x.httpStatus) && !x.waybackUrl) return "dead-link";
  if (x.lang && !/^en\b|^en-/.test(x.lang) && x.lang !== "en") return "not-english";

  const section = (x.section ?? "").trim().toLowerCase();
  const tags = x.tags.map((t) => t.trim().toLowerCase());
  const path = pathOf(x.url);

  if (FICTION_TOKENS.has(section) || tags.some((t) => FICTION_TOKENS.has(t)) || FICTION_PATH.test(path)) return "fiction-or-poetry";

  if (x.wordCount !== null && x.wordCount < MIN_WORDS) return "too-short";
  if (x.wordCount === null && !x.knownPublication) return "unknown-length";

  const isInterview = INTERVIEW.test(x.title ?? "") || tags.some((t) => /^(interviews?|q&a|q & a)$/.test(t)) || /^interviews?$/.test(section);
  if (isInterview && x.wordCount !== null && x.wordCount < INTERVIEW_MIN_WORDS) return "short-interview";

  const longRead = tags.some((t) => LONG_READ_TAG.test(t)) || LONG_READ_TAG.test(section);
  const durable = x.recommendedYears >= DURABLE_YEARS;
  if (!longRead && !durable && (NEWS_SECTIONS.has(section) || NEWS_PATH.test(path))) return "news";
  return null;
}
