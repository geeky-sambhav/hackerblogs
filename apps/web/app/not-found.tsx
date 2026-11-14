import Link from "next/link";

export default function NotFound() {
  return (
    <section className="pt-12">
      <h1 className="text-4xl font-medium">This page isn&apos;t on the shelves</h1>
      <p className="mt-4 text-muted-foreground">
        The link may be old, or the piece may have left the library when the list was rebuilt.{" "}
        <Link href="/search" className="text-primary underline">
          Search the library
        </Link>{" "}
        or{" "}
        <Link href="/" className="text-primary underline">
          go to the home page
        </Link>
        .
      </p>
    </section>
  );
}
