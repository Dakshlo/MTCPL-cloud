/**
 * Production numbers for the carving wall display.
 *
 * Daksh Sep 2026, after the floor started taking the TV seriously:
 * "one more screen which can show team number — how much total CFT
 *  produced vs how much last was… 2 lines of graph, one of last month
 *  and one approaching it."
 *
 * He also asked for a per-vendor page off the same numbers. It was
 * built, ran for a week, and he dropped it — "keep carving this month,
 * that one's good" — so the vendor aggregation and the two lookups that
 * fed it are gone from here rather than left computing for nobody.
 *
 * Reads APPROVED carving output — a slab counts on the day the carving
 * head signed it off (review_approved_at), not when the operator
 * unloaded it. That is the same event the CNC monthly report and the
 * WhatsApp daily report bill on, so the wall can never disagree with
 * the paperwork.
 *
 * UNITS. Carved output is one unit per slab, chosen by the slab's real
 * thickness: 12 in or thinner is charged on face AREA (SFT), thicker on
 * VOLUME (CFT) — never both, which would double-count. Double-sided
 * carving (mig 088) counts twice. The two are then added into a single
 * "combined unit" figure, exactly as the CNC costing page prices per
 * unit. Daksh asks for this in CFT and the floor says CFT, so the slide
 * labels it CFT — but it is the combined figure, and mixing the two is
 * what the whole company already does everywhere else. Keeping a
 * separate, "purer" CFT here would put a number on the wall that
 * matches no other screen.
 *
 * CUMULATIVE, BY DAY OF MONTH. The chart draws last month as a finished
 * curve and this month climbing toward it, so "are we ahead or behind"
 * is answered by which line is higher on the same day-of-month — not by
 * two bars whose months are different lengths.
 */

import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { fetchAllPaged } from "@/lib/paginate";
import { faceSftFromSlab, isThinSlab } from "@/lib/dimensions";

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

export type ProductionPoint = {
  /** Day of month, 1-based. */
  day: number;
  /** Combined CFT+SFT units approved on that day. */
  units: number;
  /** Running total from the 1st. */
  cum: number;
};

export type FloorProduction = {
  monthLabel: string;
  prevMonthLabel: string;
  /** Day-of-month today, IST — where the current-month line stops. */
  today: number;
  daysInMonth: number;
  daysInPrevMonth: number;
  thisMonth: ProductionPoint[];
  prevMonth: ProductionPoint[];
  totals: {
    thisMonth: number;
    prevMonthToDate: number;
    prevMonthFull: number;
    /** This month's run-rate carried to the end of the month. */
    projected: number;
    /** Percent vs the same day last month. null when last month was 0. */
    vsLastPct: number | null;
  };
};

/** Calendar parts of an ISO instant in IST, without Intl (Vercel's ICU
 *  build has bitten this codebase before — see the HDFC filename note). */
function istParts(iso: string): { y: number; m: number; d: number } {
  const t = new Date(new Date(iso).getTime() + IST_OFFSET_MS);
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
}

