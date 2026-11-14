import Link from "next/link";
import { ThemeToggle } from "@/components/theme-toggle";

const NAV = [
  { href: "/areas", label: "Areas" },
  { href: "/collections", label: "Collections" },
  { href: "/years", label: "Decades" },
  { href: "/search", label: "Search" },
  { href: "/library", label: "Your library" },
];

export function SiteHeader() {
  return (
    <header className="mx-auto w-full max-w-3xl px-4 pt-6 pb-2 sm:px-6">
      <div className="flex items-baseline justify-between gap-4">
        <Link href="/" className="text-2xl font-semibold tracking-tight">
          HackerReads
        </Link>
        <ThemeToggle />
      </div>
      <nav aria-label="Main" className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-[0.95rem] text-muted-foreground">
        {NAV.map((n) => (
          <Link key={n.href} href={n.href} className="hover:text-foreground hover:underline">
            {n.label}
          </Link>
        ))}
        <Link href="/random" prefetch={false} className="hover:text-foreground hover:underline">
          Surprise me
        </Link>
      </nav>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="mx-auto mt-16 w-full max-w-3xl px-4 pb-10 text-sm text-muted-foreground sm:px-6">
      <p>
        Every piece links to its original publisher. Nothing is republished here.{" "}
        <Link href="/about" className="underline hover:text-foreground">
          How pieces are chosen, and data sources
        </Link>
        .
      </p>
    </footer>
  );
}
