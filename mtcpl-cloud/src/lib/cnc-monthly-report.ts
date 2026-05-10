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
 *   • SQFT = (length_in × width_in) / 144
 *   • CFT  = (length_in × width_in × thickness_in) / 1728
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
  /** YYYY value of the report. */
  year: number;
  /** 1-12 month value. */
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
  /** Aggregate working days = max across machines (a day is counted
   *  if any machine logged anything on it). */
  workingDaysAcrossFleet: number;
  /** "MTCPL per machine average" — grand total / number of machines. */
  perMachineAvgSqft: number;
  perMachineAvgCft: number;
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

export async function buildCncMonthlyReport(year: number, month: number): Promise<CncMonthlyReport> {
  const admin = createAdminSupabaseClient();

  // Month bounds in IST. We over-fetch by one day on each side to
  // catch edge-rollover rows; istDateKey filters to the right day.
  const startIst = new Date(`${year}-${pad2(month)}-01T00:00:00+05:30`);
  const endIst = new Date(year, month, 1); // exclusive end (UTC, but used for ISO compare)
  endIst.setHours(0, 0, 0, 0);
  const startIso = startIst.toISOString();
  const endIso = new Date(endIst.getTime()).toISOString();

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

  // Build the (machine, day) → { sqft, cft } accumulator.
  const days = daysInMonth(year, month);
  const rows: DailyRow[] = [];
  for (let d = 1; d <= days; d++) {
    rows.push({ date: `${year}-${pad2(month)}-${pad2(d)}`, values: {} });
  }
  const rowByDate = new Map<string, DailyRow>();
  for (const r of rows) rowByDate.set(r.date, r);

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
    cell.sqft = (cell.sqft ?? 0) + sqft;
    cell.cft = cell.cft + cft;
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

  return {
    year,
    month,
    machines: machineCols,
    vendorGroups,
    rows,
    perMachine,
    grandTotalSqft,
    grandTotalCft,
    workingDaysAcrossFleet: fleetWorkingDays.size,
    perMachineAvgSqft: machineCols.length > 0 ? grandTotalSqft / machineCols.length : 0,
    perMachineAvgCft: machineCols.length > 0 ? grandTotalCft / machineCols.length : 0,
  };
}
