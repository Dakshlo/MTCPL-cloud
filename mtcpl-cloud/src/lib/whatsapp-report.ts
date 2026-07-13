// ──────────────────────────────────────────────────────────────────
// Daily WhatsApp work-report (MSG91 → Meta) — Daksh, June 2026.
//
// Every evening (6 PM IST cron) we:
//   1. aggregate the day's work  → buildDailyReportData()
//   2. render it as a PDF        → buildDailyReportPdf()  (colourful, with logo)
//   3. upload to a public bucket → public url
//   4. send the approved Utility template with the PDF as its Document
//      header + {{1}} = the date, to the configured recipients.
//
// Reuses the existing MSG91 account auth key (MSG91_AUTH_KEY) — one key
// serves SMS + WhatsApp. No new secrets.
// ──────────────────────────────────────────────────────────────────

import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { getReportRecipientNumbers } from "@/lib/wa-recipients";
import { buildCncVariousCostReport, cncPeriodFromSearch } from "@/lib/cnc-various-cost-report";
import { buildCutterCostReport, cutterPeriodFromSearch } from "@/lib/cutter-cost-report";
import { isMarble, cftEquivFromTonnes, type StoneCategory } from "@/lib/stone-categories";
import { computeGroupedGstTotals, type GstMode } from "@/lib/challan-pricing";
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
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

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
    .replace(/[^\x20-\x7E -ÿ]/g, "");
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
 *  dayOffset 0  → [10:00 yesterday, 10:00 today]        — the main report
 *  dayOffset -1 → [10:00 day-before, 10:00 yesterday]   — the comparison
 *  The label is the date the window STARTS on — the day the work belongs to
 *  (so the morning report reads as "<yesterday>'s report"). */
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
  return { startUTC, endUTC, label: `${s.getUTCDate()} ${MONTHS[s.getUTCMonth()]} ${s.getUTCFullYear()}` };
}

/** IST "today" as YYYY-MM-DD (for clamping the cutter report to month-to-date). */
function istDateKey(): string {
  const ist = new Date(Date.now() + 5.5 * 3600 * 1000);
  return `${ist.getUTCFullYear()}-${String(ist.getUTCMonth() + 1).padStart(2, "0")}-${String(ist.getUTCDate()).padStart(2, "0")}`;
}

/** Start of the current IST month (UTC ISO) + a short label + days elapsed.
 *  Powers the month-to-date production cards (cutting / carving / dispatch). */
function istMonthStart() {
  const ist = new Date(Date.now() + 5.5 * 3600 * 1000);
  const y = ist.getUTCFullYear();
  const m = ist.getUTCMonth();
  const startUTC = new Date(Date.UTC(y, m, 1, 0, 0, 0, 0) - 5.5 * 3600 * 1000).toISOString();
  return { startUTC, label: `${MONTHS[m]} ${y}`, daysElapsed: ist.getUTCDate() };
}

// ── Data ────────────────────────────────────────────────────────────

type DayTotals = {
  blocks: { count: number; cft: number };
  cutting: { slabs: number; cft: number };
  carving: { slabs: number; cft: number };
  dispatch: { slabs: number; cft: number; tonnes: number; trucks: number };
};

export type DailyReport = {
  label: string;
  prevLabel: string;
  today: DayTotals;
  prev: DayTotals;
  /** Month-to-date totals — cutting / carving / dispatch headline the
   *  cards now (with the last-24 h figure shown in brackets). */
  mtd: DayTotals;
  month: { label: string; days: number };
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
  blocksByStone: Array<{ stone: string; count: number; cft: number; vendors: Array<{ vendor: string; count: number; cft: number }> }>;
  cuttingByStone: Array<{ stone: string; slabs: number; cft: number }>;
  carvingByVendor: Array<{ vendor: string; slabs: number; cft: number }>;
  dispatchByTemple: Array<{ temple: string; slabs: number; cft: number; tonnes: number }>;
  payments: { total: number; byVendor: Array<{ vendor: string; amount: number }> };
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
  /** Last 10 IST days of activity for the trend chart — counts per day. */
  trend: Array<{ label: string; short: string; blocks: number; cutting: number; carving: number }>;
  /** Last-24 h challans raised + invoices issued (summary + attached detail).
   *  null if it couldn't be built — never blocks the daily report. */
  recent: { challans: RecentDoc[]; invoices: RecentDoc[] } | null;
};

