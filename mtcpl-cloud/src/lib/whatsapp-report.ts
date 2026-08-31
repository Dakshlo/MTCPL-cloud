// ──────────────────────────────────────────────────────────────────
// Daily WhatsApp work-report (MSG91 → Meta) — Daksh, June 2026.
//
// Every morning (10 AM IST cron — vercel.json `30 4 * * *` UTC) we:
//   1. aggregate the day's work  → buildDailyReportData()
//   2. render it as a PDF        → buildDailyReportPdf()  (colourful, with logo)
//   3. upload to a public bucket → public url
//   4. send the approved Utility template with the PDF as its Document
//      header + {{1}} = the date, to the configured recipients.
//
// Reuses the existing MSG91 account auth key (MSG91_AUTH_KEY) — one key
// serves SMS + WhatsApp. No new secrets.
//
// Jul 2026 insight pass (Daksh, "redesign + bug check"):
//   • Month figures anchor to the REPORT day's month, not "now" — the 10 AM
//     run on the 1st covers the last day of the OLD month, and used to print
//     "Aug · 0 slabs (+19 in 24 h)" while the header said 31 Jul.
//   • vs-last-month-same-day comparison + month-end pace on every card.
//   • In-card 10-day sparklines, live pipeline page, dispatch trend chart,
//     billing strip, month-to-date payments.
//   • Lifetime queries paginated — blocks(Fresh)=1,307 and
//     cut_session_slabs=1,180 rows were already past PostgREST's silent
//     1000-row cap, so the recovery card was computed on truncated data.
//
// Aug 2026 simplification pass (Daksh, relaying his dad — the reader):
//   • LIGHT theme. The dark "liquid glass" look wasted toner and read
//     badly in daylight on a phone.
//   • Page 1 is two numbers per card — last 24 h on the left, the month
//     so far (with its day count) on the right — headlined in CFT,
//     because CFT is what he thinks in, not block or slab counts.
//   • Cutting also states TONNES: marble is bought and cut by weight and
//     its blocks carry no dimensions, so CFT alone hides a marble day.
//   • CNC / cutter costing cut back to the rate + what it has cost.
//   • The live-pipeline page is gone (buildPipeline() itself stays — the
//     Cockpit dashboard reads it). 5 pages became 4.
// ──────────────────────────────────────────────────────────────────

import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { fetchAllPaged, chunkIds } from "@/lib/paginate";
import { getReportRecipientNumbers } from "@/lib/wa-recipients";
import { buildCncVariousCostReport, cncPeriodFromSearch } from "@/lib/cnc-various-cost-report";
import { buildCutterCostReport, cutterPeriodFromSearch } from "@/lib/cutter-cost-report";
import { isMarble, cftEquivFromTonnes, type StoneCategory } from "@/lib/stone-categories";
import { isThinSlab, faceSftFromSlab } from "@/lib/dimensions";
import { applyDiscount, computeGroupedGstTotals, type GstMode } from "@/lib/challan-pricing";
import { challanCode, invoiceCodeFromDoc } from "@/lib/doc-code";
import { POST_CUT_STATUSES } from "@/lib/slab-statuses";
import {
  buildLineages,
  aggregateLineages,
  type BjBlockRow,
  type BjSlabRow,
  type BjCsbRow,
  type BjMarbleTruckRow,
  type BjCutSessionSlabRow,
} from "@/app/(app)/block-journey/build-lineages";

type AdminClient = ReturnType<typeof createAdminSupabaseClient>;

// ── Config ──────────────────────────────────────────────────────────
const WA_BULK_URL = "https://control.msg91.com/api/v5/whatsapp/whatsapp-outbound-message/bulk/";
const TEMPLATE_NAME = process.env.MSG91_WA_TEMPLATE || "mtcpl_daily_report";
const TEMPLATE_LANG = process.env.MSG91_WA_TEMPLATE_LANG || "en";
const INTEGRATED_NUMBER = process.env.MSG91_WA_NUMBER || "917627065482";

// Recipients are managed from Settings (app_settings) — see lib/wa-recipients.
// Here we just add the country code to bare 10-digit numbers.
async function recipients(): Promise<string[]> {
  const nums = await getReportRecipientNumbers();
  return nums.map((d) => (d.length === 10 ? `91${d}` : d));
}

