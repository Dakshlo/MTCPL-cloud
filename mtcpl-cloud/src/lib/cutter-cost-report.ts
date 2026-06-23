/**
 * Mig 060 — Cutter cost report. Parallel to cnc-monthly-report.ts
 * but simpler: aggregate-only (no per-machine / per-vendor split),
 * straight-line depreciation, single pool of operational expenses.
 *
 * The math Daksh asked for:
 *
 *   monthly_dep   = book_value / (useful_life_years * 12)
 *   period_cost   = sum(cutter_expenses in period)
 *                 + monthly_dep × (days_in_period / 30)        // prorated
 *   cft_in_period = sum(block_cft) for cut_session_blocks where
 *                     status = 'done' AND approved_at ∈ period
 *   cost_per_cft  = period_cost / cft_in_period
 *
 * Period kinds: daily / weekly / monthly / yearly. Same query-string
 * driven selector as the CNC report so the UI can stay consistent.
 *
 * Block CFT comes from blocks.length_ft × width_ft × height_ft /
 * 1728 — the columns are named "_ft" but store inches everywhere in
 * this codebase (cnc-monthly-report.ts line 510-512 explains why).
 */

import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { POST_CUT_STATUSES } from "@/lib/slab-statuses";

export type CutterPeriodKind = "daily" | "weekly" | "monthly" | "yearly";

export type CutterReportPeriod = {
  kind: CutterPeriodKind;
  /** YYYY-MM-DD inclusive. */
  startDate: string;
  /** YYYY-MM-DD inclusive. */
  endDate: string;
  /** Human-friendly label for the page header. */
  label: string;
};

export type CutterExpenseBreakdownRow = {
  category: "electricity" | "manpower" | "repair_maintenance" | "other";
  amount: number;
};

/** Mig 063 follow-on (Daksh) — each slab that contributed to the
 *  period's CFT total. Used by the click-through peek modal on the
 *  report page so the user can audit "which 2,588 CFT exactly are
 *  we counting?". Shape mirrors the columns shown in the Ready
 *  Sizes Report so the modal reads as a familiar mini-table. */
export type CutterContributingSlab = {
  id: string;
  label: string | null;
  temple: string | null;
  stone: string | null;
  quality: string | null;
  sourceBlockId: string | null;
  lengthIn: number;
  widthIn: number;
  thicknessIn: number;
  cft: number;
  updatedAt: string;
};

export type CutterCostReport = {
  period: CutterReportPeriod;
  /** Sum of slab CFT produced in the period. Mig 063 follow-on:
   *  switched from block-CFT (cut_session_blocks) to slab-CFT
   *  (slab_requirements with POST_CUT_STATUSES + updated_at in
   *  window) so this number lines up with what the Ready Sizes
   *  Report shows for the same date range. */
  totalCft: number;
  /** Count of slabs that contributed (post-cut, updated_at in window). */
  slabsCount: number;
  /** Every slab that contributed — feeds the click-through peek
   *  modal on the CFT tile. */
  contributingSlabs: CutterContributingSlab[];
  /** Operational expense pool for the period, prorated from any
   *  months touched. */
  operationalForPeriod: number;
  /** Depreciation share for the period: monthly_dep × (days / 30). */
  depreciationForPeriod: number;
  /** Operational + depreciation. */
  totalCost: number;
  /** totalCost / totalCft. NaN when no production. */
  costPerCft: number;
  /** Per-category breakdown of operational expenses (for the
   *  monthly view this is the month's totals; for week/day it's
   *  prorated across touched months too). */
  expenseBreakdown: CutterExpenseBreakdownRow[];
  /** Current book value snapshot in effect on period.endDate. Mig 063
   *  switched cutter depreciation from straight-line to declining
   *  balance (WDV), so the snapshot now exposes both the original
   *  book value AND the current depreciated value plus the years
   *  elapsed since effective_from. The report panel shows both so
   *  the user can see "you bought it at ₹X, after Y years it's
   *  written down to ₹Z, this year's monthly dep is ₹W". */
  bookValueSnapshot: {
    /** Original book value entered on the snapshot. */
    bookValue: number;
    /** Current depreciated value at the period's end date — base
     *  × (1 - rate)^years_elapsed, floored at salvage_value. This
     *  is what the monthly_dep calc uses. */
    currentValue: number;
    usefulLifeYears: number;
    depreciationRatePct: number;
    salvageValue: number;
    /** Whole years elapsed from effective_from to period end. Used
     *  for display ("Year 3 of life · 10y assumed"). */
    yearsElapsed: number;
    /** Monthly depreciation in this year (current_value × rate / 12). */
    monthlyDepreciation: number;
    effectiveFrom: string | null;
  } | null;
};

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

