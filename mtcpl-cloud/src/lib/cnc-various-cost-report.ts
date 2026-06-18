/**
 * Mig 078 follow-on — CNC Various Costing report.
 *
 * Daksh: the existing /carving/reports view is the paper-mirror
 * Excel-style monthly sheet (kept as a deep-dive link). This is a
 * different surface: a focused dashboard at /reports/various-costing/cnc
 * with the same period-toggle UX as the Cutter Costing page (daily /
 * weekly / monthly / yearly) plus a per-vendor breakdown table.
 *
 * Math:
 *   carved_cft_in_period = Σ slab CFT for carving_items where
 *                          review_approved_at ∈ period (output counts
 *                          at APPROVAL, not unload — rejected/reworked
 *                          slabs are excluded; see §1 below)
 *   carved_sft_in_period = Σ slab SFT for the same set
 *                          (length × width / 144)
 *   operational_cost     = Σ cnc_vendor_expenses (vendor_id, year, month)
 *                          rows that touch the period, prorated by
 *                          (days_in_window_within_month / days_in_month)
 *                          for sub-monthly views. Excludes cancelled.
 *   cost_per_sft         = operational_cost / sft
 *   cost_per_cft         = operational_cost / cft
 *
 * Deliberately operational-only (no depreciation) for this summary
 * surface. The full /carving/reports view bundles depreciation and
 * remains accessible from this page's "Open full Excel report"
 * link.
 *
 * The `_ft` suffix on slab_requirements dimension columns is
 * historical — values are stored in inches across this codebase
 * (cnc-monthly-report.ts line 510 comment). The /1728 (CFT) and
 * /144 (SFT) divisors handle the conversion.
 */

import { createAdminSupabaseClient } from "@/lib/supabase/admin";

export type CncPeriodKind = "daily" | "weekly" | "monthly" | "yearly";

export type CncReportPeriod = {
  kind: CncPeriodKind;
  /** YYYY-MM-DD inclusive. */
  startDate: string;
  /** YYYY-MM-DD inclusive. */
  endDate: string;
  /** Human-friendly label ("May 2026", "Week of 19–25 May 2026"). */
  label: string;
};

export type CncVendorRow = {
  vendorId: string;
  vendorName: string;
  cft: number;
  sft: number;
  /** sft + cft — combined carved output. */
  combined: number;
  slabsCount: number;
  /** Number of CNC machines assigned to this vendor. */
  machineCount: number;
  /** combined output ÷ days in the window (vendor's daily average). */
  perDay: number;
  /** combined ÷ machines ÷ days (per machine per day). NaN with no machines. */
  perMachinePerDay: number;
  /** Operational expenses for this vendor in the period (prorated). */
  operationalCost: number;
  /** Depreciation for this vendor's machines, prorated to the period. */
  depreciationCost: number;
  /** Operational + depreciation. */
  totalCost: number;
  /** totalCost / sft. NaN when no production. */
  costPerSft: number;
  /** totalCost / cft. NaN when no production. */
  costPerCft: number;
  /** totalCost / combined. NaN when no production. */
  costPerCombined: number;
};

export type CncExpenseBreakdownRow = {
  category: "tools" | "electricity" | "labor" | "office" | "maintenance" | "other";
  amount: number;
};

/** One carved slab counted in the period's output — feeds the
 *  click-through peek modal on the Output KPI tile so the user can
 *  audit "which 267 slabs make up this output?". Dimensions are in
 *  inches (slab_requirements stores inches despite the *_ft names). */
export type CncContributingSlab = {
  id: string;
  vendorName: string;
  stone: string | null;
  lengthIn: number;
  widthIn: number;
  thicknessIn: number;
  sft: number;
  cft: number;
  /** 1, or 2 for double-side carving (output counts x2). */
  sides: number;
};