const cft = (l: number, w: number, t: number) => (l * w * t) / 1728;
const stoneLabel = (s: string | null) => (s ?? "Other").replace(/Stone$/i, "") || "Other";
const inr = (n: number) => `Rs ${Math.round(n).toLocaleString("en-IN")}`;
// 2-decimal money — for per-unit rates (e.g. "Rs 148.25 / unit") where the
// paise matter and rounding to whole rupees would look wrong.
const inr2 = (n: number) => `Rs ${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
// Indian-grouped plain numbers — "32,372" reads far better than "32372".
const fmt0 = (n: number) => Math.round(n).toLocaleString("en-IN");
/** "AUG 2026" / "AUG" — month labels are shown in caps on the light cards. */
const mo2 = (s: string) => (s || "").toUpperCase();
const fmt1 = (n: number) => n.toLocaleString("en-IN", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

// The report PDF uses the standard Helvetica font (WinAnsi/CP1252). pdf-lib
// THROWS on any character it can't encode — e.g. "↳" (0x21B3) once crashed the
// whole daily send. Sanitise every drawn string to a WinAnsi-safe form: swap
// the common typographic Unicode for ASCII, then drop anything left outside
// Latin-1 (0x20-0x7E + 0xA0-0xFF are all valid CP1252). Belt-and-suspenders so
// a stray char in a vendor/temple/item name can never break the report again.
function winSafe(s: string): string {
  return (s ?? "")
    .replace(/[‘’‚]/g, "'")
    .replace(/[“”„]/g, '"')
    .replace(/[–—―]/g, "-")
    .replace(/…/g, "...")
    .replace(/[←-⇿•‣⁃▪●]/g, ">") // arrows + bullets
    .replace(/₹/g, "Rs ")
    .replace(/[^\x20-\x7E -ÿ]/g, "");
}

/** IST day window [startUTC, endUTC] + a human label. offset 0 = today, -1 = yesterday. */
function istDay(offset = 0) {
  const ist = new Date(Date.now() + 5.5 * 3600 * 1000); // UTC fields read as IST wall clock
  const y = ist.getUTCFullYear();
  const m = ist.getUTCMonth();
  const d = ist.getUTCDate() + offset;
  const startUTC = new Date(Date.UTC(y, m, d, 0, 0, 0, 0) - 5.5 * 3600 * 1000).toISOString();
  const endUTC = new Date(Date.UTC(y, m, d, 23, 59, 59, 999) - 5.5 * 3600 * 1000).toISOString();
  const ref = new Date(Date.UTC(y, m, d));
  return { startUTC, endUTC, label: `${ref.getUTCDate()} ${MONTHS[ref.getUTCMonth()]} ${ref.getUTCFullYear()}` };
}

// The report is sent at 10:00 IST and covers the 24 h ending at 10:00 IST
// (i.e. "yesterday 10 AM → today 10 AM"), so the recipient gets the previous
// day's work each morning.
const REPORT_HOUR_IST = 10;

/** 24-hour window ending at 10:00 IST on (today + dayOffset).
 *  dayOffset 0  → [10:00 yesterday, 10:00 today)        — the main report
 *  dayOffset -1 → [10:00 day-before, 10:00 yesterday)   — the comparison
 *  Half-open: a row stamped exactly 10:00:00.000 belongs to the NEXT window,
 *  never both. The label is the date the window STARTS on — the day the work
 *  belongs to (so the morning report reads as "<yesterday>'s report"). */
function window24(dayOffset = 0) {
  const ist = new Date(Date.now() + 5.5 * 3600 * 1000);
  const y = ist.getUTCFullYear();
  const m = ist.getUTCMonth();
  const d = ist.getUTCDate() + dayOffset;
  const endIstMs = Date.UTC(y, m, d, REPORT_HOUR_IST, 0, 0, 0);
  const startIstMs = endIstMs - 24 * 3600 * 1000;
  const startUTC = new Date(startIstMs - 5.5 * 3600 * 1000).toISOString();
  const endUTC = new Date(endIstMs - 5.5 * 3600 * 1000).toISOString();
  const s = new Date(startIstMs); // label off the window's start day
  return {
    startUTC,
    endUTC,
    label: `${s.getUTCDate()} ${MONTHS[s.getUTCMonth()]} ${s.getUTCFullYear()}`,
    weekday: WEEKDAYS[s.getUTCDay()],
    // Label-day parts — everything month-anchored derives from THESE, not
    // from "now" (see reportMonthFor).
    y: s.getUTCFullYear(),
    m: s.getUTCMonth(),
    d: s.getUTCDate(),
  };
}

/** IST "today" as YYYY-MM-DD (for clamping the cutter report to month-to-date). */
function istDateKey(): string {
  const ist = new Date(Date.now() + 5.5 * 3600 * 1000);
  return `${ist.getUTCFullYear()}-${String(ist.getUTCMonth() + 1).padStart(2, "0")}-${String(ist.getUTCDate()).padStart(2, "0")}`;
}

/** Month framing for the REPORT day (window24's label day), NOT for "now".
 *
 *  The 10 AM run on the 1st of a month reports the LAST day of the previous
 *  month — anchoring to "now" made every month card read "new month · 0
 *  (+19 in 24 h)" that morning, contradicting the 31-Jul header (real bug,
 *  seen in production on 1 Aug 2026). Anchoring to the label day instead
 *  turns that same run into the previous month's complete final report.
 *
 *  Also computes the same-point window of the month BEFORE (1st → same
 *  day-of-month, clamped to shorter months, ending 10:00 IST) so every card
 *  can answer "are we ahead of last month?". */
function reportMonthFor(y: number, m: number, d: number) {
  const IST = 5.5 * 3600 * 1000;
  const startUTC = new Date(Date.UTC(y, m, 1, 0, 0, 0, 0) - IST).toISOString();
  const monthLen = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const pRef = new Date(Date.UTC(y, m - 1, 1)); // rolls the year over safely
  const py = pRef.getUTCFullYear(), pm = pRef.getUTCMonth();
  const prevLen = new Date(Date.UTC(py, pm + 1, 0)).getUTCDate();
  const prevDays = Math.min(d, prevLen); // 31 Jul vs 30-day June → day 30
  const prevStartUTC = new Date(Date.UTC(py, pm, 1, 0, 0, 0, 0) - IST).toISOString();
  // Mirror the MTD window's shape exactly: through day-N + the 10-hour
  // morning sliver of day-N+1 (same sliver the live month carries).
  const prevEndUTC = new Date(Date.UTC(py, pm, prevDays + 1, REPORT_HOUR_IST, 0, 0, 0) - IST).toISOString();
  return {
    startUTC,
    label: `${MONTHS[m]} ${y}`,
    monthName: MONTHS[m],
    daysElapsed: d,
    monthLen,
    year: y,
    monthIndex: m,
    prev: { startUTC: prevStartUTC, endUTC: prevEndUTC, monthName: MONTHS[pm], days: prevDays },
  };
}

// ── Data ────────────────────────────────────────────────────────────

/* Aug 2026 — Daksh: "in blocks added show 2 cards, one for marble and one
   for sandstone; for marble tonnes, for sandstone CFT". The two stones are
   BOUGHT differently — marble comes in by the truck in TONNES and its blocks
   carry no dimensions at all, sandstone is CFT throughout — so one blended
   blocks number was never a number he could use.
   Cutting stays a single blended card ("both stone, no separate"): a cut
   slab has real dimensions whatever it came from, so CFT already adds up
   across the two. */
type DayTotals = {
  blocks: {
    count: number; cft: number;
    marble: { count: number; tonnes: number };
    sandstone: { count: number; cft: number };
  };
  cutting: { slabs: number; cft: number };
  /* Aug 2026 — Daksh: "in carving done you're only showing CFT; show the
     combined CFT + SFT." Carved output is measured in ONE unit per slab,
     decided by real thickness: a slab 12 in or thinner is charged on its
     face AREA (SFT), a thicker one on VOLUME (CFT). Adding the two gives
     the "combined units" the CNC costing page already prices per unit, so
     the two screens now report the same quantity.

     Double-sided carving counts twice (mig 088) — two faces is two lots
     of work. Both of those were missing here: every carved slab was being
     counted as raw volume, once, so thin slabs read as a sliver of their
     real output and double-sided work as half. */
  carving: { slabs: number; cft: number; sft: number };
  dispatch: { slabs: number; cft: number; tonnes: number; trucks: number };
};

export type DailyReport = {
  label: string;
  weekday: string;
  prevLabel: string;
  today: DayTotals;
  prev: DayTotals;
  /** Month-to-date totals for the REPORT month — cutting / carving /
   *  dispatch headline the cards (last-24 h figure in the pill). */
  mtd: DayTotals;
  /** Same-point totals for the month BEFORE the report month (1st → same
   *  day-of-month, clamped) — powers the "vs Jun same day" line. */
  mtdPrev: DayTotals;
  month: { label: string; monthName: string; days: number; monthLen: number; prevMonthName: string; prevDays: number };
  /** Current usable raw-block stock (status available/reserved), CFT by
   *  category. null if it couldn't be computed. */
  stock: {
    totalCft: number;
    marbleCft: number;
    marbleTonnes: number;
    sandstoneCft: number;
    marbleCount: number;
    sandstoneCount: number;
  } | null;
  /** Block recovery split by stone category — sandstone as a yield %,
   *  marble as CFT per tonne (same framing as the Block Journey page). */
  recovery: {
    sandstone: { recoveredPct: number; originalCft: number; slabCft: number; lineages: number };
    marble: { cftPerTonne: number; tonnes: number; slabCft: number; lineages: number };
  } | null;
  /** Live pipeline snapshot — where material stands RIGHT NOW (counts, not
   *  window-bound). null if it couldn't be computed. */
  pipeline: {
    cutWaiting: number;      // cut_done, not parked — waiting to enter carving
    queue: number;           // carving_assigned
    onMachine: number;       // carving_in_progress
    onHold: number;          // carving_items parked mid-carve
    readyDispatch: number;   // completed, not parked
    storageCut: number;      // cut_done + parked (main storage, cut kind)
    storageReady: number;    // completed + parked (main storage, ready kind)
  } | null;
  blocksByStone: Array<{ stone: string; count: number; cft: number; vendors: Array<{ vendor: string; count: number; cft: number }> }>;
  cuttingByStone: Array<{ stone: string; slabs: number; cft: number }>;
  carvingByVendor: Array<{ vendor: string; slabs: number; cft: number; sft: number }>;
  dispatchByTemple: Array<{ temple: string; slabs: number; cft: number; tonnes: number }>;
  payments: { total: number; byVendor: Array<{ vendor: string; amount: number }> };
  /** Supplier payments for the report month to date (total only). */
  paymentsMtd: number;
  /** Month-to-date CNC costing snapshot (elapsed days only). null if the
   *  report couldn't be built — never blocks the daily report. */
  cnc: {
    label: string;        // "June 2026"
    days: number;         // elapsed days of the month so far
    monthLen: number;     // total days in the month
    totalCost: number;    // operational + depreciation, prorated to elapsed days
    operational: number;
    depreciation: number;
    sft: number;
    cft: number;
    costPerSft: number;     // may be NaN when no production
    costPerCft: number;
    costPerCombined: number; // totalCost ÷ (sft + cft) — the headline "/unit"
    machines: number;
    slabs: number;
  } | null;
  /** Month-to-date cutter (block-cutting plant) costing — elapsed days
   *  only, same as the CNC snapshot. Cutting output is volume (CFT) only. */
  cutter: {
    label: string;
    days: number;
    monthLen: number;
    totalCost: number;
    operational: number;
    depreciation: number;
    cft: number;
    costPerCft: number;   // may be NaN when no production
    slabs: number;
  } | null;
  /** Last 10 IST days of activity for the trend charts + the page-1 card
   *  sparklines — counts per day. */
  trend: Array<{ label: string; short: string; blocks: number; cutting: number; carving: number; dispatch: number }>;
  /** Last-24 h challans raised + invoices issued (summary + attached detail).
   *  null if it couldn't be built — never blocks the daily report. */
  recent: { challans: RecentDoc[]; invoices: RecentDoc[] } | null;
};

// dims for a set of slab ids → map id → cft.
async function cftBySlab(admin: AdminClient, ids: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  // 500-id chunks: a 1000-id .in() would land EXACTLY on PostgREST's 1000-row
  // cap (zero margin) and make a very long URL.
  for (const chunk of chunkIds(ids, 500)) {
    const { data } = await admin
      .from("slab_requirements")
      .select("id, length_ft, width_ft, thickness_ft")
      .in("id", chunk);
    for (const s of (data ?? []) as Array<{ id: string; length_ft: number; width_ft: number; thickness_ft: number }>) {
      out.set(s.id, cft(Number(s.length_ft), Number(s.width_ft), Number(s.thickness_ft)));
    }
  }
  return out;
}

/** Raw dims per slab — carved output needs the thin/thick decision, which
 *  cftBySlab's single number has already thrown away. */
async function dimsBySlab(
  admin: AdminClient,
  ids: string[],
): Promise<Map<string, { l: number; w: number; t: number }>> {
  const out = new Map<string, { l: number; w: number; t: number }>();
  for (const chunk of chunkIds(ids, 500)) {
    const { data } = await admin
      .from("slab_requirements")
      .select("id, length_ft, width_ft, thickness_ft")
      .in("id", chunk);
    for (const s of (data ?? []) as Array<{ id: string; length_ft: number; width_ft: number; thickness_ft: number }>) {
      out.set(s.id, { l: Number(s.length_ft), w: Number(s.width_ft), t: Number(s.thickness_ft) });
    }
  }
  return out;
}

const emptyTotals = (): DayTotals => ({
  blocks: { count: 0, cft: 0, marble: { count: 0, tonnes: 0 }, sandstone: { count: 0, cft: 0 } },
  cutting: { slabs: 0, cft: 0 },
  carving: { slabs: 0, cft: 0, sft: 0 },
  dispatch: { slabs: 0, cft: 0, tonnes: 0, trucks: 0 },
});

/** Aggregate one window [startUTC, endUTC). `detail` also returns the
 *  per-group breakdowns. Serves 24 h windows AND month windows, so every
 *  query here is paginated — a busy month's carving approvals alone can
 *  cross PostgREST's silent 1000-row cap. */
async function aggregateDay(
  admin: AdminClient,
  startUTC: string,
  endUTC: string,
  detail: boolean,
  categoryMap: Record<string, StoneCategory>,
) {
  const totals = emptyTotals();
  const det = {
    blocksByStone: [] as DailyReport["blocksByStone"],
    cuttingByStone: [] as DailyReport["cuttingByStone"],
    carvingByVendor: [] as DailyReport["carvingByVendor"],
    dispatchByTemple: [] as DailyReport["dispatchByTemple"],
  };

  // 1. BLOCKS added in the window (raw stone blocks created).
  {
    const data = await fetchAllPaged<{ stone: string | null; length_ft: number; width_ft: number; height_ft: number; tonnes: number | null; vendor_name: string | null }>((from, to) =>
      admin
        .from("blocks")
        .select("stone, length_ft, width_ft, height_ft, tonnes, created_at, vendor_name")
        .gte("created_at", startUTC)
        .lt("created_at", endUTC)
        .order("id", { ascending: true })
        .range(from, to),
    );
    const byStone = new Map<string, { count: number; cft: number; vendors: Map<string, { count: number; cft: number }> }>();
    for (const b of data) {
      const c = cft(Number(b.length_ft), Number(b.width_ft), Number(b.height_ft));
      totals.blocks.count += 1; totals.blocks.cft += c;
      // Marble is weighed, not measured — a marble block's dimensions are
      // NULL, so its CFT is 0 and only the tonnage means anything.
      if (isMarble(b.stone, categoryMap)) {
        totals.blocks.marble.count += 1;
        totals.blocks.marble.tonnes += Number(b.tonnes) || 0;
      } else {
        totals.blocks.sandstone.count += 1;
        totals.blocks.sandstone.cft += c;
      }
      const k = stoneLabel(b.stone);
      const g = byStone.get(k) ?? { count: 0, cft: 0, vendors: new Map<string, { count: number; cft: number }>() };
      g.count += 1; g.cft += c;
      const vn = (b.vendor_name ?? "").trim() || "—";
      const vg = g.vendors.get(vn) ?? { count: 0, cft: 0 };
      vg.count += 1; vg.cft += c; g.vendors.set(vn, vg);
      byStone.set(k, g);
    }
    if (detail) det.blocksByStone = [...byStone.entries()].map(([stone, v]) => ({ stone, count: v.count, cft: v.cft, vendors: [...v.vendors.entries()].map(([vendor, vv]) => ({ vendor, ...vv })).sort((a, b) => b.cft - a.cft) })).sort((a, b) => b.cft - a.cft);
  }

  // 2. CUTTING done in the window — blocks that became 'done'; their cut slabs by stone.
  {
    const doneBlocks = await fetchAllPaged<{ block_id: string }>((from, to) =>
      admin
        .from("cut_session_blocks")
        .select("block_id, status, updated_at")
        .eq("status", "done")
        .gte("updated_at", startUTC)
        .lt("updated_at", endUTC)
        .order("id", { ascending: true })
        .range(from, to),
    );
    /* Marble NEVER enters a cut session. Verified Aug 2026: of the 455
       marble blocks that have produced slabs, zero appear in
       cut_session_blocks — the team cuts marble by hand and the block just
       becomes `consumed`. So this card had silently been sandstone-only
       since it was written; August alone was under-reporting 137 marble
       blocks / 903 slabs / ~4,800 CFT.

       The cut DATE for marble is blocks.updated_at at the point it went
       consumed — the same rule the app's own Marble Cutting Log uses
       (blocks/page.tsx), so the two screens agree. It is not a dedicated
       timestamp, so a later edit of a consumed block re-dates its cut;
       that is the existing convention and not worth diverging from here. */
    const marbleNames = Object.keys(categoryMap).filter((n) => categoryMap[n] === "marble");
    let marbleCutIds: string[] = [];
    if (marbleNames.length > 0) {
      const rows = await fetchAllPaged<{ id: string }>((from, to) =>
        admin
          .from("blocks")
          .select("id, stone, status, updated_at")
          .eq("status", "consumed")
          .in("stone", marbleNames)
          .gte("updated_at", startUTC)
          .lt("updated_at", endUTC)
          .order("id", { ascending: true })
          .range(from, to),
      );
      marbleCutIds = rows.map((r) => r.id);
    }
    // Set-union so a block counted by both routes can never be double-cut.
    const blockIds = [...new Set([...doneBlocks.map((b) => b.block_id), ...marbleCutIds].filter(Boolean))];
    if (blockIds.length > 0) {
      const slabs: Array<{ stone: string | null; length_ft: number; width_ft: number; thickness_ft: number }> = [];
      // Each 200-block chunk can yield FAR more than 1000 slabs, so the result
      // needs paginating too — otherwise the cutting card silently under-counts
      // the same way the dispatch card did.
      for (const chunk of chunkIds(blockIds, 200)) {
        const page = await fetchAllPaged<{ stone: string | null; length_ft: number; width_ft: number; thickness_ft: number }>((from, to) =>
          admin
            .from("slab_requirements")
            .select("stone, length_ft, width_ft, thickness_ft, status")
            .in("source_block_id", chunk)
            .not("status", "in", "(open,rejected,cancelled)")
            .order("id", { ascending: true })
            .range(from, to),
        );
        slabs.push(...page);
      }
      const byStone = new Map<string, { slabs: number; cft: number }>();
      for (const s of slabs) {
        const c = cft(Number(s.length_ft), Number(s.width_ft), Number(s.thickness_ft));
        totals.cutting.slabs += 1; totals.cutting.cft += c;
        const k = stoneLabel(s.stone);
        const g = byStone.get(k) ?? { slabs: 0, cft: 0 };
        g.slabs += 1; g.cft += c; byStone.set(k, g);
      }
      if (detail) det.cuttingByStone = [...byStone.entries()].map(([stone, v]) => ({ stone, ...v })).sort((a, b) => b.cft - a.cft);
    }
  }

  // 3. CARVING done in the window — carving_items approved, by vendor.
  {
    const rows = await fetchAllPaged<{ slab_requirement_id: string | null; vendor_name: string | null; carving_sides: number | null }>((from, to) =>
      admin
        .from("carving_items")
        .select("slab_requirement_id, vendor_name, carving_sides, review_approved_at")
        .not("review_approved_at", "is", null)
        .gte("review_approved_at", startUTC)
        .lt("review_approved_at", endUTC)
        .order("id", { ascending: true })
        .range(from, to),
    );
    const dims = await dimsBySlab(admin, rows.map((r) => r.slab_requirement_id).filter(Boolean) as string[]);
    const byVendor = new Map<string, { slabs: number; cft: number; sft: number }>();
    for (const r of rows) {
      const d = r.slab_requirement_id ? dims.get(r.slab_requirement_id) : undefined;
      // Same rule as the CNC costing report (cnc-various-cost-report.ts): one
      // unit per slab by REAL thickness — never both, which would double-count
      // — times the number of carved sides.
      const sides = Number(r.carving_sides) === 2 ? 2 : 1;
      const thin = d ? isThinSlab(d.l, d.w, d.t) : false;
      const c = d && !thin ? cft(d.l, d.w, d.t) * sides : 0;
      const s = d && thin ? faceSftFromSlab(d.l, d.w, d.t) * sides : 0;
      totals.carving.slabs += 1; totals.carving.cft += c; totals.carving.sft += s;
      const k = r.vendor_name || "-";
      const g = byVendor.get(k) ?? { slabs: 0, cft: 0, sft: 0 };
      g.slabs += 1; g.cft += c; g.sft += s; byVendor.set(k, g);
    }
    if (detail) det.carvingByVendor = [...byVendor.entries()].map(([vendor, v]) => ({ vendor, ...v })).sort((a, b) => (b.cft + b.sft) - (a.cft + a.sft));
  }

  // 4. DISPATCH in the window — trucks sent; slabs + tonnes by temple.
  {
    const dispatches = await fetchAllPaged<{ id: string; temple: string }>((from, to) =>
      admin
        .from("dispatches")
        .select("id, temple, dispatched_at")
        .gte("dispatched_at", startUTC)
        .lt("dispatched_at", endUTC)
        .order("id", { ascending: true })
        .range(from, to),
    );
    totals.dispatch.trucks = dispatches.length;
    if (dispatches.length > 0) {
      // dispatch_logs holds one row PER SLAB per dispatch, so a month-to-date
      // window blows past PostgREST's 1000-row cap (Jul 2026 = 1,467 rows) — the
      // old uncapped .in() silently kept 1000 and UNDER-reported the dispatch
      // slabs / CFT / tonnes on the daily report. Chunk the dispatch ids AND
      // paginate each chunk so every log row is counted.
      type LogRow = { dispatch_id: string | null; slab_requirement_id: string | null; weight_tonnes: number | null };
      const logRows: LogRow[] = [];
      for (const idChunk of chunkIds(dispatches.map((d) => d.id), 100)) {
        const page = await fetchAllPaged<LogRow>((from, to) =>
          admin
            .from("dispatch_logs")
            .select("dispatch_id, slab_requirement_id, weight_tonnes")
            .in("dispatch_id", idChunk)
            .order("id", { ascending: true })
            .range(from, to),
        );
        logRows.push(...page);
      }
      const templeOf = new Map(dispatches.map((d) => [d.id, d.temple]));
      const dims = await cftBySlab(admin, logRows.map((l) => l.slab_requirement_id).filter(Boolean) as string[]);
      const byTemple = new Map<string, { slabs: number; cft: number; tonnes: number }>();
      for (const l of logRows) {
        if (!l.dispatch_id || !l.slab_requirement_id) continue;
        const temple = templeOf.get(l.dispatch_id) || "-";
        const c = dims.get(l.slab_requirement_id) ?? 0;
        const tn = Number(l.weight_tonnes) || 0;
        totals.dispatch.slabs += 1; totals.dispatch.cft += c; totals.dispatch.tonnes += tn;
        const g = byTemple.get(temple) ?? { slabs: 0, cft: 0, tonnes: 0 };
        g.slabs += 1; g.cft += c; g.tonnes += tn; byTemple.set(temple, g);
      }
      if (detail) det.dispatchByTemple = [...byTemple.entries()].map(([temple, v]) => ({ temple, ...v })).sort((a, b) => b.slabs - a.slabs);
    }
  }

  return { totals, det };
}

/** Supplier bill payments marked paid in [startUTC, endUTC) (carving-vendor
 *  payouts aren't tracked in the system yet). Grouped by vendor name when
 *  `detail`. Paginated — this also serves month windows now, and lifetime
 *  paid rows already exceed 1000. */
async function paymentsForWindow(admin: AdminClient, startUTC: string, endUTC: string, detail: boolean) {
  const rowsAll = await fetchAllPaged<{ paid_amount: number | null; bill_id: string | null }>((from, to) =>
    admin
      .from("bill_payments")
      .select("paid_amount, bill_id, paid_at, status")
      .eq("status", "paid")
      // Mig 219 — settlements are not cash that moved today.
      .eq("is_settlement", false)
      .gte("paid_at", startUTC)
      .lt("paid_at", endUTC)
      .order("id", { ascending: true })
      .range(from, to),
  );
  const rows = rowsAll.filter((p) => p.paid_amount != null);
  const total = rows.reduce((s, p) => s + Number(p.paid_amount), 0);
  if (!detail) return { total, byVendor: [] as Array<{ vendor: string; amount: number }> };

  const billIds = [...new Set(rows.map((r) => r.bill_id).filter(Boolean) as string[])];
  const billVendor = new Map<string, string | null>();
  for (let i = 0; i < billIds.length; i += 500) {
    const { data: bills } = await admin.from("bills").select("id, bill_vendor_id").in("id", billIds.slice(i, i + 500));
    for (const b of (bills ?? []) as Array<{ id: string; bill_vendor_id: string | null }>) billVendor.set(b.id, b.bill_vendor_id);
  }
  const vendorIds = [...new Set([...billVendor.values()].filter(Boolean) as string[])];
  const vName = new Map<string, string>();
  for (let i = 0; i < vendorIds.length; i += 500) {
    const { data: vs } = await admin.from("bill_vendors").select("id, name").in("id", vendorIds.slice(i, i + 500));
    for (const v of (vs ?? []) as Array<{ id: string; name: string }>) vName.set(v.id, v.name);
  }
  const byV = new Map<string, number>();
  for (const p of rows) {
    const vid = p.bill_id ? billVendor.get(p.bill_id) : null;
    const name = (vid && vName.get(vid)) || "-";
    byV.set(name, (byV.get(name) ?? 0) + Number(p.paid_amount));
  }
  const byVendor = [...byV.entries()].map(([vendor, amount]) => ({ vendor, amount })).sort((a, b) => b.amount - a.amount);
  return { total, byVendor };
}

/** Per-day activity counts for the last `days` IST days (oldest → newest).
 *  One windowed query per metric + bucket in JS — cheap, no N×day fan-out.
 *  blocks = blocks added, cutting = slabs cut (block became done), carving =
 *  slabs approved, dispatch = slabs sent. Counts (not CFT) so the series
 *  share a clean scale. */
async function trendForDays(admin: AdminClient, categoryMap: Record<string, StoneCategory>, days = 10) {
  const list = Array.from({ length: days }, (_, i) => {
    // End on yesterday (the last COMPLETE calendar day) — the report runs at
    // 10 AM, so including today would plot a misleading half-day dip.
    const d = istDay(i - days); // -days … -1
    return { ...d, startMs: Date.parse(d.startUTC), endMs: Date.parse(d.endUTC), blocks: 0, cutting: 0, carving: 0, dispatch: 0 };
  });
  const windowStart = list[0].startUTC;
  const windowEnd = list[list.length - 1].endUTC;
  const bucketOf = (iso: string | null): number => {
    if (!iso) return -1;
    const ms = Date.parse(iso);
    for (let i = 0; i < list.length; i++) if (ms >= list[i].startMs && ms <= list[i].endMs) return i;
    return -1;
  };

  // Blocks added.
  {
    const { data } = await admin.from("blocks").select("created_at").gte("created_at", windowStart).lte("created_at", windowEnd);
    for (const b of (data ?? []) as Array<{ created_at: string }>) { const i = bucketOf(b.created_at); if (i >= 0) list[i].blocks += 1; }
  }
  // Cutting done — blocks that turned 'done' in the window; count their cut slabs against the done-day.
  {
    const { data: db } = await admin.from("cut_session_blocks").select("block_id, updated_at").eq("status", "done").gte("updated_at", windowStart).lte("updated_at", windowEnd);
    const blockBucket = new Map<string, number>();
    for (const r of (db ?? []) as Array<{ block_id: string | null; updated_at: string }>) {
      if (!r.block_id) continue;
      const i = bucketOf(r.updated_at);
      if (i >= 0) blockBucket.set(r.block_id, i);
    }
    // Marble is cut off-session — its block simply becomes `consumed` (see
    // the long note in aggregateDay). Bucket those too, or this chart
    // disagrees with the CUTTING DONE · MARBLE card on page 1.
    const marbleNames = Object.keys(categoryMap).filter((n) => categoryMap[n] === "marble");
    if (marbleNames.length > 0) {
      const mb = await fetchAllPaged<{ id: string; updated_at: string }>((from, to) =>
        admin
          .from("blocks")
          .select("id, stone, status, updated_at")
          .eq("status", "consumed")
          .in("stone", marbleNames)
          .gte("updated_at", windowStart)
          .lte("updated_at", windowEnd)
          .order("id", { ascending: true })
          .range(from, to),
      );
      for (const r of mb) {
        const i = bucketOf(r.updated_at);
        if (i >= 0 && !blockBucket.has(r.id)) blockBucket.set(r.id, i);
      }
    }
    // A 200-block chunk can produce >1000 slabs — paginate each chunk (same
    // fix the main cutting card got; this chart silently under-counted too).
    for (const chunk of chunkIds([...blockBucket.keys()], 200)) {
      const slabs = await fetchAllPaged<{ source_block_id: string | null }>((from, to) =>
        admin
          .from("slab_requirements")
          .select("source_block_id, status")
          .in("source_block_id", chunk)
          .not("status", "in", "(open,rejected,cancelled)")
          .order("id", { ascending: true })
          .range(from, to),
      );
      for (const s of slabs) {
        const i = s.source_block_id != null ? blockBucket.get(s.source_block_id) : undefined;
        if (i != null) list[i].cutting += 1;
      }
    }
  }
  // Carving done — carving_items approved in the window.
  {
    const { data } = await admin.from("carving_items").select("review_approved_at").not("review_approved_at", "is", null).gte("review_approved_at", windowStart).lte("review_approved_at", windowEnd);
    for (const r of (data ?? []) as Array<{ review_approved_at: string }>) { const i = bucketOf(r.review_approved_at); if (i >= 0) list[i].carving += 1; }
  }
  // Dispatched — slabs on trucks sent in the window (dispatch_logs per dispatch).
  {
    const disp = await fetchAllPaged<{ id: string; dispatched_at: string }>((from, to) =>
      admin.from("dispatches").select("id, dispatched_at").gte("dispatched_at", windowStart).lte("dispatched_at", windowEnd).order("id", { ascending: true }).range(from, to),
    );
    const dBucket = new Map<string, number>();
    for (const r of disp) { const i = bucketOf(r.dispatched_at); if (i >= 0) dBucket.set(r.id, i); }
    for (const chunk of chunkIds([...dBucket.keys()], 100)) {
      const logs = await fetchAllPaged<{ dispatch_id: string | null }>((from, to) =>
        admin.from("dispatch_logs").select("dispatch_id").in("dispatch_id", chunk).order("id", { ascending: true }).range(from, to),
      );
      for (const l of logs) {
        const i = l.dispatch_id ? dBucket.get(l.dispatch_id) : undefined;
        if (i != null) list[i].dispatch += 1;
      }
    }
  }

  return list.map((d) => ({ label: d.label, short: d.label.split(" ")[0], blocks: d.blocks, cutting: d.cutting, carving: d.carving, dispatch: d.dispatch }));
}

/** Stone-name → category map (marble vs sandstone) from stone_types. */
async function stoneCategoryMapFor(admin: AdminClient): Promise<Record<string, StoneCategory>> {
  const map: Record<string, StoneCategory> = {};
  const { data } = await admin.from("stone_types").select("name, stone_category");
  for (const s of (data ?? []) as Array<{ name: string; stone_category?: string | null }>) {
    map[s.name] = s.stone_category === "marble" ? "marble" : "sandstone";
  }
  return map;
}

/** Current USABLE raw-block stock — blocks still available/reserved (i.e. not
 *  cut, consumed or discarded), CFT by category. Sandstone = L×W×H; marble =
 *  tonnes × 8 CFT-equiv (falls back to dims if a marble block lacks weight).
 *  Paginated — live stock is 584 blocks and growing toward the 1000 cap. */
async function blockStock(
  admin: AdminClient,
  categoryMap: Record<string, StoneCategory>,
): Promise<DailyReport["stock"]> {
  try {
    const data = await fetchAllPaged<{
      stone: string | null; length_ft: number; width_ft: number; height_ft: number; tonnes: number | null;
    }>((from, to) =>
      admin
        .from("blocks")
        .select("stone, length_ft, width_ft, height_ft, tonnes, status")
        .in("status", ["available", "reserved"])
        .order("id", { ascending: true })
        .range(from, to),
    );
    let marbleCft = 0, marbleTonnes = 0, sandstoneCft = 0, marbleCount = 0, sandstoneCount = 0;
    for (const b of data) {
      const dimsCft = cft(Number(b.length_ft), Number(b.width_ft), Number(b.height_ft));
      if (isMarble(b.stone, categoryMap)) {
        const tonnes = Number(b.tonnes) || 0;
        marbleTonnes += tonnes;
        marbleCft += cftEquivFromTonnes(tonnes) || dimsCft;
        marbleCount += 1;
      } else {
        sandstoneCft += dimsCft;
        sandstoneCount += 1;
      }
    }
    return { totalCft: marbleCft + sandstoneCft, marbleCft, marbleTonnes, sandstoneCft, marbleCount, sandstoneCount };
  } catch {
    return null;
  }
}

/** Block recovery split by category — reuses the Block Journey lineage engine
 *  so the numbers match that page exactly. Sandstone yields a recovered %,
 *  marble a CFT-per-tonne. Wrapped so a hiccup never blocks the daily report.
 *  Every source query is paginated: Fresh blocks (1,307) and cut_session_slabs
 *  (1,180) are ALREADY past the 1000-row cap, so the unpaged version was
 *  silently computing recovery on truncated data. */
async function buildRecoveryByCategory(
  admin: AdminClient,
  categoryMap: Record<string, StoneCategory>,
): Promise<DailyReport["recovery"]> {
  try {
    // Post-cut slabs, paginated (same walk the Block Journey page uses).
    const postCut: BjSlabRow[] = [];
    for (let off = 0; off < 50000; off += 1000) {
      const { data } = await admin
        .from("slab_requirements")
        .select("id, length_ft, width_ft, thickness_ft, source_block_id, label, temple, status, cut_source_kind")
        .not("source_block_id", "is", null)
        .in("status", POST_CUT_STATUSES as unknown as string[])
        .order("id", { ascending: true })
        .range(off, off + 999);
      if (!data || data.length === 0) break;
      postCut.push(...(data as unknown as BjSlabRow[]));
      if (data.length < 1000) break;
    }
    const blockCols =
      "id, stone, yard, quality, category, length_ft, width_ft, height_ft, tonnes, truck_entry_id, status, created_at, created_by, updated_at";
    const [freshRows, reusedRows, doneCsbRows, truckRows, cssRaw] = await Promise.all([
      fetchAllPaged<BjBlockRow>((from, to) =>
        admin.from("blocks").select(blockCols).eq("category", "Fresh").order("id", { ascending: true }).range(from, to)),
      fetchAllPaged<BjBlockRow>((from, to) =>
        admin.from("blocks").select(blockCols).eq("category", "Reused").order("id", { ascending: true }).range(from, to)),
      fetchAllPaged<BjCsbRow>((from, to) =>
        admin.from("cut_session_blocks").select("block_id, status, updated_at").eq("status", "done").order("id", { ascending: true }).range(from, to)),
      fetchAllPaged<BjMarbleTruckRow>((from, to) =>
        admin.from("marble_truck_entries").select("id, stone, truck_no, vendor_name, total_tonnes, num_blocks, created_at").order("id", { ascending: true }).range(from, to)),
      fetchAllPaged<{
        slab_requirement_id: string;
        is_filler: boolean | null;
        cut_session_blocks: { block_id: string } | { block_id: string }[] | null;
      }>((from, to) =>
        admin.from("cut_session_slabs").select("slab_requirement_id, is_filler, cut_session_blocks!inner(block_id)").order("id", { ascending: true }).range(from, to)),
    ]);
    const cutSessionSlabs: BjCutSessionSlabRow[] = [];
    for (const r of cssRaw) {
      const csb = Array.isArray(r.cut_session_blocks) ? r.cut_session_blocks[0] : r.cut_session_blocks;
      if (!csb?.block_id) continue;
      cutSessionSlabs.push({ slab_requirement_id: r.slab_requirement_id, is_filler: r.is_filler ?? null, block_id: csb.block_id });
    }
    const lineages = buildLineages(
      freshRows,
      reusedRows,
      postCut,
      doneCsbRows,
      categoryMap,
      truckRows,
      cutSessionSlabs,
    );
    const agg = aggregateLineages(lineages);
    return {
      sandstone: {
        recoveredPct: agg.weightedRecoveredPct,
        originalCft: agg.totalOriginalCft,
        slabCft: agg.totalSlabCft,
        lineages: agg.totalLineages - agg.marble.lineageCount,
      },
      marble: {
        cftPerTonne: agg.marble.weightedCftPerTonne,
        tonnes: agg.marble.totalTonnes,
        slabCft: agg.marble.totalSlabCft,
        lineages: agg.marble.lineageCount,
      },
    };
  } catch {
    return null;
  }
}

/** Live pipeline snapshot — cheap HEAD counts, no rows transferred. Answers
 *  "where does material stand right now?" (the owner's follow-up to every
 *  production number). Wrapped so a hiccup never blocks the report. */
async function buildPipeline(admin: AdminClient): Promise<DailyReport["pipeline"]> {
  try {
    const slabCount = async (status: string, parkedOnly = false): Promise<number> => {
      let q = admin.from("slab_requirements").select("id", { count: "exact", head: true }).eq("status", status);
      if (parkedOnly) q = q.eq("is_parked", true);
      const { count, error } = await q;
      if (error) throw error;
      return count ?? 0;
    };
    const [cutAll, cutParked, queue, onMachine, doneAll, doneParked] = await Promise.all([
      slabCount("cut_done"),
      slabCount("cut_done", true),
      slabCount("carving_assigned"),
      slabCount("carving_in_progress"),
      slabCount("completed"),
      slabCount("completed", true),
    ]);
    const { count: holdCount, error: holdErr } = await admin
      .from("carving_items")
      .select("id", { count: "exact", head: true })
      .eq("status", "carving_on_hold");
    if (holdErr) throw holdErr;
    return {
      cutWaiting: Math.max(0, cutAll - cutParked),
      queue,
      onMachine,
      onHold: holdCount ?? 0,
      readyDispatch: Math.max(0, doneAll - doneParked),
      storageCut: cutParked,
      storageReady: doneParked,
    };
  } catch {
    return null;
  }
}

// ── Last-24 h challans & invoices (Daksh, Jul 2026) ─────────────────
// The daily report now carries every challan RAISED and every invoice ISSUED
// in the same 24 h window — a summary list PLUS one itemised detail block per
// document, appended as pages in the same PDF (MSG91's template only carries
// one document header, so a single combined PDF is the delivery path — no
// chromium, no extra messages).

export type RecentLine = { name: string; desc: string; unit: string; qty: number; rate: number; amount: number; gstPercent: number | null };
export type RecentDoc = {
  kind: "challan" | "invoice";
  code: string; invCode: string | null; party: string; date: string;
  priced: boolean; cft: number; sft: number; nos: number;
  subtotal: number; taxed: number; total: number;
  items: RecentLine[];
};

const gstOfRow = (r: { gst_mode?: string | null; igst_percent?: number | null; cgst_percent?: number | null; sgst_percent?: number | null }) => ({
  mode: (r.gst_mode === "igst" || r.gst_mode === "cgst_sgst" ? r.gst_mode : null) as GstMode,
  igst: Number(r.igst_percent) || 0, cgst: Number(r.cgst_percent) || 0, sgst: Number(r.sgst_percent) || 0,
});
const unitBucket = (u: string | null | undefined): "cft" | "sft" | "nos" => {
  const s = (u ?? "").toLowerCase();
  if (s.includes("cft") || s.includes("cubic")) return "cft";
  if (s.includes("sft") || s.includes("sq")) return "sft";
  return "nos";
};

/** Fetch + normalise line items for a set of parent ids from one item table. */
async function fetchLines(
  admin: AdminClient, table: string, parentCol: string, ids: string[],
  unitCol: "unit" | "measure_unit", qtyCol: "quantity" | "measure_qty",
): Promise<Map<string, RecentLine[]>> {
  const m = new Map<string, RecentLine[]>();
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200);
    if (!chunk.length) break;
    const { data, error } = await admin.from(table).select("*").in(parentCol, chunk);
    if (error) break;
    for (const it of (data ?? []) as Array<Record<string, unknown>>) {
      const pid = String(it[parentCol]);
      const arr = m.get(pid) ?? [];
      const q = Number(it[qtyCol]) || 0;
      arr.push({
        name: String(it.label ?? it.particulars ?? [it.component_section, it.component_element].filter(Boolean).join(" ") ?? "").trim(),
        desc: String([it.description, it.additional_description].filter(Boolean).join(" - ") ?? "").trim(),
        unit: String(it[unitCol] ?? it.unit ?? "").trim(),
        qty: q,
        rate: Number(it.rate) || 0,
        amount: it.amount != null ? Number(it.amount) || 0 : q * (Number(it.rate) || 0),
        // Mig 199 — the line's own GST slab (select("*") carries it post-mig).
        gstPercent: it.section_gst != null && Number.isFinite(Number(it.section_gst)) ? Number(it.section_gst) : null,
      });
      m.set(pid, arr);
    }
  }
  return m;
}

/** One doc's rolled-up qty buckets + totals from its lines. Mig 200 — `total`
 *  is the PAYABLE (grand − discount). */
function rollup(lines: RecentLine[], gst: ReturnType<typeof gstOfRow>, disc?: { discount_mode?: string | null; discount_value?: number | null; round_total?: boolean | null }): Pick<RecentDoc, "cft" | "sft" | "nos" | "subtotal" | "taxed" | "total" | "priced"> {
  let cft = 0, sft = 0, nos = 0;
  for (const l of lines) { const b = unitBucket(l.unit); if (b === "cft") cft += l.qty; else if (b === "sft") sft += l.qty; else nos += l.qty; }
  const priced = lines.some((l) => l.amount > 0);
  const t = computeGroupedGstTotals(lines.map((l) => ({ amount: l.amount, gstPercent: l.gstPercent })), gst);
  const payable = applyDiscount(t.grand, disc?.discount_mode ?? null, Number(disc?.discount_value) || 0, disc?.round_total === true).payable;
  return { cft, sft, nos, subtotal: t.subtotal, taxed: t.grand - t.subtotal, total: payable, priced };
}

/** Every challan raised + every invoice issued inside [startUTC, endUTC). */
async function gatherRecentDocs(admin: AdminClient, startUTC: string, endUTC: string): Promise<{ challans: RecentDoc[]; invoices: RecentDoc[] }> {
  const challans: RecentDoc[] = [];
  const invoices: RecentDoc[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const win = (q: any, col: string): any => q.gte(col, startUTC).lt(col, endUTC);

  type ChRow = { id: string; challan_number: string; doc_fy: string | null; doc_seq: number | null; challan_date: string; temple: string | null; priced_at: string | null; owner_approved_at: string | null; custom_billed_at: string | null; converted_invoice_id: string | null; inv_fy: string | null; inv_seq: number | null; invoice_no_override: string | null; gst_mode: string | null; igst_percent: number | null; cgst_percent: number | null; sgst_percent: number | null; discount_mode?: string | null; discount_value?: number | null; round_total?: boolean | null };
  const CH_COLS = "id, challan_number, doc_fy, doc_seq, challan_date, temple, priced_at, owner_approved_at, custom_billed_at, converted_invoice_id, inv_fy, inv_seq, invoice_no_override, gst_mode, igst_percent, cgst_percent, sgst_percent, discount_mode, discount_value, round_total";
  const chCode = (r: ChRow) => challanCode(r.doc_fy, r.doc_seq) ?? r.challan_number;
  const chInv = (r: ChRow) => r.invoice_no_override?.trim() || invoiceCodeFromDoc(r.inv_fy, r.inv_seq) || null;

  // Line-item maps built lazily per id-set.
  const chItems = async (ids: string[]) => fetchLines(admin, "challan_items", "challan_id", ids, "measure_unit", "measure_qty");
  const chCustom = async (ids: string[]) => fetchLines(admin, "challan_custom_items", "challan_id", ids, "unit", "quantity");

  // 1 — CHALLANS raised in the window (temple).
  try {
    const { data } = await win(admin.from("challans").select(CH_COLS).is("archived_at", null).is("cancelled_at", null).order("created_at", { ascending: false }) as never, "created_at") as { data: ChRow[] | null };
    const rows = (data ?? []) as ChRow[];
    const std = await chItems(rows.map((r) => r.id));
    const cust = await chCustom(rows.filter((r) => !std.has(r.id)).map((r) => r.id));
    for (const r of rows) {
      const lines = std.get(r.id) ?? cust.get(r.id) ?? [];
      challans.push({ kind: "challan", code: chCode(r), invCode: chInv(r), party: r.temple ?? "-", date: r.challan_date, items: lines, ...rollup(lines, gstOfRow(r), r) });
    }
  } catch { /* never block the report */ }

  // 2 — INVOICES issued in the window: purchase (owner_approved_at) + running (custom_billed_at).
  try {
    const { data: appr } = await win(admin.from("challans").select(CH_COLS).is("cancelled_at", null).is("archived_at", null).is("custom_billed_at", null).not("owner_approved_at", "is", null).order("owner_approved_at", { ascending: false }) as never, "owner_approved_at") as { data: ChRow[] | null };
    const { data: run } = await win(admin.from("challans").select(CH_COLS).is("cancelled_at", null).is("archived_at", null).not("custom_billed_at", "is", null).not("inv_seq", "is", null).order("custom_billed_at", { ascending: false }) as never, "custom_billed_at") as { data: ChRow[] | null };
    const rows = [...((appr ?? []) as ChRow[]), ...((run ?? []) as ChRow[])];
    const std = await chItems(rows.filter((r) => !r.custom_billed_at).map((r) => r.id));
    const cust = await chCustom(rows.filter((r) => r.custom_billed_at).map((r) => r.id));
    for (const r of rows) {
      const lines = (r.custom_billed_at ? cust.get(r.id) : std.get(r.id)) ?? [];
      invoices.push({ kind: "invoice", code: chInv(r) ?? chCode(r), invCode: chInv(r), party: r.temple ?? "-", date: r.challan_date, items: lines, ...rollup(lines, gstOfRow(r), r) });
    }
  } catch { /* skip */ }

  // 3 — WORK-ORDER invoices approved in the window (bulk_invoices).
  try {
    type BRow = { id: string; temple: string | null; invoice_date: string; inv_fy: string | null; inv_seq: number | null; invoice_no_override: string | null; gst_mode: string | null; igst_percent: number | null; cgst_percent: number | null; sgst_percent: number | null; discount_mode?: string | null; discount_value?: number | null; round_total?: boolean | null };
    const { data } = await win(admin.from("bulk_invoices").select("id, temple, invoice_date, inv_fy, inv_seq, invoice_no_override, gst_mode, igst_percent, cgst_percent, sgst_percent, discount_mode, discount_value, round_total").is("cancelled_at", null).not("owner_approved_at", "is", null).order("owner_approved_at", { ascending: false }) as never, "owner_approved_at") as { data: BRow[] | null };
    const rows = (data ?? []) as BRow[];
    const items = await fetchLines(admin, "bulk_invoice_items", "bulk_invoice_id", rows.map((r) => r.id), "unit", "quantity");
    for (const r of rows) {
      const lines = items.get(r.id) ?? [];
      const code = r.invoice_no_override?.trim() || invoiceCodeFromDoc(r.inv_fy, r.inv_seq) || `INV-${r.id.slice(0, 6).toUpperCase()}`;
      invoices.push({ kind: "invoice", code, invCode: code, party: r.temple ?? "-", date: r.invoice_date, items: lines, ...rollup(lines, gstOfRow(r), r) });
    }
  } catch { /* skip */ }

  // 4 — OTHER SALES: challans created + invoices converted in the window.
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const parse = (rows: any[]): { row: any; party: string }[] => rows.map((r) => ({ row: r, party: (Array.isArray(r.invoice_parties) ? r.invoice_parties[0]?.name : r.invoice_parties?.name) ?? "Other Sales" }));
    const OC = "id, challan_date, doc_fy, doc_seq, inv_fy, inv_seq, converted_at, gst_mode, igst_percent, cgst_percent, sgst_percent, discount_mode, discount_value, round_total, invoice_parties(name)";
    const { data: raised } = await win(admin.from("other_challans").select(OC).is("cancelled_at", null).order("created_at", { ascending: false }) as never, "created_at") as { data: unknown[] | null };
    const { data: conv } = await win(admin.from("other_challans").select(OC).is("cancelled_at", null).not("converted_at", "is", null).order("converted_at", { ascending: false }) as never, "converted_at") as { data: unknown[] | null };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const all = [...parse((raised ?? []) as any[]).map((x) => ({ ...x, kind: "challan" as const })), ...parse((conv ?? []) as any[]).map((x) => ({ ...x, kind: "invoice" as const }))];
    const items = await fetchLines(admin, "other_challan_items", "other_challan_id", all.map((x) => String(x.row.id)), "unit", "quantity");
    for (const x of all) {
      const r = x.row;
      const lines = items.get(String(r.id)) ?? [];
      const roll = rollup(lines, gstOfRow(r), r);
      const code = x.kind === "invoice" ? (invoiceCodeFromDoc(r.inv_fy, r.inv_seq) || `INV-${String(r.id).slice(0, 6).toUpperCase()}`) : (challanCode(r.doc_fy, r.doc_seq) ?? `CH-${String(r.id).slice(0, 6).toUpperCase()}`);
      const doc: RecentDoc = { kind: x.kind, code, invCode: x.kind === "invoice" ? code : (r.converted_at ? invoiceCodeFromDoc(r.inv_fy, r.inv_seq) : null), party: x.party, date: String(r.challan_date), items: lines, ...roll };
      (x.kind === "invoice" ? invoices : challans).push(doc);
    }
  } catch { /* skip */ }

  const bySeq = (a: RecentDoc, b: RecentDoc) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0);
  return { challans: challans.sort(bySeq), invoices: invoices.sort(bySeq) };
}

export async function buildDailyReportData(): Promise<DailyReport> {
  const admin = createAdminSupabaseClient();
  // Main = last 24 h (10 AM → 10 AM); prev = the 24 h before that.
  const t = window24(0);
  const p = window24(-1);
  // Needed by aggregateDay itself now (marble vs sandstone split), so it is
  // fetched before the first window rather than alongside the stock card.
  const categoryMap = await stoneCategoryMapFor(admin);
  const today = await aggregateDay(admin, t.startUTC, t.endUTC, true, categoryMap);
  const prev = await aggregateDay(admin, p.startUTC, p.endUTC, false, categoryMap);
  const payToday = await paymentsForWindow(admin, t.startUTC, t.endUTC, true);

  // Month framing anchored to the REPORT day, plus the same-point window of
  // the month before it — see reportMonthFor. Current usable block stock,
  // block recovery and the live pipeline are wrapped so they never block
  // the report.
  const mo = reportMonthFor(t.y, t.m, t.d);
  const mtd = await aggregateDay(admin, mo.startUTC, t.endUTC, false, categoryMap);
  const mtdPrev = await aggregateDay(admin, mo.prev.startUTC, mo.prev.endUTC, false, categoryMap);
  const paymentsMtd = (await paymentsForWindow(admin, mo.startUTC, t.endUTC, false)).total;
  const stock = await blockStock(admin, categoryMap);
  const recovery = await buildRecoveryByCategory(admin, categoryMap);
  const pipeline = await buildPipeline(admin);

  // Report-month CNC costing — same prorated-to-elapsed-days engine as the
  // /reports/various-costing/cnc page (it self-clamps current months to
  // "today"; a past report month yields its complete final figures).
  // Wrapped so a CNC hiccup never blocks the daily report.
  let cnc: DailyReport["cnc"] = null;
  try {
    const period = cncPeriodFromSearch({ year: String(mo.year), month: String(mo.monthIndex + 1) });
    const rep = await buildCncVariousCostReport(period);
    const monthLen = Number(period.endDate.slice(8, 10)) || 30;
    const machines = rep.perVendor.reduce((s, v) => s + (v.machineCount || 0), 0);
    cnc = {
      label: period.label,
      days: rep.daysInWindow,
      monthLen,
      totalCost: rep.totalCostForPeriod,
      operational: rep.operationalForPeriod,
      depreciation: rep.depreciationForPeriod,
      sft: rep.totalSft,
      cft: rep.totalCft,
      costPerSft: rep.costPerSft,
      costPerCft: rep.costPerCft,
      // Combined "/unit" headline — matches the CNC costing page's
      // "COST PER UNIT" card (totalCost ÷ summed SFT+CFT output).
      costPerCombined: rep.totalSft + rep.totalCft > 0 ? rep.totalCostForPeriod / (rep.totalSft + rep.totalCft) : NaN,
      machines,
      slabs: rep.slabsCount,
    };
  } catch {
    cnc = null;
  }

  // Report-month cutter costing. The cutter report doesn't self-clamp to
  // "today" like the CNC one, so clamp its end ourselves: min(today, month
  // end) — a current month counts elapsed days only, a past report month
  // keeps its full length.
  let cutter: DailyReport["cutter"] = null;
  try {
    const period = cutterPeriodFromSearch({ year: String(mo.year), month: String(mo.monthIndex + 1) });
    const todayKey = istDateKey();
    const endUsed = todayKey < period.endDate ? todayKey : period.endDate;
    const monthLen = Number(period.endDate.slice(8, 10)) || 30;
    const days = Number(endUsed.slice(8, 10)) || monthLen;
    const rep = await buildCutterCostReport({ ...period, endDate: endUsed });
    cutter = {
      label: period.label,
      days,
      monthLen,
      totalCost: rep.totalCost,
      operational: rep.operationalForPeriod,
      depreciation: rep.depreciationForPeriod,
      cft: rep.totalCft,
      costPerCft: rep.costPerCft,
      slabs: rep.slabsCount,
    };
  } catch {
    cutter = null;
  }

  const trend = await trendForDays(admin, categoryMap, 10);

  // Last-24 h challans raised + invoices issued (same window as the report).
  let recent: DailyReport["recent"] = null;
  try { recent = await gatherRecentDocs(admin, t.startUTC, t.endUTC); } catch { recent = null; }

  return {
    label: t.label,
    weekday: t.weekday,
    prevLabel: p.label,
    today: today.totals,
    prev: prev.totals,
    mtd: mtd.totals,
    mtdPrev: mtdPrev.totals,
    month: { label: mo.label, monthName: mo.monthName, days: mo.daysElapsed, monthLen: mo.monthLen, prevMonthName: mo.prev.monthName, prevDays: mo.prev.days },
    stock,
    recovery,
    pipeline,
    blocksByStone: today.det.blocksByStone,
    cuttingByStone: today.det.cuttingByStone,
    carvingByVendor: today.det.carvingByVendor,
    dispatchByTemple: today.det.dispatchByTemple,
    payments: { total: payToday.total, byVendor: payToday.byVendor },
    paymentsMtd,
    cnc,
    cutter,
    trend,
    recent,
  };
}

// ── PDF ─────────────────────────────────────────────────────────────

export async function buildDailyReportPdf(data: DailyReport): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  // Phone-screen page (portrait). The report is delivered on WhatsApp and
  // read on a phone, so: single column, one big card per metric, large
  // numbers — readable without pinch-zoom.
  const W = 430, H = 932, M = 18, cw = W - 2 * M;
  // LIGHT theme (Daksh, Aug 2026 — "make that pdf light theme"). Dark ink
  // on paper-white, with each card a pale wash of its metric colour and a
  // matching left rule. Printing a dark-themed PDF wasted toner and read
  // badly in daylight on a phone; this is the same information at far
  // higher contrast.
  const white = rgb(1, 1, 1);
  const ink = rgb(0.09, 0.11, 0.15);          // near-black body text
  const muted = rgb(0.42, 0.46, 0.53);
  const line = rgb(0.84, 0.86, 0.89);
  const brown = rgb(0.55, 0.36, 0.11);
  const rowTint = rgb(0.965, 0.97, 0.98);
  const bgTop = rgb(1, 1, 1), bgBot = rgb(0.97, 0.975, 0.98);
  // Strong hues for rules/labels…
  const COL = {
    blue: rgb(0.15, 0.39, 0.85), cyan: rgb(0.05, 0.50, 0.64), amber: rgb(0.72, 0.44, 0.04),
    green: rgb(0.06, 0.53, 0.31), gold: rgb(0.62, 0.40, 0.10), indigo: rgb(0.31, 0.28, 0.75), teal: rgb(0.06, 0.45, 0.42),
  };
  // …and the pale wash each card sits on.
  const WASH = {
    blue: rgb(0.92, 0.95, 1), cyan: rgb(0.90, 0.96, 0.98), amber: rgb(0.99, 0.95, 0.87),
    green: rgb(0.90, 0.97, 0.93), gold: rgb(0.98, 0.95, 0.89), indigo: rgb(0.94, 0.94, 0.99), teal: rgb(0.90, 0.96, 0.95),
  };

  let logo: Awaited<ReturnType<typeof pdf.embedPng>> | null = null;
  try { logo = await pdf.embedPng(await readFile(path.join(process.cwd(), "public", "logo-dark.png"))); } catch { /* optional */ }

  const roundPath = (w: number, h: number, r: number) => {
    const rr = Math.min(r, w / 2, h / 2);
    return `M ${rr} 0 L ${w - rr} 0 Q ${w} 0 ${w} ${rr} L ${w} ${h - rr} Q ${w} ${h} ${w - rr} ${h} L ${rr} ${h} Q 0 ${h} 0 ${h - rr} L 0 ${rr} Q 0 0 ${rr} 0 Z`;
  };
  // Rounded only on the top (gloss) / bottom (depth) edge — used to fake a
  // glassy vertical sheen on the cards.
  const roundTopPath = (w: number, h: number, r: number) => {
    const rr = Math.min(r, w / 2, h);
    return `M 0 ${h} L 0 ${rr} Q 0 0 ${rr} 0 L ${w - rr} 0 Q ${w} 0 ${w} ${rr} L ${w} ${h} Z`;
  };
  const roundBottomPath = (w: number, h: number, r: number) => {
    const rr = Math.min(r, w / 2, h);
    return `M 0 0 L ${w} 0 L ${w} ${h - rr} Q ${w} ${h} ${w - rr} ${h} L ${rr} ${h} Q 0 ${h} 0 ${h - rr} L 0 0 Z`;
  };
  const mk = (pg: ReturnType<typeof pdf.addPage>) => ({
    pg,
    // Every draw goes through winSafe() so a WinAnsi-unencodable char can never
    // throw and kill the whole report (the "↳" 0x21B3 crash).
    t: (s: string, x: number, y: number, sz: number, f = font, c = ink) => { const S = winSafe(s); return pg.drawText(S, { x, y, size: sz, font: f, color: c }); },
    r: (s: string, xr: number, y: number, sz: number, f = font, c = ink) => { const S = winSafe(s); return pg.drawText(S, { x: xr - f.widthOfTextAtSize(S, sz), y, size: sz, font: f, color: c }); },
    ctr: (s: string, cx: number, y: number, sz: number, f = font, c = ink) => { const S = winSafe(s); return pg.drawText(S, { x: cx - f.widthOfTextAtSize(S, sz) / 2, y, size: sz, font: f, color: c }); },
    card: (x: number, yTop: number, w: number, h: number, rad: number, color: ReturnType<typeof rgb>, o?: { opacity?: number }) => pg.drawSvgPath(roundPath(w, h, rad), { x, y: yTop, color, opacity: o?.opacity }),
    // Light card: a pale wash, a hairline border, and a solid colour rule
    // down the left edge that carries the metric's identity. No gloss, no
    // shadow — on white those read as smudges, and the point of the light
    // theme is contrast, not decoration.
    glass: (x: number, yTop: number, w: number, h: number, rad: number, base: ReturnType<typeof rgb>, wash?: ReturnType<typeof rgb>) => {
      pg.drawSvgPath(roundPath(w, h, rad), { x, y: yTop, color: wash ?? rgb(0.97, 0.975, 0.98), borderColor: base, borderWidth: 0.8, borderOpacity: 0.35 });
      pg.drawSvgPath(roundPath(5, h, 2.5), { x, y: yTop, color: base });
    },
    clip: (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s),
  });

  const gen = new Date(Date.now() + 5.5 * 3600 * 1000);
  const genLabel = `${gen.getUTCDate()} ${MONTHS[gen.getUTCMonth()]}, ${String(gen.getUTCHours()).padStart(2, "0")}:${String(gen.getUTCMinutes()).padStart(2, "0")} IST`;

  const header = (P: ReturnType<typeof mk>, top: number, withSubtitle: boolean) => {
    if (logo) { const lh = 20, lw = (logo.width / logo.height) * lh; P.pg.drawImage(logo, { x: M, y: top - lh, width: lw, height: lh }); }
    const dpw = bold.widthOfTextAtSize(data.label, 11) + 18;
    P.card(W - M - dpw, top, dpw, 20, 6, brown);
    P.ctr(data.label, W - M - dpw / 2, top - 13, 11, bold, white);
    P.r(`${data.weekday} · vs ${data.prevLabel}`, W - M, top - 30, 8, font, muted);
    P.t("Daily Work Report", M, top - 44, 17, bold, ink);
    P.t("MATESHWARI TEMPLE CONSTRUCTION PVT LTD", M, top - 57, 7.5, bold, brown);
    let y = top - 57;
    // Says what the two colours mean, since that is now the whole page.
    if (withSubtitle) { P.t(`Left = last 24 h · Right = ${data.month.label} to date (day ${data.month.days} of ${data.month.monthLen})`, M, y - 12, 8, bold, muted); y -= 12; }
    y -= 9;
    P.pg.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 2.5, color: COL.gold });
    P.pg.drawLine({ start: { x: M, y: y - 2 }, end: { x: W - M, y: y - 2 }, thickness: 0.5, color: brown });
    return y - 16;
  };
  const footer = (P: ReturnType<typeof mk>, pageNo: number, pages: number) => {
    P.pg.drawLine({ start: { x: M, y: 34 }, end: { x: W - M, y: 34 }, thickness: 0.6, color: line });
    P.t(pageNo === 1 ? `Automated daily report · MTCPL · Generated ${genLabel}` : "Automated daily report · MTCPL", M, 22, 7.5, font, muted);
    P.r(`Page ${pageNo} of ${pages}`, W - M, 22, 7.5, font, muted);
  };

  // ASCII-only for the standard PDF font (Helvetica/WinAnsi can't encode
  // Devanagari etc. — strip to printable Latin so a stray char never throws).
  const asc = (s: string) => (s || "").replace(/[^\x20-\x7E]/g, "").replace(/\s+/g, " ").trim();

  // Last-24 h challans/invoices append a summary page + itemised detail pages
  // to the SAME PDF (MSG91 carries one document). Deterministic pagination:
  // fixed slot per doc so the page count is known up front for the footer.
  const recChallans = data.recent?.challans ?? [];
  const recInvoices = data.recent?.invoices ?? [];
  const RECENT_CAP = 40, DOCS_PER_PAGE = 5;
  const detailDocs = [...recChallans, ...recInvoices].slice(0, RECENT_CAP);
  const hasRecent = detailDocs.length > 0;
  const detailPages = Math.ceil(detailDocs.length / DOCS_PER_PAGE);
  const PAGES = 5 + (hasRecent ? 1 + detailPages : 0);
  const newPage = () => {
    const pg = pdf.addPage([W, H]);
    // Vertical slate gradient (banded — pdf-lib has no native gradients).
    const bands = 48;
    for (let i = 0; i < bands; i++) {
      const f = i / (bands - 1);
      pg.drawRectangle({
        x: 0, y: H - (H * (i + 1)) / bands, width: W, height: H / bands + 1,
        color: rgb(
          bgTop.red + (bgBot.red - bgTop.red) * f,
          bgTop.green + (bgBot.green - bgTop.green) * f,
          bgTop.blue + (bgBot.blue - bgTop.blue) * f,
        ),
      });
    }
    // The dark theme's glow blobs are deliberately gone: on white they read
    // as printer smudges and fight the numbers, which are the whole point.
    return mk(pg);
  };

  // ── Page 1 — the five headline metrics, two numbers each ──
  {
    const P = newPage();
    let y = header(P, H - 26, true);
    const mo = data.month;

    /* Aug 2026 — Daksh, relaying his dad: "too much on the card, it's
       confusing. Just show 2 numbers — that day on the left, month so
       far on the right." Then: "dad is more interested in CFT, not
       blocks or slabs." Then: "on blocks added, 2 cards — one for
       marble and one for sandstone; for marble tonnes, for sandstone
       CFT", and "both those cards should look like they're under a
       single roof." Cutting he wants left as one: "both stone, no
       separate."

       So: BLOCKS ADDED is one bordered card containing two stone rows,
       and the three flow metrics below it are plain cards. The roof is
       what says "these two are the same measurement, split by stone" —
       without it they read as two unrelated metrics.

       Marble BLOCKS are stated in tonnes because that is how they are
       bought and those blocks carry no dimensions at all; everything
       downstream is CFT, cut marble included, which is why cutting
       adds up as one figure.

       Everything that used to crowd these cards (prev-day pill,
       sparkline, vs-last-month, pace projection) is gone. The 24 h
       breakdown by stone is page 4, the trend charts page 5. */
    const C_24H = ink;                          // today — near-black
    const C_MTD = COL.blue;                     // month so far — its own colour
    const moLabel = `${mo.monthName.toUpperCase()} SO FAR · ${mo.days} ${mo.days === 1 ? "DAY" : "DAYS"}`;
    const midX = M + cw / 2;

    /** One left/right number pair — the same shape inside the blocks roof
     *  and on the standalone cards below it, so they read as one family. */
    const pair = (
      top: number, unit: string,
      todayV: string, todaySub: string, monthV: string, monthSub: string,
      num: number,
    ) => {
      const numY = top - (num + 8);   // rhythm scales with the figure size
      const subY = numY - 20;
      const uSz = Math.max(11, num * 0.36);
      P.t("LAST 24 H", M + 18, top, 8.5, bold, muted);
      P.t(todayV, M + 18, numY, num, bold, C_24H);
      P.t(unit, M + 18 + bold.widthOfTextAtSize(todayV, num) + 7, numY, uSz, bold, C_24H);
      P.t(todaySub, M + 18, subY, 9.5, bold, muted);

      P.t(moLabel, midX + 16, top, 8.5, bold, C_MTD);
      P.t(monthV, midX + 16, numY, num, bold, C_MTD);
      P.t(unit, midX + 16 + bold.widthOfTextAtSize(monthV, num) + 7, numY, uSz, bold, C_MTD);
      P.t(monthSub, midX + 16, subY, 9.5, bold, muted);
    };

    // ── BLOCKS ADDED — one roof, two stone rows ──
    {
      const rowH = 108, hh = 44 + rowH * 2 + 6;
      P.glass(M, y, cw, hh, 13, COL.blue, WASH.blue);
      P.t("BLOCKS ADDED", M + 18, y - 28, 13.5, bold, COL.blue);
      P.r("MARBLE IN TONNES · SANDSTONE IN CFT", W - M - 14, y - 27, 8, bold, muted);

      const stoneRow = (top: number, name: string, unit: string, t: string, tSub: string, m: string, mSub: string) => {
        P.t(name, M + 18, top - 16, 11, bold, ink);
        P.pg.drawLine({ start: { x: midX, y: top - 24 }, end: { x: midX, y: top - 100 }, thickness: 0.7, color: COL.blue, opacity: 0.3 });
        pair(top - 36, unit, t, tSub, m, mSub, 32);
      };
      stoneRow(
        y - 44, "MARBLE", "T",
        fmt1(data.today.blocks.marble.tonnes), `${data.today.blocks.marble.count} blocks`,
        fmt1(data.mtd.blocks.marble.tonnes), `${fmt0(data.mtd.blocks.marble.count)} blocks`,
      );
      // Hairline between the two rows — inside the same border, so they stay
      // one card rather than becoming two.
      P.pg.drawLine({ start: { x: M + 14, y: y - 44 - rowH }, end: { x: W - M - 14, y: y - 44 - rowH }, thickness: 0.6, color: COL.blue, opacity: 0.28 });
      stoneRow(
        y - 44 - rowH, "SANDSTONE", "CFT",
        fmt0(data.today.blocks.sandstone.cft), `${data.today.blocks.sandstone.count} blocks`,
        fmt0(data.mtd.blocks.sandstone.cft), `${fmt0(data.mtd.blocks.sandstone.count)} blocks`,
      );
      y -= hh + 13;
    }

    // ── the three flow metrics, one card each ──
    const cards: Array<{
      c: ReturnType<typeof rgb>; wash: ReturnType<typeof rgb>; label: string; unit: string;
      today: string; todaySub: string; month: string; monthSub: string;
    }> = [
      {
        c: COL.cyan, wash: WASH.cyan, label: "CUTTING DONE", unit: "CFT",
        today: fmt0(data.today.cutting.cft), todaySub: `${data.today.cutting.slabs} slabs`,
        month: fmt0(data.mtd.cutting.cft),   monthSub: `${fmt0(data.mtd.cutting.slabs)} slabs`,
      },
      {
        /* Carved output is SFT for a thin slab and CFT for a thick one —
           never both — so the honest headline is the two added together,
           the same "combined units" the CNC costing card is priced per.
           The split is spelled out underneath so it is never mistaken
           for plain CFT. */
        c: COL.amber, wash: WASH.amber, label: "CARVING DONE", unit: "CFT+SFT",
        today: fmt0(data.today.carving.cft + data.today.carving.sft),
        todaySub: `${fmt0(data.today.carving.cft)} CFT + ${fmt0(data.today.carving.sft)} SFT · ${data.today.carving.slabs} slabs`,
        month: fmt0(data.mtd.carving.cft + data.mtd.carving.sft),
        monthSub: `${fmt0(data.mtd.carving.cft)} CFT + ${fmt0(data.mtd.carving.sft)} SFT · ${fmt0(data.mtd.carving.slabs)} slabs`,
      },
      {
        c: COL.green, wash: WASH.green, label: "DISPATCHED", unit: "CFT",
        today: fmt0(data.today.dispatch.cft),
        todaySub: `${data.today.dispatch.slabs} slabs · ${data.today.dispatch.trucks} trucks`,
        month: fmt0(data.mtd.dispatch.cft),
        monthSub: `${fmt0(data.mtd.dispatch.slabs)} slabs · ${data.mtd.dispatch.trucks} trucks`,
      },
    ];
    const ch = 152, gap = 13;
    for (const k of cards) {
      P.glass(M, y, cw, ch, 13, k.c, k.wash);
      P.t(k.label, M + 18, y - 30, 14, bold, k.c);
      P.pg.drawLine({ start: { x: midX, y: y - 46 }, end: { x: midX, y: y - ch + 16 }, thickness: 0.7, color: k.c, opacity: 0.3 });
      pair(y - 62, k.unit, k.today, k.todaySub, k.month, k.monthSub, 36);
      y -= ch + gap;
    }

    footer(P, 1, PAGES);
  }

  /* ── Page 2 — the plant: what cutting and carving cost, what stone is
     left, and how much of a block survives it.
     Stock and recovery sit here rather than beside the trend charts on
     Daksh's instruction ("bring them up under cutter costing") — they
     answer the same question the costing cards do: is the material side
     of the business healthy. */
  {
    const P = newPage();
    let y = header(P, H - 26, false);
    /* "In CNC costing, cutter costing make it minimal and bold, only
       important numbers." Both cards used to carry the operational /
       depreciation split, machine counts and a per-SFT-and-per-CFT line.
       What the owner actually reads is the RATE and what it has cost so
       far, so that is all that is left; the rest lives on the costing
       pages in the app. */
    const COST_H = 196, PLANT_GAP = 14;
    if (data.cnc) {
      const c = data.cnc, hh = COST_H;
      const rate = Number.isFinite(c.costPerCombined) ? inr2(c.costPerCombined) : "--";
      P.glass(M, y, cw, hh, 14, COL.indigo, WASH.indigo);
      P.t("CNC COSTING", M + 18, y - 32, 14.5, bold, COL.indigo);
      P.r(`${mo2(c.label)} · ${c.days} of ${c.monthLen} days`, W - M - 16, y - 31, 9, bold, muted);
      P.t(rate, M + 18, y - 96, 44, bold, ink);
      P.t("PER SFT+CFT", M + 20 + bold.widthOfTextAtSize(rate, 44) + 9, y - 96, 11, bold, muted);
      P.pg.drawLine({ start: { x: M + 18, y: y - 122 }, end: { x: W - M - 16, y: y - 122 }, thickness: 0.6, color: COL.indigo, opacity: 0.3 });
      P.t("SPENT", M + 18, y - 144, 9.5, bold, muted);
      P.t(inr(c.totalCost), M + 18, y - 170, 19, bold, ink);
      P.r("CARVED", W - M - 16, y - 144, 9.5, bold, muted);
      P.r(`${fmt0(c.sft + c.cft)} units · ${c.slabs} slabs`, W - M - 16, y - 170, 14, bold, ink);
      y -= hh + PLANT_GAP;
    }
    if (data.cutter) {
      const c = data.cutter, hh = COST_H;
      const rate = Number.isFinite(c.costPerCft) ? inr2(c.costPerCft) : "--";
      P.glass(M, y, cw, hh, 14, COL.teal, WASH.teal);
      P.t("CUTTER COSTING", M + 18, y - 32, 14.5, bold, COL.teal);
      P.r(`${mo2(c.label)} · ${c.days} of ${c.monthLen} days`, W - M - 16, y - 31, 9, bold, muted);
      P.t(rate, M + 18, y - 96, 44, bold, ink);
      P.t("PER CFT", M + 20 + bold.widthOfTextAtSize(rate, 44) + 9, y - 96, 11, bold, muted);
      P.pg.drawLine({ start: { x: M + 18, y: y - 122 }, end: { x: W - M - 16, y: y - 122 }, thickness: 0.6, color: COL.teal, opacity: 0.3 });
      P.t("SPENT", M + 18, y - 144, 9.5, bold, muted);
      P.t(inr(c.totalCost), M + 18, y - 170, 19, bold, ink);
      P.r("CUT", W - M - 16, y - 144, 9.5, bold, muted);
      P.r(`${fmt0(c.cft)} CFT`, W - M - 16, y - 170, 14, bold, ink);
      y -= hh + PLANT_GAP;
    }
    const PLANT_H = 166;
    if (data.stock) {
      const s = data.stock, hh = PLANT_H;
      P.glass(M, y, cw, hh, 14, COL.cyan, WASH.cyan);
      P.t("RAW BLOCK STOCK", M + 18, y - 30, 14, bold, COL.cyan);
      P.r("available + reserved", W - M - 16, y - 29, 8.5, bold, muted);
      const colW = (cw - 34) / 2;
      P.t("SANDSTONE", M + 18, y - 62, 9.5, bold, muted);
      P.t(`${fmt0(s.sandstoneCft)} CFT`, M + 18, y - 106, 27, bold, ink);
      P.t(`${s.sandstoneCount} blocks`, M + 18, y - 128, 9.5, bold, muted);
      const mx = M + 18 + colW;
      P.pg.drawLine({ start: { x: mx - 8, y: y - 50 }, end: { x: mx - 8, y: y - 136 }, thickness: 0.6, color: COL.cyan, opacity: 0.3 });
      P.t("MARBLE", mx, y - 62, 9.5, bold, muted);
      P.t(`${fmt1(s.marbleTonnes)} T`, mx, y - 106, 27, bold, ink);
      P.t(`${s.marbleCount} blocks · ~${fmt0(s.marbleCft)} CFT`, mx, y - 128, 9.5, bold, muted);
      y -= hh + PLANT_GAP;
    }
    // Block recovery split by stone category (matches the Block Journey
    // page): sandstone as a yield %, marble as CFT per tonne.
    if (data.recovery) {
      const rec = data.recovery, rh = PLANT_H;
      P.glass(M, y, cw, rh, 14, COL.gold, WASH.gold);
      P.t("BLOCK RECOVERY", M + 18, y - 30, 14, bold, COL.gold);
      P.r("lifetime, every cut block", W - M - 16, y - 29, 8.5, bold, muted);
      const colW = (cw - 34) / 2;
      P.t("SANDSTONE", M + 18, y - 62, 9.5, bold, muted);
      P.t(`${rec.sandstone.recoveredPct.toFixed(1)}%`, M + 18, y - 106, 27, bold, ink);
      P.t(`${fmt0(rec.sandstone.slabCft)} / ${fmt0(rec.sandstone.originalCft)} CFT`, M + 18, y - 128, 9.5, bold, muted);
      const mx = M + 18 + colW;
      P.pg.drawLine({ start: { x: mx - 8, y: y - 50 }, end: { x: mx - 8, y: y - 136 }, thickness: 0.6, color: COL.gold, opacity: 0.3 });
      P.t("MARBLE", mx, y - 62, 9.5, bold, muted);
      P.t(`${rec.marble.cftPerTonne.toFixed(1)} CFT/T`, mx, y - 106, 27, bold, ink);
      P.t(`${fmt0(rec.marble.slabCft)} CFT from ${fmt1(rec.marble.tonnes)} T`, mx, y - 128, 9.5, bold, muted);
      y -= rh + PLANT_GAP;
    }
    footer(P, 2, PAGES);
  }

  // ── Page 3 — money out: billing raised and suppliers paid ──
  {
    const P = newPage();
    let y = header(P, H - 26, false);
    {
      // Billing pulse — how much paper went out in the same 24 h window. The
      // full lists + itemised copies follow on the billing pages.
      const hh = 84;
      const bv = recChallans.reduce((s, d) => s + d.total, 0);
      const iv = recInvoices.reduce((s, d) => s + d.total, 0);
      P.glass(M, y, cw, hh, 14, COL.blue, WASH.blue);
      P.t("BILLING · LAST 24 H", M + 18, y - 24, 12, bold, COL.blue);
      const half = cw / 2;
      P.t("CHALLANS RAISED", M + 18, y - 46, 9, bold, muted);
      P.t(data.recent ? `${recChallans.length} · ${inr(bv)}` : "n/a", M + 18, y - 70, 15, bold, ink);
      P.pg.drawLine({ start: { x: M + half, y: y - 38 }, end: { x: M + half, y: y - 74 }, thickness: 0.6, color: COL.blue, opacity: 0.3 });
      P.t("INVOICES ISSUED", M + half + 16, y - 46, 9, bold, muted);
      P.t(data.recent ? `${recInvoices.length} · ${inr(iv)}` : "n/a", M + half + 16, y - 70, 15, bold, ink);
      y -= hh + 13;
    }
    {
      // Show EVERY supplier paid in the window (Daksh: the old top-6 cap
      // silently dropped vendors while the total stayed correct). A typical
      // day settles ~17 bills and the worst in four months was 52, so with
      // its own page the two columns never actually truncate; only an
      // extreme tail collapses into a "+N more" line.
      const all = data.payments.byVendor;
      const hasRows = all.length > 0;
      const lineH = 16, headH = 82, padBot = 14, footMargin = 46;
      const maxLines = Math.max(1, Math.floor((y - footMargin - headH - padBot) / lineH));
      const cap = maxLines * 2;
      let shown = all, ovN = 0, ovAmt = 0;
      if (all.length > cap) {
        const showLines = Math.max(1, maxLines - 1); // reserve last line for "+N more"
        shown = all.slice(0, showLines * 2);
        const rest = all.slice(showLines * 2);
        ovN = rest.length;
        ovAmt = rest.reduce((s, v) => s + v.amount, 0);
      }
      const bodyLines = hasRows ? Math.ceil(shown.length / 2) + (ovN > 0 ? 1 : 0) : 1;
      const payH = headH + bodyLines * lineH + padBot;
      P.glass(M, y, cw, payH, 14, COL.gold, WASH.gold);
      P.t("PAYMENTS TO SUPPLIERS", M + 18, y - 24, 12, bold, COL.gold);
      P.t("LAST 24 H", M + 18, y - 44, 9, bold, muted);
      P.t(inr(data.payments.total), M + 18, y - 68, 22, bold, ink);
      // Month framing on the right — the running spend this month.
      P.r(`${mo2(data.month.monthName)} SO FAR`, W - M - 16, y - 44, 9, bold, muted);
      P.r(inr(data.paymentsMtd), W - M - 16, y - 68, 15, bold, COL.blue);
      let py = y - 96;
      if (!hasRows) { P.t("No supplier payments in this 24 h window.", M + 18, py - 2, 9.5, font, muted); }
      else {
        P.pg.drawLine({ start: { x: M + 18, y: py + 10 }, end: { x: W - M - 16, y: py + 10 }, thickness: 0.6, color: COL.gold, opacity: 0.3 });
        const colGap = 16, innerW = cw - 36;
        const colX = [M + 18, M + 18 + (innerW + colGap) / 2];
        const colR = [M + 18 + (innerW - colGap) / 2, W - M - 16];
        shown.forEach((v, i) => {
          const col = i % 2;
          if (col === 0 && i > 0) py -= lineH;
          P.t(P.clip(v.vendor, 18), colX[col], py, 9, font, ink);
          P.r(inr(v.amount), colR[col], py, 9.5, bold, ink);
        });
        if (ovN > 0) {
          py -= lineH;
          P.t(`+${ovN} more supplier${ovN === 1 ? "" : "s"}`, colX[0], py, 9, font, muted);
          P.r(inr(ovAmt), W - M - 16, py, 9.5, bold, ink);
        }
      }
    }
    footer(P, 3, PAGES);
  }

  // ── Page 4 — last-24 h breakdowns (blocks / cutting / carving / dispatch) ──
  {
    const P = newPage();
    let y = header(P, H - 26, false);
    P.t("LAST 24 H · DETAIL", M, y, 11, bold, ink); y -= 18;
    const section = (title: string, color: ReturnType<typeof rgb>, rows: Array<{ n: string; v: string }>) => {
      P.pg.drawRectangle({ x: M, y: y - 1, width: 7, height: 7, color });
      P.t(title, M + 11, y, 10, bold, color); y -= 6;
      P.pg.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 1, color }); y -= 16;
      if (rows.length === 0) { P.t("None", M, y, 10, font, muted); y -= 16; }
      else {
        rows.slice(0, 8).forEach((rw, i) => {
          if (i % 2 === 1) P.pg.drawRectangle({ x: M - 4, y: y - 4, width: cw + 8, height: 15, color: rowTint });
          P.t(P.clip(rw.n, 30), M, y, 10.5, font, ink); P.r(rw.v, W - M, y, 10, bold, ink); y -= 16;
        });
        // No silent caps — a long tail collapses into an explicit count.
        if (rows.length > 8) { P.t(`+ ${rows.length - 8} more`, M, y, 9, font, muted); y -= 16; }
      }
      y -= 12;
    };
    section("BLOCKS ADDED BY STONE", COL.blue, data.blocksByStone.flatMap((rw) => [
      { n: rw.stone, v: `${fmt0(rw.cft)} CFT · ${rw.count}` },
      ...rw.vendors.filter((vd) => vd.vendor !== "—").map((vd) => ({ n: `    -  ${vd.vendor}`, v: `${fmt0(vd.cft)} CFT · ${vd.count}` })),
    ]));
    section("CUTTING BY STONE", COL.cyan, data.cuttingByStone.map((rw) => ({ n: rw.stone, v: `${fmt0(rw.cft)} CFT · ${rw.slabs}` })));
    section("CARVING BY VENDOR", COL.amber, data.carvingByVendor.map((rw) => ({
      n: rw.vendor,
      v: rw.sft >= 0.5 ? `${fmt0(rw.cft)} CFT + ${fmt0(rw.sft)} SFT · ${rw.slabs}` : `${fmt0(rw.cft)} CFT · ${rw.slabs}`,
    })));
    section("DISPATCH BY TEMPLE", COL.green, data.dispatchByTemple.map((rw) => ({ n: rw.temple, v: `${fmt1(rw.cft)} CFT · ${rw.slabs}` })));
    footer(P, 4, PAGES);
  }

  /* ── Page 5 — the 10-day trends.
     The LIVE PIPELINE card that used to open a page of its own is gone
     (Daksh: "remove live pipeline") — it answered "where is everything
     right now", which the app's own boards answer better and in real
     time. NOTE that buildPipeline() and DailyReport.pipeline stay: the
     Cockpit dashboard reads them (dashboard/cockpit.tsx). */
  {
    const P = newPage();
    let y = header(P, H - 26, false);
    P.t("10-DAY ACTIVITY TRENDS", M, y, 11, bold, ink); y -= 18;
    const tr = data.trend, n = tr.length;
    const drawMini = (title: string, color: ReturnType<typeof rgb>, key: "blocks" | "cutting" | "carving" | "dispatch") => {
      const vals = tr.map((d) => d[key]);
      const peak = vals.length ? Math.max(...vals) : 0;
      const total = vals.reduce((a, b) => a + b, 0);
      const avg = n > 0 ? total / n : 0;
      P.pg.drawCircle({ x: M + 4, y: y - 3, size: 3.4, color });
      P.t(title, M + 13, y - 6, 11.5, bold, ink);
      P.r(`avg ${avg.toFixed(1)}/day · peak ${peak} · total ${total}`, W - M, y - 6, 8, bold, muted);
      const left = M + 26, rightX = W - M - 4, pT = y - 20, pB = pT - 100;
      const niceMax = Math.max(5, Math.ceil(peak / 5) * 5);
      for (let g = 0; g <= 4; g++) {
        const yy = pB + ((pT - pB) * g) / 4;
        P.pg.drawLine({ start: { x: left, y: yy }, end: { x: rightX, y: yy }, thickness: g === 0 ? 0.8 : 0.4, color: line, opacity: g === 0 ? 1 : 0.5 });
        P.r(String(Math.round((niceMax * g) / 4)), left - 5, yy - 3, 7, font, muted);
      }
      const xAt = (i: number) => left + (n <= 1 ? 0 : ((rightX - left) * i) / (n - 1));
      const yAt = (v: number) => pB + (pT - pB) * Math.min(1, v / niceMax);
      for (let i = 0; i < n; i++) P.ctr(tr[i].short, xAt(i), pB - 12, 7.5, font, muted);
      for (let i = 0; i < n - 1; i++) P.pg.drawLine({ start: { x: xAt(i), y: yAt(vals[i]) }, end: { x: xAt(i + 1), y: yAt(vals[i + 1]) }, thickness: 2.2, color });
      for (let i = 0; i < n; i++) P.pg.drawCircle({ x: xAt(i), y: yAt(vals[i]), size: 2.4, color });
      y = pB - 12 - 22;
    };
    drawMini("Blocks added", COL.blue, "blocks");
    drawMini("Cutting done", COL.cyan, "cutting");
    drawMini("Carving done", COL.amber, "carving");
    drawMini("Dispatched", COL.green, "dispatch");
    footer(P, 5, PAGES);
  }

  // ── Pages 6+ — last-24 h challans & invoices (summary + copies) ──
  if (hasRecent) {
    const money = (d: RecentDoc) => (d.priced ? inr(d.total) : "not priced");
    const qline = (d: { cft: number; sft: number; nos: number }) =>
      [d.cft ? `${d.cft.toFixed(0)} CFT` : "", d.sft ? `${d.sft.toFixed(0)} SFT` : "", d.nos ? `${d.nos.toFixed(0)} NOS` : ""].filter(Boolean).join(" - ") || "-";

    // Page 6 — SUMMARY (both lists + section totals).
    {
      const P = newPage();
      let y = header(P, H - 26, false);
      P.t("LAST 24 H - CHALLANS & INVOICES", M, y, 11, bold, ink); y -= 6;
      P.pg.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 1, color: COL.teal }); y -= 17;

      const listBlock = (title: string, color: ReturnType<typeof rgb>, docs: RecentDoc[]) => {
        P.pg.drawRectangle({ x: M, y: y - 1, width: 7, height: 7, color });
        P.t(`${title} (${docs.length})`, M + 11, y, 9.5, bold, color); y -= 6;
        P.pg.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.9, color }); y -= 15;
        if (docs.length === 0) { P.t("None in this window.", M, y, 9.5, font, muted); y -= 16; }
        else {
          docs.slice(0, 9).forEach((d, i) => {
            if (i % 2 === 1) P.pg.drawRectangle({ x: M - 4, y: y - 4, width: cw + 8, height: 15, color: rowTint });
            P.t(asc(P.clip(`${d.code}  ${d.party}`, 30)), M, y, 9.5, font, ink);
            P.r(money(d), W - M, y, 9.5, bold, d.priced ? ink : muted);
            P.r(asc(qline(d)), W - M - 92, y, 8, font, muted);
            y -= 16;
          });
          if (docs.length > 9) { P.t(`+ ${docs.length - 9} more`, M, y, 9, font, muted); y -= 14; }
          const tot = docs.reduce((a, d) => ({ total: a.total + d.total, cft: a.cft + d.cft, sft: a.sft + d.sft, nos: a.nos + d.nos }), { total: 0, cft: 0, sft: 0, nos: 0 });
          P.pg.drawLine({ start: { x: M, y: y + 5 }, end: { x: W - M, y: y + 5 }, thickness: 0.5, color: line });
          P.t(`Total  ${qline(tot)}`, M, y - 6, 9, bold, muted);
          P.r(inr(tot.total), W - M, y - 6, 10.5, bold, color); y -= 24;
        }
        y -= 10;
      };
      listBlock("CHALLANS RAISED", COL.blue, recChallans);
      listBlock("INVOICES ISSUED", COL.green, recInvoices);
      P.t("Full itemised copies of each document on the following pages.", M, y, 8.5, font, muted);
      footer(P, 6, PAGES);
    }

    // Detail pages — one itemised block per document (fixed slot).
    for (let pageIdx = 0; pageIdx < detailPages; pageIdx++) {
      const P = newPage();
      const y0 = header(P, H - 26, false);
      P.t("CHALLAN & INVOICE COPIES  (last 24 h)", M, y0, 10, bold, ink);
      const top0 = y0 - 22, bottom = 46;
      const slotH = (top0 - bottom) / DOCS_PER_PAGE;
      const pageDocs = detailDocs.slice(pageIdx * DOCS_PER_PAGE, (pageIdx + 1) * DOCS_PER_PAGE);

      pageDocs.forEach((d, i) => {
        const top = top0 - i * slotH;
        const isInv = d.kind === "invoice";
        const accent = isInv ? COL.green : COL.blue;
        // Slot card.
        P.pg.drawRectangle({ x: M - 3, y: top - slotH + 10, width: cw + 6, height: slotH - 12, color: rowTint, opacity: 0.5 });
        P.pg.drawRectangle({ x: M - 3, y: top - slotH + 10, width: 3, height: slotH - 12, color: accent });
        // Header line: badge + code + total.
        const badge = isInv ? "INVOICE" : "CHALLAN";
        const bw = bold.widthOfTextAtSize(badge, 7) + 10;
        P.card(M + 4, top + 2, bw, 12, 3, accent);
        P.ctr(badge, M + 4 + bw / 2, top - 6.5, 7, bold, white);
        P.t(asc(d.code), M + 4 + bw + 7, top - 6, 11, bold, ink);
        P.r(d.priced ? inr(d.total) : "not priced", W - M - 6, top - 6, 12, bold, d.priced ? accent : muted);
        // Meta line.
        const meta = [asc(d.party), fmtRecentDate(d.date), d.invCode && d.invCode !== d.code ? `Inv ${asc(d.invCode)}` : ""].filter(Boolean).join("  -  ");
        P.t(P.clip(meta, 62), M + 6, top - 21, 8.5, font, muted); let yy = top - 36;
        // Items table.
        const qx = W - M - 150, rx = W - M - 76, ax = W - M - 6;
        P.t("ITEM", M + 6, yy, 7, bold, muted); P.r("QTY", qx, yy, 7, bold, muted); P.r("RATE", rx, yy, 7, bold, muted); P.r("AMOUNT", ax, yy, 7, bold, muted); yy -= 12;
        const maxRows = Math.max(1, Math.floor((yy - (top - slotH) - 26) / 11));
        const shown = d.items.slice(0, maxRows);
        shown.forEach((it) => {
          const nm = asc(it.name || it.desc || "Item");
          P.t(P.clip(nm, 32), M + 6, yy, 8.5, font, ink);
          P.r(it.qty ? `${it.qty.toFixed(2).replace(/\.00$/, "")} ${asc(it.unit)}`.trim() : "-", qx, yy, 8, font, muted);
          P.r(it.rate ? inr(it.rate) : "-", rx, yy, 8, font, muted);
          P.r(it.amount ? inr(it.amount) : "-", ax, yy, 8.5, font, ink);
          yy -= 11;
        });
        if (d.items.length > shown.length) { P.t(`+ ${d.items.length - shown.length} more item(s)`, M + 6, yy, 7.5, font, muted); yy -= 11; }
        if (d.items.length === 0) { P.t("No line items on this document.", M + 6, yy, 8, font, muted); yy -= 11; }
        // Totals footer for the slot.
        const ty = top - slotH + 16;
        P.pg.drawLine({ start: { x: M + 6, y: ty + 12 }, end: { x: W - M - 6, y: ty + 12 }, thickness: 0.5, color: line });
        if (d.priced) {
          P.t(`Subtotal ${inr(d.subtotal)}   GST ${inr(d.taxed)}`, M + 6, ty + 1, 8, font, muted);
          P.r(`Total ${inr(d.total)}`, W - M - 6, ty + 1, 9.5, bold, accent);
        } else {
          P.t("Not priced yet - value will appear once this challan is priced.", M + 6, ty + 1, 8, font, muted);
        }
      });
      footer(P, 7 + pageIdx, PAGES);
    }
  }

  return pdf.save();
}

/** "21 May 2026" for a YYYY-MM-DD doc date (IST). */
function fmtRecentDate(d: string): string {
  const s = (d ?? "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return s || "-";
  const [y, m, dd] = s.split("-").map(Number);
  return `${dd} ${MONTHS[(m - 1) % 12]} ${y}`;
}

// ── Send ────────────────────────────────────────────────────────────

async function sendTemplate(to: string[], pdfUrl: string, dateLabel: string): Promise<void> {
  const authkey = process.env.MSG91_AUTH_KEY;
  if (!authkey) throw new Error("MSG91_AUTH_KEY is not set in the environment.");

  const body = {
    integrated_number: INTEGRATED_NUMBER,
    content_type: "template",
    payload: {
      messaging_product: "whatsapp",
      type: "template",
      template: {
        name: TEMPLATE_NAME,
        language: { code: TEMPLATE_LANG, policy: "deterministic" },
        to_and_components: [
          {
            to,
            components: {
              header_1: { type: "document", value: pdfUrl, filename: "MTCPL-Daily-Report.pdf" },
              body_1: { type: "text", value: dateLabel },
            },
          },
        ],
      },
    },
  };

  const res = await fetch(WA_BULK_URL, {
    method: "POST",
    headers: { authkey, "Content-Type": "application/json", accept: "application/json" },
    body: JSON.stringify(body),
  });
  const txt = await res.text();
  let json: { type?: string; message?: string; hasError?: boolean } = {};
  try { json = JSON.parse(txt); } catch { /* non-JSON */ }
  if (!res.ok || json.type === "error" || json.hasError) {
    throw new Error(`MSG91 WhatsApp send failed: ${json.message || txt || `HTTP ${res.status}`}`);
  }
}

/** Full pipeline: aggregate → PDF → upload → send. Returns a summary. */
export async function sendDailyWhatsAppReport(): Promise<{
  ok: true; label: string; recipients: string[]; pdfUrl: string;
  totals: { blocks: number; cuttingSlabs: number; carvingSlabs: number; dispatchSlabs: number; paymentsToday: number };
}> {
  const admin = createAdminSupabaseClient();
  const data = await buildDailyReportData();
  const pdfBytes = await buildDailyReportPdf(data);

  const safeDate = data.label.replace(/\s+/g, "-");
  const path2 = `${safeDate}/${crypto.randomUUID()}.pdf`;
  const { error: upErr } = await admin.storage
    .from("whatsapp_reports")
    .upload(path2, Buffer.from(pdfBytes), { contentType: "application/pdf", upsert: false });
  if (upErr) throw new Error(`Report PDF upload failed: ${upErr.message}`);
  const pdfUrl = admin.storage.from("whatsapp_reports").getPublicUrl(path2).data.publicUrl;

  const to = await recipients();
  await sendTemplate(to, pdfUrl, data.label);

  return {
    ok: true,
    label: data.label,
    recipients: to,
    pdfUrl,
    totals: {
      blocks: data.today.blocks.count,
      cuttingSlabs: data.today.cutting.slabs,
      carvingSlabs: data.today.carving.slabs,
      dispatchSlabs: data.today.dispatch.slabs,
      paymentsToday: data.payments.total,
    },
  };
}
