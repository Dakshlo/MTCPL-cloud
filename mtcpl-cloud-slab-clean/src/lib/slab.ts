import type { SlabStatus } from "@/lib/types";

export const STONE_TYPES = ["Pinkstone", "Makrana"] as const;
export const PRIORITY_OPTIONS = ["Critical", "High", "Medium", "Low"] as const;
export const DIMENSION_MODES = ["ft_inch", "decimal_ft"] as const;
export const VENDOR_TYPES = ["CNC", "Manual"] as const;
export const SLAB_STATUS_ORDER: SlabStatus[] = [
  "entered",
  "ready_for_assignment",
  "assigned",
  "in_progress",
  "completed_pending_approval",
  "approved_ready_to_ship",
  "denied_rework",
  "dispatched"
];
export const SLAB_STATUS_LABELS: Record<SlabStatus, string> = {
  entered: "Entered",
  ready_for_assignment: "Ready for assignment",
  assigned: "Assigned to vendor",
  in_progress: "Work in progress",
  completed_pending_approval: "Pending approval",
  approved_ready_to_ship: "Approved for dispatch",
  denied_rework: "Denied / rework",
  dispatched: "Dispatched"
};

export function textValue(formData: FormData, key: string) {
  const raw = formData.get(key);
  return typeof raw === "string" ? raw.trim() : "";
}

export function numValue(formData: FormData, key: string, fallback = 0) {
  const raw = Number(formData.get(key));
  return Number.isFinite(raw) ? raw : fallback;
}

export function toDecimalFeet(feet: number, inches: number) {
  return Number((Number(feet || 0) + Number(inches || 0) / 12).toFixed(2));
}

export function cubicFeet(lengthFt: number, widthFt: number, thicknessFt: number) {
  return Number((Number(lengthFt || 0) * Number(widthFt || 0) * Number(thicknessFt || 0)).toFixed(3));
}

export function makeTempleSlabCode(prefix: string, next: number) {
  return `${String(prefix || "SLB").toUpperCase()}-S${String(next).padStart(4, "0")}`;
}

export function nextTempleSequence(existingCodes: string[], prefix: string, start = 3000) {
  const safePrefix = `${String(prefix || "SLB").toUpperCase()}-S`;
  return existingCodes.reduce((highest, code) => {
    if (!String(code).startsWith(safePrefix)) return highest;
    const match = String(code).match(/(\d+)$/);
    if (!match) return highest;
    return Math.max(highest, Number(match[1]));
  }, start) + 1;
}

export function colorFromGroupName(groupName?: string | null) {
  if (!groupName) return "#d6c1a1";
  let total = 0;
  for (let index = 0; index < groupName.length; index += 1) {
    total += groupName.charCodeAt(index);
  }
  const palette = ["#c09282", "#7e9f7c", "#7f77dd", "#d08557", "#6c90c8", "#aa7d9f", "#8a7458"];
  return palette[total % palette.length];
}

export function daysUntil(dateString?: string | null) {
  if (!dateString) return null;
  const target = new Date(dateString);
  if (Number.isNaN(target.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  target.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - today.getTime()) / 86400000);
}

export function neededDateFromDays(daysText: string) {
  const days = Number(daysText);
  if (!Number.isFinite(days) || days <= 0) return null;
  const target = new Date();
  target.setHours(0, 0, 0, 0);
  target.setDate(target.getDate() + Math.round(days));
  return target.toISOString().slice(0, 10);
}

export function formatNeedLabel(dateString?: string | null) {
  const diff = daysUntil(dateString);
  if (diff === null) return null;
  if (diff <= 0) return "Needed now";
  if (diff === 30) return "Needed in 1 month";
  if (diff % 30 === 0) return `Needed in ${diff / 30} months`;
  if (diff === 1) return "Needed in 1 day";
  return `Needed in ${diff} days`;
}

export function statusTone(status: SlabStatus) {
  switch (status) {
    case "entered":
      return { bg: "#eef4ff", text: "#2f5592" };
    case "ready_for_assignment":
      return { bg: "#ecf5e7", text: "#3f6f39" };
    case "assigned":
    case "in_progress":
      return { bg: "#f4ebdd", text: "#7d5b35" };
    case "completed_pending_approval":
      return { bg: "#eee7fb", text: "#6550a8" };
    case "approved_ready_to_ship":
      return { bg: "#e6f4ea", text: "#2f6c3f" };
    case "denied_rework":
      return { bg: "#fae4df", text: "#9a3a33" };
    case "dispatched":
      return { bg: "#efebe5", text: "#746455" };
    default:
      return { bg: "#efebe5", text: "#746455" };
  }
}
