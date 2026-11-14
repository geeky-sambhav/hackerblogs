import Link from "next/link";
import { Suspense } from "react";
import { PieceList } from "@/components/piece-entry";
import { decadesOf, parseListParams, runList, SORTS, toQuery, type ListParams, type Sort } from "@/lib/list";
import { plural } from "@/lib/labels";
import type { Area, Piece } from "@/lib/types";

type Props = {
  basePath: string;
  pieces: Piece[];
  searchParams: Promise<Record<string, string | string[] | undefined>>;
  areas?: Area[];
  hide?: ("area" | "decade")[];
  diversify?: boolean;
};

function Chip({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      scroll={false}
      aria-current={active ? "true" : undefined}
      className={
        active
          ? "rounded-full bg-accent px-3 py-0.5 text-accent-foreground"
          : "rounded-full px-3 py-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
      }
    >
      {children}
    </Link>
  );
}

function Filters({ basePath, p, pieces, areas, hide = [] }: { basePath: string; p: ListParams; pieces: Piece[]; areas?: Area[]; hide?: Props["hide"] }) {
  const href = (patch: Partial<ListParams>) => `${basePath}${toQuery({ ...p, page: 1, ...patch })}`;
  const decades = decadesOf(pieces);
  return (
    <div className="space-y-2 border-y border-border py-3 text-sm">
      <div className="flex flex-wrap items-center gap-1">
        <span className="mr-2 text-muted-foreground">Sort</span>
        {(Object.keys(SORTS) as Sort[]).map((s) => (
          <Chip key={s} href={href({ sort: s })} active={p.sort === s}>
            {SORTS[s]}
          </Chip>
        ))}
      </div>
      {!hide.includes("decade") && decades.length > 1 ? (
        <div className="flex flex-wrap items-center gap-1">
          <span className="mr-2 text-muted-foreground">Published</span>
          <Chip href={href({ decade: undefined })} active={p.decade === undefined}>
            Any time
          </Chip>
          {decades.map((d) => (
            <Chip key={d} href={href({ decade: d })} active={p.decade === d}>
              {`${d}s`}
            </Chip>
          ))}
        </div>
      ) : null}
      {!hide.includes("area") && areas && areas.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1">
          <span className="mr-2 text-muted-foreground">Area</span>
          <Chip href={href({ area: undefined })} active={!p.area}>
            All
          </Chip>
          {areas.map((a) => (
            <Chip key={a.slug} href={href({ area: a.slug })} active={p.area === a.slug}>
              {a.name}
            </Chip>
          ))}
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-1">
        <span className="mr-2 text-muted-foreground">Length</span>
        <Chip href={href({ length: undefined })} active={!p.length}>
          Any
        </Chip>
        <Chip href={href({ length: "short" })} active={p.length === "short"}>
          Under 3,000 words
        </Chip>
        <Chip href={href({ length: "medium" })} active={p.length === "medium"}>
          3,000–7,000
        </Chip>
        <Chip href={href({ length: "long" })} active={p.length === "long"}>
          Over 7,000
        </Chip>
        <span className="mr-2 ml-4 text-muted-foreground">Access</span>
        <Chip href={href({ paywall: undefined })} active={!p.paywall}>
          Any
        </Chip>
        <Chip href={href({ paywall: "free" })} active={p.paywall === "free"}>
          Free to read
        </Chip>
      </div>
    </div>
  );
}

async function Results({ basePath, pieces, searchParams, areas, hide, diversify }: Props) {
  const p = parseListParams(await searchParams);
  const { total, page, pages, items } = runList(pieces, p, { diversify });
  return (
    <>
      <Filters basePath={basePath} p={p} pieces={pieces} areas={areas} hide={hide} />
      <p className="mt-4 text-sm text-muted-foreground">{plural(total, "piece")}</p>
      <PieceList pieces={items} />
      {pages > 1 ? (
        <nav aria-label="Pages" className="mt-6 flex items-center gap-4 text-[0.95rem]">
          {page > 1 ? (
            <Link href={`${basePath}${toQuery({ ...p, page: page - 1 })}`} className="text-primary underline">
              Previous page
            </Link>
          ) : null}
          <span className="text-muted-foreground">
            Page {page} of {pages}
          </span>
          {page < pages ? (
            <Link href={`${basePath}${toQuery({ ...p, page: page + 1 })}`} className="text-primary underline">
              Next page
            </Link>
          ) : null}
        </nav>
      ) : null}
    </>
  );
}

/** Filterable, paginated list. Filters live in the URL, so every view is shareable. */
export function ListView(props: Props) {
  return (
    <Suspense fallback={<p className="py-8 text-muted-foreground">Sorting the shelf…</p>}>
      <Results {...props} />
    </Suspense>
  );
}
