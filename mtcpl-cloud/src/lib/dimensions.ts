/**
 * Shared slab dimension → area / volume helpers.
 *
 * IMPORTANT UNITS NOTE: the slab_requirements columns are *named*
 * length_ft / width_ft / thickness_ft but they actually store INCHES
 * (the add form maps the `length_in` input straight into `length_ft`;
 * the UI renders them with a ″ suffix; every CFT calc in the app divides
 * by 1728). So:
 *   - CFT (cubic feet) = (l × w × t) / 1728   (in³ → ft³)
 *   - SFT (square feet) = (l × w) / 144        (in² → ft²)
 * Do NOT "simplify" by dropping the divisor — that would make jobwork
 * amounts 1728× / 144× too big.
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

export function sftFromSlab(
  lengthIn: number | string | null | undefined,
  widthIn: number | string | null | undefined,
): number {
  return ((Number(lengthIn) || 0) * (Number(widthIn) || 0)) / 144;
}

/** Quantity in the chosen jobwork unit (cft = volume, sft = top face area). */
export function jobworkQuantity(
  unit: "cft" | "sft",
  lengthIn: number | string | null | undefined,
  widthIn: number | string | null | undefined,
  thicknessIn: number | string | null | undefined,
): number {
  return unit === "sft"
    ? sftFromSlab(lengthIn, widthIn)
    : cftFromSlab(lengthIn, widthIn, thicknessIn);
}
