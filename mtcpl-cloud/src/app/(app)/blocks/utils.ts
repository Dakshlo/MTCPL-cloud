/** Generate next MT-B-XXX code from existing IDs */
export function generateNextCode(existingIds: string[]): string {
  const prefix = "MT-B-";
  const seqNums = existingIds
    .filter(id => typeof id === "string" && id.startsWith(prefix))
    .map(id => parseInt(id.slice(prefix.length), 10))
    .filter(n => Number.isFinite(n));
  const next = seqNums.length ? Math.max(...seqNums) + 1 : 1;
  return `${prefix}${String(next).padStart(3, "0")}`;
}
