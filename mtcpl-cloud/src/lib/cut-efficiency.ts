/**
 * Compute slab yield / restockable / waste split for a block's cut layout.
 *
 * Rule (from business): the largest remainder piece that can be restocked as a
 * reusable block is NOT waste — only the scraps + kerf that can't be kept count
 * as true waste. Example: 100-unit block → 60 units slabs + 20 units restocked
 * = 80 units recovered, 20 units actual waste.
 */

export type CutEfficiency = {
  /** Total block volume (cubic inches). */
  blockVol: number;
  /** Sum of slab volumes (sw * sh * sd) in cubic inches. */
  slabVol: number;
  /** Volume of the largest projected remainder (restockable), cubic inches. */
  restockVol: number;
  /** Actual waste = block - slabs - restockable (kerf + small scraps). */
  wasteVol: number;
  /** Slab yield as % of block volume (0-100). */
  slabPct: number;
  /** Restockable piece as % of block volume (0-100). */
  restockPct: number;
  /** True waste as % of block volume (0-100). */
  wastePct: number;
};

type BlockDims = { l: number | string; w: number | string; h: number | string };
type PlacedLike = { sw?: number | string; sh?: number | string; sd?: number | string };
type RemainderDims = { l: number | string; w: number | string; h: number | string };

function num(value: number | string | null | undefined): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Compute efficiency breakdown for a single block's cut layout.
 * Returns null when block dimensions are missing or zero.
 */
export function computeCutEfficiency(
  block: BlockDims | null | undefined,
  placed: PlacedLike[] = [],
  biggest: RemainderDims | null | undefined = null,
): CutEfficiency | null {
  if (!block) return null;
  const blockVol = num(block.l) * num(block.w) * num(block.h);
  if (blockVol <= 0) return null;

  const slabVol = placed.reduce(
    (sum, s) => sum + num(s.sw) * num(s.sh) * num(s.sd),
    0,
  );
  const restockVol = biggest ? num(biggest.l) * num(biggest.w) * num(biggest.h) : 0;
  const wasteVol = Math.max(0, blockVol - slabVol - restockVol);

  // Clamp percentages so floating-point drift doesn't show 101% etc.
  const slabPct = Math.min(100, Math.max(0, Math.round((slabVol / blockVol) * 100)));
  const restockPct = Math.min(100, Math.max(0, Math.round((restockVol / blockVol) * 100)));
  const wastePct = Math.min(100, Math.max(0, 100 - slabPct - restockPct));

  return { blockVol, slabVol, restockVol, wasteVol, slabPct, restockPct, wastePct };
}

/** Convert cubic inches to cubic feet. */
export function toCFT(cubicInches: number): number {
  return cubicInches / 1728;
}
