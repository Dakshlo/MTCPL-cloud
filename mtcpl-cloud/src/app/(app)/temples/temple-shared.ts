// Shared types + stage helpers for Temple View (list) and the fullscreen
// card browser. Kept here so both components import from one place (no
// duplication, no circular import).

export type StageBucket = "pending" | "cutting" | "cut_done" | "carving" | "done" | "rejected";

export type ComponentImage = { id: string; url: string; caption: string | null };

export type TempleSlabCard = {
  id: string; status: string; stone: string | null; quality: string | null;
  l: number; w: number; t: number; priority: boolean;
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
  cut_done: { label: "Cut · ready", color: "#0d9488" }, // teal (cut, ready to assign to carving)
  carving: { label: "Carving", color: "#f59e0b" },      // amber
  done: { label: "Done", color: "#16a34a" },            // green
  rejected: { label: "Rejected", color: "#dc2626" },    // red
};

// Rejected slabs are filtered out of Temple View (server-side), so the
// legend / bars don't show that stage.
export const STAGE_ORDER: StageBucket[] = ["done", "carving", "cut_done", "cutting", "pending"];

export function bucketOf(status: string): StageBucket {
  if (["open", "planned"].includes(status)) return "pending";
  if (status === "cutting") return "cutting";
  if (status === "cut_done") return "cut_done"; // cut, ready to assign to carving
  if (["carving_assigned", "carving_in_progress"].includes(status)) return "carving";
  if (status === "rejected") return "rejected";
  return "done";
}

export function stoneLabel(s: string | null): string {
  return (s ?? "").replace(/Stone$/i, "");
}

export const calcCft = (l: number, w: number, t: number) => (l * w * t) / 1728;
