/**
 * A candidate is "viable" when it could still pass eligibility after its page is
 * fetched (see packages/shared/src/score.ts). Off known publications, only
 * viable candidates are fetched. Rising-lane pieces are approximated by a first
 * recommendation in 2023 or later (their publication year is not known yet).
 */
export const RISING_FIRST_REC = "2023-01-01";

export function isViable(x: { people: number; months: number; curators: number; firstRec: Date | null }): boolean {
  if (x.people >= 3 && x.months >= 3) return true;
  if (x.people >= 2 && x.months >= 2 && x.curators >= 2) return true;
  if (x.firstRec && x.firstRec >= new Date(RISING_FIRST_REC)) {
    return (x.people >= 2 && x.months >= 2) || (x.people >= 1 && x.curators >= 1);
  }
  return false;
}

/** Same rule in SQL over the pieces table (alias p). */
export const VIABLE_SQL = `(
  (p.people >= 3 AND p.months >= 3)
  OR (p.people >= 2 AND p.months >= 2 AND cardinality(p.editorial_sources) >= 2)
  OR (p.first_rec >= '${RISING_FIRST_REC}' AND ((p.people >= 2 AND p.months >= 2) OR (p.people >= 1 AND cardinality(p.editorial_sources) >= 1)))
)`;
