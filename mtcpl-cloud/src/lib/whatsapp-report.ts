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
  blocksByStone: Array<{ stone: string; count: number; cft: number }>;
  cuttingByStone: Array<{ stone: string; slabs: number; cft: number }>;
  carvingByVendor: Array<{ vendor: string; slabs: number; cft: number }>;
  dispatchByTemple: Array<{ temple: string; slabs: number; tonnes: number }>;
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
      .select("stone, length_ft, width_ft, height_ft, created_at")
      .gte("created_at", startUTC)
      .lte("created_at", endUTC);
    const byStone = new Map<string, { count: number; cft: number }>();
    for (const b of (data ?? []) as Array<{ stone: string | null; length_ft: number; width_ft: number; height_ft: number }>) {
      const c = cft(Number(b.length_ft), Number(b.width_ft), Number(b.height_ft));
      totals.blocks.count += 1; totals.blocks.cft += c;
      const k = stoneLabel(b.stone);
      const g = byStone.get(k) ?? { count: 0, cft: 0 };
      g.count += 1; g.cft += c; byStone.set(k, g);
    }
    if (detail) det.blocksByStone = [...byStone.entries()].map(([stone, v]) => ({ stone, ...v })).sort((a, b) => b.cft - a.cft);
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
      const byTemple = new Map<string, { slabs: number; tonnes: number }>();
      for (const l of logRows) {
        if (!l.dispatch_id || !l.slab_requirement_id) continue;
        const temple = templeOf.get(l.dispatch_id) || "-";
        const c = dims.get(l.slab_requirement_id) ?? 0;
        const tn = Number(l.weight_tonnes) || 0;
        totals.dispatch.slabs += 1; totals.dispatch.cft += c; totals.dispatch.tonnes += tn;
        const g = byTemple.get(temple) ?? { slabs: 0, tonnes: 0 };
        g.slabs += 1; g.tonnes += tn; byTemple.set(temple, g);
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

export async function buildDailyReportData(): Promise<DailyReport> {
  const admin = createAdminSupabaseClient();
  // Main = last 24 h (10 AM → 10 AM); prev = the 24 h before that.
  const t = window24(0);
  const p = window24(-1);
  const today = await aggregateDay(admin, t.startUTC, t.endUTC, true);
  const prev = await aggregateDay(admin, p.startUTC, p.endUTC, false);
  const payToday = await paymentsForWindow(admin, t.startUTC, t.endUTC, true);

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

  return {
    label: t.label,
    prevLabel: p.label,
    today: today.totals,
    prev: prev.totals,
    blocksByStone: today.det.blocksByStone,
    cuttingByStone: today.det.cuttingByStone,
    carvingByVendor: today.det.carvingByVendor,
    dispatchByTemple: today.det.dispatchByTemple,
    payments: { total: payToday.total, byVendor: payToday.byVendor },
    cnc,
    cutter,
    trend,
  };
}

// ── PDF ─────────────────────────────────────────────────────────────

export async function buildDailyReportPdf(data: DailyReport): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595.28, 841.89]); // A4
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const W = 595.28, H = 841.89, M = 40;
  const white = rgb(1, 1, 1), ink = rgb(0.12, 0.12, 0.12), muted = rgb(0.45, 0.43, 0.4), line = rgb(0.84, 0.81, 0.76), brown = rgb(0.486, 0.231, 0.047);
  const paper = rgb(0.984, 0.980, 0.972);   // warm off-white page
  const rowTint = rgb(0.953, 0.945, 0.929);  // alternating list row
  const COL = {
    blue: rgb(0.145, 0.388, 0.922),
    cyan: rgb(0.031, 0.569, 0.698),
    amber: rgb(0.851, 0.467, 0.024),
    green: rgb(0.086, 0.639, 0.290),
    gold: rgb(0.706, 0.325, 0.035),
    indigo: rgb(0.282, 0.255, 0.604),  // CNC costing
    teal: rgb(0.086, 0.412, 0.388),    // cutter costing
  };

  // Warm paper background — softer than stark white, makes the colour cards pop.
  page.drawRectangle({ x: 0, y: 0, width: W, height: H, color: paper });

  const text = (s: string, x: number, y: number, size: number, f = font, c = ink) => page.drawText(s, { x, y, size, font: f, color: c });
  const right = (s: string, xr: number, y: number, size: number, f = font, c = ink) => page.drawText(s, { x: xr - f.widthOfTextAtSize(s, size), y, size, font: f, color: c });
  const centre = (s: string, cx: number, y: number, size: number, f = font, c = ink) => page.drawText(s, { x: cx - f.widthOfTextAtSize(s, size) / 2, y, size, font: f, color: c });
  const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 2)}..` : s);

  // Rounded-rectangle card via an SVG path. (x, yTop) is the TOP-LEFT corner;
  // the card extends downward. pdf-lib flips SVG-y, so yTop is the top edge.
  const roundPath = (w: number, h: number, r: number) => {
    const rr = Math.min(r, w / 2, h / 2);
    return `M ${rr} 0 L ${w - rr} 0 Q ${w} 0 ${w} ${rr} L ${w} ${h - rr} Q ${w} ${h} ${w - rr} ${h} L ${rr} ${h} Q 0 ${h} 0 ${h - rr} L 0 ${rr} Q 0 0 ${rr} 0 Z`;
  };
  const card = (
    x: number, yTop: number, w: number, h: number, r: number,
    color: ReturnType<typeof rgb>,
    o?: { opacity?: number; border?: ReturnType<typeof rgb>; borderWidth?: number },
  ) => page.drawSvgPath(roundPath(w, h, r), {
    x, y: yTop, color, opacity: o?.opacity,
    borderColor: o?.border, borderWidth: o?.borderWidth,
  });

  let top = H - 30;

  // ── Logo + header ──
  try {
    const png = await pdf.embedPng(await readFile(path.join(process.cwd(), "public", "logo-dark.png")));
    const lh = 34, lw = (png.width / png.height) * lh;
    page.drawImage(png, { x: M, y: top - lh + 2, width: lw, height: lh });
  } catch { /* logo optional */ }
  const tx = M + 86;
  text("MATESHWARI TEMPLE CONSTRUCTION PVT LTD", tx, top - 6, 10, bold, brown);
  text("Daily Work Report", tx, top - 24, 17, bold, ink);
  text("Activity in the 24 hours ending 10 AM IST", tx, top - 38, 8, font, muted);
  // Date in a rounded brand pill, with the comparison day beneath it.
  const dpw = bold.widthOfTextAtSize(data.label, 12) + 24;
  card(W - M - dpw, top + 3, dpw, 23, 6, brown);
  centre(data.label, W - M - dpw / 2, top - 12, 12, bold, white);
  right(`vs ${data.prevLabel}`, W - M, top - 30, 9, font, muted);
  top -= 46;
  // Two-tone rule: a bold gold band over a thin brown baseline.
  page.drawLine({ start: { x: M, y: top }, end: { x: W - M, y: top }, thickness: 3, color: COL.gold });
  page.drawLine({ start: { x: M, y: top - 2.4 }, end: { x: W - M, y: top - 2.4 }, thickness: 0.6, color: brown });
  top -= 18;

  // ── 4 big metric cards (2×2) ──
  const gap = 12;
  const bw = (W - 2 * M - gap) / 2;
  const bh = 88;
  const delta = (cur: number, prev: number) => { const d = cur - prev; return `Prev day ${prev}   (${d > 0 ? "+" : ""}${d})`; };
  const box = (x: number, ytop: number, color: ReturnType<typeof rgb>, label: string, big: string, sub: string, compare: string) => {
    card(x, ytop, bw, bh, 10, color);
    // soft accent tab top-left for a designed feel
    card(x + 13, ytop - 11, 26, 4, 2, white, { opacity: 0.5 });
    text(label, x + 14, ytop - 26, 10, bold, white);
    text(big, x + 13, ytop - 54, 26, bold, white);
    text(sub, x + 14, ytop - 68, 9.5, font, white);
    // translucent pill holding the vs-yesterday delta
    const cw2 = font.widthOfTextAtSize(compare, 8) + 14;
    card(x + 13, ytop - 70, cw2, 15, 5, white, { opacity: 0.16 });
    text(compare, x + 20, ytop - 80, 8, font, white);
  };
  box(M, top, COL.blue, "BLOCKS ADDED", String(data.today.blocks.count), `${data.today.blocks.cft.toFixed(1)} CFT`, delta(data.today.blocks.count, data.prev.blocks.count));
  box(M + bw + gap, top, COL.cyan, "CUTTING DONE", String(data.today.cutting.slabs), `${data.today.cutting.cft.toFixed(1)} CFT`, delta(data.today.cutting.slabs, data.prev.cutting.slabs));
  top -= bh + gap;
  box(M, top, COL.amber, "CARVING DONE", String(data.today.carving.slabs), `${data.today.carving.cft.toFixed(1)} CFT`, delta(data.today.carving.slabs, data.prev.carving.slabs));
  box(M + bw + gap, top, COL.green, "DISPATCHED", String(data.today.dispatch.slabs), `${data.today.dispatch.cft.toFixed(1)} CFT  ·  ${data.today.dispatch.tonnes.toFixed(1)} T  ·  ${data.today.dispatch.trucks} trucks`, delta(data.today.dispatch.slabs, data.prev.dispatch.slabs));
  top -= bh + 22;

  // ── breakdown columns ──
  const cw = (W - 2 * M - 2 * gap) / 3;
  const colX = [M, M + cw + gap, M + 2 * (cw + gap)];
  const colTop = top;
  const drawList = (x: number, title: string, color: ReturnType<typeof rgb>, rows: Array<{ name: string; val: string }>) => {
    let yy = colTop;
    // colour bullet + title
    page.drawRectangle({ x, y: yy - 1, width: 7, height: 7, color });
    text(title, x + 11, yy, 8.5, bold, color); yy -= 6;
    page.drawLine({ start: { x, y: yy }, end: { x: x + cw, y: yy }, thickness: 1, color }); yy -= 14;
    if (rows.length === 0) { text("None", x, yy, 9, font, muted); yy -= 14; }
    else rows.slice(0, 6).forEach((r, i) => {
      if (i % 2 === 1) page.drawRectangle({ x: x - 3, y: yy - 3.5, width: cw + 6, height: 13.5, color: rowTint });
      text(clip(r.name, 15), x, yy, 9, font, ink); right(r.val, x + cw, yy, 8.5, font, muted); yy -= 14;
    });
    return yy;
  };
  const y1 = drawList(colX[0], "CUTTING BY STONE", COL.cyan, data.cuttingByStone.map((r) => ({ name: r.stone, val: `${r.slabs} · ${r.cft.toFixed(0)} CFT` })));
  const y2 = drawList(colX[1], "CARVING BY VENDOR", COL.amber, data.carvingByVendor.map((r) => ({ name: r.vendor, val: `${r.slabs} · ${r.cft.toFixed(0)} CFT` })));
  const y3 = drawList(colX[2], "DISPATCH BY TEMPLE", COL.green, data.dispatchByTemple.map((r) => ({ name: r.temple, val: `${r.slabs} · ${r.tonnes.toFixed(1)} T` })));
  top = Math.min(y1, y2, y3) - 16;

  // ── CNC costing — month to date, combined "/unit" headline ──
  if (data.cnc) {
    const c = data.cnc;
    const h = 96;
    card(M, top, W - 2 * M, h, 10, COL.indigo);
    text("CNC COSTING  ·  MONTH TO DATE", M + 15, top - 19, 10, bold, white);
    right(`${c.label}   ·   ${c.days} of ${c.monthLen} days`, W - M - 15, top - 19, 9, font, white);
    // spend so far (left) + combined cost-per-unit headline (right, matches the
    // CNC costing page's "COST PER UNIT · SFT + CFT combined" card)
    text(inr(c.totalCost), M + 14, top - 46, 20, bold, white);
    text("spent so far", M + 18 + bold.widthOfTextAtSize(inr(c.totalCost), 20), top - 46, 9, font, white);
    right(Number.isFinite(c.costPerCombined) ? `${inr2(c.costPerCombined)} / unit` : "-- / unit", W - M - 15, top - 44, 16, bold, white);
    right("SFT + CFT combined", W - M - 15, top - 55, 7.5, font, white);
    page.drawLine({ start: { x: M + 15, y: top - 61 }, end: { x: W - M - 15, y: top - 61 }, thickness: 0.6, color: white, opacity: 0.32 });
    const ps = Number.isFinite(c.costPerSft) ? inr2(c.costPerSft) : "--";
    const pc = Number.isFinite(c.costPerCft) ? inr2(c.costPerCft) : "--";
    text(`${ps} / SFT      ${pc} / CFT      Operational ${inr(c.operational)}      Depreciation ${inr(c.depreciation)}`, M + 15, top - 76, 8.5, font, white);
    text(`Output ${c.sft.toFixed(0)} SFT / ${c.cft.toFixed(0)} CFT      ${c.slabs} slabs carved      ${c.machines} machine${c.machines === 1 ? "" : "s"}`, M + 15, top - 88, 8.5, font, white);
    top -= h + 14;
  }

  // ── Cutter (block-cutting plant) costing — month to date ──
  if (data.cutter) {
    const c = data.cutter;
    const h = 82;
    card(M, top, W - 2 * M, h, 10, COL.teal);
    text("CUTTER COSTING  ·  MONTH TO DATE", M + 15, top - 19, 10, bold, white);
    right(`${c.label}   ·   ${c.days} of ${c.monthLen} days`, W - M - 15, top - 19, 9, font, white);
    text(inr(c.totalCost), M + 14, top - 46, 20, bold, white);
    text("spent so far", M + 18 + bold.widthOfTextAtSize(inr(c.totalCost), 20), top - 46, 9, font, white);
    right(Number.isFinite(c.costPerCft) ? `${inr2(c.costPerCft)} / CFT` : "-- / CFT", W - M - 15, top - 44, 16, bold, white);
    right("per CFT cut", W - M - 15, top - 55, 7.5, font, white);
    page.drawLine({ start: { x: M + 15, y: top - 61 }, end: { x: W - M - 15, y: top - 61 }, thickness: 0.6, color: white, opacity: 0.32 });
    text(`Operational ${inr(c.operational)}      Depreciation ${inr(c.depreciation)}      Output ${c.cft.toFixed(0)} CFT      ${c.slabs} slabs`, M + 15, top - 76, 8.5, font, white);
    top -= h + 14;
  }

  // ── payments card (yesterday comparison removed per request) ──
  const payRows = data.payments.byVendor.slice(0, 6);
  const hasRows = payRows.length > 0;
  const payH = 56 + (hasRows ? payRows.length * 15 + 8 : 14);
  card(M, top, W - 2 * M, payH, 10, COL.gold);
  text("PAYMENTS TO SUPPLIERS  ·  24 H", M + 15, top - 19, 10, bold, white);
  text(inr(data.payments.total), M + 14, top - 45, 22, bold, white);
  let py = top - 56;
  if (!hasRows) {
    text("No supplier payments in this 24 h window.", M + 15, py - 2, 9.5, font, white);
  } else {
    page.drawLine({ start: { x: M + 15, y: py }, end: { x: W - M - 15, y: py }, thickness: 0.6, color: white, opacity: 0.35 });
    py -= 16;
    for (const v of payRows) { text(clip(v.vendor, 40), M + 15, py, 9.5, font, white); right(inr(v.amount), W - M - 15, py, 9.5, bold, white); py -= 15; }
  }

  // ── footer ──
  page.drawLine({ start: { x: M, y: 52 }, end: { x: W - M, y: 52 }, thickness: 0.8, color: line });
  text("Automated daily report · MTCPL", M, 40, 8.5, font, muted);
  const gen = new Date(Date.now() + 5.5 * 3600 * 1000);
  right(`Generated ${gen.getUTCDate()} ${MONTHS[gen.getUTCMonth()]} ${gen.getUTCFullYear()}, ${String(gen.getUTCHours()).padStart(2, "0")}:${String(gen.getUTCMinutes()).padStart(2, "0")} IST`, W - M, 40, 8.5, font, muted);

  // ════════════════════════════════════════════════════════════════
  // Page 2 — three separate trend charts (one metric each, own scale)
  // ════════════════════════════════════════════════════════════════
  const p2 = pdf.addPage([W, H]);
  p2.drawRectangle({ x: 0, y: 0, width: W, height: H, color: paper });
  const t2 = (s: string, x: number, y: number, size: number, f = font, c = ink) => p2.drawText(s, { x, y, size, font: f, color: c });
  const r2 = (s: string, xr: number, y: number, size: number, f = font, c = ink) => p2.drawText(s, { x: xr - f.widthOfTextAtSize(s, size), y, size, font: f, color: c });
  const c2 = (s: string, cx: number, y: number, size: number, f = font, c = ink) => p2.drawText(s, { x: cx - f.widthOfTextAtSize(s, size) / 2, y, size, font: f, color: c });

  let h2 = H - 44;
  t2("MATESHWARI TEMPLE CONSTRUCTION PVT LTD", M, h2, 10, bold, brown);
  t2("10-Day Activity Trends", M, h2 - 21, 16, bold, ink);
  const tr = data.trend;
  if (tr.length > 0) r2(`${tr[0].label}  -  ${tr[tr.length - 1].label}`, W - M, h2 - 5, 9, font, muted);
  h2 -= 32;
  p2.drawLine({ start: { x: M, y: h2 }, end: { x: W - M, y: h2 }, thickness: 3, color: COL.gold });
  p2.drawLine({ start: { x: M, y: h2 - 2.4 }, end: { x: W - M, y: h2 - 2.4 }, thickness: 0.6, color: brown });
  h2 -= 26;

  // One chart per metric, each on its OWN y-scale, so a quiet series isn't
  // flattened by a busy one — far easier to read than three lines overlaid.
  const n = tr.length;
  const PLOTH = 145;
  const drawMini = (yTop: number, title: string, color: ReturnType<typeof rgb>, key: "blocks" | "cutting" | "carving"): number => {
    const vals = tr.map((d) => d[key]);
    const total = vals.reduce((a, b) => a + b, 0);
    const todayV = vals.length ? vals[vals.length - 1] : 0;
    const peak = vals.length ? Math.max(...vals) : 0;
    // title row: colour dot + name (left), quick stats (right)
    p2.drawCircle({ x: M + 4, y: yTop - 3, size: 3.4, color });
    t2(title, M + 13, yTop - 6, 11.5, bold, ink);
    r2(`latest ${todayV}      peak ${peak}      10-day total ${total}`, W - M, yTop - 6, 8.5, font, muted);
    const left = M + 28, rightX = W - M - 6;
    const plotTop = yTop - 20, plotBottom = plotTop - PLOTH;
    const plotW = rightX - left, plotH = plotTop - plotBottom;
    const niceMax = Math.max(5, Math.ceil(peak / 5) * 5);
    const STEPS = 4;
    for (let g = 0; g <= STEPS; g++) {
      const yy = plotBottom + (plotH * g) / STEPS;
      p2.drawLine({ start: { x: left, y: yy }, end: { x: rightX, y: yy }, thickness: g === 0 ? 1 : 0.5, color: line, opacity: g === 0 ? 1 : 0.5 });
      r2(String(Math.round((niceMax * g) / STEPS)), left - 7, yy - 3, 8, font, muted);
    }
    const xAt = (i: number) => left + (n <= 1 ? 0 : (plotW * i) / (n - 1));
    const yAt = (v: number) => plotBottom + plotH * Math.min(1, v / niceMax);
    for (let i = 0; i < n; i++) c2(tr[i].short, xAt(i), plotBottom - 13, 8, font, muted);
    for (let i = 0; i < n - 1; i++) p2.drawLine({ start: { x: xAt(i), y: yAt(vals[i]) }, end: { x: xAt(i + 1), y: yAt(vals[i + 1]) }, thickness: 2.2, color });
    for (let i = 0; i < n; i++) p2.drawCircle({ x: xAt(i), y: yAt(vals[i]), size: 2.5, color });
    return plotBottom - 13 - 26; // y for the next chart's title row
  };

  let cy = drawMini(h2, "Blocks added", COL.blue, "blocks");
  cy = drawMini(cy, "Cutting done", COL.cyan, "cutting");
  drawMini(cy, "Carving done", COL.amber, "carving");

  // footer (page 2)
  p2.drawLine({ start: { x: M, y: 52 }, end: { x: W - M, y: 52 }, thickness: 0.8, color: line });
  t2("Automated daily report · MTCPL", M, 40, 8.5, font, muted);
  r2("Page 2 of 2", W - M, 40, 8.5, font, muted);

  return pdf.save();
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
