/**
 * CNC monthly report — production-summary computation shared by the
 * HTML view at /carving/reports and the Excel export route at
 * /api/reports/cnc-monthly.xlsx so the two never drift apart.
 *
 * For a given (year, month) the report shows per-day SQFT + CFT for
 * every CNC machine, grouped under its vendor (operator). Lathe
 * machines only show CFT (round work — SQFT is meaningless).
 *
 * The numbers come from carving_items joined to slab_requirements:
 *   • A row counts toward (machine, day) if review_approved_at falls
 *     on that day in IST and completed_on_cnc_machine_id is set —
 *     i.e. output is counted at REVIEW APPROVAL, not at unload, so
 *     reworked / rejected slabs never count (Daksh, June 2026).
 *   • Thin slab (thickness ≤ 12") → SFT = (length × width) / 144
 *   • Thick slab (thickness > 12") → CFT = (length × width × thickness) / 1728
 *
 * Mig 053 follow-on (Daksh, May 2026): the SFT vs CFT choice is
 * now mutually exclusive per slab. Earlier the report showed both
 * for every entry, which was confusing — thin slabs are sold by
 * area, thick blocks by volume, so each piece belongs in exactly
 * one column. The display column header reads "SFT" (renamed from
 * "SQFT") and the empty side of each cell renders as "—".
 */

import { createAdminSupabaseClient } from "@/lib/supabase/admin";

export type MachineCol = {
  id: string;
  code: string;
  vendor_id: string;
  vendor_name: string;
  type: "single_head" | "multi_head_2" | "lathe";
  /** Lathes don't show SQFT — we only emit the CFT column for them. */
  showSqft: boolean;
};

export type DailyRow = {
  /** ISO yyyy-mm-dd (IST). Empty cells where the day hasn't happened
   *  yet or no work was logged. */
  date: string;
  /** Per-machine SQFT + CFT keyed by machine.id. SQFT may be undefined
   *  for lathe rows. */
  values: Record<string, { sqft?: number; cft: number }>;
};

export type VendorGroup = {
  vendor_id: string;
  vendor_name: string;
  machines: MachineCol[];
};

export type CncMonthlyReport = {
  /** Mig 053 follow-on (Daksh): the report now supports daily,
   *  weekly, and monthly views. `period` captures which view + the
   *  exact date range — page header reads `period.label` for the
   *  human-friendly string, Excel route reads it for the filename. */
  period: CncReportPeriod;
  /** Anchor YYYY (= period.year for monthly, year of start for
   *  daily/weekly). Kept so the existing year/month picker keeps
   *  working in monthly view. */
  year: number;
  /** Anchor 1-12 month value. Same back-compat purpose as year. */
  month: number;
  /** Machines as flat list — used by Excel export header. */
  machines: MachineCol[];
  /** Same machines grouped by their vendor — used by HTML view. */
  vendorGroups: VendorGroup[];
  /** One row per day of the month (always full month). */
  rows: DailyRow[];
  /** Per-machine totals + averages over working days (any day with
   *  any value). */
  perMachine: Record<
    string,
    {
      sqftTotal: number;
      cftTotal: number;
      sqftAvg: number;
      cftAvg: number;
      workingDays: number;
    }
  >;
  /** Sum across every machine. */
  grandTotalSqft: number;
  grandTotalCft: number;
  /** Mig 054 — fleet-wide cost totals (prorated to the period).
   *  Operational = sum of cnc_vendor_expenses rows for the
   *  vendor/month combos in this report's range.
   *  Depreciation = sum of monthlyDepreciationFor() across every
   *  machine for the period.
   *  Total      = sum of the two. */
  grandTotalOperational: number;
  grandTotalDepreciation: number;
  grandTotalCost: number;
  /** Mig 053 follow-on (Daksh): single "total work units" proxy
   *  metric — SFT + CFT added together. Not physically meaningful
   *  (mixing area + volume) but useful as a single number on the
   *  summary panel + Excel footer to compare months at a glance. */
  grandTotalCombined: number;
  /** Aggregate working days = max across machines (a day is counted
   *  if any machine logged anything on it). */
  workingDaysAcrossFleet: number;
  /** "MTCPL per machine average" — grand total / number of machines. */
  perMachineAvgSqft: number;
  perMachineAvgCft: number;
  /** Mig 053 follow-on (Daksh): per-CNC-operator (vendor) totals.
   *  Each vendor's row sums every machine that belongs to them.
   *  Useful for the operator-level KPI Daksh asked for ("total
   *  production from per CNC operator whole"). */
  perVendor: Record<
    string,
    {
      vendor_id: string;
      vendor_name: string;
      sqftTotal: number;
      cftTotal: number;
      combinedTotal: number;
      machineCount: number;
      /** Working days across this operator's fleet (any machine
       *  active = counted). */
      workingDays: number;
      /** Mig 054 — operational expense for the period (prorated).
       *  Sum of cnc_vendor_expenses across days in range,
       *  weighting each by 1/daysInMonth for its calendar month. */
      operationalForPeriod: number;
      /** Mig 054 — depreciation cost for the period (prorated).
       *  Sum across machines: monthlyDepreciation / daysInMonth ×
       *  days that machine's month overlaps the report period. */
      depreciationForPeriod: number;
      /** Operational + Depreciation. */
      totalCostForPeriod: number;
      /** Cost-per-unit. NaN / Infinity (zero production) handled
       *  by the display layer ("—"). */
      costPerSft: number;
      costPerCft: number;
      costPerCombined: number;
    }
  >;
};

