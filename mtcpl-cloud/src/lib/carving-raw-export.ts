// ──────────────────────────────────────────────────────────────────
// Raw CNC / carving data — one row per carving job (Daksh, Nov 2026).
//
// "I want an excel export of our raw data of cnc, so on excel they can
// modify the way they wanna see." The existing /api/reports/cnc-monthly
// export is a SUMMARY (daily rows × machine columns, shaped like the
// paper sheet). This is the opposite: the flat table underneath it, so
// the office can pivot it themselves without asking for a new report
// every time the question changes.
//
// One row = one carving job (a slab's trip through one machine). A slab
// carved twice is two rows — that is the raw grain, and a pivot can
// always collapse it. Everything is denormalised into readable values:
// no id codes, no file paths, names instead of user ids.
//
// CFT / SFT ARE NOT STORED. Both are computed, and the rules are not
// obvious (slab_requirements' *_ft columns hold INCHES; the thickness is
// the smallest of the three dims whatever column it sits in). We delegate
// to lib/dimensions so this sheet can never disagree with what invoicing
// bills. See that file's header for the full story.
// ──────────────────────────────────────────────────────────────────

import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { fetchAllPaged, chunkIds } from "@/lib/paginate";
import { getProfilesMap } from "@/lib/profiles";
import {
  cftFromSlab,
  faceSftFromSlab,
  isThinSlab,
  jobworkQuantity,
  thicknessOf,
} from "@/lib/dimensions";

export type CarvingRawFilters = {
  /** assigned_at >= this date (yyyy-mm-dd), inclusive. */
  from?: string;
  /** assigned_at <= this date (yyyy-mm-dd), inclusive to end-of-day. */
  to?: string;
  temple?: string;
  vendor?: string;
  status?: string;
};

export type ColumnKind = "text" | "number" | "money" | "date" | "day" | "bool";

export type RawColumn = {
  header: string;
  group: GroupKey;
  kind: ColumnKind;
  width: number;
  /** decimals for `number` columns */
  dp?: number;
};

export type GroupKey =
  | "slab"
  | "who"
  | "timing"
  | "quality"
  | "money"
  | "logistics"
  | "people";

export const GROUP_LABELS: Record<GroupKey, string> = {
  slab: "The slab",
  who: "Who carved it",
  timing: "Timing",
  quality: "Quality & review",
  money: "Money",
  logistics: "Logistics",
  people: "People",
};

/** Header fill per group — so one clean header row still reads as groups.
 *  A merged group band would look nicer and break Excel's PivotTable,
 *  which is the entire point of this sheet. Colour instead. */
export const GROUP_FILL: Record<GroupKey, string> = {
  slab: "FF1F4E79",
  who: "FF2E6B4F",
  timing: "FF7A4E1D",
  quality: "FF6B2E5F",
  money: "FF8A6D1F",
  logistics: "FF34506B",
  people: "FF4A4A4A",
};

export type CellValue = string | number | Date | null;

export type CarvingRawExport = {
  columns: RawColumn[];
  rows: CellValue[][];
  meta: {
    generatedAt: string;
    filters: CarvingRawFilters;
    rowCount: number;
    /** Distinct values present, so the About sheet can show what's in here. */
    temples: string[];
    vendors: string[];
    statuses: string[];
  };
};

// ── helpers ───────────────────────────────────────────────────────

const round = (n: number, dp: number) => {
  const f = 10 ** dp;
  return Math.round((Number(n) || 0) * f) / f;
};

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/**
 * Excel has no timezone — it stores a bare wall-clock serial. ExcelJS
 * derives that serial from the Date's UTC value, so a raw timestamp would
 * display 5½ hours behind what the floor actually saw. Shifting by +5:30
 * makes the serial read as IST, which is the only clock anyone here uses.
 * The value stays a real Excel date, so sorting and pivoting by month work.
 */
function istDate(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return null;
  return new Date(t.getTime() + IST_OFFSET_MS);
}