// dims for a set of slab ids → map id → cft.
async function cftBySlab(admin: AdminClient, ids: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  for (let i = 0; i < ids.length; i += 1000) {
    const chunk = ids.slice(i, i + 1000);
    if (chunk.length === 0) break;
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

const emptyTotals = (): DayTotals => ({
  blocks: { count: 0, cft: 0 },
  cutting: { slabs: 0, cft: 0 },
  carving: { slabs: 0, cft: 0 },
  dispatch: { slabs: 0, cft: 0, tonnes: 0, trucks: 0 },
});

/** Aggregate one IST day. `detail` also returns the per-group breakdowns. */
async function aggregateDay(admin: AdminClient, startUTC: string, endUTC: string, detail: boolean) {
  const totals = emptyTotals();
  const det = {
    blocksByStone: [] as DailyReport["blocksByStone"],
    cuttingByStone: [] as DailyReport["cuttingByStone"],
    carvingByVendor: [] as DailyReport["carvingByVendor"],
    dispatchByTemple: [] as DailyReport["dispatchByTemple"],
  };

  // 1. BLOCKS added today (raw stone blocks created today).
  {
    const { data } = await admin
      .from("blocks")
      .select("stone, length_ft, width_ft, height_ft, created_at, vendor_name")
      .gte("created_at", startUTC)
      .lte("created_at", endUTC);
    const byStone = new Map<string, { count: number; cft: number; vendors: Map<string, { count: number; cft: number }> }>();
    for (const b of (data ?? []) as Array<{ stone: string | null; length_ft: number; width_ft: number; height_ft: number; vendor_name: string | null }>) {
      const c = cft(Number(b.length_ft), Number(b.width_ft), Number(b.height_ft));
      totals.blocks.count += 1; totals.blocks.cft += c;
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

  // 2. CUTTING done today — blocks that became 'done' today; their cut slabs by stone.
  {
    const { data: doneBlocks } = await admin
      .from("cut_session_blocks")
      .select("block_id, status, updated_at")
      .eq("status", "done")
      .gte("updated_at", startUTC)
      .lte("updated_at", endUTC);
    const blockIds = [...new Set(((doneBlocks ?? []) as Array<{ block_id: string }>).map((b) => b.block_id).filter(Boolean))];
    if (blockIds.length > 0) {
      const slabs: Array<{ stone: string | null; length_ft: number; width_ft: number; thickness_ft: number }> = [];
      for (let i = 0; i < blockIds.length; i += 200) {
        const { data } = await admin
          .from("slab_requirements")
          .select("stone, length_ft, width_ft, thickness_ft, status")
          .in("source_block_id", blockIds.slice(i, i + 200))
          .not("status", "in", "(open,rejected,cancelled)");
        slabs.push(...((data ?? []) as typeof slabs));
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

  // 3. CARVING done today — carving_items approved today, by vendor.
  {
    const { data: items } = await admin
      .from("carving_items")
      .select("slab_requirement_id, vendor_name, review_approved_at")
      .not("review_approved_at", "is", null)
      .gte("review_approved_at", startUTC)
      .lte("review_approved_at", endUTC);
    const rows = (items ?? []) as Array<{ slab_requirement_id: string | null; vendor_name: string | null }>;
    const dims = await cftBySlab(admin, rows.map((r) => r.slab_requirement_id).filter(Boolean) as string[]);
    const byVendor = new Map<string, { slabs: number; cft: number }>();
    for (const r of rows) {
      const c = r.slab_requirement_id ? dims.get(r.slab_requirement_id) ?? 0 : 0;
      totals.carving.slabs += 1; totals.carving.cft += c;
      const k = r.vendor_name || "-";
      const g = byVendor.get(k) ?? { slabs: 0, cft: 0 };
      g.slabs += 1; g.cft += c; byVendor.set(k, g);
    }
    if (detail) det.carvingByVendor = [...byVendor.entries()].map(([vendor, v]) => ({ vendor, ...v })).sort((a, b) => b.cft - a.cft);
  }

  // 4. DISPATCH today — trucks sent today; slabs + tonnes by temple.
  {
    const { data: disp } = await admin
      .from("dispatches")
      .select("id, temple, dispatched_at")
      .gte("dispatched_at", startUTC)
      .lte("dispatched_at", endUTC);
    const dispatches = (disp ?? []) as Array<{ id: string; temple: string }>;
    totals.dispatch.trucks = dispatches.length;
    if (dispatches.length > 0) {
      const { data: logs } = await admin
        .from("dispatch_logs")
        .select("dispatch_id, slab_requirement_id, weight_tonnes")
        .in("dispatch_id", dispatches.map((d) => d.id));
      const templeOf = new Map(dispatches.map((d) => [d.id, d.temple]));
      const logRows = (logs ?? []) as Array<{ dispatch_id: string | null; slab_requirement_id: string | null; weight_tonnes: number | null }>;
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

/** Supplier bill payments marked paid in the window (carving-vendor payouts
 *  aren't tracked in the system yet). Grouped by vendor name when `detail`. */
async function paymentsForWindow(admin: AdminClient, startUTC: string, endUTC: string, detail: boolean) {
  const { data } = await admin
    .from("bill_payments")
    .select("paid_amount, bill_id, paid_at, status")
    .eq("status", "paid")
    .gte("paid_at", startUTC)
    .lte("paid_at", endUTC);
  const rows = ((data ?? []) as Array<{ paid_amount: number | null; bill_id: string | null }>).filter((p) => p.paid_amount != null);
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
 *  slabs approved. Counts (not CFT) so the three series share a clean scale. */
async function trendForDays(admin: AdminClient, days = 10) {
  const list = Array.from({ length: days }, (_, i) => {
    // End on yesterday (the last COMPLETE calendar day) — the report runs at
    // 10 AM, so including today would plot a misleading half-day dip.
    const d = istDay(i - days); // -days … -1
    return { ...d, startMs: Date.parse(d.startUTC), endMs: Date.parse(d.endUTC), blocks: 0, cutting: 0, carving: 0 };
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
    const blockIds = [...blockBucket.keys()];
    for (let k = 0; k < blockIds.length; k += 200) {
      const { data: slabs } = await admin
        .from("slab_requirements")
        .select("source_block_id, status")
        .in("source_block_id", blockIds.slice(k, k + 200))
        .not("status", "in", "(open,rejected,cancelled)");
      for (const s of (slabs ?? []) as Array<{ source_block_id: string | null }>) {
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

  return list.map((d) => ({ label: d.label, short: d.label.split(" ")[0], blocks: d.blocks, cutting: d.cutting, carving: d.carving }));
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
 *  tonnes × 8 CFT-equiv (falls back to dims if a marble block lacks weight). */
async function blockStock(
  admin: AdminClient,
  categoryMap: Record<string, StoneCategory>,
): Promise<DailyReport["stock"]> {
  try {
    const { data } = await admin
      .from("blocks")
      .select("stone, length_ft, width_ft, height_ft, tonnes, status")
      .in("status", ["available", "reserved"]);
    let marbleCft = 0, marbleTonnes = 0, sandstoneCft = 0, marbleCount = 0, sandstoneCount = 0;
    for (const b of (data ?? []) as Array<{
      stone: string | null; length_ft: number; width_ft: number; height_ft: number; tonnes: number | null;
    }>) {
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
 *  marble a CFT-per-tonne. Wrapped so a hiccup never blocks the daily report. */
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
    const [freshR, reusedR, doneCsbR, trucksR, cssR] = await Promise.all([
      admin.from("blocks").select(blockCols).eq("category", "Fresh"),
      admin.from("blocks").select(blockCols).eq("category", "Reused"),
      admin.from("cut_session_blocks").select("block_id, status, updated_at").eq("status", "done"),
      admin.from("marble_truck_entries").select("id, stone, truck_no, vendor_name, total_tonnes, num_blocks, created_at"),
      admin.from("cut_session_slabs").select("slab_requirement_id, is_filler, cut_session_blocks!inner(block_id)"),
    ]);
    const cutSessionSlabs: BjCutSessionSlabRow[] = [];
    for (const r of (cssR.data ?? []) as Array<{
      slab_requirement_id: string;
      is_filler: boolean | null;
      cut_session_blocks: { block_id: string } | { block_id: string }[] | null;
    }>) {
      const csb = Array.isArray(r.cut_session_blocks) ? r.cut_session_blocks[0] : r.cut_session_blocks;
      if (!csb?.block_id) continue;
      cutSessionSlabs.push({ slab_requirement_id: r.slab_requirement_id, is_filler: r.is_filler ?? null, block_id: csb.block_id });
    }
    const lineages = buildLineages(
      (freshR.data ?? []) as unknown as BjBlockRow[],
      (reusedR.data ?? []) as unknown as BjBlockRow[],
      postCut,
      (doneCsbR.data ?? []) as unknown as BjCsbRow[],
      categoryMap,
      (trucksR.data ?? []) as unknown as BjMarbleTruckRow[],
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

/** One doc's rolled-up qty buckets + totals from its lines. */
function rollup(lines: RecentLine[], gst: ReturnType<typeof gstOfRow>): Pick<RecentDoc, "cft" | "sft" | "nos" | "subtotal" | "taxed" | "total" | "priced"> {
  let cft = 0, sft = 0, nos = 0;
  for (const l of lines) { const b = unitBucket(l.unit); if (b === "cft") cft += l.qty; else if (b === "sft") sft += l.qty; else nos += l.qty; }
  const priced = lines.some((l) => l.amount > 0);
  const t = computeGroupedGstTotals(lines.map((l) => ({ amount: l.amount, gstPercent: l.gstPercent })), gst);
  return { cft, sft, nos, subtotal: t.subtotal, taxed: t.grand - t.subtotal, total: t.grand, priced };
}

/** Every challan raised + every invoice issued inside [startUTC, endUTC). */
async function gatherRecentDocs(admin: AdminClient, startUTC: string, endUTC: string): Promise<{ challans: RecentDoc[]; invoices: RecentDoc[] }> {
  const challans: RecentDoc[] = [];
  const invoices: RecentDoc[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const win = (q: any, col: string): any => q.gte(col, startUTC).lt(col, endUTC);

  type ChRow = { id: string; challan_number: string; doc_fy: string | null; doc_seq: number | null; challan_date: string; temple: string | null; priced_at: string | null; owner_approved_at: string | null; custom_billed_at: string | null; converted_invoice_id: string | null; inv_fy: string | null; inv_seq: number | null; invoice_no_override: string | null; gst_mode: string | null; igst_percent: number | null; cgst_percent: number | null; sgst_percent: number | null };
  const CH_COLS = "id, challan_number, doc_fy, doc_seq, challan_date, temple, priced_at, owner_approved_at, custom_billed_at, converted_invoice_id, inv_fy, inv_seq, invoice_no_override, gst_mode, igst_percent, cgst_percent, sgst_percent";
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
      challans.push({ kind: "challan", code: chCode(r), invCode: chInv(r), party: r.temple ?? "-", date: r.challan_date, items: lines, ...rollup(lines, gstOfRow(r)) });
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
      invoices.push({ kind: "invoice", code: chInv(r) ?? chCode(r), invCode: chInv(r), party: r.temple ?? "-", date: r.challan_date, items: lines, ...rollup(lines, gstOfRow(r)) });
    }
  } catch { /* skip */ }

  // 3 — WORK-ORDER invoices approved in the window (bulk_invoices).
  try {
    type BRow = { id: string; temple: string | null; invoice_date: string; inv_fy: string | null; inv_seq: number | null; invoice_no_override: string | null; gst_mode: string | null; igst_percent: number | null; cgst_percent: number | null; sgst_percent: number | null };
    const { data } = await win(admin.from("bulk_invoices").select("id, temple, invoice_date, inv_fy, inv_seq, invoice_no_override, gst_mode, igst_percent, cgst_percent, sgst_percent").is("cancelled_at", null).not("owner_approved_at", "is", null).order("owner_approved_at", { ascending: false }) as never, "owner_approved_at") as { data: BRow[] | null };
    const rows = (data ?? []) as BRow[];
    const items = await fetchLines(admin, "bulk_invoice_items", "bulk_invoice_id", rows.map((r) => r.id), "unit", "quantity");
    for (const r of rows) {
      const lines = items.get(r.id) ?? [];
      const code = r.invoice_no_override?.trim() || invoiceCodeFromDoc(r.inv_fy, r.inv_seq) || `INV-${r.id.slice(0, 6).toUpperCase()}`;
      invoices.push({ kind: "invoice", code, invCode: code, party: r.temple ?? "-", date: r.invoice_date, items: lines, ...rollup(lines, gstOfRow(r)) });
    }
  } catch { /* skip */ }

  // 4 — OTHER SALES: challans created + invoices converted in the window.
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const parse = (rows: any[]): { row: any; party: string }[] => rows.map((r) => ({ row: r, party: (Array.isArray(r.invoice_parties) ? r.invoice_parties[0]?.name : r.invoice_parties?.name) ?? "Other Sales" }));
    const OC = "id, challan_date, doc_fy, doc_seq, inv_fy, inv_seq, converted_at, gst_mode, igst_percent, cgst_percent, sgst_percent, invoice_parties(name)";
    const { data: raised } = await win(admin.from("other_challans").select(OC).is("cancelled_at", null).order("created_at", { ascending: false }) as never, "created_at") as { data: unknown[] | null };
    const { data: conv } = await win(admin.from("other_challans").select(OC).is("cancelled_at", null).not("converted_at", "is", null).order("converted_at", { ascending: false }) as never, "converted_at") as { data: unknown[] | null };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const all = [...parse((raised ?? []) as any[]).map((x) => ({ ...x, kind: "challan" as const })), ...parse((conv ?? []) as any[]).map((x) => ({ ...x, kind: "invoice" as const }))];
    const items = await fetchLines(admin, "other_challan_items", "other_challan_id", all.map((x) => String(x.row.id)), "unit", "quantity");
    for (const x of all) {
      const r = x.row;
      const lines = items.get(String(r.id)) ?? [];
      const roll = rollup(lines, gstOfRow(r));
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
  const today = await aggregateDay(admin, t.startUTC, t.endUTC, true);
  const prev = await aggregateDay(admin, p.startUTC, p.endUTC, false);
  const payToday = await paymentsForWindow(admin, t.startUTC, t.endUTC, true);

  // Month-to-date production (cutting / carving / dispatch) — from the 1st of
  // the IST month through the report window end. Plus current usable block
  // stock and block recovery, both wrapped so they never block the report.
  const mStart = istMonthStart();
  const categoryMap = await stoneCategoryMapFor(admin);
  const mtd = await aggregateDay(admin, mStart.startUTC, t.endUTC, false);
  const stock = await blockStock(admin, categoryMap);
  const recovery = await buildRecoveryByCategory(admin, categoryMap);

  // Month-to-date CNC costing — same prorated-to-elapsed-days engine as the
  // /reports/various-costing/cnc page. Wrapped so a CNC hiccup never blocks
  // the daily report.
  let cnc: DailyReport["cnc"] = null;
  try {
    const period = cncPeriodFromSearch({}); // defaults to the current month
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

  // Month-to-date cutter costing. The cutter report doesn't self-clamp to
  // "today" like the CNC one, so we hand it a period whose end is today —
  // its day-weighted proration then counts only the elapsed days.
  let cutter: DailyReport["cutter"] = null;
  try {
    const period = cutterPeriodFromSearch({}); // current month, full
    const todayKey = istDateKey();
    const monthLen = Number(period.endDate.slice(8, 10)) || 30;
    const days = Number(todayKey.slice(8, 10)) || monthLen;
    const rep = await buildCutterCostReport({ ...period, endDate: todayKey });
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

  const trend = await trendForDays(admin, 10);

  // Last-24 h challans raised + invoices issued (same window as the report).
  let recent: DailyReport["recent"] = null;
  try { recent = await gatherRecentDocs(admin, t.startUTC, t.endUTC); } catch { recent = null; }

  return {
    label: t.label,
    prevLabel: p.label,
    today: today.totals,
    prev: prev.totals,
    mtd: mtd.totals,
    month: { label: mStart.label, days: mStart.daysElapsed },
    stock,
    recovery,
    blocksByStone: today.det.blocksByStone,
    cuttingByStone: today.det.cuttingByStone,
    carvingByVendor: today.det.carvingByVendor,
    dispatchByTemple: today.det.dispatchByTemple,
    payments: { total: payToday.total, byVendor: payToday.byVendor },
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
  // Dark "liquid glass" theme — light text on a deep slate gradient, with
  // frosted colour-tinted cards. logo-light.png reads on the dark backdrop.
  const white = rgb(1, 1, 1), ink = rgb(0.93, 0.95, 0.98), muted = rgb(0.62, 0.66, 0.74), line = rgb(0.32, 0.36, 0.44), brown = rgb(0.87, 0.66, 0.34);
  const paper = rgb(0.07, 0.085, 0.125), rowTint = rgb(0.15, 0.18, 0.24);
  const bgTop = rgb(0.05, 0.065, 0.10), bgBot = rgb(0.10, 0.12, 0.17);
  const COL = {
    blue: rgb(0.29, 0.56, 0.98), cyan: rgb(0.12, 0.67, 0.82), amber: rgb(0.96, 0.62, 0.16),
    green: rgb(0.16, 0.74, 0.45), gold: rgb(0.86, 0.58, 0.24), indigo: rgb(0.49, 0.46, 0.90), teal: rgb(0.16, 0.64, 0.60),
  };

  let logo: Awaited<ReturnType<typeof pdf.embedPng>> | null = null;
  try { logo = await pdf.embedPng(await readFile(path.join(process.cwd(), "public", "logo-light.png"))); } catch { /* optional */ }

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
    // Frosted "liquid glass" card: drop shadow → tinted body with a bright
    // rim → top gloss → bottom depth → a crisp specular edge.
    glass: (x: number, yTop: number, w: number, h: number, rad: number, base: ReturnType<typeof rgb>) => {
      pg.drawSvgPath(roundPath(w, h, rad), { x: x + 2, y: yTop - 5, color: rgb(0, 0, 0), opacity: 0.30 });
      pg.drawSvgPath(roundPath(w, h, rad), { x, y: yTop, color: base, borderColor: rgb(1, 1, 1), borderWidth: 1, borderOpacity: 0.32 });
      pg.drawSvgPath(roundTopPath(w, h * 0.46, rad), { x, y: yTop, color: rgb(1, 1, 1), opacity: 0.13 });
      pg.drawSvgPath(roundBottomPath(w, h * 0.3, rad), { x, y: yTop - h * 0.7, color: rgb(0, 0, 0), opacity: 0.12 });
      pg.drawSvgPath(roundTopPath(w, 2.5, rad), { x, y: yTop, color: rgb(1, 1, 1), opacity: 0.5 });
    },
    clip: (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s),
  });

  const gen = new Date(Date.now() + 5.5 * 3600 * 1000);
  const genLabel = `${gen.getUTCDate()} ${MONTHS[gen.getUTCMonth()]}, ${String(gen.getUTCHours()).padStart(2, "0")}:${String(gen.getUTCMinutes()).padStart(2, "0")} IST`;

  const header = (P: ReturnType<typeof mk>, top: number, withSubtitle: boolean) => {
    if (logo) { const lh = 20, lw = (logo.width / logo.height) * lh; P.pg.drawImage(logo, { x: M, y: top - lh, width: lw, height: lh }); }
    const dpw = bold.widthOfTextAtSize(data.label, 11) + 18;
    P.card(W - M - dpw, top, dpw, 20, 5, brown);
    P.ctr(data.label, W - M - dpw / 2, top - 13, 11, bold, white);
    P.r(`vs ${data.prevLabel}`, W - M, top - 30, 8, font, muted);
    P.t("Daily Work Report", M, top - 42, 16, bold, ink);
    P.t("MATESHWARI TEMPLE CONSTRUCTION PVT LTD", M, top - 55, 7.5, bold, ink);
    let y = top - 55;
    if (withSubtitle) { P.t("Month-to-date production · last 24 h shown in brackets", M, y - 12, 8, font, muted); y -= 12; }
    y -= 8;
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
  const PAGES = 4 + (hasRecent ? 1 + detailPages : 0);
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
    // Soft accent blobs for frosted-glass depth — they glow through the gaps.
    pg.drawCircle({ x: W * 0.86, y: H * 0.8, size: 150, color: COL.indigo, opacity: 0.16 });
    pg.drawCircle({ x: W * 0.08, y: H * 0.34, size: 175, color: COL.cyan, opacity: 0.12 });
    pg.drawCircle({ x: W * 0.72, y: H * 0.1, size: 140, color: COL.gold, opacity: 0.1 });
    return mk(pg);
  };

  // ── Page 1 — headline metrics, one big card each ──
  {
    const P = newPage();
    let y = header(P, H - 26, true);
    const delta = (cur: number, prev: number) => { const d = cur - prev; return `Prev day ${prev}  (${d > 0 ? "+" : ""}${d})`; };
    const mLabel = data.month.label;
    // Blocks = added in the last 24 h + a live in-stock line. Cutting /
    // Carving / Dispatch headline the MONTH-TO-DATE total, with the last
    // 24 h shown in the bracket pill (Daksh's dad wants the running month).
    const cards: Array<{ c: ReturnType<typeof rgb>; label: string; caption?: string; big: string; unit: string; sub: string; pill: string; extra?: string }> = [
      {
        c: COL.blue, label: "BLOCKS ADDED",
        big: String(data.today.blocks.count), unit: "blocks", sub: `${data.today.blocks.cft.toFixed(1)} CFT added (24h)`,
        pill: delta(data.today.blocks.count, data.prev.blocks.count),
        extra: data.stock
          ? `In stock — Sandstone ${data.stock.sandstoneCft.toFixed(0)} CFT  ·  Marble ${data.stock.marbleTonnes.toFixed(1)} T`
          : undefined,
      },
      { c: COL.cyan, label: "CUTTING DONE", caption: `Month to date · ${mLabel}`, big: String(data.mtd.cutting.slabs), unit: "slabs", sub: `${data.mtd.cutting.cft.toFixed(1)} CFT cut`, pill: `+${data.today.cutting.slabs} in 24h` },
      { c: COL.amber, label: "CARVING DONE", caption: `Month to date · ${mLabel}`, big: String(data.mtd.carving.slabs), unit: "slabs", sub: `${data.mtd.carving.cft.toFixed(1)} CFT carved`, pill: `+${data.today.carving.slabs} in 24h` },
      { c: COL.green, label: "DISPATCHED", caption: `Month to date · ${mLabel}`, big: String(data.mtd.dispatch.slabs), unit: "slabs", sub: `${data.mtd.dispatch.cft.toFixed(1)} CFT · ${data.mtd.dispatch.tonnes.toFixed(1)} T · ${data.mtd.dispatch.trucks} trucks`, pill: `+${data.today.dispatch.slabs} in 24h` },
    ];
    const ch = 150, gap = 13;
    for (const k of cards) {
      P.glass(M, y, cw, ch, 18, k.c);
      P.card(M + 20, y - 15, 32, 5, 2.5, white, { opacity: 0.55 });
      P.t(k.label, M + 20, y - 34, 13, bold, white);
      if (k.caption) P.t(k.caption, M + 20, y - 48, 9, font, white);
      P.t(k.big, M + 18, y - 104, 50, bold, white);
      // Unit label sits to the right of the big number, baseline-aligned, so
      // "506" reads unambiguously as "506 slabs".
      P.t(k.unit, M + 18 + bold.widthOfTextAtSize(k.big, 50) + 9, y - 104, 15, bold, white);
      P.t(k.sub, M + 20, y - 128, 12, font, white);
      if (k.extra) P.t(k.extra, M + 20, y - 143, 9.5, font, white);
      const pw = font.widthOfTextAtSize(k.pill, 9) + 18;
      P.card(W - M - pw - 14, y - 40, pw, 19, 7, white, { opacity: 0.20 });
      P.t(k.pill, W - M - pw - 5, y - 52.5, 9, font, white);
      y -= ch + gap;
    }
    footer(P, 1, PAGES);
  }

  // ── Page 2 — month-to-date costing + supplier payments ──
  {
    const P = newPage();
    let y = header(P, H - 26, false);
    if (data.cnc) {
      const c = data.cnc, hh = 186;
      P.glass(M, y, cw, hh, 18, COL.indigo);
      P.t("CNC COSTING · MONTH TO DATE", M + 18, y - 26, 11, bold, white);
      P.t(`${c.label} · ${c.days} of ${c.monthLen} days`, M + 18, y - 44, 9.5, font, white);
      P.t(Number.isFinite(c.costPerCombined) ? `${inr2(c.costPerCombined)} / unit` : "-- / unit", M + 18, y - 80, 30, bold, white);
      P.t("SFT + CFT combined", M + 20, y - 98, 9, font, white);
      P.pg.drawLine({ start: { x: M + 18, y: y - 108 }, end: { x: W - M - 18, y: y - 108 }, thickness: 0.5, color: white, opacity: 0.3 });
      P.t(`Spent so far: ${inr(c.totalCost)}`, M + 18, y - 124, 10.5, bold, white);
      // Carved output that the cost is spread over — slab count + the combined
      // SFT/CFT quantity (Daksh). Marble carves in SFT, sandstone in CFT.
      P.t(`Carved ${c.slabs} slab${c.slabs === 1 ? "" : "s"} · ${c.sft.toFixed(0)} SFT + ${c.cft.toFixed(0)} CFT = ${(c.sft + c.cft).toFixed(0)} combined`, M + 18, y - 140, 9.5, bold, white);
      P.t(`/SFT ${Number.isFinite(c.costPerSft) ? inr2(c.costPerSft) : "--"}   ·   /CFT ${Number.isFinite(c.costPerCft) ? inr2(c.costPerCft) : "--"}`, M + 18, y - 158, 9.5, font, white);
      P.t(`Op ${inr(c.operational)} · Dep ${inr(c.depreciation)} · ${c.machines} machine${c.machines === 1 ? "" : "s"}`, M + 18, y - 174, 9, font, white);
      y -= hh + 12;
    }
    if (data.cutter) {
      const c = data.cutter, hh = 128;
      P.glass(M, y, cw, hh, 18, COL.teal);
      P.t("CUTTER COSTING · MONTH TO DATE", M + 18, y - 26, 11, bold, white);
      P.t(`${c.label} · ${c.days} of ${c.monthLen} days`, M + 18, y - 44, 9.5, font, white);
      P.t(Number.isFinite(c.costPerCft) ? `${inr2(c.costPerCft)} / CFT` : "-- / CFT", M + 18, y - 80, 28, bold, white);
      P.pg.drawLine({ start: { x: M + 18, y: y - 92 }, end: { x: W - M - 18, y: y - 92 }, thickness: 0.5, color: white, opacity: 0.3 });
      P.t(`Spent so far: ${inr(c.totalCost)}`, M + 18, y - 108, 10.5, bold, white);
      P.t(`Op ${inr(c.operational)} · Dep ${inr(c.depreciation)} · ${c.cft.toFixed(0)} CFT cut`, M + 18, y - 122, 9, font, white);
      y -= hh + 12;
    }
    {
      // Show EVERY supplier paid in the window (Daksh: the old top-6 cap
      // silently dropped vendors while the total stayed correct). Two columns
      // fit ~40; only an extreme tail collapses into a "+N more" line so the
      // page can never overflow. Capacity is computed from the space left
      // under the costing cards above.
      const all = data.payments.byVendor;
      const hasRows = all.length > 0;
      const lineH = 16, headH = 64, padBot = 12, footMargin = 46;
      const maxLines = Math.max(1, Math.floor((y - footMargin - headH) / lineH));
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
      P.glass(M, y, cw, payH, 18, COL.gold);
      P.t("PAYMENTS TO SUPPLIERS · 24 H", M + 18, y - 24, 11, bold, white);
      P.t(inr(data.payments.total), M + 18, y - 50, 24, bold, white);
      let py = y - 64;
      if (!hasRows) { P.t("No supplier payments in this 24 h window.", M + 18, py - 2, 9.5, font, white); }
      else {
        P.pg.drawLine({ start: { x: M + 18, y: py }, end: { x: W - M - 18, y: py }, thickness: 0.5, color: white, opacity: 0.32 });
        py -= 18;
        const colGap = 16, innerW = cw - 36;
        const colX = [M + 18, M + 18 + (innerW + colGap) / 2];
        const colR = [M + 18 + (innerW - colGap) / 2, W - M - 18];
        shown.forEach((v, i) => {
          const col = i % 2;
          if (col === 0 && i > 0) py -= lineH;
          P.t(P.clip(v.vendor, 18), colX[col], py, 9, font, white);
          P.r(inr(v.amount), colR[col], py, 9, bold, white);
        });
        if (ovN > 0) {
          py -= lineH;
          P.t(`+${ovN} more supplier${ovN === 1 ? "" : "s"}`, colX[0], py, 9, font, white);
          P.r(inr(ovAmt), W - M - 18, py, 9, bold, white);
        }
      }
    }
    footer(P, 2, PAGES);
  }

  // ── Page 3 — breakdowns (blocks / cutting / carving / dispatch) ──
  {
    const P = newPage();
    let y = header(P, H - 26, false);
    const section = (title: string, color: ReturnType<typeof rgb>, rows: Array<{ n: string; v: string }>) => {
      P.pg.drawRectangle({ x: M, y: y - 1, width: 7, height: 7, color });
      P.t(title, M + 11, y, 9.5, bold, color); y -= 6;
      P.pg.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.9, color }); y -= 16;
      if (rows.length === 0) { P.t("None", M, y, 10, font, muted); y -= 16; }
      else rows.slice(0, 5).forEach((rw, i) => {
        if (i % 2 === 1) P.pg.drawRectangle({ x: M - 4, y: y - 4, width: cw + 8, height: 15, color: rowTint });
        P.t(P.clip(rw.n, 30), M, y, 10.5, font, ink); P.r(rw.v, W - M, y, 10, font, muted); y -= 16;
      });
      y -= 12;
    };
    // Block recovery split by stone category (matches the Block Journey
    // page): sandstone as a yield %, marble as CFT per tonne.
    if (data.recovery) {
      const rec = data.recovery, rh = 96;
      P.glass(M, y, cw, rh, 16, COL.gold);
      P.t("BLOCK RECOVERY", M + 16, y - 22, 11, bold, white);
      P.t("Lifetime yield from every cut block", M + 16, y - 35, 8, font, white);
      const colW = (cw - 32) / 2;
      P.t("SANDSTONE", M + 16, y - 54, 8.5, bold, white);
      P.t(`${rec.sandstone.recoveredPct.toFixed(1)}%`, M + 16, y - 78, 22, bold, white);
      P.t(`${rec.sandstone.slabCft.toFixed(0)} / ${rec.sandstone.originalCft.toFixed(0)} CFT · ${rec.sandstone.lineages} blocks`, M + 16, y - 90, 8, font, white);
      const mx = M + 16 + colW;
      P.pg.drawLine({ start: { x: mx - 8, y: y - 50 }, end: { x: mx - 8, y: y - 92 }, thickness: 0.5, color: white, opacity: 0.3 });
      P.t("MARBLE", mx, y - 54, 8.5, bold, white);
      P.t(`${rec.marble.cftPerTonne.toFixed(1)} CFT/T`, mx, y - 78, 22, bold, white);
      P.t(`${rec.marble.slabCft.toFixed(0)} CFT from ${rec.marble.tonnes.toFixed(1)} T · ${rec.marble.lineages} blocks`, mx, y - 90, 8, font, white);
      y -= rh + 14;
    }
    section("BLOCKS ADDED BY STONE", COL.blue, data.blocksByStone.flatMap((rw) => [
      { n: rw.stone, v: `${rw.count} · ${rw.cft.toFixed(0)} CFT` },
      ...rw.vendors.filter((vd) => vd.vendor !== "—").map((vd) => ({ n: `   ↳ ${vd.vendor}`, v: `${vd.count} · ${vd.cft.toFixed(0)} CFT` })),
    ]));
    section("CUTTING BY STONE", COL.cyan, data.cuttingByStone.map((rw) => ({ n: rw.stone, v: `${rw.slabs} · ${rw.cft.toFixed(0)} CFT` })));
    section("CARVING BY VENDOR", COL.amber, data.carvingByVendor.map((rw) => ({ n: rw.vendor, v: `${rw.slabs} · ${rw.cft.toFixed(0)} CFT` })));
    section("DISPATCH BY TEMPLE", COL.green, data.dispatchByTemple.map((rw) => ({ n: rw.temple, v: `${rw.slabs} slabs · ${rw.cft.toFixed(1)} CFT` })));
    footer(P, 3, PAGES);
  }

  // ── Page 4 — 10-day trend, one chart per metric (own scale) ──
  {
    const P = newPage();
    let y = header(P, H - 26, false);
    P.t("10-DAY ACTIVITY TRENDS", M, y, 10, bold, ink); y -= 18;
    const tr = data.trend, n = tr.length;
    const drawMini = (title: string, color: ReturnType<typeof rgb>, key: "blocks" | "cutting" | "carving") => {
      const vals = tr.map((d) => d[key]);
      const peak = vals.length ? Math.max(...vals) : 0;
      const total = vals.reduce((a, b) => a + b, 0);
      const lastV = vals.length ? vals[vals.length - 1] : 0;
      P.pg.drawCircle({ x: M + 4, y: y - 3, size: 3.4, color });
      P.t(title, M + 13, y - 6, 11.5, bold, ink);
      P.r(`latest ${lastV} · peak ${peak} · total ${total}`, W - M, y - 6, 8, font, muted);
      const left = M + 26, rightX = W - M - 4, pT = y - 20, pB = pT - 120;
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
      y = pB - 12 - 24;
    };
    drawMini("Blocks added", COL.blue, "blocks");
    drawMini("Cutting done", COL.cyan, "cutting");
    drawMini("Carving done", COL.amber, "carving");
    footer(P, 4, PAGES);
  }

  // ── Pages 5+ — last-24 h challans & invoices (summary + copies) ──
  if (hasRecent) {
    const money = (d: RecentDoc) => (d.priced ? inr(d.total) : "not priced");
    const qline = (d: { cft: number; sft: number; nos: number }) =>
      [d.cft ? `${d.cft.toFixed(0)} CFT` : "", d.sft ? `${d.sft.toFixed(0)} SFT` : "", d.nos ? `${d.nos.toFixed(0)} NOS` : ""].filter(Boolean).join(" - ") || "-";

    // Page 5 — SUMMARY (both lists + section totals).
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
      footer(P, 5, PAGES);
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
      footer(P, 6 + pageIdx, PAGES);
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
