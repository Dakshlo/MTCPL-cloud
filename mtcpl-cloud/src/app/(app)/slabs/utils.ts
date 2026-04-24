/**
 * Generate next slab code for a given prefix: PREFIX-0001, PREFIX-0002, …
 * Accepts an array of existing IDs (legacy API — computes MAX on the
 * client) OR a single highest-known ID (preferred — computed server-side
 * by ordering the DB query and taking LIMIT 1, which sidesteps the
 * PostgREST db-max-rows cap).
 */
export function generateSlabCode(existingIds: string[], prefix: string): string {
  const pfx = `${prefix}-`;
  const nums = existingIds
    .filter(id => typeof id === "string" && id.startsWith(pfx))
    .map(id => parseInt(id.slice(pfx.length), 10))
    .filter(n => Number.isFinite(n));
  const next = nums.length ? Math.max(...nums) + 1 : 1;
  return `${pfx}${String(next).padStart(4, "0")}`;
}

/**
 * Build the next slab code given the single highest existing ID for a
 * prefix (as returned by a server-side `ORDER BY id DESC LIMIT 1` query).
 * Works regardless of how many rows exist for the prefix — no 1000-row
 * truncation risk. Pass null/undefined if no rows exist yet.
 */
export function nextSlabCodeFromMaxId(maxId: string | null | undefined, prefix: string): string {
  const pfx = `${prefix}-`;
  if (!maxId || !maxId.startsWith(pfx)) {
    return `${pfx}${String(1).padStart(4, "0")}`;
  }
  // parseInt on "0010-9" returns 10 (stops at the hyphen), which is
  // exactly the behaviour we want — batch children share the base
  // number and we just add one to it.
  const n = parseInt(maxId.slice(pfx.length), 10);
  const next = Number.isFinite(n) ? n + 1 : 1;
  return `${pfx}${String(next).padStart(4, "0")}`;
}