export type CncVariousCostReport = {
  period: CncReportPeriod;
  totalCft: number;
  totalSft: number;
  slabsCount: number;
  /** Operational expense pool across all CNC vendors for the period
   *  (prorated for sub-monthly views). */
  operationalForPeriod: number;
  /** Depreciation across all CNC machines for the period (prorated).
   *  Same WDV math as /carving/reports — the two surfaces stay in
   *  agreement so the user doesn't see different totals between the
   *  summary and the deep-dive. */
  depreciationForPeriod: number;
  /** operationalForPeriod + depreciationForPeriod. */
  totalCostForPeriod: number;
  /** totalCostForPeriod / totalSft. NaN when no production. */
  costPerSft: number;
  /** totalCostForPeriod / totalCft. NaN when no production. */
  costPerCft: number;
  /** Effective days in the window (clamped to "today" for current/future
   *  periods) — powers the per-day / per-machine-per-day columns. */
  daysInWindow: number;
  /** Aggregate per-category operational breakdown across all CNC
   *  vendors. (Depreciation is shown as a single line in the UI,
   *  not split by category.) */
  expenseBreakdown: CncExpenseBreakdownRow[];
  /** One row per CNC vendor (active or not — we include vendors with
   *  EITHER carving output OR operational expenses OR machines in
   *  the period so the table shows a true picture). */
  perVendor: CncVendorRow[];
  /** Every carved slab counted in the period — feeds the Output tile's
   *  click-through peek modal. */
  contributingSlabs: CncContributingSlab[];
};

// ── Date helpers (IST-friendly) ───────────────────────────────────

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function daysInMonth(year: number, month1Indexed: number): number {
  return new Date(year, month1Indexed, 0).getDate();
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

function parseDateKey(s: string): { year: number; month: number; day: number } {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return istTodayParts();
  return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
}

function formatDateKey(p: { year: number; month: number; day: number }): string {
  return `${p.year}-${pad2(p.month)}-${pad2(p.day)}`;
}

function isoUtcMidnight(p: { year: number; month: number; day: number }): number {
  return Date.UTC(p.year, p.month - 1, p.day, 0, 0, 0, 0);
}

function parseDateKeyMs(ms: number): { year: number; month: number; day: number } {
  const d = new Date(ms);
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
  };
}

function istWeekStartKey(): string {
  const t = Date.now() + 5.5 * 60 * 60 * 1000;
  const d = new Date(t);
  const weekday = d.getUTCDay();
  const daysBack = (weekday + 6) % 7; // Mon-anchored
  const monMs = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - daysBack * 86_400_000;
  return formatDateKey(parseDateKeyMs(monMs));
}

/** Derive a CncReportPeriod from query-string params. Mirrors
 *  cutterPeriodFromSearch — keeps the two report URLs symmetrical. */
export function cncPeriodFromSearch(
  sp: Record<string, string | string[] | undefined>,
): CncReportPeriod {
  const view = (typeof sp.view === "string" ? sp.view : "monthly") as CncPeriodKind;

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
    const startStr = typeof sp.start === "string" ? sp.start : istWeekStartKey();
    const start = parseDateKey(startStr);
    const endMs = isoUtcMidnight(start) + 6 * 86_400_000;
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

  if (view === "yearly") {
    const today = istTodayParts();
    const year = Number(sp.year) || today.year;
    return {
      kind: "yearly",
      startDate: `${year}-01-01`,
      endDate: `${year}-12-31`,
      label: `${year}`,
    };
  }

  // Monthly (default).
  const today = istTodayParts();
  const year = Number(sp.year) || today.year;
  const month = Math.min(12, Math.max(1, Number(sp.month) || today.month));
  const lastDay = daysInMonth(year, month);
  return {
    kind: "monthly",
    startDate: `${year}-${pad2(month)}-01`,
    endDate: `${year}-${pad2(month)}-${pad2(lastDay)}`,
    label: `${MONTH_NAMES[month - 1]} ${year}`,
  };
}

function slabCft(l: number, w: number, t: number): number {
  return (l * w * t) / 1728;
}

function slabSft(l: number, w: number): number {
  return (l * w) / 144;
}

