import { cn } from "@/lib/utils";
import { FIRST_YEAR, LAST_YEAR } from "@/lib/labels";

type Props = { recYears: number[]; size?: "sm" | "lg"; className?: string };

/**
 * The library-card date stamps: one square per year, inked when readers
 * recommended the piece that year.
 */
export function StampStrip({ recYears, size = "sm", className }: Props) {
  const inked = new Set(recYears);
  const years = Array.from({ length: LAST_YEAR - FIRST_YEAR + 1 }, (_, i) => FIRST_YEAR + i);
  const label =
    recYears.length > 0
      ? `Recommended in ${recYears.length} ${recYears.length === 1 ? "year" : "different years"}: ${recYears.join(", ")}`
      : "No recommendations recorded";

  if (size === "sm") {
    return (
      <span role="img" aria-label={label} title={label} className={cn("inline-flex items-center gap-[2px] align-middle", className)}>
        {years.map((y) => (
          <span key={y} className={cn("block size-[7px] rounded-[1px]", inked.has(y) ? "bg-stamp" : "bg-stamp-empty")} />
        ))}
      </span>
    );
  }

  return (
    <figure className={cn("m-0", className)}>
      <div role="img" aria-label={label} className="grid grid-cols-7 gap-1.5 sm:grid-cols-[repeat(21,minmax(0,1fr))]">
        {years.map((y) => (
          <div key={y} className="flex flex-col items-center gap-1">
            <span
              className={cn(
                "flex aspect-square w-full items-center justify-center rounded-[3px] text-[0.6rem] leading-none tabular-nums",
                inked.has(y)
                  ? "bg-stamp text-background -rotate-3"
                  : "border border-dashed border-border text-transparent",
              )}
            >
              {inked.has(y) ? `’${String(y).slice(2)}` : ""}
            </span>
            <span className="text-[0.65rem] tabular-nums text-muted-foreground sm:hidden md:block">{y % 5 === 0 ? y : " "}</span>
          </div>
        ))}
      </div>
    </figure>
  );
}
