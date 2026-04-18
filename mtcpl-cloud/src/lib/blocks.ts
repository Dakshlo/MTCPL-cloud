/**
 * Block display helpers.
 *
 * "Fresh" vs "Used" — both mean `status === 'available'` (can be cut right
 * now), but the category tells us where the block came from:
 *
 *   - category='Fresh'  → brand-new block added to inventory    → "Fresh"
 *   - category='Reused' → re-stocked remainder from a prior cut → "Used"
 *
 * Functionally identical for planning/cutting, but worth distinguishing in
 * reports so you can tell raw new arrivals from recycled offcuts.
 */

/** Display label for the block's status pill, taking category into account. */
export function blockStatusLabel(status: string, category?: string | null): string {
  if (status === "available") {
    return category === "Reused" ? "Used" : "Fresh";
  }
  const map: Record<string, string> = {
    reserved: "in-progress",
    consumed: "consumed",
    discarded: "deleted",
  };
  return map[status] ?? status;
}

/** Class for the status pill. Fresh + Used both use the green "available" badge
 *  (both are available to cut); cutter tells them apart by the text + ↻ icon. */
export function blockStatusBadge(status: string, category?: string | null): string {
  if (status === "available") {
    // Both available states render green; the label differentiates.
    return "badge-available";
  }
  const map: Record<string, string> = {
    reserved: "badge-reserved",
    consumed: "badge-consumed",
    discarded: "badge-discarded",
  };
  return map[status] ?? "";
}

/** True when this block is a re-stocked remainder (category 'Reused'). */
export function isReusedBlock(category?: string | null): boolean {
  return category === "Reused";
}