function daysInMonth(year: number, month1Indexed: number): number {
  return new Date(year, month1Indexed, 0).getDate();
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

// IST midnight for a yyyy-mm-dd in UTC-equivalent timestamps.
// Our completed_at is stored as TIMESTAMPTZ, so when we extract the
// date we want IST local day boundaries (00:00:00 +05:30).
function istDateKey(iso: string): string {
  // Build a UTC date offset by +5h30m to land in IST, then format.
  const t = new Date(iso).getTime() + 5.5 * 60 * 60 * 1000;
  const d = new Date(t);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

// ── Mig 053 follow-on (Daksh): generalized period selection ──────
// The report builder used to be hardcoded monthly. Now it accepts
// a CncReportPeriod with kind = daily | weekly | monthly so the
// same code path produces all three views.

export type CncReportPeriod = {
  kind: "daily" | "weekly" | "monthly";
  /** YYYY-MM-DD inclusive. */
  startDate: string;
  /** YYYY-MM-DD inclusive. */
  endDate: string;
  /** Human-friendly label for the page header + Excel filename. */
  label: string;
  /** Only set when kind === "monthly", for the year/month picker. */
  year?: number;
  month?: number;
};

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Pure helper — derive a CncReportPeriod from query-string params.
 *  Used by both the page server component and the Excel route so
 *  they stay in sync. Falls back to "current month" when no params
 *  given (keeps the old default). */
export function cncPeriodFromSearch(sp: Record<string, string | string[] | undefined>): CncReportPeriod {
  const view = (typeof sp.view === "string" ? sp.view : "monthly") as
    | "daily"
    | "weekly"
    | "monthly";

  if (view === "daily") {
    const dateStr = typeof sp.date === "string" ? sp.date : istTodayKey();
    const d = parseDateKey(dateStr);
    return {
      kind: "daily",
      startDate: dateStr,
      endDate: dateStr,
      label: `${pad2(d.day)} ${MONTH_SHORT[d.month - 1]} ${d.year}`,
    };
  }

  if (view === "weekly") {
    // Default to the Monday of the current ISO week (Mon–Sun).
    const startStr = typeof sp.start === "string" ? sp.start : istWeekStartKey();
    const start = parseDateKey(startStr);
    const startMs = isoUtcMidnight(start);
    const endMs = startMs + 6 * 86_400_000;
    const end = parseDateKeyMs(endMs);
    const label =
      start.month === end.month
        ? `${pad2(start.day)}–${pad2(end.day)} ${MONTH_SHORT[start.month - 1]} ${start.year}`
        : `${pad2(start.day)} ${MONTH_SHORT[start.month - 1]} – ${pad2(end.day)} ${MONTH_SHORT[end.month - 1]} ${start.year}`;
    return {
      kind: "weekly",
      startDate: startStr,
      endDate: formatDateKey(end),
      label: `Week of ${label}`,
    };
  }

  // Monthly (default)
  const today = istTodayParts();
  const year = Number(sp.year) || today.year;
  const month = Math.min(12, Math.max(1, Number(sp.month) || today.month));
  const lastDay = daysInMonth(year, month);
  return {
    kind: "monthly",
    startDate: `${year}-${pad2(month)}-01`,
    endDate: `${year}-${pad2(month)}-${pad2(lastDay)}`,
    label: `${MONTH_NAMES[month - 1]} ${year}`,
    year,
    month,
  };
}

function parseDateKey(s: string): { year: number; month: number; day: number } {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) {
    const t = istTodayParts();
    return t;
  }
  return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
}

function parseDateKeyMs(ms: number): { year: number; month: number; day: number } {
  const d = new Date(ms);
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
  };
}

