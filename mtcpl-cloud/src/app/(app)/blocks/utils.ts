/** Generate next BLK-YYYYMM-XXXX code from existing IDs */
export function generateNextCode(existingIds: string[]): string {
  const now = new Date();
  const ym = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}`;
  const prefix = `BLK-${ym}-`;
  const seqNums = existingIds
    .filter(id => typeof id === "string" && id.startsWith(prefix))
    .map(id => parseInt(id.slice(prefix.length), 10))
    .filter(n => Number.isFinite(n));
  const next = seqNums.length ? Math.max(...seqNums) + 1 : 1;
  return `${prefix}${String(next).padStart(4, "0")}`;
}
