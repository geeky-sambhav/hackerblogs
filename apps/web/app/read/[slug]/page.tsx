import { Suspense } from "react";
import { PageSkeleton } from "@/components/skeleton";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Citation } from "@/components/citation";
import { PieceActions, ReadLink } from "@/components/piece-actions";
import { PieceList, snapshot } from "@/components/piece-entry";
import { StampStrip } from "@/components/stamp-strip";
import { Thumb } from "@/components/thumb";
import { getAreas, getCatalog, getPieceBySlug, getRelated, piecesByIds } from "@/lib/catalog";
import { awardLabel, editorialLabel, lengthLabel, paywallLabel, plural, sourceLabel } from "@/lib/labels";

export async function generateStaticParams() {
  const { pieces } = await getCatalog();
  // Cache Components needs at least one param; the placeholder 404s.
  return pieces.length ? pieces.map((p) => ({ slug: p.slug })) : [{ slug: "__none__" }];
}

export async function generateMetadata({ params }: PageProps<"/read/[slug]">): Promise<Metadata> {
  const piece = await getPieceBySlug((await params).slug);
  if (!piece) return {};
  return {
    title: piece.title,
    description: piece.dek ?? `${piece.title}${piece.publication ? `, from ${piece.publication.name}` : ""}.`,
  };
}

async function ReadPageContent({ params }: PageProps<"/read/[slug]">) {
  const { slug } = await params;
  const piece = await getPieceBySlug(slug);
  if (!piece) notFound();
  const areas = await getAreas();
  const related = await getRelated(piece.id);
  const [corec, sameAuthor, topic] = await Promise.all([
    piecesByIds(related.corec.slice(0, 5)),
    piecesByIds(related.author.slice(0, 3)),
    piecesByIds(related.topic.slice(0, 5)),
  ]);
  const areaNames = new Map(areas.map((a) => [a.slug, a.name]));
  const dead = !!piece.waybackUrl;
  const href = piece.waybackUrl ?? piece.url;
  const host = (() => {
    try {
      return new URL(piece.url).hostname.replace(/^www\./, "");
    } catch {
      return piece.url;
    }
  })();
  const paywall = paywallLabel(piece.publication?.paywall);
  const length = lengthLabel(piece.lengthBucket);

  return (
    <article className="pt-8">
      <header>
        <h1 className="text-4xl leading-[1.1] font-medium tracking-tight text-balance sm:text-5xl">{piece.title}</h1>
        <p className="mt-3 text-lg text-muted-foreground">
          <Citation piece={piece} />
        </p>
        {piece.dek ? <p className="mt-4 max-w-[62ch] text-lg leading-relaxed">{piece.dek}</p> : null}
        {piece.image ? (
          <Thumb src={piece.image} className="mt-6 aspect-[16/9] w-full max-w-xl rounded-md" />
        ) : null}
        <div className="mt-6 flex flex-wrap items-center gap-4">
          <ReadLink
            piece={snapshot(piece)}
            href={href}
            className="inline-flex items-center rounded-md bg-primary px-5 py-2.5 text-primary-foreground hover:bg-primary/90"
          >
            {dead ? "Read the archived copy" : `Read at ${piece.publication?.name ?? host}`}
          </ReadLink>
          <PieceActions piece={snapshot(piece)} />
        </div>
        <p className="mt-3 text-sm text-muted-foreground">
          {[dead ? "The original page is gone; this links to the Internet Archive." : host, paywall, length]
            .filter(Boolean)
            .join(". ")}
          .
        </p>
      </header>

      <section aria-labelledby="evidence" className="mt-10 rounded-lg border border-border bg-card p-5 sm:p-6">
        <h2 id="evidence" className="text-xl font-medium">
          Why it is here
        </h2>
        <p className="mt-2 text-[0.95rem] text-muted-foreground">
          Recommended by {plural(piece.people, "reader")} on {piece.communitySources.map(sourceLabel).join(" and ") || "the web"} in{" "}
          {plural(piece.years, "different year")}
          {piece.firstRecYear && piece.lastRecYear && piece.firstRecYear !== piece.lastRecYear
            ? `, from ${piece.firstRecYear} to ${piece.lastRecYear}`
            : ""}
          .
        </p>
        <StampStrip recYears={piece.recYears} size="lg" className="mt-5" />
        {piece.editorial.length > 0 || piece.awards.length > 0 ? (
          <ul className="mt-5 space-y-1 text-[0.95rem]">
            {piece.editorial.map((e) => (
              <li key={e}>Picked by {editorialLabel(e)}</li>
            ))}
            {piece.awards.map((a, i) => (
              <li key={i} className="text-stamp">
                {awardLabel(a)}
              </li>
            ))}
          </ul>
        ) : null}
        {piece.areas.length > 0 ? (
          <p className="mt-5 text-[0.95rem]">
            Filed under{" "}
            {piece.areas.map((a, i) => (
              <span key={a}>
                {i > 0 ? ", " : null}
                <Link href={`/areas/${a}`} className="text-primary underline">
                  {areaNames.get(a) ?? a}
                </Link>
              </span>
            ))}
            .
          </p>
        ) : null}
      </section>

      {corec.length > 0 ? (
        <section className="mt-12">
          <h2 className="text-2xl font-medium">Readers who recommended this also recommended</h2>
          <PieceList pieces={corec} />
        </section>
      ) : null}
      {sameAuthor.length > 0 ? (
        <section className="mt-12">
          <h2 className="text-2xl font-medium">More by {piece.authors.map((a) => a.name).join(" and ")}</h2>
          <PieceList pieces={sameAuthor} />
        </section>
      ) : null}
      {topic.length > 0 ? (
        <section className="mt-12">
          <h2 className="text-2xl font-medium">More like this</h2>
          <PieceList pieces={topic} />
        </section>
      ) : null}
    </article>
  );
}

export default function ReadPage(props: PageProps<"/read/[slug]">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <ReadPageContent {...props} />
    </Suspense>
  );
}
