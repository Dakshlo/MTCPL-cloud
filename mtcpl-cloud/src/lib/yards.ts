/**
 * Single source of truth for yard numbers, facility grouping, and display
 * labels.
 *
 * The DB has a CHECK constraint (blocks_yard_check) that must be kept in
 * sync with ALLOWED_YARDS. If you add or remove a yard here, also run:
 *
 *   ALTER TABLE public.blocks DROP CONSTRAINT blocks_yard_check;
 *   ALTER TABLE public.blocks
 *     ADD CONSTRAINT blocks_yard_check CHECK (yard IN (1,2,3,4,5,6,7,8,9));
 *
 * (update the yard list in the CHECK to match).
 *
 * Facility is a UI-only concept — the DB still stores just `yard: int`.
 * A block's facility is always derived from its yard number via
 * facilityOfYard(). Two facilities today:
 *
 *   - MTCPL  : Yards 1–6, plus Open Yard (= yard 9)
 *   - RIICO  : Yards 7, 8
 *
 * Cut plans must never mix the two — they're different physical sites.
 */

export const ALLOWED_YARDS = [1, 2, 3, 4, 5, 6, 7, 8, 9] as const;
export type YardNum = (typeof ALLOWED_YARDS)[number];

export type Facility = "mtcpl" | "riico";
export const FACILITIES: readonly Facility[] = ["mtcpl", "riico"] as const;

/** Yards belonging to each facility. Source of truth for all filters. */
export const YARDS_BY_FACILITY: Record<Facility, readonly number[]> = {
  mtcpl: [1, 2, 3, 4, 5, 6, 9],
  riico: [7, 8],
};

/** Derive a block's facility from its yard number. Unknown yards fall back to MTCPL. */
export function facilityOfYard(y: number | string | null | undefined): Facility {
  const n = Number(y);
  if (n === 7 || n === 8) return "riico";
  return "mtcpl";
}

/** Human-readable facility label for buttons / headers. */
export function facilityLabel(f: Facility): string {
  return f === "riico" ? "RIICO" : "MTCPL";
}

/** Full human-readable label — e.g. "Yard 7 (RIICO)", "Open Yard". Use on cards, dropdowns, cutting views. */
export function yardLabel(y: number | string | null | undefined): string {
  const n = Number(y);
  if (!Number.isFinite(n)) return "—";
  if (n === 7) return "Yard 7 (RIICO)";
  if (n === 8) return "Yard 8 (RIICO)";
  if (n === 9) return "Open Yard";
  return `Yard ${n}`;
}

/** Compact badge label — e.g. "Y7 RIICO", "Open Yard". Use on role-pills where space is tight. */
export function yardShortLabel(y: number | string | null | undefined): string {
  const n = Number(y);
  if (!Number.isFinite(n)) return "—";
  if (n === 7) return "Y7 RIICO";
  if (n === 8) return "Y8 RIICO";
  if (n === 9) return "Open Yard";
  return `Y${n}`;
}

/** Guard: is this number a yard we allow? */
export function isAllowedYard(y: unknown): boolean {
  const n = Number(y);
  return (ALLOWED_YARDS as readonly number[]).includes(n);
}