// ── Depreciation (mirrors src/lib/cnc-monthly-report.ts) ──────────
// Each CNC machine carries a snapshot of its asset value (either
// purchase_price + purchase_date OR current_book_value +
// book_value_as_of) plus a WDV (Written Down Value) rate and salvage
// floor. We compute the monthly share, prorate by days, sum per
// vendor + total. Math is identical to /carving/reports so the two
// surfaces show consistent numbers.

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

function monthlyDepreciationFor(
  machine: MachineAsset,
  forYear: number,
  forMonth: number,
): number {
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

/** For a (year, month) the report needs to know how many days of
 *  the period window fall inside that month. Used to prorate
 *  monthly expense totals down to weekly / daily views. */
function daysOfWindowInMonth(
  windowStart: string,
  windowEnd: string,
  year: number,
  month: number,
): number {
  const monthStart = isoUtcMidnight({ year, month, day: 1 });
  const monthEnd = isoUtcMidnight({ year, month, day: daysInMonth(year, month) });
  const winStart = isoUtcMidnight(parseDateKey(windowStart));
  // Clamp the window end to TODAY (IST) so a current / partial month prorates
  // cost to the days ELAPSED, not the full calendar month — Daksh: on the 17th,
  // June costs 17 days of expense against its 17 days of output, not the full 30.
  const todayMs = isoUtcMidnight(istTodayParts());
  const winEnd = Math.min(isoUtcMidnight(parseDateKey(windowEnd)), todayMs);
  const overlapStart = Math.max(monthStart, winStart);
  const overlapEnd = Math.min(monthEnd, winEnd);
  if (overlapEnd < overlapStart) return 0;
  return Math.floor((overlapEnd - overlapStart) / 86_400_000) + 1;
}

/** Enumerate every (year, month) that the period window touches. */
function monthsTouchedBy(startDate: string, endDate: string): Array<{ year: number; month: number }> {
  const s = parseDateKey(startDate);
  const e = parseDateKey(endDate);
  const months: Array<{ year: number; month: number }> = [];
  let y = s.year;
  let m = s.month;
  while (y < e.year || (y === e.year && m <= e.month)) {
    months.push({ year: y, month: m });
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return months;
}

// ── Main builder ──────────────────────────────────────────────────

export async function buildCncVariousCostReport(
  period: CncReportPeriod,
): Promise<CncVariousCostReport> {
  const admin = createAdminSupabaseClient();

  // Period bounds in IST. review_approved_at is TIMESTAMPTZ.
  const startIso = new Date(`${period.startDate}T00:00:00+05:30`).toISOString();
  const endParts = parseDateKey(period.endDate);
  const exclusiveEndMs = isoUtcMidnight(endParts) + 86_400_000 - 5.5 * 60 * 60 * 1000;
  const endIso = new Date(exclusiveEndMs).toISOString();

  // ── 0. Defunct CNC vendors to exclude (Daksh, June 2026) ──────
  // A vendor that is BOTH deactivated AND owns zero CNC machines is a
  // dead cost-centre (e.g. ALKESH) — it should not clutter the CNC
  // costing table or skew the per-unit cost. Resolve the set up front
  // and skip it in every aggregation loop below (same posture as the
  // Outsource skip) so the displayed rows and the totals stay in
  // agreement. A deactivated vendor that STILL owns machines keeps
  // showing — its depreciation is real and worth tracking.
  const excludedVendorIds = new Set<string>();
  {
    const [{ data: vendorActive }, { data: machineVendors }] = await Promise.all([
      admin.from("vendors").select("id, is_active"),
      admin.from("cnc_machines").select("vendor_id"),
    ]);
    const machineCountEarly = new Map<string, number>();
    for (const r of machineVendors ?? []) {
      const vid = (r as { vendor_id: string | null }).vendor_id;
      if (vid) machineCountEarly.set(vid, (machineCountEarly.get(vid) ?? 0) + 1);
    }
    for (const v of vendorActive ?? []) {
      const id = v.id as string;
      const active = (v as { is_active?: boolean | null }).is_active !== false;
      if (!active && (machineCountEarly.get(id) ?? 0) === 0) excludedVendorIds.add(id);
    }
  }

  // ── 1. Carving APPROVED within the window ─────────────────────
  // Daksh (June 2026) — output is counted at REVIEW APPROVAL, not at
  // unload. review_approved_at is stamped when the reviewer approves a
  // slab and CLEARED again on rework / reject, so a slab only counts
  // once it's genuinely accepted: unloaded-but-pending, reworked, and
  // rejected slabs never inflate carved output (or the cost-per-unit).
  // Matches the vendor cockpit "Carved · last 30 days" stat. We filter
  // on review_approved_at IS NOT NULL (rather than review_decision =
  // 'approved') so pre-mig-080 approvals — which carry a null decision
  // — still count.
  // Each row joins to slab_requirements for the dimensions. Per
  // earlier embedded-join issues, do two queries + a lookup map.
  const { data: items, error: itemsErr } = await admin
    .from("carving_items")
    .select("vendor_id, vendor_name, slab_requirement_id, review_approved_at, carving_sides, vendor_type")
    .gte("review_approved_at", startIso)
    .lt("review_approved_at", endIso)
    .not("review_approved_at", "is", null);
  if (itemsErr) throw new Error(`carving_items query failed: ${itemsErr.message}`);

  const slabIds = Array.from(
    new Set((items ?? []).map((r) => r.slab_requirement_id as string)),
  );

  type SlabRow = {
    id: string;
    length_ft: number;
    width_ft: number;
    thickness_ft: number;
    stone: string | null;
  };
  let slabMap = new Map<string, SlabRow>();
  if (slabIds.length > 0) {
    // Chunk to be safe — Supabase has soft caps on .in() lists.
    const CHUNK = 500;
    for (let i = 0; i < slabIds.length; i += CHUNK) {
      const part = slabIds.slice(i, i + CHUNK);
      const { data: slabs, error: slabsErr } = await admin
        .from("slab_requirements")
        .select("id, length_ft, width_ft, thickness_ft, stone")
        .in("id", part);
      if (slabsErr) throw new Error(`slab_requirements query failed: ${slabsErr.message}`);
      for (const s of slabs ?? []) {
        slabMap.set(s.id as string, {
          id: s.id as string,
          length_ft: Number(s.length_ft),
          width_ft: Number(s.width_ft),
          thickness_ft: Number(s.thickness_ft),
          stone: (s as { stone?: string | null }).stone ?? null,
        });
      }
    }
  }

  // Aggregate carved output per vendor.
  type VendorAgg = {
    vendorName: string;
    cft: number;
    sft: number;
    slabsCount: number;
  };
  const carvedByVendor = new Map<string, VendorAgg>();
  const contributingSlabs: CncContributingSlab[] = [];
  let totalCft = 0;
  let totalSft = 0;
  let totalSlabs = 0;
  for (const item of items ?? []) {
    // CNC costing counts CNC carving only — outsource jobwork is billed on
    // challans, not part of the plant's CNC cost. (null-safe: only Outsource
    // is excluded, so legacy CNC rows with no vendor_type still count.)
    if ((item as { vendor_type?: string | null }).vendor_type === "Outsource") continue;
    const slab = slabMap.get(item.slab_requirement_id as string);
    if (!slab) continue; // Defensive — orphan reference shouldn't happen but skip rather than crash.
    // Mig 088 — double-side carving counts output x2 (twice the work).
    const sides = Number((item as { carving_sides?: number }).carving_sides) === 2 ? 2 : 1;
    const cft = slabCft(slab.length_ft, slab.width_ft, slab.thickness_ft) * sides;
    const sft = slabSft(slab.length_ft, slab.width_ft) * sides;
    const vendorId = item.vendor_id as string;
    if (excludedVendorIds.has(vendorId)) continue; // defunct vendor — skip output + totals
    const existing = carvedByVendor.get(vendorId) ?? {
      vendorName: (item.vendor_name as string) || "Unknown",
      cft: 0,
      sft: 0,
      slabsCount: 0,
    };
    existing.cft += cft;
    existing.sft += sft;
    existing.slabsCount += 1;
    carvedByVendor.set(vendorId, existing);
    totalCft += cft;
    totalSft += sft;
    totalSlabs += 1;
    contributingSlabs.push({
      id: item.slab_requirement_id as string,
      vendorName: (item.vendor_name as string) || "Unknown",
      stone: slab.stone,
      lengthIn: slab.length_ft,
      widthIn: slab.width_ft,
      thicknessIn: slab.thickness_ft,
      sft,
      cft,
      sides,
    });
  }

  // ── 2. Operational expenses for the period ────────────────────
  // Pull every cnc_vendor_expenses row for the months the window
  // touches, prorate by days-in-window-within-month / days-in-month.
  const monthsTouched = monthsTouchedBy(period.startDate, period.endDate);
  const yearMonthPairs = monthsTouched.map((m) => ({ year: m.year, month: m.month }));

  // Build a per-vendor + per-category accumulator.
  type ExpenseAgg = {
    cost: number;
    byCategory: Record<CncExpenseBreakdownRow["category"], number>;
  };
  function emptyAgg(): ExpenseAgg {
    return {
      cost: 0,
      byCategory: {
        tools: 0,
        electricity: 0,
        labor: 0,
        office: 0,
        maintenance: 0,
        other: 0,
      },
    };
  }
  const expensesByVendor = new Map<string, ExpenseAgg>();
  const aggregateByCategory = emptyAgg();

  if (yearMonthPairs.length > 0) {
    // One round trip per month touched — at the pilot scale this is
    // at most 12 (yearly view) so the cost is negligible.
    for (const { year, month } of yearMonthPairs) {
      const { data: rows, error: expErr } = await admin
        .from("cnc_vendor_expenses")
        .select("vendor_id, category, amount")
        .eq("year", year)
        .eq("month", month)
        .is("cancelled_at", null);
      if (expErr) throw new Error(`cnc_vendor_expenses query failed: ${expErr.message}`);
      const daysInWindow = daysOfWindowInMonth(
        period.startDate,
        period.endDate,
        year,
        month,
      );
      const monthLen = daysInMonth(year, month);
      const shareFactor = monthLen > 0 ? daysInWindow / monthLen : 0;
      for (const r of rows ?? []) {
        const amt = Number(r.amount) * shareFactor;
        const cat = r.category as CncExpenseBreakdownRow["category"];
        const vendorId = r.vendor_id as string;
        if (excludedVendorIds.has(vendorId)) continue; // defunct vendor — skip its expenses + totals
        const va = expensesByVendor.get(vendorId) ?? emptyAgg();
        va.cost += amt;
        va.byCategory[cat] = (va.byCategory[cat] || 0) + amt;
        expensesByVendor.set(vendorId, va);
        aggregateByCategory.cost += amt;
        aggregateByCategory.byCategory[cat] =
          (aggregateByCategory.byCategory[cat] || 0) + amt;
      }
    }
  }

  // ── 2a. Plant-wide electricity (mig 071 fix, Daksh June 2026) ──
  // Electricity now lives in its OWN table (cnc_plant_electricity,
  // one bill per month). This report read electricity only from
  // cnc_vendor_expenses (per-vendor), which is empty for it since
  // mig 071 — so operational showed ₹0 even after the May bill was
  // entered. Pull the plant bill on a one-month-BACK shift (utility
  // bills arrive late, so June's report uses May's bill), prorate it
  // to the window, and fold it into the electricity category + total.
  // It's split across vendors by output share when the per-vendor
  // rows are composed below.
  function prevMonthOf(y: number, m: number): { year: number; month: number } {
    return m === 1 ? { year: y - 1, month: 12 } : { year: y, month: m - 1 };
  }
  let plantElectricForPeriod = 0;
  for (const { year, month } of yearMonthPairs) {
    const em = prevMonthOf(year, month);
    const { data: peRows } = await admin
      .from("cnc_plant_electricity")
      .select("amount")
      .eq("year", em.year)
      .eq("month", em.month)
      .is("cancelled_at", null);
    const monthLen = daysInMonth(year, month);
    const daysInWindow = daysOfWindowInMonth(
      period.startDate,
      period.endDate,
      year,
      month,
    );
    const shareFactor = monthLen > 0 ? daysInWindow / monthLen : 0;
    for (const r of peRows ?? []) {
      plantElectricForPeriod +=
        Number((r as { amount: number | string }).amount ?? 0) * shareFactor;
    }
  }
  aggregateByCategory.byCategory.electricity += plantElectricForPeriod;
  aggregateByCategory.cost += plantElectricForPeriod;

  const operationalForPeriod = aggregateByCategory.cost;

  // ── 2b. Depreciation per vendor (prorated to the window) ──────
  // One fetch of every CNC machine + its asset register columns.
  // For each (machine, year, month) the window touches, compute
  // monthlyDepreciationFor() and prorate by days_in_window /
  // days_in_month. Sum into the vendor's depreciation bucket.
  const { data: machines, error: machinesErr } = await admin
    .from("cnc_machines")
    .select(
      "id, vendor_id, purchase_price, purchase_date, current_book_value, book_value_as_of, depreciation_rate_pct, salvage_value",
    );
  if (machinesErr) throw new Error(`cnc_machines query failed: ${machinesErr.message}`);

  // How many machines each vendor has (for the per-machine-per-day column).
  const machineCountByVendor = new Map<string, number>();
  for (const raw of machines ?? []) {
    const vid = raw.vendor_id as string;
    if (vid) machineCountByVendor.set(vid, (machineCountByVendor.get(vid) ?? 0) + 1);
  }

  const depreciationByVendor = new Map<string, number>();
  let depreciationForPeriod = 0;
  for (const raw of machines ?? []) {
    const m: MachineAsset = {
      id: raw.id as string,
      vendor_id: raw.vendor_id as string,
      purchase_price:
        raw.purchase_price == null ? null : Number(raw.purchase_price),
      purchase_date: raw.purchase_date as string | null,
      current_book_value:
        raw.current_book_value == null ? null : Number(raw.current_book_value),
      book_value_as_of: raw.book_value_as_of as string | null,
      depreciation_rate_pct: Number(raw.depreciation_rate_pct ?? 0),
      salvage_value: Number(raw.salvage_value ?? 0),
    };
    let machineTotal = 0;
    for (const { year, month } of yearMonthPairs) {
      const monthly = monthlyDepreciationFor(m, year, month);
      if (monthly <= 0) continue;
      const monthLen = daysInMonth(year, month);
      const daysInWindow = daysOfWindowInMonth(
        period.startDate,
        period.endDate,
        year,
        month,
      );
      // Day-level proration matches the operational expense math
      // above + the existing /carving/reports per-vendor numbers.
      machineTotal += monthly * (monthLen > 0 ? daysInWindow / monthLen : 0);
    }
    if (machineTotal > 0) {
      const existing = depreciationByVendor.get(m.vendor_id) ?? 0;
      depreciationByVendor.set(m.vendor_id, existing + machineTotal);
      depreciationForPeriod += machineTotal;
    }
  }

  // ── 3. Resolve vendor names for any vendor that has expenses
  //     but no carving output in the window (so the table still
  //     shows them — they spent money even if no slabs landed). ──
  const allVendorIds = new Set<string>([
    ...carvedByVendor.keys(),
    ...expensesByVendor.keys(),
    ...depreciationByVendor.keys(),
  ]);
  const knownNames = new Map<string, string>();
  for (const [id, v] of carvedByVendor) knownNames.set(id, v.vendorName);
  const missingNameIds = Array.from(allVendorIds).filter((id) => !knownNames.has(id));
  if (missingNameIds.length > 0) {
    const { data: vendors } = await admin
      .from("vendors")
      .select("id, name")
      .in("id", missingNameIds);
    for (const v of vendors ?? []) {
      knownNames.set(v.id as string, (v.name as string) || "Unknown");
    }
  }

  // Effective days in the window — clamped to "today" so a current month
  // (or week/year) divides by days ELAPSED, not the full calendar span.
  const nowIst = new Date(Date.now() + 5.5 * 3600 * 1000);
  const todayKey = `${nowIst.getUTCFullYear()}-${String(nowIst.getUTCMonth() + 1).padStart(2, "0")}-${String(nowIst.getUTCDate()).padStart(2, "0")}`;
  const effEnd = period.endDate < todayKey ? period.endDate : (todayKey < period.startDate ? period.startDate : todayKey);
  const dayMs = 86400000;
  const startMs = Date.UTC(+period.startDate.slice(0, 4), +period.startDate.slice(5, 7) - 1, +period.startDate.slice(8, 10));
  const endMs = Date.UTC(+effEnd.slice(0, 4), +effEnd.slice(5, 7) - 1, +effEnd.slice(8, 10));
  const daysInWindow = Math.max(1, Math.floor((endMs - startMs) / dayMs) + 1);

  // ── 4. Compose per-vendor rows ────────────────────────────────
  const totalCombinedOutput = totalSft + totalCft;
  const perVendor: CncVendorRow[] = Array.from(allVendorIds).map((vendorId) => {
    const carved = carvedByVendor.get(vendorId);
    const exp = expensesByVendor.get(vendorId);
    const cft = carved?.cft ?? 0;
    const sft = carved?.sft ?? 0;
    const slabsCount = carved?.slabsCount ?? 0;
    // Mig 071 fix — plant electricity is plant-wide; allocate this
    // vendor's share by output (SFT+CFT). The shares sum to the full
    // plant bill, so the per-vendor operational totals tie out to
    // operationalForPeriod above. Even split if there was no output.
    const electricShare =
      totalCombinedOutput > 0
        ? plantElectricForPeriod * ((sft + cft) / totalCombinedOutput)
        : allVendorIds.size > 0
          ? plantElectricForPeriod / allVendorIds.size
          : 0;
    const operationalCost = (exp?.cost ?? 0) + electricShare;
    const depreciationCost = depreciationByVendor.get(vendorId) ?? 0;
    const totalCost = operationalCost + depreciationCost;
    const combined = sft + cft;
    const machineCount = machineCountByVendor.get(vendorId) ?? 0;
    return {
      vendorId,
      vendorName: knownNames.get(vendorId) || "Unknown",
      cft,
      sft,
      combined,
      slabsCount,
      machineCount,
      perDay: combined / daysInWindow,
      perMachinePerDay: machineCount > 0 ? combined / machineCount / daysInWindow : NaN,
      operationalCost,
      depreciationCost,
      totalCost,
      costPerSft: sft > 0 ? totalCost / sft : NaN,
      costPerCft: cft > 0 ? totalCost / cft : NaN,
      costPerCombined: combined > 0 ? totalCost / combined : NaN,
    };
  });
  // Sort by total cost desc — biggest contributors at the top.
  perVendor.sort((a, b) => b.totalCost - a.totalCost || b.cft - a.cft);

  // ── 5. Category breakdown ─────────────────────────────────────
  const CATEGORIES: CncExpenseBreakdownRow["category"][] = [
    "labor",
    "electricity",
    "tools",
    "maintenance",
    "office",
    "other",
  ];
  const expenseBreakdown: CncExpenseBreakdownRow[] = CATEGORIES.map((c) => ({
    category: c,
    amount: aggregateByCategory.byCategory[c] || 0,
  }));

  const totalCostForPeriod = operationalForPeriod + depreciationForPeriod;

  return {
    period,
    totalCft,
    totalSft,
    slabsCount: totalSlabs,
    operationalForPeriod,
    depreciationForPeriod,
    totalCostForPeriod,
    costPerSft: totalSft > 0 ? totalCostForPeriod / totalSft : NaN,
    costPerCft: totalCft > 0 ? totalCostForPeriod / totalCft : NaN,
    daysInWindow,
    expenseBreakdown,
    perVendor,
    contributingSlabs,
  };
}
