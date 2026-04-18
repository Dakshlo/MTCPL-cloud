/**
 * Single source of truth for yard numbers and display labels.
 *
 * The DB has a CHECK constraint (blocks_yard_check) that must be kept in
 * sync with ALLOWED_YARDS. If you add or remove a yard here, also run:
 *
 *   ALTER TABLE public.blocks DROP CONSTRAINT blocks_yard_check;
 *   ALTER TABLE public.blocks
 *     ADD CONSTRAINT blocks_yard_check CHECK (yard IN (1,2,3,4,5,6,7,8,9));
 *
 * (updating the yard list in the CHECK to match).
 */

export const ALLOWED_YARDS = [1, 2, 3, 4, 5, 6, 7, 8, 9] as const;
export type YardNum = (typeof ALLOWED_YARDS)[number];

/** Full human-readable label — e.g. "Yard 7 (RIICO)". Use on cards, dropdowns, cutting views. */
export function yardLabel(y: number | string | null | undefined): string {
  const n = Number(y);
  if (!Number.isFinite(n)) return "—";
  if (n === 7) return "Yard 7 (RIICO)";
  if (n === 8) return "Yard 8 (RIICO)";
  if (n === 9) return "Yard 9 (Open Yard)";
  return `Yard ${n}`;
}

/** Compact badge label — e.g. "Y7 RIICO". Use on role-pills where space is tight. */
export function yardShortLabel(y: number | string | null | undefined): string {
  const n = Number(y);
  if (!Number.isFinite(n)) return "—";
  if (n === 7) return "Y7 RIICO";
  if (n === 8) return "Y8 RIICO";
  if (n === 9) return "Y9 Open";
  return `Y${n}`;
}

/** Guard: is this number a yard we allow? */
export function isAllowedYard(y: unknown): boolean {
  const n = Number(y);
  return (ALLOWED_YARDS as readonly number[]).includes(n);
}
