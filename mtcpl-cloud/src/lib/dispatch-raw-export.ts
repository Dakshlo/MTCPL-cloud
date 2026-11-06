// ──────────────────────────────────────────────────────────────────
// Raw dispatch data — one row per dispatched slab (Daksh, Nov 2026).
//
// "That excel export we made for CNC, likewise we want excel export
// feature for dispatch module too."
//
// Same idea as lib/carving-raw-export and deliberately the same shape:
// the flat table underneath the screens, so the office can pivot it
// themselves instead of asking for a new report every time the
// question changes. One header row, no banner, no merged cells —
// anything prettier breaks Excel's PivotTable, which is the whole
// point of the sheet.
//
// ONE ROW = ONE SLAB ON ONE TRIP. The trip's details (challan, truck,
// driver, dates) repeat on each of its slabs, which is exactly what a
// pivot wants: sum CFT by temple, count slabs by month, filter to one
// vehicle, without a join. A trip of 40 slabs is 40 rows; a pivot can
// always collapse it back, and a flat row can never be un-collapsed.
//
// CFT / SFT ARE NOT STORED. Both are computed, and the rules are not
// obvious (slab_requirements' *_ft columns hold INCHES; the thickness
// is the smallest of the three dims whatever column it sits in). We
// delegate to lib/dimensions so this sheet can never disagree with
// what invoicing bills. See that file's header for the full story.
// ──────────────────────────────────────────────────────────────────

import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { fetchAllPaged, chunkIds } from "@/lib/paginate";
import { getProfilesMap } from "@/lib/profiles";
import {
  cftFromSlab,
  faceSftFromSlab,
  isThinSlab,
  thicknessOf,
} from "@/lib/dimensions";

