/**
 * Deterministic colour-by-batch-id assignment.
 *
 * Slabs assigned together in a single bulk-assign share a
 * `carving_items.batch_id` UUID (migration 026). Anywhere those
 * slabs appear in the UI — vendor cockpit Pending/Ready lists,
 * transfer page Mine/Available rows, floor view queue lists — we
 * give them a small coloured stripe or chip so the user can spot
 * "these came together" at a glance.
 *
 * The mapping from batch_id → colour is deterministic and stable:
 * we hash the first ~8 chars of the UUID and pick from an 8-colour
 * pastel palette. Two slabs with the same batch_id always render
 * the same colour, across every surface, across every reload.
 *
 * NULL batch_id → no colour (singleton assignment, no group).
 *
 * Palette matches the mirror-pair palette in dashboard-client.tsx
 * so the visual language is consistent.
 */

export type BatchTint = {
  bg: string;
  border: string;
  fg: string;
};

const PALETTE: BatchTint[] = [
  { bg: "rgba(37,99,235,0.10)",  border: "rgba(37,99,235,0.55)",  fg: "#1d4ed8" },
  { bg: "rgba(22,163,74,0.10)",  border: "rgba(22,163,74,0.55)",  fg: "#15803d" },
  { bg: "rgba(217,119,6,0.10)",  border: "rgba(217,119,6,0.55)",  fg: "#b45309" },
  { bg: "rgba(124,58,237,0.10)", border: "rgba(124,58,237,0.55)", fg: "#7c3aed" },
  { bg: "rgba(190,18,60,0.10)",  border: "rgba(190,18,60,0.55)",  fg: "#be123c" },
  { bg: "rgba(14,165,233,0.10)", border: "rgba(14,165,233,0.55)", fg: "#0284c7" },
  { bg: "rgba(234,88,12,0.10)",  border: "rgba(234,88,12,0.55)",  fg: "#c2410c" },
  { bg: "rgba(20,184,166,0.10)", border: "rgba(20,184,166,0.55)", fg: "#0d9488" },
];

/**
 * Return a stable colour set for a given batch_id. NULL / empty
 * input returns NULL — caller should fall back to default styling.
 *
 * Algorithm: simple `sum of first 12 char codes % 8` over the
 * UUID's leading hex chars. Cheap, deterministic, good enough
 * distribution for a fleet with ≤ a few dozen active batches at
 * any moment.
 */
export function batchTint(batchId: string | null | undefined): BatchTint | null {
  if (!batchId) return null;
  let sum = 0;
  for (let i = 0; i < Math.min(12, batchId.length); i++) {
    sum += batchId.charCodeAt(i);
  }
  return PALETTE[sum % PALETTE.length] ?? null;
}
