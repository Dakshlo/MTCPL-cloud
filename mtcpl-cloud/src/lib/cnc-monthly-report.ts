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
 *   • A row counts toward (machine, day) if completed_at falls on
 *     that day in IST and cnc_machine_id is set.
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
      .select("id, vendor_id, machine_code, machine_type")
      .order("machine_code"),
  ]);

  const vendorById = new Map<string, { id: string; name: string }>();
  for (const v of (vendors ?? []) as Array<{ id: string; name: string }>) {
    vendorById.set(v.id, v);
  }

  const machineCols: MachineCol[] = ((machines ?? []) as Array<{
    id: string; vendor_id: string; machine_code: string; machine_type: string | null;
  }>)
    .filter((m) => vendorById.has(m.vendor_id))
    .map((m) => {
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
  const { data: items, error: itemsErr } = await admin
    .from("carving_items")
    .select("id, cnc_machine_id, completed_at, slab_requirement_id")
    .gte("completed_at", startIso)
    .lt("completed_at", endIso)
    .not("cnc_machine_id", "is", null)
    .not("completed_at", "is", null);
  if (itemsErr) throw new Error(`carving_items: ${itemsErr.message}`);

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
    cnc_machine_id: string | null; completed_at: string; slab_requirement_id: string;
  }>) {
    if (!it.cnc_machine_id) continue;
    const dim = slabDims.get(it.slab_requirement_id);
    if (!dim) continue;
    const sqft = (dim.l * dim.w) / 144;
    const cft = (dim.l * dim.w * dim.t) / 1728;
    const dateKey = istDateKey(it.completed_at);
    const row = rowByDate.get(dateKey);
    if (!row) continue;
    const cell = row.values[it.cnc_machine_id] ?? { sqft: 0, cft: 0 };
    if (dim.t <= 12) {
      // Thin slab → contribute to SFT only.
      cell.sqft = (cell.sqft ?? 0) + sqft;
    } else {
      // Thick slab → contribute to CFT only.
      cell.cft = cell.cft + cft;
    }
    row.values[it.cnc_machine_id] = cell;
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

  // Per-vendor (CNC operator) aggregation. Walk vendorGroups so the
  // order matches the on-screen header grouping.
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
    perVendor[grp.vendor_id] = {
      vendor_id: grp.vendor_id,
      vendor_name: grp.vendor_name,
      sqftTotal,
      cftTotal,
      combinedTotal: sqftTotal + cftTotal,
      machineCount: grp.machines.length,
      workingDays: operatorWorkingDays.size,
    };
  }

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