export type DispatchRawFilters = {
  /** dispatched_at >= this date (yyyy-mm-dd), inclusive. */
  from?: string;
  /** dispatched_at <= this date (yyyy-mm-dd), inclusive to end-of-day. */
  to?: string;
  temple?: string;
  /** on_road · delivered · returned · waiting · invoice (see rowStage). */
  stage?: string;
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

export type GroupKey = "trip" | "slab" | "journey" | "billing" | "people";

export const GROUP_LABELS: Record<GroupKey, string> = {
  trip: "The trip",
  slab: "The slab",
  journey: "Where it got to",
  billing: "Challan & invoice",
  people: "People",
};

/** Header fill per group — so one clean header row still reads as
 *  groups. A merged group band would look nicer and break PivotTable. */
export const GROUP_FILL: Record<GroupKey, string> = {
  trip: "FF1F4E79",
  slab: "FF2E6B4F",
  journey: "FF7A4E1D",
  billing: "FF8A6D1F",
  people: "FF4A4A4A",
};

export type CellValue = string | number | Date | null;

export type DispatchRawExport = {
  columns: RawColumn[];
  rows: CellValue[][];
  meta: {
    generatedAt: string;
    filters: DispatchRawFilters;
    rowCount: number;
    tripCount: number;
    temples: string[];
    stages: string[];
    /** Totals, so the About sheet can be checked against the screens. */
    totalCft: number;
    totalSft: number;
  };
};

// ── helpers ───────────────────────────────────────────────────────

const round = (n: number, dp: number) => {
  const f = 10 ** dp;
  return Math.round((Number(n) || 0) * f) / f;
};

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/**
 * Excel has no timezone — it stores a bare wall-clock serial, derived
 * from the Date's UTC value. A raw timestamp would therefore display
 * 5½ hours behind what the yard actually saw. Shifting by +5:30 makes
 * the serial read as IST, which is the only clock anyone here uses,
 * and it stays a real Excel date so sorting and pivoting by month work.
 */
function istDate(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return null;
  return new Date(t.getTime() + IST_OFFSET_MS);
}

/** Plain yyyy-mm-dd column (a deadline, a challan date) — no clock. */
function plainDate(d: string | null | undefined): Date | null {
  if (!d) return null;
  const t = new Date(`${d}T00:00:00Z`);
  return Number.isNaN(t.getTime()) ? null : t;
}

function daysBetween(a: string | null, b: string | null): number | null {
  if (!a || !b) return null;
  const ms = new Date(b).getTime() - new Date(a).getTime();
  if (!Number.isFinite(ms) || ms < 0) return null;
  return round(ms / 86_400_000, 2);
}

const yesNo = (v: boolean | null | undefined): string =>
  v === true ? "Yes" : v === false ? "No" : "";

const txt = (v: unknown): string => (v === null || v === undefined ? "" : String(v));

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** Title Case an enum value: `on_road` → `On road`. */
function human(v: string | null | undefined): string {
  if (!v) return "";
  const s = String(v).replace(/_/g, " ").trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ── row shapes (only the columns we actually read) ────────────────

type DispatchRow = Record<string, unknown> & { id: string; dispatched_at: string | null };
type LogRow = Record<string, unknown> & { id: string; dispatch_id: string | null };
type SlabRow = Record<string, unknown> & { id: string };
type ChallanRow = Record<string, unknown> & { id: string; source_dispatch_id: string | null };

type Ctx = {
  log: LogRow;
  trip: DispatchRow | null;
  slab: SlabRow | null;
  challan: ChallanRow | null;
  who: (id: unknown) => string;
  inchargeName: string;
};

/**
 * Where this trip has got to, as one word.
 *
 * The dispatch board shows these as separate lanes and the rules live
 * in several places; one column here means a pivot can answer "how
 * much is still on the road" without reproducing them.
 */
function tripStage(t: DispatchRow | null): string {
  if (!t) return "";
  if (t.returned_at) return "Returned";
  if (t.delivered_at) return "Delivered";
  if (t.on_road_at) return "On road";
  if (t.approved_at) return "Invoice in process";
  return "Waiting for approval";
}

const STAGE_KEYS: Record<string, string> = {
  returned: "Returned",
  delivered: "Delivered",
  on_road: "On road",
  invoice: "Invoice in process",
  waiting: "Waiting for approval",
};

/** The challan number as the papers show it: 24/25-117, or the plain
 *  running number for the older rows that predate the FY series. */
function challanLabel(t: DispatchRow | null): string {
  if (!t) return "";
  const fy = txt(t.doc_fy);
  const seq = t.doc_seq;
  if (fy && seq != null) return `${fy}-${seq}`;
  return t.challan_number != null ? String(t.challan_number) : "";
}

function invoiceLabel(c: ChallanRow | null): string {
  if (!c) return "";
  const override = txt(c.invoice_no_override);
  if (override) return override;
  const fy = txt(c.inv_fy);
  const seq = c.inv_seq;
  return fy && seq != null ? `INV-${fy}-${seq}` : "";
}

// ── the column list, in the order they appear left-to-right ───────
//
// Ordered so the first dozen are the ones anyone actually opens the
// sheet for: challan, temple, date, slab, size, CFT, where it got to.

type Field = RawColumn & { get: (c: Ctx) => CellValue };

const FIELDS: Field[] = [
  // ── the trip ───────────────────────────────────────────────────
  { header: "Challan no", group: "trip", kind: "text", width: 13,
    get: (c) => challanLabel(c.trip) },
  { header: "Temple", group: "trip", kind: "text", width: 22,
    get: (c) => txt(c.trip?.temple ?? c.slab?.temple) },
  { header: "Dispatched on", group: "trip", kind: "date", width: 17,
    get: (c) => istDate(txt(c.trip?.dispatched_at) || txt(c.log.dispatched_at)) },
  { header: "Month", group: "trip", kind: "text", width: 10,
    get: (c) => {
      const d = istDate(txt(c.trip?.dispatched_at) || txt(c.log.dispatched_at));
      return d ? `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}` : "";
    } },
  { header: "Load no", group: "trip", kind: "number", width: 9, dp: 0,
    get: (c) => num(c.trip?.load_number) },
  { header: "Vehicle no", group: "trip", kind: "text", width: 14,
    get: (c) => txt(c.trip?.vehicle_no) },
  { header: "Driver", group: "trip", kind: "text", width: 16,
    get: (c) => txt(c.trip?.driver_name) },
  { header: "Driver phone", group: "trip", kind: "text", width: 14,
    get: (c) => txt(c.trip?.driver_phone) },
  { header: "Dispatch incharge", group: "trip", kind: "text", width: 18,
    get: (c) => c.inchargeName },
  { header: "Expected delivery", group: "trip", kind: "day", width: 16,
    get: (c) => plainDate(txt(c.trip?.expected_delivery_date) || null) },
  { header: "Released as", group: "trip", kind: "text", width: 14,
    get: (c) => human(txt(c.trip?.release_mode)) },
  { header: "Slabs on this trip", group: "trip", kind: "number", width: 15, dp: 0,
    get: (c) => num((c.trip as { __slabCount?: number } | null)?.__slabCount) },
  { header: "Trip notes", group: "trip", kind: "text", width: 26,
    get: (c) => txt(c.trip?.notes) },

  // ── the slab ───────────────────────────────────────────────────
  { header: "Slab ID", group: "slab", kind: "text", width: 16,
    get: (c) => txt(c.log.slab_requirement_id ?? c.slab?.id) },
  { header: "Label", group: "slab", kind: "text", width: 18,
    get: (c) => txt(c.slab?.label) },
  { header: "Description", group: "slab", kind: "text", width: 30,
    get: (c) => txt(c.log.desc_override || c.slab?.description) },
  { header: "Extra description", group: "slab", kind: "text", width: 24,
    get: (c) => txt(c.log.additional_override || c.slab?.additional_description) },
  { header: "Section", group: "slab", kind: "text", width: 16,
    get: (c) => txt(c.slab?.component_section) },
  { header: "Element", group: "slab", kind: "text", width: 16,
    get: (c) => txt(c.slab?.component_element) },
  { header: "Stone", group: "slab", kind: "text", width: 14,
    get: (c) => txt(c.slab?.stone) },
  { header: "Length (in)", group: "slab", kind: "number", width: 11, dp: 2,
    get: (c) => num(c.slab?.length_ft) },
  { header: "Width (in)", group: "slab", kind: "number", width: 11, dp: 2,
    get: (c) => num(c.slab?.width_ft) },
  { header: "Thickness col (in)", group: "slab", kind: "number", width: 15, dp: 2,
    get: (c) => num(c.slab?.thickness_ft) },
  // The REAL thickness, which is not always the thickness column —
  // see lib/dimensions. Both are given so a doubter can check.
  { header: "Real thickness (in)", group: "slab", kind: "number", width: 16, dp: 2,
    get: (c) => c.slab
      ? round(thicknessOf(c.slab.length_ft as number, c.slab.width_ft as number, c.slab.thickness_ft as number), 2)
      : null },
  // NOT rounded in the cell. The column shows 3 decimals through its
  // number format, but the value underneath is exact — so a pivot
  // total matches the database to the last digit. Rounding 6,448 rows
  // to 3dp and then adding them up drifted the plant's total CFT by a
  // third of a foot, which is the kind of difference somebody spends
  // an afternoon hunting for.
  { header: "CFT", group: "slab", kind: "number", width: 10, dp: 3,
    get: (c) => c.slab
      ? cftFromSlab(c.slab.length_ft as number, c.slab.width_ft as number, c.slab.thickness_ft as number)
      : null },
  { header: "SFT (face)", group: "slab", kind: "number", width: 11, dp: 3,
    get: (c) => c.slab
      ? faceSftFromSlab(c.slab.length_ft as number, c.slab.width_ft as number, c.slab.thickness_ft as number)
      : null },
  { header: "Thin or thick", group: "slab", kind: "text", width: 12,
    get: (c) => c.slab
      ? (isThinSlab(c.slab.length_ft as number, c.slab.width_ft as number, c.slab.thickness_ft as number) ? "Thin" : "Thick")
      : "" },
  { header: "Billed as", group: "slab", kind: "text", width: 10,
    get: (c) => txt(c.log.measure_unit).toUpperCase() },
  { header: "Weight (t)", group: "slab", kind: "number", width: 11, dp: 3,
    get: (c) => num(c.log.weight_tonnes) },
  { header: "Carving method", group: "slab", kind: "text", width: 15,
    get: (c) => human(txt(c.slab?.carving_method)) },
  { header: "Slab status now", group: "slab", kind: "text", width: 16,
    get: (c) => human(txt(c.slab?.status)) },
  { header: "Slab note", group: "slab", kind: "text", width: 24,
    get: (c) => txt(c.log.dispatch_note) },

  // ── where it got to ────────────────────────────────────────────
  { header: "Stage", group: "journey", kind: "text", width: 18,
    get: (c) => tripStage(c.trip) },
  { header: "Approved on", group: "journey", kind: "date", width: 17,
    get: (c) => istDate(txt(c.trip?.approved_at) || null) },
  { header: "On road on", group: "journey", kind: "date", width: 17,
    get: (c) => istDate(txt(c.trip?.on_road_at) || null) },
  { header: "Delivered on", group: "journey", kind: "date", width: 17,
    get: (c) => istDate(txt(c.trip?.delivered_at) || null) },
  { header: "Days to deliver", group: "journey", kind: "number", width: 13, dp: 2,
    get: (c) => daysBetween(txt(c.trip?.dispatched_at) || null, txt(c.trip?.delivered_at) || null) },
  { header: "Received by", group: "journey", kind: "text", width: 18,
    get: (c) => txt(c.trip?.receiver_name) },
  { header: "Delivery note", group: "journey", kind: "text", width: 24,
    get: (c) => txt(c.trip?.delivery_note) },
  { header: "Site handover", group: "journey", kind: "date", width: 17,
    get: (c) => istDate(txt(c.trip?.handover_ack_at) || null) },
  { header: "Returned on", group: "journey", kind: "date", width: 17,
    get: (c) => istDate(txt(c.trip?.returned_at) || null) },
  { header: "Return reason", group: "journey", kind: "text", width: 24,
    get: (c) => txt(c.trip?.return_reason) },
  { header: "Proof photos", group: "journey", kind: "text", width: 12,
    get: (c) => {
      const n = (c.trip?.proof_site_path ? 1 : 0) + (c.trip?.proof_challan_path ? 1 : 0);
      return n === 0 ? "" : String(n);
    } },
  { header: "Installed on", group: "journey", kind: "date", width: 17,
    get: (c) => istDate(txt(c.slab?.installed_at) || null) },

  // ── challan & invoice ──────────────────────────────────────────
  { header: "Invoicing challan", group: "billing", kind: "text", width: 16,
    get: (c) => txt(c.challan?.challan_number) },
  { header: "Challan date", group: "billing", kind: "day", width: 13,
    get: (c) => plainDate(txt(c.challan?.challan_date) || null) },
  { header: "Priced on", group: "billing", kind: "date", width: 17,
    get: (c) => istDate(txt(c.challan?.priced_at) || null) },
  { header: "Invoice no", group: "billing", kind: "text", width: 16,
    get: (c) => invoiceLabel(c.challan) },
  { header: "Owner approved", group: "billing", kind: "bool", width: 14,
    get: (c) => (c.challan ? yesNo(!!c.challan.owner_approved_at) : "") },
  { header: "Challan cancelled", group: "billing", kind: "bool", width: 15,
    get: (c) => (c.challan ? yesNo(!!c.challan.cancelled_at) : "") },
  { header: "Transport co.", group: "billing", kind: "text", width: 18,
    get: (c) => txt(c.challan?.transport_company) },
  { header: "LR no", group: "billing", kind: "text", width: 13,
    get: (c) => txt(c.challan?.lr_no) },

  // ── people ─────────────────────────────────────────────────────
  { header: "Dispatched by", group: "people", kind: "text", width: 16,
    get: (c) => c.who(c.trip?.dispatched_by ?? c.log.dispatched_by) },
  { header: "Approved by", group: "people", kind: "text", width: 16,
    get: (c) => c.who(c.trip?.approved_by) },
  { header: "Delivered by", group: "people", kind: "text", width: 16,
    get: (c) => c.who(c.trip?.delivered_by) },
];

export const DISPATCH_RAW_COLUMNS: RawColumn[] = FIELDS.map(
  ({ header, group, kind, width, dp }) => ({ header, group, kind, width, dp }),
);

// ── the loader ────────────────────────────────────────────────────

/**
 * Everything, paged.
 *
 * PostgREST silently truncates an uncapped select at 1000 rows — the
 * trap that once broke the monthly costing report — and there are
 * already 6,700 dispatch lines. Every list here goes through
 * fetchAllPaged or chunkIds for that reason.
 */
export async function buildDispatchRawExport(
  filters: DispatchRawFilters = {},
): Promise<DispatchRawExport> {
  const admin = createAdminSupabaseClient();

  // 1. The trips in range. Filtering here rather than on the lines,
  //    because a trip is the thing that has a date and a slab should
  //    never be split off the trip it travelled on.
  const trips = (await fetchAllPaged((from, to) => {
    let q = admin
      .from("dispatches")
      .select(
        "id, temple, vehicle_no, driver_name, driver_phone, expected_delivery_date, notes, dispatched_by, dispatched_at, delivered_at, delivered_by, receiver_name, delivery_note, challan_number, approved_at, approved_by, proof_site_path, proof_challan_path, load_number, incharge_id, weight_mode, load_weight_tonnes, on_road_at, returned_at, return_reason, handover_ack_at, doc_fy, doc_seq, release_mode, archived_at",
      )
      .is("archived_at", null)
      .order("dispatched_at", { ascending: false });
    if (filters.from) q = q.gte("dispatched_at", `${filters.from}T00:00:00+05:30`);
    if (filters.to) q = q.lte("dispatched_at", `${filters.to}T23:59:59+05:30`);
    if (filters.temple) q = q.eq("temple", filters.temple);
    return q.range(from, to);
  })) as DispatchRow[];

  const stageWanted = filters.stage ? STAGE_KEYS[filters.stage] : null;
  const keptTrips = stageWanted ? trips.filter((t) => tripStage(t) === stageWanted) : trips;
  const tripById = new Map(keptTrips.map((t) => [t.id, t]));

  // 2. The lines on those trips.
  const logs: LogRow[] = [];
  for (const chunk of chunkIds([...tripById.keys()])) {
    const rows = (await fetchAllPaged((from, to) =>
      admin
        .from("dispatch_logs")
        .select(
          "id, carving_item_id, slab_requirement_id, dispatched_by, dispatch_note, dispatched_at, dispatch_id, weight_tonnes, measure_unit, desc_override, additional_override",
        )
        .in("dispatch_id", chunk)
        .range(from, to),
    )) as LogRow[];
    logs.push(...rows);
  }

  // How many slabs each trip carried — a column people reach for
  // constantly ("was that a full load?") and a join away otherwise.
  const slabCount = new Map<string, number>();
  for (const l of logs) {
    if (!l.dispatch_id) continue;
    slabCount.set(l.dispatch_id, (slabCount.get(l.dispatch_id) ?? 0) + 1);
  }
  for (const [id, t] of tripById) {
    (t as { __slabCount?: number }).__slabCount = slabCount.get(id) ?? 0;
  }

  // 3. The slabs themselves.
  const slabIds = [...new Set(logs.map((l) => txt(l.slab_requirement_id)).filter(Boolean))];
  const slabs = new Map<string, SlabRow>();
  for (const chunk of chunkIds(slabIds)) {
    const { data } = await admin.from("slab_requirements").select("*").in("id", chunk);
    for (const s of (data ?? []) as SlabRow[]) slabs.set(s.id, s);
  }

  // 4. The invoicing challan each trip turned into, and the people.
  const challanByTrip = new Map<string, ChallanRow>();
  for (const chunk of chunkIds([...tripById.keys()])) {
    const { data } = await admin
      .from("challans")
      .select(
        "id, challan_number, challan_date, source_dispatch_id, priced_at, invoice_no_override, inv_fy, inv_seq, owner_approved_at, cancelled_at, transport_company, lr_no",
      )
      .in("source_dispatch_id", chunk);
    for (const c of (data ?? []) as ChallanRow[]) {
      if (c.source_dispatch_id) challanByTrip.set(c.source_dispatch_id, c);
    }
  }

  const [profiles, { data: inchargeRows }] = await Promise.all([
    getProfilesMap(),
    admin.from("dispatch_incharges").select("id, name"),
  ]);
  const inchargeName = new Map(
    ((inchargeRows ?? []) as Array<{ id: string; name: string | null }>).map((r) => [
      r.id,
      r.name ?? "",
    ]),
  );
  // getProfilesMap returns a plain object keyed by id, not a Map.
  const who = (id: unknown): string =>
    typeof id === "string" && id ? profiles[id] ?? "" : "";

  // 5. Flatten. Newest trip first, and within a trip the slabs in the
  //    order they were loaded — which is the order the challan prints.
  const ordered = [...logs].sort((a, b) => {
    const ta = tripById.get(txt(a.dispatch_id));
    const tb = tripById.get(txt(b.dispatch_id));
    const da = new Date(txt(tb?.dispatched_at) || 0).getTime();
    const db = new Date(txt(ta?.dispatched_at) || 0).getTime();
    if (da !== db) return da - db;
    return txt(a.dispatched_at).localeCompare(txt(b.dispatched_at));
  });

  const rows: CellValue[][] = [];
  const temples = new Set<string>();
  const stages = new Set<string>();
  let totalCft = 0;
  let totalSft = 0;

  for (const log of ordered) {
    const trip = tripById.get(txt(log.dispatch_id)) ?? null;
    const slab = slabs.get(txt(log.slab_requirement_id)) ?? null;
    const ctx: Ctx = {
      log,
      trip,
      slab,
      challan: trip ? challanByTrip.get(trip.id) ?? null : null,
      who,
      inchargeName: trip?.incharge_id ? inchargeName.get(txt(trip.incharge_id)) ?? "" : "",
    };
    rows.push(FIELDS.map((f) => f.get(ctx)));

    const t = txt(trip?.temple ?? slab?.temple);
    if (t) temples.add(t);
    const st = tripStage(trip);
    if (st) stages.add(st);
    if (slab) {
      totalCft += cftFromSlab(slab.length_ft as number, slab.width_ft as number, slab.thickness_ft as number);
      totalSft += faceSftFromSlab(slab.length_ft as number, slab.width_ft as number, slab.thickness_ft as number);
    }
  }

  return {
    columns: DISPATCH_RAW_COLUMNS,
    rows,
    meta: {
      generatedAt: new Date().toISOString(),
      filters,
      rowCount: rows.length,
      tripCount: new Set(ordered.map((l) => txt(l.dispatch_id))).size,
      temples: [...temples].sort(),
      stages: [...stages].sort(),
      totalCft: round(totalCft, 3),
      totalSft: round(totalSft, 3),
    },
  };
}
