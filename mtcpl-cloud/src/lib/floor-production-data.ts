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
import { fetchAllPaged, chunkIds } from "@/lib/paginate";
import { faceSftFromSlab, isThinSlab } from "@/lib/dimensions";
import { cftEquivFromTonnes, isMarble, type StoneCategory } from "@/lib/stone-categories";

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

export type ProductionPoint = {
  /** Day of month, 1-based. */
  day: number;
  /** Combined CFT+SFT units approved on that day. */
  units: number;
  /** Running total from the 1st. */
  cum: number;
};

/** One metric's two cumulative curves plus the numbers above them.
 *  Carving and cutting are the same shape, so the wall renders both
 *  through the same chart component. */
export type MonthSeries = {
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

/** One stone's live block stock. Sandstone is measured, marble weighed,
 *  so only the field its own trade uses is meaningful. */
export type StockStone = {
  stone: string;
  blocks: number;
  /** Sandstone: real CFT. Marble: 0 — marble blocks carry no dimensions. */
  cft: number;
  /** Marble only. */
  tonnes: number;
};

export type FloorStock = {
  sandstone: { blocks: number; cft: number; byStone: StockStone[] };
  marble: { blocks: number; tonnes: number; cftEquiv: number; byStone: StockStone[] };
  /* Bought THIS month — the top-up against the standing stock above.
     This was briefly a day-by-day list ("22 September · 19 blocks ·
     141 CFT") that scrolled itself. Daksh dropped it a day later — the
     month's total is the number he wants on the wall, and a list
     creeping past was noise around it. The grouping that built it went
     with the list rather than being left computing for nobody. */
  purchased: {
    sandstone: { blocks: number; cft: number };
    marble: { blocks: number; tonnes: number };
  };
};

export type FloorProduction = {
  monthLabel: string;
  prevMonthLabel: string;
  /** Day-of-month today, IST — where the current-month line stops. */
  today: number;
  daysInMonth: number;
  daysInPrevMonth: number;
  /** Carved output, approved. */
  carving: MonthSeries;
  /** Blocks cut into slabs. */
  cutting: MonthSeries;
  /** Live raw-block stock + this month's purchases. null if it failed;
   *  the slide is then dropped rather than shown empty. */
  stock: FloorStock | null;
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

/* Full names, not "Sep" (Daksh). These read at wall distance and there
   is room for them; the chart's own end-of-line label takes the first
   word, so it becomes "August" rather than "Aug". */
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

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

  // Stone name → category. Needed by cutting (marble is cut off-session)
  // and by stock (marble is weighed, sandstone measured).
  const categoryMap: Record<string, StoneCategory> = {};
  {
    const { data } = await admin.from("stone_types").select("name, stone_category");
    for (const st of (data ?? []) as Array<{ name: string; stone_category?: string | null }>) {
      categoryMap[st.name] = st.stone_category === "marble" ? "marble" : "sandstone";
    }
  }

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

  /** Daily buckets → cumulative points, and the four headline numbers
   *  that go above the chart. Shared by carving and cutting so the two
   *  slides can never drift in how they compute "ahead or behind". */
  const seriesFrom = (thisDaily: number[], prevDaily: number[]): MonthSeries => {
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
    // Same day-of-month cut, so a short month is never unfairly beaten
    // by a long one.
    const prevToDate = prevMonth.find((p) => p.day === Math.min(today, daysInPrevMonth))?.cum ?? 0;
    return {
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
  };

  const carving = seriesFrom(thisDaily, prevDaily);

  // ── CUTTING: blocks that became slabs, by the day they were cut ──
  //
  // Same definition the WhatsApp daily report uses, including the part
  // that is easy to get wrong: marble NEVER enters cut_session_blocks.
  // The team cuts it by hand and the block simply goes `consumed`, so
  // its cut date is blocks.updated_at — the rule the app's own Marble
  // Cutting Log follows. Keyed off cut_session_blocks alone, this chart
  // would silently be sandstone-only, which is how the daily report
  // under-reported ~4,800 CFT of marble in one month before it was
  // caught.
  const cutDateByBlock = new Map<string, string>();
  {
    const doneRows = await fetchAllPaged<{ block_id: string; updated_at: string }>((from, to) =>
      admin
        .from("cut_session_blocks")
        .select("block_id, status, updated_at")
        .eq("status", "done")
        .gte("updated_at", windowStart)
        .lt("updated_at", windowEnd)
        .order("id", { ascending: true })
        .range(from, to),
    );
    for (const r of doneRows) if (r.block_id) cutDateByBlock.set(r.block_id, r.updated_at);

    const marbleNames = Object.keys(categoryMap).filter((n) => categoryMap[n] === "marble");
    if (marbleNames.length > 0) {
      const consumed = await fetchAllPaged<{ id: string; updated_at: string }>((from, to) =>
        admin
          .from("blocks")
          .select("id, stone, status, updated_at")
          .eq("status", "consumed")
          .in("stone", marbleNames)
          .gte("updated_at", windowStart)
          .lt("updated_at", windowEnd)
          .order("id", { ascending: true })
          .range(from, to),
      );
      // Union, not overwrite — a block reached by both routes is one cut.
      for (const r of consumed) if (!cutDateByBlock.has(r.id)) cutDateByBlock.set(r.id, r.updated_at);
    }
  }

  const cutThisDaily = new Array<number>(daysInMonth + 1).fill(0);
  const cutPrevDaily = new Array<number>(daysInPrevMonth + 1).fill(0);
  {
    const blockIds = [...cutDateByBlock.keys()];
    for (const chunk of chunkIds(blockIds, 200)) {
      // A 200-block chunk can yield far more than 1000 slabs, so the
      // result needs paginating too.
      const slabs = await fetchAllPaged<{
        source_block_id: string | null;
        length_ft: number | string; width_ft: number | string; thickness_ft: number | string;
      }>((from, to) =>
        admin
          .from("slab_requirements")
          .select("source_block_id, length_ft, width_ft, thickness_ft, status")
          .in("source_block_id", chunk)
          .not("status", "in", "(open,rejected,cancelled)")
          .order("id", { ascending: true })
          .range(from, to),
      );
      for (const sl of slabs) {
        const when = sl.source_block_id ? cutDateByBlock.get(sl.source_block_id) : undefined;
        if (!when) continue;
        const c =
          ((Number(sl.length_ft) || 0) * (Number(sl.width_ft) || 0) * (Number(sl.thickness_ft) || 0)) / 1728;
        if (c <= 0) continue;
        const p = istParts(when);
        if (p.y === y && p.m === m && p.d >= 1 && p.d <= daysInMonth) cutThisDaily[p.d] += c;
        else if (p.y === prevY && p.m === prevM && p.d >= 1 && p.d <= daysInPrevMonth) cutPrevDaily[p.d] += c;
      }
    }
  }

  const cutting = seriesFrom(cutThisDaily, cutPrevDaily);

  // ── STOCK: usable raw blocks, split by stone ────────────────────
  //
  // Same "usable" definition as the daily report's RAW BLOCK STOCK
  // card: available + reserved, i.e. everything not yet cut, consumed
  // or discarded.
  let stock: FloorStock | null = null;
  try {
    const blocks = await fetchAllPaged<{
      stone: string | null; length_ft: number | string; width_ft: number | string;
      height_ft: number | string; tonnes: number | null;
    }>((from, to) =>
      admin
        .from("blocks")
        .select("stone, length_ft, width_ft, height_ft, tonnes, status")
        .in("status", ["available", "reserved"])
        .order("id", { ascending: true })
        .range(from, to),
    );
    const agg = new Map<string, StockStone>();
    for (const b of blocks) {
      const name = (b.stone ?? "").trim() || "—";
      const g = agg.get(name) ?? { stone: name, blocks: 0, cft: 0, tonnes: 0 };
      g.blocks += 1;
      if (isMarble(b.stone, categoryMap)) {
        g.tonnes += Number(b.tonnes) || 0;
      } else {
        g.cft +=
          ((Number(b.length_ft) || 0) * (Number(b.width_ft) || 0) * (Number(b.height_ft) || 0)) / 1728;
      }
      agg.set(name, g);
    }
    const marbleStones = [...agg.values()]
      .filter((g) => categoryMap[g.stone] === "marble")
      .sort((a, b) => b.tonnes - a.tonnes);
    const sandStones = [...agg.values()]
      .filter((g) => categoryMap[g.stone] !== "marble")
      .sort((a, b) => b.cft - a.cft);

    // This month's purchases — the top-up against the standing stock.
    // Counted on created_at, the same event the daily report's BLOCKS
    // ADDED card uses.
    const bought = await fetchAllPaged<{
      stone: string | null; length_ft: number | string; width_ft: number | string;
      height_ft: number | string; tonnes: number | null;
    }>((from, to) =>
      admin
        .from("blocks")
        .select("stone, length_ft, width_ft, height_ft, tonnes, created_at")
        .gte("created_at", istMidnightUTC(y, m, 1))
        .lt("created_at", windowEnd)
        .order("id", { ascending: true })
        .range(from, to),
    );
    let pSandBlocks = 0, pSandCft = 0, pMarbleBlocks = 0, pMarbleT = 0;
    for (const b of bought) {
      if (isMarble(b.stone, categoryMap)) {
        pMarbleBlocks += 1;
        pMarbleT += Number(b.tonnes) || 0;
      } else {
        pSandBlocks += 1;
        pSandCft +=
          ((Number(b.length_ft) || 0) * (Number(b.width_ft) || 0) * (Number(b.height_ft) || 0)) / 1728;
      }
    }

    const marbleTonnes = marbleStones.reduce((s2, g) => s2 + g.tonnes, 0);
    stock = {
      sandstone: {
        blocks: sandStones.reduce((s2, g) => s2 + g.blocks, 0),
        cft: sandStones.reduce((s2, g) => s2 + g.cft, 0),
        byStone: sandStones,
      },
      marble: {
        blocks: marbleStones.reduce((s2, g) => s2 + g.blocks, 0),
        tonnes: marbleTonnes,
        // The company's own 8 CFT per tonne, the same conversion the
        // daily report's stock card prints. Shown as "~" because it is
        // a conversion, not a measurement.
        cftEquiv: cftEquivFromTonnes(marbleTonnes),
        byStone: marbleStones,
      },
      purchased: {
        sandstone: { blocks: pSandBlocks, cft: pSandCft },
        marble: { blocks: pMarbleBlocks, tonnes: pMarbleT },
      },
    };
  } catch (e) {
    console.error("[floor] stock build failed", e);
    stock = null;
  }

  return {
    monthLabel: `${MONTHS[m - 1]} ${y}`,
    prevMonthLabel: `${MONTHS[prevM - 1]} ${prevY}`,
    today,
    daysInMonth,
    daysInPrevMonth,
    carving,
    cutting,
    stock,
  };
}