/** UTC instant of 00:00 IST on the given IST calendar date. */
function istMidnightUTC(y: number, m: number, d: number): string {
  return new Date(Date.UTC(y, m - 1, d) - IST_OFFSET_MS).toISOString();
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export async function buildFloorProductionData(): Promise<FloorProduction> {
  const admin = createAdminSupabaseClient();

  const nowIst = new Date(Date.now() + IST_OFFSET_MS);
  const y = nowIst.getUTCFullYear();
  const m = nowIst.getUTCMonth() + 1;
  const today = nowIst.getUTCDate();

  const prevY = m === 1 ? y - 1 : y;
  const prevM = m === 1 ? 12 : m - 1;

  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const daysInPrevMonth = new Date(Date.UTC(prevY, prevM, 0)).getUTCDate();

  const windowStart = istMidnightUTC(prevY, prevM, 1);
  // Exclusive end = 00:00 IST tomorrow, so everything approved today counts.
  const windowEnd = istMidnightUTC(y, m, today + 1);

  // Paginated: two months of approvals is well past PostgREST's silent
  // 1000-row cap (August alone was 484 slabs).
  //
  // This used to fetch the vendor and machine lists alongside, for the
  // Vendor Scoreboard slide. That slide is gone, so those two queries
  // went with it — the wall no longer pays for them on every refresh.
  const items = await fetchAllPaged<{
    slab_requirement_id: string | null;
    review_approved_at: string;
    carving_sides: number | null;
  }>((from, to) =>
    admin
      .from("carving_items")
      .select("slab_requirement_id, review_approved_at, carving_sides")
      .not("review_approved_at", "is", null)
      .gte("review_approved_at", windowStart)
      .lt("review_approved_at", windowEnd)
      .order("id", { ascending: true })
      .range(from, to),
  );

  // Slab dimensions for every approved item in the window.
  const slabIds = [...new Set(items.map((i) => i.slab_requirement_id).filter(Boolean))] as string[];
  const dims = new Map<string, { l: number; w: number; t: number }>();
  for (let i = 0; i < slabIds.length; i += 300) {
    const chunk = slabIds.slice(i, i + 300);
    const rows = await fetchAllPaged<{
      id: string; length_ft: number | string; width_ft: number | string; thickness_ft: number | string;
    }>((from, to) =>
      admin
        .from("slab_requirements")
        .select("id, length_ft, width_ft, thickness_ft")
        .in("id", chunk)
        .order("id", { ascending: true })
        .range(from, to),
    );
    for (const r of rows) {
      dims.set(r.id, { l: Number(r.length_ft) || 0, w: Number(r.width_ft) || 0, t: Number(r.thickness_ft) || 0 });
    }
  }

  /** One slab's contribution: SFT for a thin slab, CFT for a thick one,
   *  doubled when both faces were carved. Never both units. */
  const unitsFor = (slabId: string | null, sides: number | null): number => {
    if (!slabId) return 0;
    const d = dims.get(slabId);
    if (!d) return 0;
    const mult = Number(sides) === 2 ? 2 : 1;
    return isThinSlab(d.l, d.w, d.t)
      ? faceSftFromSlab(d.l, d.w, d.t) * mult
      : ((d.l * d.w * d.t) / 1728) * mult;
  };

  const thisDaily = new Array<number>(daysInMonth + 1).fill(0);
  const prevDaily = new Array<number>(daysInPrevMonth + 1).fill(0);

  for (const it of items) {
    const u = unitsFor(it.slab_requirement_id, it.carving_sides);
    if (u <= 0) continue;
    const p = istParts(it.review_approved_at);
    const isThis = p.y === y && p.m === m;
    const isPrev = p.y === prevY && p.m === prevM;
    if (isThis && p.d >= 1 && p.d <= daysInMonth) thisDaily[p.d] += u;
    else if (isPrev && p.d >= 1 && p.d <= daysInPrevMonth) prevDaily[p.d] += u;
  }

  const toPoints = (daily: number[], upto: number): ProductionPoint[] => {
    const out: ProductionPoint[] = [];
    let cum = 0;
    for (let d = 1; d <= upto; d++) {
      cum += daily[d] ?? 0;
      out.push({ day: d, units: daily[d] ?? 0, cum });
    }
    return out;
  };

  const thisMonth = toPoints(thisDaily, today);
  const prevMonth = toPoints(prevDaily, daysInPrevMonth);

  const thisTotal = thisMonth.length ? thisMonth[thisMonth.length - 1].cum : 0;
  const prevFull = prevMonth.length ? prevMonth[prevMonth.length - 1].cum : 0;
  const prevToDate = prevMonth.find((p) => p.day === Math.min(today, daysInPrevMonth))?.cum ?? 0;

  return {
    monthLabel: `${MONTHS[m - 1]} ${y}`,
    prevMonthLabel: `${MONTHS[prevM - 1]} ${prevY}`,
    today,
    daysInMonth,
    daysInPrevMonth,
    thisMonth,
    prevMonth,
    totals: {
      thisMonth: thisTotal,
      prevMonthToDate: prevToDate,
      prevMonthFull: prevFull,
      // Straight run-rate: today's pace held to month end. Deliberately
      // naive — it is a wall display, not a forecast, and anything
      // cleverer would need explaining to the floor.
      projected: today > 0 ? (thisTotal / today) * daysInMonth : 0,
      vsLastPct: prevToDate > 0 ? ((thisTotal - prevToDate) / prevToDate) * 100 : null,
    },
  };
}