/** Plain yyyy-mm-dd date column (deadline) — no clock, no shift needed. */
function plainDate(d: string | null | undefined): Date | null {
  if (!d) return null;
  const t = new Date(`${d}T00:00:00Z`);
  return Number.isNaN(t.getTime()) ? null : t;
}

function hoursBetween(a: string | null, b: string | null): number | null {
  if (!a || !b) return null;
  const ms = new Date(b).getTime() - new Date(a).getTime();
  if (!Number.isFinite(ms) || ms < 0) return null;
  return round(ms / 3_600_000, 2);
}

function daysBetween(a: string | null, b: string | null): number | null {
  if (!a || !b) return null;
  const ms = new Date(b).getTime() - new Date(a).getTime();
  if (!Number.isFinite(ms) || ms < 0) return null;
  return round(ms / 86_400_000, 2);
}

const yesNo = (v: boolean | null | undefined): string =>
  v === true ? "Yes" : v === false ? "No" : "";

const txt = (v: unknown): string =>
  v === null || v === undefined ? "" : String(v);

/** Title Case an enum value: `ready_to_dispatch` → `Ready to dispatch`. */
function human(v: string | null | undefined): string {
  if (!v) return "";
  const s = String(v).replace(/_/g, " ").trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ── row shapes (only the columns we actually read) ────────────────

type CarvingItem = Record<string, unknown> & {
  id: string;
  slab_requirement_id: string | null;
  assigned_at: string | null;
};

type SlabRow = Record<string, unknown> & { id: string };

type MachineRow = {
  id: string;
  machine_code: string | null;
  operator_name: string | null;
  machine_type: string | null;
  cnc_axes: number | null;
};

// ── the column list, in the order they appear left-to-right ───────
//
// Ordered so the first dozen are the ones anyone actually opens the
// sheet for: slab, temple, size, CFT/SFT, operator, machine, hours.

type Field = RawColumn & { get: (c: Ctx) => CellValue };

type Ctx = {
  ci: CarvingItem;
  sr: SlabRow | null;
  /**
   * The machine that did the work. NOT simply cnc_machine_id — that
   * column is the "what is bolted to this machine right now" pointer
   * and is CLEARED on unload, so it is set on only 69 of 3,126 jobs.
   * The lasting record is completed_on_cnc_machine_id (2,898 rows).
   * Resolving completed → assigned is what makes "CFT by machine"
   * pivot to something other than blanks.
   */
  machine: MachineRow | null;
  /** Only for jobs physically loaded right now — the other 69. */
  liveMachine: MachineRow | null;
  who: (id: unknown) => string;
  woNumber: string;
  station: string;
  truck: string;
};

/** Read a column off the carving_items row. */
const ciS = (ci: CarvingItem, k: string): string | null => {
  const v = ci[k];
  return v === null || v === undefined ? null : String(v);
};
const ciN = (ci: CarvingItem, k: string): number | null => {
  const v = ci[k];
  return v === null || v === undefined || v === "" ? null : Number(v);
};
const srS = (sr: SlabRow | null, k: string): string | null => {
  if (!sr) return null;
  const v = sr[k];
  return v === null || v === undefined ? null : String(v);
};

const FIELDS: Field[] = [
  // ── A. The slab ────────────────────────────────────────────────
  { header: "Slab code", group: "slab", kind: "text", width: 18,
    get: (c) => txt(c.ci.slab_requirement_id) },
  { header: "Label", group: "slab", kind: "text", width: 16,
    get: (c) => txt(srS(c.sr, "label")) },
  { header: "Temple", group: "slab", kind: "text", width: 24,
    get: (c) => txt(srS(c.sr, "temple")) },
  { header: "Stone", group: "slab", kind: "text", width: 16,
    get: (c) => txt(srS(c.sr, "stone")) },
  { header: "Length (in)", group: "slab", kind: "number", width: 11, dp: 2,
    get: (c) => (c.sr ? round(Number(c.sr.length_ft) || 0, 2) : null) },
  { header: "Width (in)", group: "slab", kind: "number", width: 11, dp: 2,
    get: (c) => (c.sr ? round(Number(c.sr.width_ft) || 0, 2) : null) },
  { header: "Thickness col (in)", group: "slab", kind: "number", width: 15, dp: 2,
    get: (c) => (c.sr ? round(Number(c.sr.thickness_ft) || 0, 2) : null) },
  { header: "Real thickness (in)", group: "slab", kind: "number", width: 16, dp: 2,
    get: (c) =>
      c.sr
        ? round(thicknessOf(c.sr.length_ft as number, c.sr.width_ft as number, c.sr.thickness_ft as number), 2)
        : null },
  { header: "CFT", group: "slab", kind: "number", width: 10, dp: 3,
    get: (c) =>
      c.sr
        ? round(cftFromSlab(c.sr.length_ft as number, c.sr.width_ft as number, c.sr.thickness_ft as number), 3)
        : null },
  { header: "SFT (face)", group: "slab", kind: "number", width: 11, dp: 3,
    get: (c) =>
      c.sr
        ? round(faceSftFromSlab(c.sr.length_ft as number, c.sr.width_ft as number, c.sr.thickness_ft as number), 3)
        : null },
  { header: "Thin or thick", group: "slab", kind: "text", width: 13,
    get: (c) =>
      c.sr
        ? isThinSlab(c.sr.length_ft as number, c.sr.width_ft as number, c.sr.thickness_ft as number)
          ? "Thin (SFT)"
          : "Thick (CFT)"
        : "" },
  { header: "Description", group: "slab", kind: "text", width: 34,
    get: (c) => txt(srS(c.sr, "description")) },
  { header: "Extra description", group: "slab", kind: "text", width: 28,
    get: (c) => txt(srS(c.sr, "additional_description")) },
  { header: "Section", group: "slab", kind: "text", width: 18,
    get: (c) => txt(srS(c.sr, "component_section")) },
  { header: "Element", group: "slab", kind: "text", width: 18,
    get: (c) => txt(srS(c.sr, "component_element")) },
  { header: "Quality", group: "slab", kind: "text", width: 12,
    get: (c) => txt(srS(c.sr, "quality")) },
  { header: "Carving method", group: "slab", kind: "text", width: 15,
    get: (c) => txt(srS(c.sr, "carving_method")) },
  { header: "Slab status", group: "slab", kind: "text", width: 16,
    get: (c) => human(srS(c.sr, "status")) },
  { header: "Source block", group: "slab", kind: "text", width: 16,
    get: (c) => txt(srS(c.sr, "source_block_id")) },
  { header: "Stock location", group: "slab", kind: "text", width: 16,
    get: (c) => txt(srS(c.sr, "stock_location")) },
  { header: "Priority slab", group: "slab", kind: "bool", width: 12,
    get: (c) => yesNo(c.sr?.priority as boolean) },
  { header: "Slab deadline", group: "slab", kind: "day", width: 13,
    get: (c) => plainDate(srS(c.sr, "deadline")) },
  { header: "Slab remark", group: "slab", kind: "text", width: 26,
    get: (c) => txt(srS(c.sr, "remark")) },

  // ── B. Who carved it ───────────────────────────────────────────
  { header: "Operator / vendor", group: "who", kind: "text", width: 22,
    get: (c) => txt(ciS(c.ci, "vendor_name")) },
  { header: "Vendor type", group: "who", kind: "text", width: 13,
    get: (c) => txt(ciS(c.ci, "vendor_type")) },
  { header: "Machine", group: "who", kind: "text", width: 14,
    get: (c) => txt(c.machine?.machine_code) },
  { header: "Machine operator", group: "who", kind: "text", width: 20,
    get: (c) => txt(c.machine?.operator_name) },
  { header: "Machine type", group: "who", kind: "text", width: 14,
    get: (c) => txt(c.machine?.machine_type) },
  { header: "Machine axes", group: "who", kind: "number", width: 12, dp: 0,
    get: (c) => (c.machine?.cnc_axes == null ? null : Number(c.machine.cnc_axes)) },
  { header: "Currently on machine", group: "who", kind: "text", width: 18,
    get: (c) => txt(c.liveMachine?.machine_code) },
  { header: "Transferred from", group: "who", kind: "text", width: 20,
    get: (c) => txt(ciS(c.ci, "transferred_from_vendor_name")) },
  { header: "Transferred at", group: "who", kind: "date", width: 18,
    get: (c) => istDate(ciS(c.ci, "transferred_at")) },
  { header: "Machine type needed", group: "who", kind: "text", width: 17,
    get: (c) => txt(ciS(c.ci, "requires_machine_type")) },
  { header: "Axes needed", group: "who", kind: "number", width: 11, dp: 0,
    get: (c) => ciN(c.ci, "requires_cnc_axes") },

  // ── C. Timing ──────────────────────────────────────────────────
  { header: "Assigned at", group: "timing", kind: "date", width: 18,
    get: (c) => istDate(ciS(c.ci, "assigned_at")) },
  { header: "Deadline days", group: "timing", kind: "number", width: 13, dp: 0,
    get: (c) => ciN(c.ci, "deadline_days") },
  { header: "Due at", group: "timing", kind: "date", width: 18,
    get: (c) => istDate(ciS(c.ci, "due_at")) },
  { header: "Loaded on machine", group: "timing", kind: "date", width: 18,
    get: (c) => istDate(ciS(c.ci, "loaded_at")) },
  { header: "Unloaded", group: "timing", kind: "date", width: 18,
    get: (c) => istDate(ciS(c.ci, "unloaded_at")) },
  { header: "Hours on machine", group: "timing", kind: "number", width: 15, dp: 2,
    get: (c) => hoursBetween(ciS(c.ci, "loaded_at"), ciS(c.ci, "unloaded_at")) },
  { header: "Completed at", group: "timing", kind: "date", width: 18,
    get: (c) => istDate(ciS(c.ci, "completed_at")) },
  { header: "Our estimate (min)", group: "timing", kind: "number", width: 15, dp: 0,
    get: (c) => ciN(c.ci, "estimated_minutes") },
  { header: "Vendor estimate (min)", group: "timing", kind: "number", width: 17, dp: 0,
    get: (c) => ciN(c.ci, "vendor_estimated_minutes") },
  { header: "Actual minutes", group: "timing", kind: "number", width: 14, dp: 0,
    get: (c) => {
      const h = hoursBetween(ciS(c.ci, "loaded_at"), ciS(c.ci, "unloaded_at"));
      return h == null ? null : round(h * 60, 0);
    } },
  { header: "Over/under estimate (min)", group: "timing", kind: "number", width: 20, dp: 0,
    get: (c) => {
      const h = hoursBetween(ciS(c.ci, "loaded_at"), ciS(c.ci, "unloaded_at"));
      const est = ciN(c.ci, "estimated_minutes");
      if (h == null || est == null) return null;
      return round(h * 60 - est, 0);
    } },
  { header: "Received at vendor", group: "timing", kind: "date", width: 18,
    get: (c) => istDate(ciS(c.ci, "received_at_vendor_at")) },
  { header: "Ready to dispatch at", group: "timing", kind: "date", width: 18,
    get: (c) => istDate(ciS(c.ci, "ready_to_dispatch_at")) },
  { header: "Received at dispatch", group: "timing", kind: "date", width: 18,
    get: (c) => istDate(ciS(c.ci, "received_at_dispatch_at")) },
  { header: "Days assigned → done", group: "timing", kind: "number", width: 17, dp: 2,
    get: (c) => daysBetween(ciS(c.ci, "assigned_at"), ciS(c.ci, "completed_at")) },

  // ── D. Quality & review ────────────────────────────────────────
  { header: "Job status", group: "quality", kind: "text", width: 16,
    get: (c) => human(ciS(c.ci, "status")) },
  { header: "Progress phase", group: "quality", kind: "text", width: 16,
    get: (c) => human(ciS(c.ci, "progress_phase")) },
  { header: "Review decision", group: "quality", kind: "text", width: 15,
    get: (c) => human(ciS(c.ci, "review_decision")) },
  { header: "Approved at", group: "quality", kind: "date", width: 18,
    get: (c) => istDate(ciS(c.ci, "review_approved_at")) },
  { header: "Quality flag", group: "quality", kind: "text", width: 14,
    get: (c) => human(ciS(c.ci, "review_quality_flag")) },
  { header: "Reworked at", group: "quality", kind: "date", width: 18,
    get: (c) => istDate(ciS(c.ci, "review_reworked_at")) },
  { header: "Rejected at", group: "quality", kind: "date", width: 18,
    get: (c) => istDate(ciS(c.ci, "review_rejected_at")) },
  { header: "Review notes", group: "quality", kind: "text", width: 30,
    get: (c) => txt(ciS(c.ci, "review_notes")) },
  { header: "Owner review status", group: "quality", kind: "text", width: 17,
    get: (c) => human(ciS(c.ci, "owner_review_status")) },
  { header: "Owner review kind", group: "quality", kind: "text", width: 16,
    get: (c) => human(ciS(c.ci, "owner_review_kind")) },
  { header: "Owner review note", group: "quality", kind: "text", width: 28,
    get: (c) => txt(ciS(c.ci, "owner_review_note")) },
  { header: "Pending work at", group: "quality", kind: "date", width: 18,
    get: (c) => istDate(ciS(c.ci, "pending_work_at")) },
  { header: "Pending work note", group: "quality", kind: "text", width: 28,
    get: (c) => txt(ciS(c.ci, "pending_work_note")) },
  { header: "Held at", group: "quality", kind: "date", width: 18,
    get: (c) => istDate(ciS(c.ci, "held_at")) },
  { header: "Held reason", group: "quality", kind: "text", width: 26,
    get: (c) => txt(ciS(c.ci, "held_reason")) },
  { header: "Carving sides", group: "quality", kind: "number", width: 12, dp: 0,
    get: (c) => ciN(c.ci, "carving_sides") },

  // ── E. Money ───────────────────────────────────────────────────
  { header: "Jobwork rate", group: "money", kind: "money", width: 13,
    get: (c) => ciN(c.ci, "jobwork_rate") },
  { header: "Jobwork unit", group: "money", kind: "text", width: 12,
    get: (c) => txt(ciS(c.ci, "jobwork_unit")) },
  { header: "Jobwork qty", group: "money", kind: "number", width: 12, dp: 3,
    get: (c) => {
      const unit = ciS(c.ci, "jobwork_unit");
      if (!c.sr || (unit !== "cft" && unit !== "sft")) return null;
      return round(
        jobworkQuantity(unit, c.sr.length_ft as number, c.sr.width_ft as number, c.sr.thickness_ft as number),
        3,
      );
    } },
  { header: "Jobwork amount", group: "money", kind: "money", width: 15,
    get: (c) => ciN(c.ci, "jobwork_amount") },

  // ── F. Logistics ───────────────────────────────────────────────
  { header: "Location", group: "logistics", kind: "text", width: 18,
    get: (c) => txt(ciS(c.ci, "location")) },
  { header: "Temporary location", group: "logistics", kind: "text", width: 18,
    get: (c) => txt(ciS(c.ci, "temporary_location")) },
  { header: "Dispatch station", group: "logistics", kind: "text", width: 18,
    get: (c) => c.station },
  { header: "Work order no", group: "logistics", kind: "text", width: 14,
    get: (c) => c.woNumber },
  { header: "Truck", group: "logistics", kind: "text", width: 16,
    get: (c) => c.truck },
  { header: "Flagged to depart", group: "logistics", kind: "bool", width: 14,
    get: (c) => yesNo(c.ci.depart_flag as boolean) },
  { header: "Depart note", group: "logistics", kind: "text", width: 24,
    get: (c) => txt(ciS(c.ci, "depart_note")) },
  { header: "Dropoff note", group: "logistics", kind: "text", width: 24,
    get: (c) => txt(ciS(c.ci, "dropoff_note")) },
  { header: "Job note", group: "logistics", kind: "text", width: 28,
    get: (c) => txt(ciS(c.ci, "note")) },

  // ── G. People ──────────────────────────────────────────────────
  { header: "Assigned by", group: "people", kind: "text", width: 18,
    get: (c) => c.who(c.ci.assigned_by) },
  { header: "Loaded by", group: "people", kind: "text", width: 18,
    get: (c) => c.who(c.ci.loaded_by) },
  { header: "Unloaded by", group: "people", kind: "text", width: 18,
    get: (c) => c.who(c.ci.unloaded_by) },
  { header: "Approved by", group: "people", kind: "text", width: 18,
    get: (c) => c.who(c.ci.review_approved_by) },
  { header: "Rejected by", group: "people", kind: "text", width: 18,
    get: (c) => c.who(c.ci.review_rejected_by) },
  { header: "Claimed by", group: "people", kind: "text", width: 18,
    get: (c) => c.who(c.ci.claimed_by) },
  { header: "Held by", group: "people", kind: "text", width: 18,
    get: (c) => c.who(c.ci.held_by) },
  { header: "Ready-to-dispatch by", group: "people", kind: "text", width: 18,
    get: (c) => c.who(c.ci.ready_to_dispatch_by) },
];

export const RAW_COLUMNS: RawColumn[] = FIELDS.map(({ get: _get, ...col }) => col);

// ── the builder ───────────────────────────────────────────────────

export async function buildCarvingRawExport(
  filters: CarvingRawFilters = {},
): Promise<CarvingRawExport> {
  const admin = createAdminSupabaseClient();

  // 1. Every carving job. 3k+ rows today, so this MUST page — an
  //    uncapped .select() silently stops at 1000 (see lib/paginate).
  //    Dates are cheap to push into SQL; the rest we filter in memory
  //    so a stray value can never blow up on an enum cast.
  const items = await fetchAllPaged<CarvingItem>((from, to) => {
    let q = admin.from("carving_items").select("*");
    if (filters.from) q = q.gte("assigned_at", `${filters.from}T00:00:00Z`);
    if (filters.to) q = q.lte("assigned_at", `${filters.to}T23:59:59.999Z`);
    return q.order("assigned_at", { ascending: true }).order("id", { ascending: true }).range(from, to);
  });

  // 2. The slabs they point at — chunked so no single .in() trips the cap.
  const slabIds = Array.from(
    new Set(items.map((i) => i.slab_requirement_id).filter((v): v is string => !!v)),
  );
  const slabs = new Map<string, SlabRow>();
  for (const chunk of chunkIds(slabIds)) {
    const { data } = await admin.from("slab_requirements").select("*").in("id", chunk);
    for (const s of (data ?? []) as SlabRow[]) slabs.set(s.id, s);
  }

  // 3. Lookups: machines, people, work orders, stations, trucks.
  const [machinesRes, profiles, woItemsRes, woRes, stationsRes, trucksRes] = await Promise.all([
    admin.from("cnc_machines").select("id, machine_code, operator_name, machine_type, cnc_axes"),
    getProfilesMap(),
    admin.from("carving_work_order_items").select("carving_item_id, work_order_id"),
    admin.from("carving_work_orders").select("id, wo_number"),
    admin.from("dispatch_stations").select("id, name"),
    admin.from("trucks").select("id, name, driver_name"),
  ]);

  const machines = new Map<string, MachineRow>();
  for (const m of (machinesRes.data ?? []) as MachineRow[]) machines.set(m.id, m);

  const woNumberById = new Map<string, string>();
  for (const w of (woRes.data ?? []) as Array<{ id: string; wo_number: string | null }>) {
    woNumberById.set(w.id, w.wo_number ?? "");
  }
  const woByItem = new Map<string, string>();
  for (const li of (woItemsRes.data ?? []) as Array<{
    carving_item_id: string | null;
    work_order_id: string | null;
  }>) {
    if (li.carving_item_id && li.work_order_id) {
      woByItem.set(li.carving_item_id, woNumberById.get(li.work_order_id) ?? "");
    }
  }

  const stations = new Map<string, string>();
  for (const s of (stationsRes.data ?? []) as Array<{ id: string; name: string | null }>) {
    stations.set(s.id, s.name ?? "");
  }
  const trucks = new Map<string, string>();
  for (const t of (trucksRes.data ?? []) as Array<{
    id: string;
    name: string | null;
    driver_name: string | null;
  }>) {
    trucks.set(t.id, [t.name, t.driver_name].filter(Boolean).join(" · "));
  }

  const who = (id: unknown): string =>
    typeof id === "string" && id ? (profiles[id] ?? "") : "";

  // 4. In-memory filters (temple lives on the slab, not the job).
  const wantTemple = (filters.temple ?? "").trim().toLowerCase();
  const wantVendor = (filters.vendor ?? "").trim().toLowerCase();
  const wantStatus = (filters.status ?? "").trim().toLowerCase();

  const kept = items.filter((ci) => {
    const sr = ci.slab_requirement_id ? slabs.get(ci.slab_requirement_id) ?? null : null;
    if (wantTemple && String(srS(sr, "temple") ?? "").toLowerCase() !== wantTemple) return false;
    if (wantVendor && String(ciS(ci, "vendor_name") ?? "").toLowerCase() !== wantVendor) return false;
    if (wantStatus && String(ciS(ci, "status") ?? "").toLowerCase() !== wantStatus) return false;
    return true;
  });

  // 5. Build the grid.
  const templesSeen = new Set<string>();
  const vendorsSeen = new Set<string>();
  const statusesSeen = new Set<string>();

  const rows: CellValue[][] = kept.map((ci) => {
    const sr = ci.slab_requirement_id ? slabs.get(ci.slab_requirement_id) ?? null : null;
    const liveMachine =
      typeof ci.cnc_machine_id === "string" ? machines.get(ci.cnc_machine_id) ?? null : null;
    const doneOnMachine =
      typeof ci.completed_on_cnc_machine_id === "string"
        ? machines.get(ci.completed_on_cnc_machine_id) ?? null
        : null;
    const ctx: Ctx = {
      ci,
      sr,
      // Completed first — see the Ctx.machine note. Falling back to the
      // live pointer keeps the 69 in-progress jobs from going blank.
      machine: doneOnMachine ?? liveMachine,
      liveMachine,
      who,
      woNumber: woByItem.get(ci.id) ?? "",
      station:
        typeof ci.dispatch_station_id === "string"
          ? stations.get(ci.dispatch_station_id) ?? ""
          : "",
      truck: typeof ci.claim_truck_id === "string" ? trucks.get(ci.claim_truck_id) ?? "" : "",
    };

    const temple = srS(sr, "temple");
    if (temple) templesSeen.add(temple);
    const vendor = ciS(ci, "vendor_name");
    if (vendor) vendorsSeen.add(vendor);
    const status = ciS(ci, "status");
    if (status) statusesSeen.add(status);

    return FIELDS.map((f) => f.get(ctx));
  });

  return {
    columns: RAW_COLUMNS,
    rows,
    meta: {
      generatedAt: new Date().toISOString(),
      filters,
      rowCount: rows.length,
      temples: [...templesSeen].sort(),
      vendors: [...vendorsSeen].sort(),
      statuses: [...statusesSeen].sort(),
    },
  };
}
