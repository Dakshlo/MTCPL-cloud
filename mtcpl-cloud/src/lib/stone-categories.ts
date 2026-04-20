/**
 * Shared helpers for the sandstone / marble stone-category distinction.
 *
 * Sandstone = measured in CFT, planned via the Plan Generator.
 * Marble    = measured in tonnes at intake (bought by the truck),
 *             cut manually, slabs still come out in CFT+dimensions.
 *
 * Conversion rate comes from the owner: 95 kg of marble = 1 CFT.
 * Used whenever we need an "equivalent CFT" for a marble tonnage
 * (e.g. displaying "3 tonnes ≈ 31.58 CFT" on a block card).
 */

export const MARBLE_KG_PER_CFT = 95;

export type StoneCategory = "sandstone" | "marble";

/** Tonnes → CFT equivalent, using the fixed 95 kg/CFT marble density. */
export function cftEquivFromTonnes(tonnes: number): number {
  if (!Number.isFinite(tonnes) || tonnes <= 0) return 0;
  return (tonnes * 1000) / MARBLE_KG_PER_CFT;
}

/** CFT → tonnes, inverse of the above. */
export function tonnesFromCft(cft: number): number {
  if (!Number.isFinite(cft) || cft <= 0) return 0;
  return (cft * MARBLE_KG_PER_CFT) / 1000;
}

/** Given a stone-name → category map (built from stone_types rows),
 *  decide whether a given stone name is marble. Missing entries fall
 *  back to sandstone so the sandstone flow remains the default. */
export function isMarble(
  stoneName: string | null | undefined,
  categoryMap: Record<string, StoneCategory>,
): boolean {
  if (!stoneName) return false;
  return categoryMap[stoneName] === "marble";
}

/** Suggest the next block ID for a marble truck. Uses a stone-specific
 *  prefix so marble blocks don't collide with sandstone's MT-B- series.
 *  Examples: WhiteMarble → "WM-001", YellowMarble → "YM-001". */
export function marbleBlockPrefix(stone: string): string {
  // Initials of the stone name, uppercased, stripped of non-letters.
  // "WhiteMarble" → "WM", "YellowMarble" → "YM", "BlackMarble" → "BM".
  const initials = stone
    .split(/(?=[A-Z])/)
    .map((s) => s[0] ?? "")
    .filter((c) => /[A-Za-z]/.test(c))
    .join("")
    .toUpperCase();
  return `${initials || "M"}-`;
}

/** Generate next sequential ID for a given prefix from the set of
 *  existing block IDs. Mirrors generateNextCode() in blocks/utils.ts
 *  but lets the caller pick the prefix. */
export function nextBlockIdWithPrefix(existingIds: string[], prefix: string): string {
  const seqNums = existingIds
    .filter((id) => typeof id === "string" && id.startsWith(prefix))
    .map((id) => parseInt(id.slice(prefix.length), 10))
    .filter((n) => Number.isFinite(n));
  const next = seqNums.length ? Math.max(...seqNums) + 1 : 1;
  return `${prefix}${String(next).padStart(3, "0")}`;
}