function isoUtcMidnight(p: { year: number; month: number; day: number }): number {
  return Date.UTC(p.year, p.month - 1, p.day, 0, 0, 0, 0);
}

function formatDateKey(p: { year: number; month: number; day: number }): string {
  return `${p.year}-${pad2(p.month)}-${pad2(p.day)}`;
}

function istTodayParts(): { year: number; month: number; day: number } {
  const t = Date.now() + 5.5 * 60 * 60 * 1000;
  const d = new Date(t);
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
  };
}

function istTodayKey(): string {
  return formatDateKey(istTodayParts());
}

/** Returns the Monday of the IST week that contains today. */
function istWeekStartKey(): string {
  const t = Date.now() + 5.5 * 60 * 60 * 1000;
  const d = new Date(t);
  // UTC day-of-week: 0 = Sun, 1 = Mon, ..., 6 = Sat. We want Monday-
  // anchored, so shift: daysBack = (weekday + 6) % 7.
  const weekday = d.getUTCDay();
  const daysBack = (weekday + 6) % 7;
  const monMs = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - daysBack * 86_400_000;
  return formatDateKey(parseDateKeyMs(monMs));
}

// ── Mig 054 — depreciation source data + math ────────────────────
// Each CNC machine carries a snapshot of its asset value (either
// purchase_price + purchase_date OR current_book_value +
// book_value_as_of) plus a depreciation rate and salvage floor.
// monthlyDepreciationFor() computes the WDV monthly share for any
// (machine, year, month).

type MachineAsset = {
  id: string;
  vendor_id: string;
  purchase_price: number | null;
  purchase_date: string | null;
  current_book_value: number | null;
  book_value_as_of: string | null;
  depreciation_rate_pct: number;
  salvage_value: number;
};

/** Returns the depreciation cost (₹) for one machine for one
 *  calendar month, using Written Down Value (WDV) method:
 *
 *    current_value = base × (1 - rate)^years_elapsed   (floored at salvage)
 *    monthly_share = current_value × rate / 12
 *
 *  Returns 0 when the machine has no asset data configured yet
 *  (graceful no-op so the report doesn't crash on partial setup). */
function monthlyDepreciationFor(
  machine: MachineAsset,
  forYear: number,
  forMonth: number,
): number {
  // Pick the base value + base date. Prefer purchase_price (more
  // accurate history) if both are present.
  let baseValue: number;
  let baseDate: Date;
  if (machine.purchase_price != null && machine.purchase_date) {
    baseValue = machine.purchase_price;
    baseDate = new Date(machine.purchase_date);
  } else if (machine.current_book_value != null && machine.book_value_as_of) {
    baseValue = machine.current_book_value;
    baseDate = new Date(machine.book_value_as_of);
  } else {
    return 0;
  }
  if (!Number.isFinite(baseDate.getTime())) return 0;

  const rate = Math.max(0, Math.min(1, machine.depreciation_rate_pct / 100));
  const salvage = Math.max(0, machine.salvage_value);

  // Years elapsed from base-date to the *middle* of the report
  // period (15th of the report's month — close enough for monthly
  // resolution).
  const reportMidMs = Date.UTC(forYear, forMonth - 1, 15);
  const yearsElapsed = Math.max(
    0,
    (reportMidMs - baseDate.getTime()) / (365.25 * 86_400_000),
  );

  const currentValue = Math.max(
    salvage,
    baseValue * Math.pow(1 - rate, yearsElapsed),
  );

  return (currentValue * rate) / 12;
}

/** Closing / current book value of a machine TODAY — the WDV-depreciated value
 *  from its purchase (or legacy book) base to now, floored at salvage. Returns
 *  null when there's no asset basis yet. Drives the read-only "Closing value"
 *  shown on the vendor page. */
export function currentBookValueFor(m: {
  purchase_price: number | string | null;
  purchase_date: string | null;
  current_book_value: number | string | null;
  book_value_as_of: string | null;
  depreciation_rate_pct: number | string | null;
  salvage_value: number | string | null;
}): number | null {
  let baseValue: number;
  let baseDate: Date;
  if (m.purchase_price != null && m.purchase_date) {
    baseValue = Number(m.purchase_price);
    baseDate = new Date(m.purchase_date);
  } else if (m.current_book_value != null && m.book_value_as_of) {
    baseValue = Number(m.current_book_value);
    baseDate = new Date(m.book_value_as_of);
  } else {
    return null;
  }
  if (!Number.isFinite(baseDate.getTime())) return null;
  const rate = Math.max(0, Math.min(1, Number(m.depreciation_rate_pct ?? 15) / 100));
  const salvage = Math.max(0, Number(m.salvage_value ?? 0));
  const yearsElapsed = Math.max(0, (Date.now() - baseDate.getTime()) / (365.25 * 86_400_000));
  return Math.max(salvage, baseValue * Math.pow(1 - rate, yearsElapsed));
}

