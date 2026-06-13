// Shared types + stage helpers for Temple View (list) and the fullscreen
// card browser. Kept here so both components import from one place (no
// duplication, no circular import).

export type StageBucket = "pending" | "cutting" | "cut_done" | "carving" | "done" | "rejected" | "cancelled";

export type ComponentImage = { id: string; url: string; caption: string | null };

// Per-temple distinct Category 1 / Category 2 / Label / Description values —
// powers the searchable dropdowns in the card browser's "move slab" modal.
export type TempleCats = Record<string, { cat1: string[]; cat2: string[]; labels: string[]; descriptions: string[] }>;

export type TempleSlabCard = {
  id: string; status: string; stone: string | null; quality: string | null;
  l: number; w: number; t: number; priority: boolean;
  // Mig 128 — raw component-path fields, so the card browser's "move slab"
  // modal can pre-fill the form and re-categorize the slab in place.
  section: string; element: string; label: string; description: string; additional: string;
  // Mig 132 — slab cancellation. On a CANCELLED slab: why + the
  // replacement decision (null = still undecided → Temple View alert).
  // On a replacement slab: replacementOf = the cancelled slab it replaces.
  cancelReason?: string | null;
  cancelResolution?: "no_replacement" | "replaced" | null;
  replacementSlabId?: string | null;
  replacementOf?: string | null;
};

export type TempleTreeNode = {
  id: string;
  name: string;
  total: number;
  counts: Record<StageBucket, number>;
  children: TempleTreeNode[];
  slabs: TempleSlabCard[];
};

export type TempleTree = {
  temple: string;
  total: number;
  counts: Record<StageBucket, number>;
  roots: TempleTreeNode[];
};

export const STAGE_META: Record<StageBucket, { label: string; color: string }> = {
  pending: { label: "Pending", color: "#94a3b8" },      // slate
  cutting: { label: "Cutting", color: "#3b82f6" },      // blue (actively being cut)
  cut_done: { label: "Cut · ready", color: "#06b6d4" }, // cyan — NOT green (never mistaken for Done) and calmer than violet as the biggest bucket
  carving: { label: "Carving", color: "#f59e0b" },      // amber
  done: { label: "Done", color: "#16a34a" },            // green
  rejected: { label: "Rejected", color: "#dc2626" },    // red
  cancelled: { label: "Cancelled", color: "#7f1d1d" },  // dark red (mig 132 — broken, owner-approved exit)
};

// Bar + chip + legend order follows the production flow, left → right:
//   Pending → Cutting → Cut · ready → Carving → Done → Cancelled.
// Rejected slabs are filtered out of Temple View (server-side), so the
// legend / bars don't show that stage. Cancelled (mig 132) IS shown —
// the office decides on a replacement from here.
export const STAGE_ORDER: StageBucket[] = ["pending", "cutting", "cut_done", "carving", "done", "cancelled"];

export function bucketOf(status: string): StageBucket {
  if (["open", "planned"].includes(status)) return "pending";
  if (status === "cutting") return "cutting";
  if (status === "cut_done") return "cut_done"; // cut, ready to assign to carving
  if (["carving_assigned", "carving_in_progress"].includes(status)) return "carving";
  if (status === "rejected") return "rejected";
  if (status === "cancelled") return "cancelled"; // mig 132
  return "done";
}

export function stoneLabel(s: string | null): string {
  return (s ?? "").replace(/Stone$/i, "");
}

export const calcCft = (l: number, w: number, t: number) => (l * w * t) / 1728;