/** Derive a CutterReportPeriod from query-string params. Defaults
 *  to "this month" so the bare URL renders something useful. */
export function cutterPeriodFromSearch(
  sp: Record<string, string | string[] | undefined>,
): CutterReportPeriod {
  const view = (typeof sp.view === "string" ? sp.view : "monthly") as CutterPeriodKind;

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
  };
}

/** Slab CFT — same /1728 conversion as Total Ready Sizes. The
 *  "_ft" suffix on these columns is historical; values are stored
 *  in inches across the codebase. */
function slabCft(l: number, w: number, t: number): number {
  return (l * w * t) / 1728;
}

export async function buildCutterCostReport(
  period: CutterReportPeriod,
): Promise<CutterCostReport> {
  const admin = createAdminSupabaseClient();

  // Period bounds in IST. approved_at is TIMESTAMPTZ so we filter
  // on absolute ISO timestamps with the IST offset baked in.
  const startIst = new Date(`${period.startDate}T00:00:00+05:30`);
  const endParts = parseDateKey(period.endDate);
  const exclusiveEndMs =
    isoUtcMidnight(endParts) + 86_400_000 - 5.5 * 60 * 60 * 1000;
  const startIso = startIst.toISOString();
  const endIso = new Date(exclusiveEndMs).toISOString();

  // ── 1. Fetch slab_requirements that contributed in the period.
  //
  // Mig 063 follow-on (Daksh): we used to count block CFT from
  // cut_session_blocks. But the Ready Sizes Report (the cutting
  // team's verification view) counts slab CFT from slab_requirements
  // — those numbers should match. Daksh wants "produced this week"
  // on cutter cost to be the same denominator they already trust
  // on Ready Sizes. So:
  //   • source = slab_requirements
  //   • filter = status IN POST_CUT_STATUSES (any post-cut state)
  //              AND updated_at within period  (same filter Ready
  //              Sizes uses for its "Cut From / Cut To" inputs)
  //   • CFT per slab = length × width × thickness / 1728
  //
  // PostgREST caps single .select() at 1000; if there are weeks
  // with > 1000 slabs we'll need pagination. For now slabs/week
  // sits well under that ceiling.
  // Daksh (Jun 2026) — PAGINATED. A month easily exceeds PostgREST's 1000-row
  // default; with `order(updated_at desc)` that cap kept the NEWEST 1000 rows
  // and silently DROPPED the oldest, so the monthly view lost its older days.
  // Page through every matching row instead.
  type SlabRow = {
    id: string;
    label: string | null;
    temple: string | null;
    stone: string | null;
    quality: string | null;
    length_ft: number | string;
    width_ft: number | string;
    thickness_ft: number | string;
    status: string;
    updated_at: string;
    source_block_id: string | null;
  };
  const PAGE = 1000;
  const slabsRaw: SlabRow[] = [];
  for (let offset = 0; offset < 500_000; offset += PAGE) {
    const { data, error: slabsErr } = await admin
      .from("slab_requirements")
      .select(
        "id, label, temple, stone, quality, length_ft, width_ft, thickness_ft, status, updated_at, source_block_id",
      )
      .in("status", POST_CUT_STATUSES as unknown as string[])
      .gte("updated_at", startIso)
      .lt("updated_at", endIso)
      .order("updated_at", { ascending: false })
      .range(offset, offset + PAGE - 1);
    if (slabsErr) throw new Error(`slab_requirements: ${slabsErr.message}`);
    const pageRows = (data ?? []) as SlabRow[];
    slabsRaw.push(...pageRows);
    if (pageRows.length < PAGE) break;
  }

  const contributingSlabs: CutterContributingSlab[] = [];
  let totalCft = 0;
  for (const r of slabsRaw) {
    const l = Number(r.length_ft) || 0;
    const w = Number(r.width_ft) || 0;
    const t = Number(r.thickness_ft) || 0;
    if (l <= 0 || w <= 0 || t <= 0) continue;
    const cft = slabCft(l, w, t);
    totalCft += cft;
    contributingSlabs.push({
      id: r.id,
      label: r.label,
      temple: r.temple,
      stone: r.stone,
      quality: r.quality,
      sourceBlockId: r.source_block_id,
      lengthIn: l,
      widthIn: w,
      thicknessIn: t,
      cft,
      updatedAt: r.updated_at,
    });
  }
  const slabsCount = contributingSlabs.length;

  // ── 2. Operational expenses — sum cutter_expenses across every
  //       month the period touches. For shorter views we prorate by
  //       (days in period that fall in month / days in month).
  const startMs = isoUtcMidnight(parseDateKey(period.startDate));
  const endMs = isoUtcMidnight(parseDateKey(period.endDate));
  // Build (year, month) → days-in-period weight.
  const monthWeights = new Map<string, { year: number; month: number; daysInPeriod: number }>();
  for (let ms = startMs; ms <= endMs; ms += 86_400_000) {
    const p = parseDateKeyMs(ms);
    const key = `${p.year}|${p.month}`;
    const prev = monthWeights.get(key);
    if (prev) {
      prev.daysInPeriod++;
    } else {
      monthWeights.set(key, { year: p.year, month: p.month, daysInPeriod: 1 });
    }
  }

  // Mig 063 follow-on (Daksh) — electricity bills always arrive
  // late (end of month / early next month), so a "current month"
  // report has no electricity entry to pull from. Fix: for the
  // electricity category specifically, shift the lookup one month
  // back. Period in month M uses the electricity bill entered for
  // month (M-1). Other categories keep the same-month lookup.
  //
  // Applied uniformly to past months too — the rule is consistent:
  // "electricity entry for month X feeds into month (X+1)'s report"
  // — so users don't have to remember a "current-month-only"
  // special case.
  //
  // We need to fetch each touched month AND its previous month
  // (for the electricity shift). Build the union below.
  function prevMonthOf(y: number, m: number): { year: number; month: number } {
    return m === 1 ? { year: y - 1, month: 12 } : { year: y, month: m - 1 };
  }

  const fetchMonths = new Set<string>();
  for (const w of monthWeights.values()) {
    fetchMonths.add(`${w.year}|${w.month}`);
    const pm = prevMonthOf(w.year, w.month);
    fetchMonths.add(`${pm.year}|${pm.month}`);
  }
  const yearList = [...new Set([...fetchMonths].map((k) => Number(k.split("|")[0])))];
  const monthList = [...new Set([...fetchMonths].map((k) => Number(k.split("|")[1])))];

  let operationalForPeriod = 0;
  const breakdownAcc = new Map<CutterExpenseBreakdownRow["category"], number>();
  if (yearList.length > 0 && monthList.length > 0) {
    const { data: expRaw, error: expErr } = await admin
      .from("cutter_expenses")
      .select("year, month, category, amount")
      .in("year", yearList)
      .in("month", monthList)
      .is("cancelled_at", null);
    if (expErr) {
      // Migration 060 not applied → silently zero out so the page
      // still renders.
      console.warn("[cutter-cost-report] expenses fetch failed", expErr);
    } else {
      type ExpRow = { year: number; month: number; category: string; amount: number | string };
      // Build lookup keyed by (year, month, category) so we can
      // do same-month vs shifted-month lookups during attribution.
      const expLookup = new Map<string, number>();
      for (const e of (expRaw ?? []) as ExpRow[]) {
        const key = `${e.year}|${e.month}|${e.category}`;
        expLookup.set(key, (expLookup.get(key) ?? 0) + (Number(e.amount) || 0));
      }
      // Walk each month the period touches; for each category attribute
      // its prorated share into the breakdown + the operational total.
      const CATS: CutterExpenseBreakdownRow["category"][] = [
        "electricity", "manpower", "repair_maintenance", "other",
      ];
      for (const w of monthWeights.values()) {
        const dim = daysInMonth(w.year, w.month);
        const weight = w.daysInPeriod / dim;
        for (const cat of CATS) {
          let amount: number;
          if (cat === "electricity") {
            const pm = prevMonthOf(w.year, w.month);
            amount = expLookup.get(`${pm.year}|${pm.month}|electricity`) ?? 0;
          } else {
            amount = expLookup.get(`${w.year}|${w.month}|${cat}`) ?? 0;
          }
          if (amount === 0) continue;
          const share = amount * weight;
          operationalForPeriod += share;
          breakdownAcc.set(cat, (breakdownAcc.get(cat) ?? 0) + share);
        }
      }
    }
  }

  const expenseBreakdown: CutterExpenseBreakdownRow[] = [
    "electricity", "manpower", "repair_maintenance", "other",
  ].map((c) => ({
    category: c as CutterExpenseBreakdownRow["category"],
    amount: breakdownAcc.get(c as CutterExpenseBreakdownRow["category"]) ?? 0,
  }));

  // ── 3. Book value snapshot in effect at period.endDate, then
  //       compute monthly depreciation share, prorated to the period.
  //
  // Mig 063 — switched from straight-line to Written Down Value
  // (declining balance). Each year, the value drops by (1 - rate)
  // and the next year's depreciation is calculated against the new
  // (smaller) base. Within a year the monthly amount stays constant
  // — matches Indian tax practice and Daksh's mental model:
  //   year 1: book × rate
  //   year 2: book × (1-rate) × rate
  //   year 3: book × (1-rate)^2 × rate
  // Per-month dep = current_value × rate / 12. Period dep adds up
  // each month the period touches (which may straddle a year
  // boundary, in which case the per-month value changes mid-period).
  let bookValueSnapshot: CutterCostReport["bookValueSnapshot"] = null;
  let depreciationForPeriod = 0;
  {
    const { data: bvRaw, error: bvErr } = await admin
      .from("cutter_book_values")
      .select(
        "book_value, useful_life_years, effective_from, depreciation_rate_pct, salvage_value",
      )
      .lte("effective_from", period.endDate)
      .is("cancelled_at", null)
      .order("effective_from", { ascending: false })
      .limit(1);
    if (bvErr) {
      console.warn("[cutter-cost-report] book value fetch failed", bvErr);
    } else if (bvRaw && bvRaw.length > 0) {
      const bv = bvRaw[0] as {
        book_value: number | string;
        useful_life_years: number;
        effective_from: string;
        depreciation_rate_pct: number | string | null;
        salvage_value: number | string | null;
      };
      const book = Number(bv.book_value) || 0;
      const life = Math.max(1, Number(bv.useful_life_years) || 10);
      const ratePct = bv.depreciation_rate_pct != null
        ? Number(bv.depreciation_rate_pct)
        : 15;
      const rate = Math.max(0, Math.min(1, ratePct / 100));
      const salvage = Math.max(0, Number(bv.salvage_value ?? 0));
      const effectiveFromDate = bv.effective_from
        ? parseDateKey(bv.effective_from)
        : null;

      /** Years elapsed (integer count of completed years) from
       *  effective_from to a given month. Floored, never negative. */
      function yearsElapsedAt(yr: number, mo: number): number {
        if (!effectiveFromDate) return 0;
        const monthsElapsed =
          (yr - effectiveFromDate.year) * 12 + (mo - effectiveFromDate.month);
        return Math.max(0, Math.floor(monthsElapsed / 12));
      }

      function currentValueAt(yr: number, mo: number): number {
        const y = yearsElapsedAt(yr, mo);
        return Math.max(salvage, book * Math.pow(1 - rate, y));
      }

      function monthlyDepAt(yr: number, mo: number): number {
        return (currentValueAt(yr, mo) * rate) / 12;
      }

      // Snapshot uses the period's end date as the reference point.
      const endParts = parseDateKey(period.endDate);
      const yearsElapsedAtEnd = yearsElapsedAt(endParts.year, endParts.month);
      const currentValueAtEnd = currentValueAt(endParts.year, endParts.month);
      const monthlyDepAtEnd = monthlyDepAt(endParts.year, endParts.month);

      bookValueSnapshot = {
        bookValue: book,
        currentValue: currentValueAtEnd,
        usefulLifeYears: life,
        depreciationRatePct: ratePct,
        salvageValue: salvage,
        yearsElapsed: yearsElapsedAtEnd,
        monthlyDepreciation: monthlyDepAtEnd,
        effectiveFrom: bv.effective_from ?? null,
      };

      // Period depreciation — walk each month the period touches.
      // For a full month, that's exactly one monthly amount; for a
      // partial week, prorate by (days_in_period / days_in_month).
      // Critical: monthlyDepAt() may return a different number when
      // the period straddles a year boundary (e.g. weekly view that
      // crosses March 31 → April 1 in a year-elapsed switch), so we
      // recompute per month rather than multiplying once.
      for (const w of monthWeights.values()) {
        const dim = daysInMonth(w.year, w.month);
        const md = monthlyDepAt(w.year, w.month);
        depreciationForPeriod += md * (w.daysInPeriod / dim);
      }
    }
  }

  const totalCost = operationalForPeriod + depreciationForPeriod;
  const costPerCft = totalCft > 0 ? totalCost / totalCft : NaN;

  return {
    period,
    totalCft,
    slabsCount,
    contributingSlabs,
    operationalForPeriod,
    depreciationForPeriod,
    totalCost,
    costPerCft,
    expenseBreakdown,
    bookValueSnapshot,
  };
}
