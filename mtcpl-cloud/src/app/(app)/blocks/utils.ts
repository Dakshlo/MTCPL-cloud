/** Generate the next MT-B-XXX code from existing IDs.
 *  Robust to case ("mt-b-881"), leading zeros ("MT-B-0881") and any leftover/
 *  suffix ("MT-B-881-R" → 881); uses a reduce (no Math.max spread on a big
 *  array). Must be fed the COMPLETE id pool — see fetchAllBlockIds. */
export function generateNextCode(existingIds: string[]): string {
  const prefix = "MT-B-";
  let max = 0;
  for (const id of existingIds) {
    if (typeof id !== "string") continue;
    const m = /^MT-B-0*(\d+)/i.exec(id.trim());
    if (!m) continue;
    const n = parseInt(m[1], 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return `${prefix}${String(max + 1).padStart(3, "0")}`;
}
