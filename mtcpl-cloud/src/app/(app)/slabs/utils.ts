/** Generate next slab code for a given prefix: PREFIX-0001, PREFIX-0002, … */
export function generateSlabCode(existingIds: string[], prefix: string): string {
  const pfx = `${prefix}-`;
  const nums = existingIds
    .filter(id => typeof id === "string" && id.startsWith(pfx))
    .map(id => parseInt(id.slice(pfx.length), 10))
    .filter(n => Number.isFinite(n));
  const next = nums.length ? Math.max(...nums) + 1 : 1;
  return `${pfx}${String(next).padStart(4, "0")}`;
}