/** Mig 053 follow-on (Daksh): generalized to accept any date range
 *  via CncReportPeriod. Daily / Weekly / Monthly views all flow
 *  through this same function — the page + Excel route compute the
 *  period from query-string params and pass it in. */
export async function buildCncReport(period: CncReportPeriod): Promise<CncMonthlyReport> {
  const admin = createAdminSupabaseClient();

  // Period bounds in IST. startDate is inclusive, endDate is
  // inclusive; the Postgres lt query needs one-past-end-day in ISO.
  const startIst = new Date(`${period.startDate}T00:00:00+05:30`);
  // endDate is inclusive Y-M-D; add one day in IST to get exclusive
  // upper bound for the query.
  const endParts = parseDateKey(period.endDate);
  const exclusiveEndMs =
    isoUtcMidnight(endParts) + 86_400_000 - 5.5 * 60 * 60 * 1000;
  const startIso = startIst.toISOString();
  const endIso = new Date(exclusiveEndMs).toISOString();

  // Pull every CNC machine + its vendor in one go.
  const [{ data: vendors }, { data: machines }] = await Promise.all([
    admin
      .from("vendors")
      .select("id, name, vendor_type")
      .eq("vendor_type", "CNC")
      .order("name"),
    admin
      .from("cnc_machines")
      // Mig 054 — pull the asset-register columns too so the
      // depreciation calc has everything it needs in one round-trip.
      .select(
        "id, vendor_id, machine_code, machine_type, " +
        "purchase_price, purchase_date, current_book_value, " +
        "book_value_as_of, depreciation_rate_pct, salvage_value",
      )
      .order("machine_code"),
  ]);

  const vendorById = new Map<string, { id: string; name: string }>();
  for (const v of (vendors ?? []) as Array<{ id: string; name: string }>) {
    vendorById.set(v.id, v);
  }

  // Mig 054 — keep the raw row so we can read the depreciation
  // columns later. machineCols is the trimmed public shape; the
  // raw asset register lives in `machineAssets`.
  type MachineRaw = {
    id: string;
    vendor_id: string;
    machine_code: string;
    machine_type: string | null;
    purchase_price: number | string | null;
    purchase_date: string | null;
    current_book_value: number | string | null;
    book_value_as_of: string | null;
    depreciation_rate_pct: number | string | null;
    salvage_value: number | string | null;
  };
  const machinesRaw = ((machines ?? []) as unknown as MachineRaw[]).filter((m) =>
    vendorById.has(m.vendor_id),
  );
  const machineAssets = new Map<string, MachineAsset>();
  for (const m of machinesRaw) {
    machineAssets.set(m.id, {
      id: m.id,
      vendor_id: m.vendor_id,
      purchase_price: m.purchase_price != null ? Number(m.purchase_price) : null,
      purchase_date: m.purchase_date,
      current_book_value: m.current_book_value != null ? Number(m.current_book_value) : null,
      book_value_as_of: m.book_value_as_of,
      depreciation_rate_pct: m.depreciation_rate_pct != null ? Number(m.depreciation_rate_pct) : 15,
      salvage_value: m.salvage_value != null ? Number(m.salvage_value) : 0,
    });
  }

  const machineCols: MachineCol[] = machinesRaw.map((m) => {
    const t = m.machine_type === "multi_head_2" || m.machine_type === "lathe"
      ? (m.machine_type as "multi_head_2" | "lathe")
      : "single_head";
    const v = vendorById.get(m.vendor_id)!;
    return {
      id: m.id,
      code: m.machine_code,
      vendor_id: v.id,
      vendor_name: v.name,
      type: t,
      showSqft: t !== "lathe",
    };
  });

  // Group machines under their vendor for the HTML view.
  const groupMap = new Map<string, VendorGroup>();
  for (const m of machineCols) {
    if (!groupMap.has(m.vendor_id)) {
      groupMap.set(m.vendor_id, { vendor_id: m.vendor_id, vendor_name: m.vendor_name, machines: [] });
    }
    groupMap.get(m.vendor_id)!.machines.push(m);
  }
  const vendorGroups = [...groupMap.values()].sort((a, b) =>
    a.vendor_name.localeCompare(b.vendor_name),
  );

  // Pull the carving_items completed in the window WITH the slab
  // dimensions in a single round-trip via a simple slab-id join.
  //
  // Mig 075 — keys on completed_on_cnc_machine_id (set permanently at
  // completion time) instead of cnc_machine_id (cleared on completion
  // since ce01026 so the cockpit's per-machine grouping stays clean).
  // Filtering on cnc_machine_id here would drop every newly-completed
  // row — the bug Daksh saw as "May 2026 report all zeros after I
  // added some CNCs". Backfill in mig 075 covers historical rows
  // (copies from cnc_machine_id where still set; falls back to
  // cnc_machine_events.unloaded and then held_from_machine_id).
  // Daksh (June 2026) — output counts at REVIEW APPROVAL, not at
  // unload. We window + day-bucket on review_approved_at (stamped on
  // approve, cleared on rework / reject) so reworked / rejected slabs
  // never count, matching the Various-Costing CNC report + the vendor
  // cockpit stat. The carving machine (completed_on_cnc_machine_id)
  // persists through approval, so the per-machine attribution is
  // unchanged.
  // Daksh (Jun 2026) — PAGINATED. Uncapped, this hit PostgREST's 1000-row
  // default and dropped rows for a busy month, so the per-day grid blanked
  // out older days at scale. Page through all rows before day-bucketing.
  type CncItemRow = {
    id: string;
    completed_on_cnc_machine_id: string | null;
    review_approved_at: string | null;
    slab_requirement_id: string;
    carving_sides: number | null;
  };
  const ITEM_PAGE = 1000;
  const items: CncItemRow[] = [];
  for (let offset = 0; offset < 500_000; offset += ITEM_PAGE) {
    const { data, error: itemsErr } = await admin
      .from("carving_items")
      .select("id, completed_on_cnc_machine_id, review_approved_at, slab_requirement_id, carving_sides")
      .gte("review_approved_at", startIso)
      .lt("review_approved_at", endIso)
      .not("completed_on_cnc_machine_id", "is", null)
      .not("review_approved_at", "is", null)
      .order("review_approved_at", { ascending: true })
      .range(offset, offset + ITEM_PAGE - 1);
    if (itemsErr) throw new Error(`carving_items: ${itemsErr.message}`);
    const pageRows = (data ?? []) as CncItemRow[];
    items.push(...pageRows);
    if (pageRows.length < ITEM_PAGE) break;
  }

  const slabIds = [
    ...new Set(((items ?? []) as { slab_requirement_id: string }[]).map((i) => i.slab_requirement_id)),
  ];
  const slabDims = new Map<string, { l: number; w: number; t: number }>();
  if (slabIds.length > 0) {
    const { data: slabs } = await admin
      .from("slab_requirements")
      .select("id, length_ft, width_ft, thickness_ft")
      .in("id", slabIds);
    for (const s of (slabs ?? []) as Array<{
      id: string; length_ft: number | string; width_ft: number | string; thickness_ft: number | string;
    }>) {
      slabDims.set(s.id, {
        l: Number(s.length_ft) || 0,
        w: Number(s.width_ft) || 0,
        t: Number(s.thickness_ft) || 0,
      });
    }
  }

  // Build the (machine, day) → { sqft, cft } accumulator. One row
  // per day in the requested period (daily=1, weekly=7, monthly≈30).
  const rows: DailyRow[] = [];
  const startParts = parseDateKey(period.startDate);
  const endPartsForLoop = parseDateKey(period.endDate);
  const startMs = isoUtcMidnight(startParts);
  const endMs = isoUtcMidnight(endPartsForLoop);
  for (let ms = startMs; ms <= endMs; ms += 86_400_000) {
    rows.push({ date: formatDateKey(parseDateKeyMs(ms)), values: {} });
  }
  const rowByDate = new Map<string, DailyRow>();
  for (const r of rows) rowByDate.set(r.date, r);

  // Mig 053 follow-on (Daksh, May 2026): "SFT vs CFT" is now a
  // mutually-exclusive classification PER SLAB based on thickness:
  //
  //   • thickness ≤ 1 ft  (i.e. ≤ 12 inches stored)  → SFT only
  //   • thickness >  1 ft                            → CFT only
  //
  // Rationale: thin slabs are sold/tracked by surface area; thick
  // pieces by volume. Mixing both for every slab made the report
  // ambiguous. Note the column is named `thickness_ft` but the
  // value is actually stored in INCHES — same as length / width
  // throughout this codebase (the /1728 conversion in the legacy
  // CFT formula confirms this).
  //
  // Display layer renders "—" for whichever number is zero in a
  // given cell, so the visual is "this work was measured in SFT"
  // or "in CFT" but never both for the same slab.
  for (const it of (items ?? []) as Array<{
    completed_on_cnc_machine_id: string | null; review_approved_at: string; slab_requirement_id: string; carving_sides?: number | null;
  }>) {
    const machineId = it.completed_on_cnc_machine_id;
    if (!machineId) continue;
    const dim = slabDims.get(it.slab_requirement_id);
    if (!dim) continue;
    // Mig 088 — double-side carving counts output x2.
    const sides = Number(it.carving_sides) === 2 ? 2 : 1;
    const sqft = ((dim.l * dim.w) / 144) * sides;
    const cft = ((dim.l * dim.w * dim.t) / 1728) * sides;
    const dateKey = istDateKey(it.review_approved_at);
    const row = rowByDate.get(dateKey);
    if (!row) continue;
    const cell = row.values[machineId] ?? { sqft: 0, cft: 0 };
    if (dim.t <= 12) {
      // Thin slab → contribute to SFT only.
      cell.sqft = (cell.sqft ?? 0) + sqft;
    } else {
      // Thick slab → contribute to CFT only.
      cell.cft = cell.cft + cft;
    }
    row.values[machineId] = cell;
  }

  // ── Mig 054 — fetch operational expenses for every (vendor, year,
  // month) that the report's date range touches. Single round-trip
  // — keyed by vendor/year/month in-memory. Soft-cancelled rows
  // excluded by partial-index condition on the query.
  //
  // Build the unique set of (year, month) pairs the period spans.
  // Mig 063 follow-on (Daksh) — electricity bills always lag a
  // month. For the calc, shift the electricity lookup to the
  // previous month so a "current month" report (May) uses the
  // April electricity entry that's already on hand. Other
  // categories stay on the period's own month.
  //
  // We need to fetch every touched month AND its previous month
  // for electricity lookups. Built the union below + keyed the
  // result map by category so the day-loop downstream can split.
  function prevMonthOf(y: number, m: number): { year: number; month: number } {
    return m === 1 ? { year: y - 1, month: 12 } : { year: y, month: m - 1 };
  }
  const yearMonthPairs = new Set<string>();
  for (let ms = startMs; ms <= endMs; ms += 86_400_000) {
    const p = parseDateKeyMs(ms);
    yearMonthPairs.add(`${p.year}|${p.month}`);
    const pm = prevMonthOf(p.year, p.month);
    yearMonthPairs.add(`${pm.year}|${pm.month}`);
  }
  const yearList = [...new Set([...yearMonthPairs].map((k) => Number(k.split("|")[0])))];
  const monthList = [...new Set([...yearMonthPairs].map((k) => Number(k.split("|")[1])))];

  // Mig 071 fix (Daksh, June 2026) — plant-wide electricity lives in
  // its OWN table (cnc_plant_electricity: one bill per month). The
  // report used to read electricity from cnc_vendor_expenses
  // (per-vendor), which is empty for it since mig 071 — so operational
  // showed ₹0 even after the May bill was entered. Pull the plant bill
  // here; it's prorated over the period + allocated to vendors by
  // output share below, on the SAME one-month-back shift (utility
  // bills arrive late, so June's report uses May's bill).
  const plantElectricByMonth = new Map<string, number>(); // "year|month" → amount
  if (yearMonthPairs.size > 0) {
    const { data: peRaw, error: peErr } = await admin
      .from("cnc_plant_electricity")
      .select("year, month, amount")
      .in("year", yearList)
      .in("month", monthList)
      .is("cancelled_at", null);
    if (!peErr) {
      for (const r of (peRaw ?? []) as Array<{
        year: number;
        month: number;
        amount: number | string;
      }>) {
        const k = `${r.year}|${r.month}`;
        plantElectricByMonth.set(
          k,
          (plantElectricByMonth.get(k) ?? 0) + Number(r.amount ?? 0),
        );
      }
    }
  }

  // Two lookups: non-electricity (same-month) + LEGACY per-vendor
  // electricity (shifted) — only matters for months entered before
  // mig 071 moved electricity to the plant-wide table above.
  const nonElectricByVendorMonth = new Map<string, number>(); // vendor|year|month
  const electricByVendorMonth = new Map<string, number>();    // vendor|year|month
  if (yearMonthPairs.size > 0 && machineCols.length > 0) {
    const distinctVendorIds = [...new Set(machineCols.map((m) => m.vendor_id))];

    // Over-fetch by (years × months) and filter in-memory — the
    // (year, month) grid is at most 2×12 = 24 cells, and the
    // table is small, so this is cheap.
    const { data: expensesRaw, error: expensesErr } = await admin
      .from("cnc_vendor_expenses")
      .select("vendor_id, year, month, category, amount")
      .in("vendor_id", distinctVendorIds)
      .in("year", yearList)
      .in("month", monthList)
      .is("cancelled_at", null);
    if (expensesErr) {
      // Migration 054 not yet applied on this environment → silently
      // proceed with zero expenses so the production-side report
      // still renders.
      console.warn("[cnc-monthly-report] expenses fetch failed", expensesErr);
    } else {
      for (const r of (expensesRaw ?? []) as Array<{
        vendor_id: string; year: number; month: number; category: string; amount: number | string;
      }>) {
        const key = `${r.vendor_id}|${r.year}|${r.month}`;
        const amount = Number(r.amount ?? 0);
        if (r.category === "electricity") {
          electricByVendorMonth.set(key, (electricByVendorMonth.get(key) ?? 0) + amount);
        } else {
          nonElectricByVendorMonth.set(key, (nonElectricByVendorMonth.get(key) ?? 0) + amount);
        }
      }
    }
  }

  // Per-machine totals + averages over days that had ANY work.
  const perMachine: CncMonthlyReport["perMachine"] = {};
  const fleetWorkingDays = new Set<string>();
  for (const m of machineCols) {
    let sqftTotal = 0;
    let cftTotal = 0;
    let workingDays = 0;
    for (const row of rows) {
      const v = row.values[m.id];
      if (!v) continue;
      const hasWork = (v.sqft ?? 0) > 0 || v.cft > 0;
      if (hasWork) {
        workingDays++;
        fleetWorkingDays.add(row.date);
      }
      sqftTotal += v.sqft ?? 0;
      cftTotal += v.cft;
    }
    perMachine[m.id] = {
      sqftTotal,
      cftTotal,
      sqftAvg: workingDays > 0 ? sqftTotal / workingDays : 0,
      cftAvg: workingDays > 0 ? cftTotal / workingDays : 0,
      workingDays,
    };
  }
  const grandTotalSqft = Object.values(perMachine).reduce((acc, p) => acc + p.sqftTotal, 0);
  const grandTotalCft = Object.values(perMachine).reduce((acc, p) => acc + p.cftTotal, 0);
  const grandTotalCombined = grandTotalSqft + grandTotalCft;

  // Mig 071 fix — prorate the plant electricity across the report
  // period (one-month-back shift). A full monthly view of June picks
  // up ALL of May's bill (Σ 1/daysInMonth over the month = 1); a
  // weekly / partial view gets the matching daily slice. Allocated to
  // vendors by output share inside the loop below.
  let plantElectricForPeriod = 0;
  for (let ms = startMs; ms <= endMs; ms += 86_400_000) {
    const p = parseDateKeyMs(ms);
    const dim = daysInMonth(p.year, p.month);
    const em = prevMonthOf(p.year, p.month);
    plantElectricForPeriod +=
      (plantElectricByMonth.get(`${em.year}|${em.month}`) ?? 0) / dim;
  }

  // Per-vendor (CNC operator) aggregation. Walk vendorGroups so the
  // order matches the on-screen header grouping.
  //
  // Mig 054 — also computes:
  //   • operationalForPeriod: sum of (monthExpense / daysInMonth)
  //     across every day in the report range, per vendor. Exact for
  //     monthly view; approximate for week-spanning-month-boundary.
  //   • depreciationForPeriod: same prorating but driven by
  //     monthlyDepreciationFor() across each vendor's machines.
  //   • totalCostForPeriod, costPerSft / Cft / Combined.
  const perVendor: CncMonthlyReport["perVendor"] = {};
  for (const grp of vendorGroups) {
    let sqftTotal = 0;
    let cftTotal = 0;
    const operatorWorkingDays = new Set<string>();
    for (const m of grp.machines) {
      const p = perMachine[m.id];
      if (!p) continue;
      sqftTotal += p.sqftTotal;
      cftTotal += p.cftTotal;
      // Walk daily rows to collect working days for this operator.
      for (const row of rows) {
        const v = row.values[m.id];
        if (!v) continue;
        if ((v.sqft ?? 0) > 0 || v.cft > 0) {
          operatorWorkingDays.add(row.date);
        }
      }
    }

    // ── Cost computation (mig 054) ──────────────────────────────
    let operationalForPeriod = 0;
    let depreciationForPeriod = 0;
    for (let ms = startMs; ms <= endMs; ms += 86_400_000) {
      const p = parseDateKeyMs(ms);
      const dim = daysInMonth(p.year, p.month);
      // Mig 063 follow-on (Daksh) — non-electricity stays on the
      // period's own month; electricity reaches back one month
      // (bills always arrive late, so the May report uses the
      // April electricity entry that's actually on file).
      const nonElectric = nonElectricByVendorMonth.get(
        `${grp.vendor_id}|${p.year}|${p.month}`,
      ) ?? 0;
      const electricMonth = prevMonthOf(p.year, p.month);
      const electric = electricByVendorMonth.get(
        `${grp.vendor_id}|${electricMonth.year}|${electricMonth.month}`,
      ) ?? 0;
      const monthlyOp = nonElectric + electric;
      operationalForPeriod += monthlyOp / dim;
      // Depreciation: sum across this vendor's machines.
      for (const m of grp.machines) {
        const asset = machineAssets.get(m.id);
        if (!asset) continue;
        const monthlyDep = monthlyDepreciationFor(asset, p.year, p.month);
        depreciationForPeriod += monthlyDep / dim;
      }
    }
    // Mig 071 fix — add this vendor's share of the plant-wide
    // electricity, split by output (SFT+CFT). The shares sum to the
    // full plant bill, so grandTotalOperational (= Σ per-vendor)
    // includes it. If there was no output at all, split it evenly so
    // the bill isn't lost.
    const vendorCombined = sqftTotal + cftTotal;
    const electricShare =
      grandTotalCombined > 0
        ? plantElectricForPeriod * (vendorCombined / grandTotalCombined)
        : vendorGroups.length > 0
          ? plantElectricForPeriod / vendorGroups.length
          : 0;
    operationalForPeriod += electricShare;

    const totalCostForPeriod = operationalForPeriod + depreciationForPeriod;
    const costPerSft = sqftTotal > 0 ? totalCostForPeriod / sqftTotal : NaN;
    const costPerCft = cftTotal > 0 ? totalCostForPeriod / cftTotal : NaN;
    const combined = sqftTotal + cftTotal;
    const costPerCombined = combined > 0 ? totalCostForPeriod / combined : NaN;

    perVendor[grp.vendor_id] = {
      vendor_id: grp.vendor_id,
      vendor_name: grp.vendor_name,
      sqftTotal,
      cftTotal,
      combinedTotal: combined,
      machineCount: grp.machines.length,
      workingDays: operatorWorkingDays.size,
      operationalForPeriod,
      depreciationForPeriod,
      totalCostForPeriod,
      costPerSft,
      costPerCft,
      costPerCombined,
    };
  }

  // Fleet-wide cost totals (mig 054).
  const grandTotalOperational = Object.values(perVendor).reduce(
    (acc, v) => acc + v.operationalForPeriod,
    0,
  );
  const grandTotalDepreciation = Object.values(perVendor).reduce(
    (acc, v) => acc + v.depreciationForPeriod,
    0,
  );
  const grandTotalCost = grandTotalOperational + grandTotalDepreciation;

  return {
    period,
    // Legacy aliases for the monthly view — kept so existing
    // consumers (Header picker) don't break. Daily/weekly views
    // set these to the period's anchor.
    year: period.year ?? parseDateKey(period.startDate).year,
    month: period.month ?? parseDateKey(period.startDate).month,
    machines: machineCols,
    vendorGroups,
    rows,
    perMachine,
    grandTotalSqft,
    grandTotalCft,
    grandTotalCombined,
    grandTotalOperational,
    grandTotalDepreciation,
    grandTotalCost,
    workingDaysAcrossFleet: fleetWorkingDays.size,
    perMachineAvgSqft: machineCols.length > 0 ? grandTotalSqft / machineCols.length : 0,
    perMachineAvgCft: machineCols.length > 0 ? grandTotalCft / machineCols.length : 0,
    perVendor,
  };
}

/** Backward-compatible wrapper — internal call sites that still
 *  use buildCncMonthlyReport(year, month) keep working. New code
 *  should use buildCncReport(period) directly. */
export async function buildCncMonthlyReport(year: number, month: number): Promise<CncMonthlyReport> {
  return buildCncReport({
    kind: "monthly",
    startDate: `${year}-${pad2(month)}-01`,
    endDate: `${year}-${pad2(month)}-${pad2(daysInMonth(year, month))}`,
    label: `${MONTH_NAMES[month - 1]} ${year}`,
    year,
    month,
  });
}
