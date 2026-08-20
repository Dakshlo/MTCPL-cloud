/**
 * Shared slab dimension → area / volume helpers.
 *
 * IMPORTANT UNITS NOTE: the slab_requirements columns are *named*
 * length_ft / width_ft / thickness_ft but they actually store INCHES
 * (the add form maps the `length_in` input straight into `length_ft`;
 * the UI renders them with a ″ suffix; every CFT calc in the app divides
 * by 1728). So:
 *   - CFT (cubic feet) = (l × w × t) / 1728   (in³ → ft³)
 *   - SFT (square feet) = face area / 144      (in² → ft²)
 * Do NOT "simplify" by dropping the divisor — that would make jobwork
 * amounts 1728× / 144× too big.
 *
 * WHICH DIMENSION IS THE THICKNESS (Daksh, Aug 2026). The three columns are
 * ENTRY order, not physical roles: whoever types the slab may put the 3″
 * thickness in the middle (38×3×22 for a jali). 21.6% of the slabs on record
 * — 3,303 of 15,289 — do not carry their thickness in the thickness column.
 *
 * So the thickness is taken as the SMALLEST of the three, and the face as the
 * product of the two LARGEST. This is the same rule invoicing already applies
 * (dispatch-grouping.sftOf, Jul 2026), now shared so the two can't drift.
 *
 * CFT is unaffected — l × w × t is the same product whatever order it is in.
 * SFT was not: (l × w) on a 38×3×22 slab gave 0.79 sft instead of the real
 * face of 5.81, and the thin/thick test read the wrong number too.
 */

export function cftFromSlab(
  lengthIn: number | string | null | undefined,
  widthIn: number | string | null | undefined,
  thicknessIn: number | string | null | undefined,
): number {
  return (
    ((Number(lengthIn) || 0) * (Number(widthIn) || 0) * (Number(thicknessIn) || 0)) /
    1728
  );
}

const n = (v: number | string | null | undefined) => Number(v) || 0;

/** The slab's real thickness — the SMALLEST of the three dims, whichever
 *  column it happens to sit in. */
export function thicknessOf(
  lengthIn: number | string | null | undefined,
  widthIn: number | string | null | undefined,
  thicknessIn: number | string | null | undefined,
): number {
  return Math.min(n(lengthIn), n(widthIn), n(thicknessIn));
}

/** Is this slab measured as area rather than volume? Thin (≤ 12″ / 1 ft) →
 *  SFT, thicker → CFT. Tested on the REAL thickness, so a slab entered as
 *  38×3×22 is thin (3″) rather than thick (22″). */
export function isThinSlab(
  lengthIn: number | string | null | undefined,
  widthIn: number | string | null | undefined,
  thicknessIn: number | string | null | undefined,
  thresholdIn = 12,
): boolean {
  return thicknessOf(lengthIn, widthIn, thicknessIn) <= thresholdIn;
}

/** Face area in square feet — the two LARGEST dims. */
export function faceSftFromSlab(
  lengthIn: number | string | null | undefined,
  widthIn: number | string | null | undefined,
  thicknessIn: number | string | null | undefined,
): number {
  const l = n(lengthIn), w = n(widthIn), t = n(thicknessIn);
  const smallest = Math.min(l, w, t);
  if (smallest <= 0) return 0; // degenerate / missing dim — no face to measure
  return (l * w * t) / smallest / 144;
}

/** @deprecated Blind to the thickness, so it multiplies by it whenever the
 *  dims were entered out of order. Use faceSftFromSlab(l, w, t). */
export function sftFromSlab(
  lengthIn: number | string | null | undefined,
  widthIn: number | string | null | undefined,
): number {
  return (n(lengthIn) * n(widthIn)) / 144;
}

/** Quantity in the chosen jobwork unit (cft = volume, sft = face area). */
export function jobworkQuantity(
  unit: "cft" | "sft",
  lengthIn: number | string | null | undefined,
  widthIn: number | string | null | undefined,
  thicknessIn: number | string | null | undefined,
): number {
  return unit === "sft"
    ? faceSftFromSlab(lengthIn, widthIn, thicknessIn)
    : cftFromSlab(lengthIn, widthIn, thicknessIn);
}
