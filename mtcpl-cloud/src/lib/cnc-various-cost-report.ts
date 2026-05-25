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
 *                          completed_at ∈ period
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
  slabsCount: number;
  /** Operational expenses for this vendor in the period (prorated). */
  cost: number;
  /** cost / sft. NaN when no production. */
  costPerSft: number;
  /** cost / cft. NaN when no production. */
  costPerCft: number;
};

export type CncExpenseBreakdownRow = {
  category: "tools" | "electricity" | "labor" | "office" | "maintenance" | "other";
  amount: number;
};

export type CncVariousCostReport = {
  period: CncReportPeriod;
  totalCft: number;
  totalSft: number;
  slabsCount: number;
  /** Operational expense pool across all CNC vendors for the period
   *  (prorated for sub-monthly views). Does NOT include depreciation
   *  — that lives on the full /carving/reports page. */
  operationalForPeriod: number;
  costPerSft: number;
  costPerCft: number;
  /** Aggregate per-category breakdown across all CNC vendors. */
  expenseBreakdown: CncExpenseBreakdownRow[];
  /** One row per CNC vendor (active or not — we include vendors with
   *  EITHER carving output OR operational expenses in the period so
   *  the table shows a true picture). */
  perVendor: CncVendorRow[];
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
  const winEnd = isoUtcMidnight(parseDateKey(windowEnd));
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

  // Period bounds in IST. completed_at is TIMESTAMPTZ.
  const startIso = new Date(`${period.startDate}T00:00:00+05:30`).toISOString();
  const endParts = parseDateKey(period.endDate);
  const exclusiveEndMs = isoUtcMidnight(endParts) + 86_400_000 - 5.5 * 60 * 60 * 1000;
  const endIso = new Date(exclusiveEndMs).toISOString();

  // ── 1. Carving completed within the window ────────────────────
  // Each row joins to slab_requirements for the dimensions. Per
  // earlier embedded-join issues, do two queries + a lookup map.
  const { data: items, error: itemsErr } = await admin
    .from("carving_items")
    .select("vendor_id, vendor_name, slab_requirement_id, completed_at")
    .gte("completed_at", startIso)
    .lt("completed_at", endIso)
    .not("completed_at", "is", null);
  if (itemsErr) throw new Error(`carving_items query failed: ${itemsErr.message}`);

  const slabIds = Array.from(
    new Set((items ?? []).map((r) => r.slab_requirement_id as string)),
  );

  type SlabRow = {
    id: string;
    length_ft: number;
    width_ft: number;
    thickness_ft: number;
  };
  let slabMap = new Map<string, SlabRow>();
  if (slabIds.length > 0) {
    // Chunk to be safe — Supabase has soft caps on .in() lists.
    const CHUNK = 500;
    for (let i = 0; i < slabIds.length; i += CHUNK) {
      const part = slabIds.slice(i, i + CHUNK);
      const { data: slabs, error: slabsErr } = await admin
        .from("slab_requirements")
        .select("id, length_ft, width_ft, thickness_ft")
        .in("id", part);
      if (slabsErr) throw new Error(`slab_requirements query failed: ${slabsErr.message}`);
      for (const s of slabs ?? []) {
        slabMap.set(s.id as string, {
          id: s.id as string,
          length_ft: Number(s.length_ft),
          width_ft: Number(s.width_ft),
          thickness_ft: Number(s.thickness_ft),
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
  let totalCft = 0;
  let totalSft = 0;
  let totalSlabs = 0;
  for (const item of items ?? []) {
    const slab = slabMap.get(item.slab_requirement_id as string);
    if (!slab) continue; // Defensive — orphan reference shouldn't happen but skip rather than crash.
    const cft = slabCft(slab.length_ft, slab.width_ft, slab.thickness_ft);
    const sft = slabSft(slab.length_ft, slab.width_ft);
    const vendorId = item.vendor_id as string;
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

  const operationalForPeriod = aggregateByCategory.cost;

  // ── 3. Resolve vendor names for any vendor that has expenses
  //     but no carving output in the window (so the table still
  //     shows them — they spent money even if no slabs landed). ──
  const allVendorIds = new Set<string>([
    ...carvedByVendor.keys(),
    ...expensesByVendor.keys(),
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

  // ── 4. Compose per-vendor rows ────────────────────────────────
  const perVendor: CncVendorRow[] = Array.from(allVendorIds).map((vendorId) => {
    const carved = carvedByVendor.get(vendorId);
    const exp = expensesByVendor.get(vendorId);
    const cft = carved?.cft ?? 0;
    const sft = carved?.sft ?? 0;
    const slabsCount = carved?.slabsCount ?? 0;
    const cost = exp?.cost ?? 0;
    return {
      vendorId,
      vendorName: knownNames.get(vendorId) || "Unknown",
      cft,
      sft,
      slabsCount,
      cost,
      costPerSft: sft > 0 ? cost / sft : NaN,
      costPerCft: cft > 0 ? cost / cft : NaN,
    };
  });
  // Sort by cost desc — biggest contributors at the top.
  perVendor.sort((a, b) => b.cost - a.cost || b.cft - a.cft);

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

  return {
    period,
    totalCft,
    totalSft,
    slabsCount: totalSlabs,
    operationalForPeriod,
    costPerSft: totalSft > 0 ? operationalForPeriod / totalSft : NaN,
    costPerCft: totalCft > 0 ? operationalForPeriod / totalCft : NaN,
    expenseBreakdown,
    perVendor,
  };
}
