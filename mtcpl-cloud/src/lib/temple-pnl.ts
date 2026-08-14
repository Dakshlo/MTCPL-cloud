/**
 * Per-temple profitability (Daksh, Aug 2026) — the first screen that joins
 * MONEY OUT to MONEY IN per temple.
 *
 * ── The honest shape of this report ────────────────────────────────
 * Revenue is EXACT: it comes from issued invoices (the same gatherInvoiced()
 * the Invoicing dashboard uses, so the two never disagree).
 *
 * Cost is ALLOCATED, and it has to be — the schema simply has no per-block
 * or per-slab cost:
 *   • blocks carry no rate/cost column, and bills have no block_id (the only
 *     link is bill_vendors.category = 'block_purchase_*' + bills.block_cft);
 *   • cutter_expenses is one company-wide monthly pool, no machine/block key;
 *   • cnc_vendor_expenses is per-vendor per-month, no slab key;
 *   • freight is NOT STORED anywhere at all (challans keep transporter NAMES
 *     only), so it is absent from this P&L — see MISSING_COSTS below.
 * The one genuinely per-slab cost is outsource jobwork
 * (carving_challan_items.amount → slab_requirement_id → temple); it is small
 * today but reported per temple as an information line.
 *
 * So the model is absorption costing on ONE driver — CFT:
 *   rate card  = (stone + cutting + carving pools for the window) ÷ CFT CUT
 *                in the window   → "what one CFT costs us to make"
 *   temple cost = that temple's BILLED CFT × the rate card
 *                 → cost of goods SOLD, which is what revenue must be
 *                   matched against
 * Cost of sales therefore does NOT equal the pool spent: the gap is stock
 * made-but-not-billed (or billed out of older stock). That gap is surfaced
 * rather than hidden — it is real working capital.
 *
 * ── Why the period matters more than usual ─────────────────────────
 * Cutting and CNC expense tracking only began in April 2026, while stone
 * bills go back to Jan 2025. Any window reaching before Apr 2026 gets a
 * cutting/carving pool of ~zero and therefore a flattering margin. The page
 * defaults to FY 26-27 (which starts exactly where costing starts) and
 * poolCoverage below flags any window where a pool is empty.
 *
 * Costs are ex-GST (bills use amount_subtotal — GST is input credit) and so
 * is revenue (payable − GST), so both sides of the margin are comparable.
 */

import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { gatherInvoiced, type InvoiceSource } from "@/lib/invoicing-summary";
import { buildCutterCostReport } from "@/lib/cutter-cost-report";
import { buildCncVariousCostReport } from "@/lib/cnc-various-cost-report";
import { fetchTempleBillNames, displayNameFor } from "@/lib/temple-names";
import { cftOf } from "@/lib/dispatch-grouping";

type Admin = ReturnType<typeof createAdminSupabaseClient>;

export type PnlPeriod = {
  /** YYYY-MM-DD inclusive. */
  startDate: string;
  /** YYYY-MM-DD inclusive. */
  endDate: string;
  label: string;
  /** Preset key echoed back so the UI can highlight the active chip. */
  key: string;
};

export type PnlTempleRow = {
  temple: string;
  revenue: number;
  invoices: number;
  /** Physical CFT behind the invoices — dims for priced challan lines,
   *  stated quantity for CFT-billed free-text lines. */
  billedCft: number;
  /** Revenue on invoices we could NOT measure a volume for (NOS lines,
   *  unit-less running bills). Cost cannot be allocated to it. */
  unmeasuredRevenue: number;
  costStone: number;
  costCutting: number;
  costCarving: number;
  costTotal: number;
  margin: number;
  /** null when there is no revenue to divide by. */
  marginPct: number | null;
  /** Revenue ÷ billed CFT — the sale price we actually realised. */
  realisationPerCft: number | null;
  /** Exact outsource jobwork billed for THIS temple's slabs in the window
   *  (information only — it is already inside the allocated carving pool). */
  outsourceJobwork: number;
};

export type PnlReport = {
  period: PnlPeriod;
  temples: PnlTempleRow[];
  /** Non-temple Other Sales revenue — kept out of the temple table but
   *  reported so the revenue total reconciles with the Invoicing page. */
  otherSalesRevenue: number;
  otherSalesInvoices: number;
  totals: {
    revenue: number;
    billedCft: number;
    cost: number;
    margin: number;
    marginPct: number | null;
    unmeasuredRevenue: number;
  };
  rateCard: {
    /** CFT of slabs CUT in the window — the denominator for every rate. */
    producedCft: number;
    stonePool: number;
    cuttingPool: number;
    carvingPool: number;
    totalPool: number;
    stonePerCft: number;
    cuttingPerCft: number;
    carvingPerCft: number;
    /** stone + cutting + carving — what one CFT costs to make. */
    makeCostPerCft: number;
    /** Stone BOUGHT in the window (ex-GST) on bills that state a block CFT
     *  — the numerator of the purchase rate, not what we charge. */
    stoneSpend: number;
    /** Block CFT on those bills — the denominator. */
    stoneBillCft: number;
    /** stoneSpend ÷ stoneBillCft — ₹ per CFT of raw block. */
    stoneRatePerBlockCft: number;
    /** Block CFT actually CUT in the window — what stonePool charges for. */
    consumedBlockCft: number;
    /** Spend on block bills that carry no block_cft; excluded from the rate
     *  so it can't inflate ₹/CFT, surfaced so the omission is visible. */
    stoneSpendNoCft: number;
    stoneBills: number;
    /** Slab CFT out ÷ block CFT in — the cutting yield this window. */
    recoveryPct: number | null;
  };
  /** Reasons this window's margins can't be trusted. The page leads with
   *  these rather than quietly printing a flattering number. */
  caveats: {
    /** Nothing was cut in the window → no cost can be allocated at all. */
    noProduction: boolean;
    /** The window starts before cutting/CNC expenses were ever recorded, so
     *  those months contribute depreciation but no running cost. */
    predatesCosting: boolean;
    /** First month with any cutter/CNC expense entry (YYYY-MM-DD), null if
     *  neither table has data. */
    costingStartsAt: string | null;
  };
};

// ── Period presets ────────────────────────────────────────────────

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function istTodayParts(): { y: number; m: number; d: number } {
  const t = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
}

const key = (y: number, m: number, d: number) => `${y}-${pad2(m)}-${pad2(d)}`;

/** Indian FY containing a date: Apr Y → Mar Y+1. */
function fyOf(y: number, m: number): number {
  return m >= 4 ? y : y - 1;
}

const fyLabel = (fy: number) => `FY ${String(fy).slice(2)}-${String(fy + 1).slice(2)}`;

export function pnlPeriodFromSearch(raw: string | undefined): PnlPeriod {
  const { y, m, d } = istTodayParts();
  const today = key(y, m, d);
  const thisFy = fyOf(y, m);

  switch (raw) {
    case "this_month":
      return { key: "this_month", startDate: key(y, m, 1), endDate: today, label: "This month" };
    case "last_fy": {
      const fy = thisFy - 1;
      return { key: "last_fy", startDate: key(fy, 4, 1), endDate: key(fy + 1, 3, 31), label: fyLabel(fy) };
    }
    case "all":
      // Stone bills begin Jan 2025; nothing in the system predates it.
      return { key: "all", startDate: "2025-01-01", endDate: today, label: "All time" };
    case "this_fy":
    default:
      return { key: "this_fy", startDate: key(thisFy, 4, 1), endDate: today, label: `${fyLabel(thisFy)} (to date)` };
  }
}

export const PNL_PRESETS = [
  { key: "this_fy", label: "This FY" },
  { key: "last_fy", label: "Last FY" },
  { key: "this_month", label: "This month" },
  { key: "all", label: "All time" },
] as const;

// ── Small helpers ─────────────────────────────────────────────────

const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** Does a free-text unit mean cubic feet? Mirrors invoicing-summary's
 *  bucket() so the two surfaces classify a line the same way. */
function isCftUnit(unit: string | null | undefined): boolean {
  const u = (unit ?? "").toLowerCase();
  return u.includes("cft") || u.includes("cubic");
}

/** Page through a table in 1000-row slices (PostgREST caps silently). */
async function pageAll<T>(admin: Admin, table: string, cols: string): Promise<T[]> {
  const out: T[] = [];
  for (let off = 0; off < 100_000; off += 1000) {
    const { data, error } = await admin.from(table).select(cols).order("id").range(off, off + 999);
    if (error) break;
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < 1000) break;
  }
  return out;
}

/** Fetch rows for a set of parent ids in chunks (avoids a giant .in()). */
async function byParent<T>(
  admin: Admin, table: string, parentCol: string, ids: string[], cols: string,
): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200);
    if (!chunk.length) break;
    const { data } = await admin.from(table).select(cols).in(parentCol, chunk);
    out.push(...((data ?? []) as T[]));
  }
  return out;
}

// ── The report ────────────────────────────────────────────────────

export async function buildTemplePnl(period: PnlPeriod): Promise<PnlReport> {
  const admin = createAdminSupabaseClient();
  const { startDate, endDate } = period;

  // Revenue, the two cost engines and the temple name map are all
  // independent — fetch them together.
  const [invoices, billNames, cutter, cnc] = await Promise.all([
    gatherInvoiced(admin),
    fetchTempleBillNames(admin),
    // Both engines accept an arbitrary window and prorate the months it
    // touches; "yearly" just tells them not to treat it as a single day.
    buildCutterCostReport({ kind: "yearly", startDate, endDate, label: period.label }),
    buildCncVariousCostReport({ kind: "yearly", startDate, endDate, label: period.label }),
  ]);

  const inWindow = (date: string | null | undefined) =>
    !!date && date >= startDate && date <= endDate;

  // ── 1. Revenue, per temple ──────────────────────────────────────
  // net = payable − GST → taxable value after discount, comparable with
  // the ex-GST cost pools below.
  const windowed = invoices.filter((r) => inWindow(r.date));
  const rev = new Map<string, { revenue: number; invoices: number; cft: number; unmeasured: number }>();
  let otherSalesRevenue = 0;
  let otherSalesInvoices = 0;

  // Volume per invoice document, measured from its own line items.
  const idsBySource = new Map<InvoiceSource, string[]>();
  for (const r of windowed) {
    const arr = idsBySource.get(r.source) ?? [];
    arr.push(r.id);
    idsBySource.set(r.source, arr);
  }
  const cftByDoc = new Map<string, number>();

  // Priced challan lines carry real dimensions (inches) for every row, so
  // physical CFT is exact even for SFT-billed jali work.
  //
  // PURCHASE ONLY. A running-bill challan keeps its original dispatch lines
  // in challan_items too, but it is INVOICED from challan_custom_items — so
  // counting both double-counts its volume (CH-2026-84 was 319 + 336 CFT).
  {
    const ids = idsBySource.get("purchase") ?? [];
    type It = { challan_id: string; quantity: number | string | null; length_ft: number | string | null; width_ft: number | string | null; thickness_ft: number | string | null };
    const items = await byParent<It>(admin, "challan_items", "challan_id", ids,
      "challan_id, quantity, length_ft, width_ft, thickness_ft");
    for (const it of items) {
      const each = cftOf(num(it.length_ft), num(it.width_ft), num(it.thickness_ft));
      const qty = num(it.quantity) || 1;
      cftByDoc.set(it.challan_id, (cftByDoc.get(it.challan_id) ?? 0) + each * qty);
    }
  }
  // Running bills and work orders are free-text lines — trust the stated
  // unit, and count nothing when it isn't a volume.
  {
    const running = idsBySource.get("running") ?? [];
    type Ct = { challan_id: string; unit: string | null; quantity: number | string | null };
    const items = await byParent<Ct>(admin, "challan_custom_items", "challan_id", running, "challan_id, unit, quantity");
    for (const it of items) {
      if (!isCftUnit(it.unit)) continue;
      cftByDoc.set(it.challan_id, (cftByDoc.get(it.challan_id) ?? 0) + num(it.quantity));
    }
  }
  {
    const bulk = idsBySource.get("work_order") ?? [];
    type Bi = { bulk_invoice_id: string; unit: string | null; quantity: number | string | null };
    const items = await byParent<Bi>(admin, "bulk_invoice_items", "bulk_invoice_id", bulk, "bulk_invoice_id, unit, quantity");
    for (const it of items) {
      if (!isCftUnit(it.unit)) continue;
      cftByDoc.set(it.bulk_invoice_id, (cftByDoc.get(it.bulk_invoice_id) ?? 0) + num(it.quantity));
    }
  }

  for (const r of windowed) {
    const net = r.amount - r.taxed; // ex-GST, after discount
    if (r.source === "other") {
      otherSalesRevenue += net;
      otherSalesInvoices += 1;
      continue;
    }
    const e = rev.get(r.party) ?? { revenue: 0, invoices: 0, cft: 0, unmeasured: 0 };
    const cft = cftByDoc.get(r.id) ?? 0;
    e.revenue += net;
    e.invoices += 1;
    e.cft += cft;
    if (cft <= 0) e.unmeasured += net;
    rev.set(r.party, e);
  }

  // ── 2. Cost pools for the window ────────────────────────────────
  // STONE is stock, not a period expense: MTCPL buys blocks in bulk and
  // cuts them months later (Apr–Aug 2026 bought ~112k block-CFT but cut
  // only ~51k). Charging the window's PURCHASES to the window's output
  // more than doubles the true stone cost and turns healthy temples red.
  // So we charge stone CONSUMED:
  //     rate  = ₹ ÷ block-CFT across the window's block-purchase bills
  //     cost  = (block-CFT actually cut in the window) × rate
  // Bills with no block_cft are excluded from the RATE (spend with no
  // volume would inflate ₹/CFT) but reported so the gap is visible.
  //
  // NOTE both 'approved' and 'fully_paid' count — a paid bill is still a
  // cost (filtering on 'approved' alone would drop half the ledger).
  let stoneSpend = 0;
  let stoneBillCft = 0;
  let stoneBills = 0;
  let stoneSpendNoCft = 0;
  {
    type V = { id: string; category: string | null };
    const { data: vendors } = await admin.from("bill_vendors").select("id, category");
    const blockVendors = new Set(
      ((vendors ?? []) as V[])
        .filter((v) => (v.category ?? "").startsWith("block_purchase"))
        .map((v) => v.id),
    );
    type B = { id: string; bill_vendor_id: string; bill_date: string | null; amount_subtotal: number | string | null; block_cft: number | string | null; status: string | null; cancelled_at: string | null };
    const bills = await pageAll<B>(admin, "bills",
      "id, bill_vendor_id, bill_date, amount_subtotal, block_cft, status, cancelled_at");
    for (const b of bills) {
      if (!blockVendors.has(b.bill_vendor_id)) continue;
      if (b.cancelled_at) continue;
      if (b.status !== "approved" && b.status !== "fully_paid") continue;
      if (!inWindow(b.bill_date)) continue;
      const amt = num(b.amount_subtotal);
      const cft = num(b.block_cft);
      stoneBills += 1;
      if (cft > 0) {
        stoneSpend += amt;
        stoneBillCft += cft;
      } else {
        stoneSpendNoCft += amt;
      }
    }
  }
  const stoneRatePerBlockCft = stoneBillCft > 0 ? stoneSpend / stoneBillCft : 0;

  // Volume of the blocks actually cut in the window. The cutter engine
  // already resolved which slabs were cut when; take their distinct source
  // blocks. Block dims are INCHES (like slabs) despite the *_ft names, and
  // marble blocks carry NULL dims + tonnes instead — 8 CFT/tonne is the
  // house equivalence used by the manual-cut path.
  let consumedBlockCft = 0;
  {
    const blockIds = [...new Set(
      cutter.contributingSlabs.map((s) => s.sourceBlockId).filter(Boolean) as string[],
    )];
    type Blk = { id: string; length_ft: number | string | null; width_ft: number | string | null; height_ft: number | string | null; tonnes: number | string | null };
    for (let i = 0; i < blockIds.length; i += 200) {
      const { data } = await admin.from("blocks")
        .select("id, length_ft, width_ft, height_ft, tonnes")
        .in("id", blockIds.slice(i, i + 200));
      for (const b of (data ?? []) as Blk[]) {
        const vol = cftOf(num(b.length_ft), num(b.width_ft), num(b.height_ft));
        if (vol > 0) consumedBlockCft += vol;
        else if (num(b.tonnes) > 0) consumedBlockCft += num(b.tonnes) * 8;
      }
    }
  }
  const stonePool = consumedBlockCft * stoneRatePerBlockCft;

  // Cutting + CNC pools come straight from the existing engines (they
  // already prorate part-months and add WDV depreciation).
  const cuttingPool = cutter.totalCost;
  const cncPool = cnc.totalCostForPeriod;

  // When did anyone first record a running expense? Months before this
  // contribute depreciation but no electricity/manpower/tools, so a window
  // reaching back that far understates cost. Read it rather than hardcoding
  // April 2026 — it moves as soon as older entries are backfilled.
  let costingStartsAt: string | null = null;
  {
    const firsts: string[] = [];
    for (const table of ["cutter_expenses", "cnc_vendor_expenses"]) {
      const { data } = await admin.from(table).select("year, month")
        .order("year", { ascending: true }).order("month", { ascending: true }).limit(1);
      const r = (data ?? [])[0] as { year: number; month: number } | undefined;
      if (r) firsts.push(`${r.year}-${pad2(r.month)}-01`);
    }
    if (firsts.length > 0) costingStartsAt = firsts.sort()[0];
  }

  // Outsource jobwork: the one exactly-attributable cost. Summed into the
  // carving pool, and also kept per temple as an information line.
  const outsourceByTemple = new Map<string, number>();
  let outsourcePool = 0;
  {
    type Ch = { id: string; challan_date: string | null; cancelled_at: string | null };
    const { data: challans } = await admin
      .from("carving_challans").select("id, challan_date, cancelled_at");
    const liveIds = ((challans ?? []) as Ch[])
      .filter((c) => !c.cancelled_at && inWindow(c.challan_date))
      .map((c) => c.id);
    if (liveIds.length > 0) {
      type Item = { challan_id: string; slab_requirement_id: string | null; amount: number | string | null };
      const items = await byParent<Item>(admin, "carving_challan_items", "challan_id", liveIds,
        "challan_id, slab_requirement_id, amount");
      const slabIds = [...new Set(items.map((i) => i.slab_requirement_id).filter(Boolean))] as string[];
      const templeBySlab = new Map<string, string>();
      for (let i = 0; i < slabIds.length; i += 200) {
        const { data } = await admin.from("slab_requirements")
          .select("id, temple").in("id", slabIds.slice(i, i + 200));
        for (const s of (data ?? []) as Array<{ id: string; temple: string | null }>) {
          templeBySlab.set(s.id, displayNameFor(billNames, s.temple));
        }
      }
      for (const it of items) {
        const amt = num(it.amount);
        outsourcePool += amt;
        const t = it.slab_requirement_id ? templeBySlab.get(it.slab_requirement_id) : null;
        if (t) outsourceByTemple.set(t, (outsourceByTemple.get(t) ?? 0) + amt);
      }
    }
  }
  const carvingPool = cncPool + outsourcePool;

  // ── 3. Rate card — pools ÷ CFT actually cut in the window ────────
  const producedCft = cutter.totalCft;
  const per = (pool: number) => (producedCft > 0 ? pool / producedCft : 0);
  const stonePerCft = per(stonePool);
  const cuttingPerCft = per(cuttingPool);
  const carvingPerCft = per(carvingPool);
  const makeCostPerCft = stonePerCft + cuttingPerCft + carvingPerCft;

  // ── 4. Per-temple cost of sales = billed CFT × rate card ────────
  const temples: PnlTempleRow[] = [...rev.entries()]
    .map(([temple, e]) => {
      const costStone = e.cft * stonePerCft;
      const costCutting = e.cft * cuttingPerCft;
      const costCarving = e.cft * carvingPerCft;
      const costTotal = costStone + costCutting + costCarving;
      const margin = e.revenue - costTotal;
      return {
        temple,
        revenue: e.revenue,
        invoices: e.invoices,
        billedCft: e.cft,
        unmeasuredRevenue: e.unmeasured,
        costStone,
        costCutting,
        costCarving,
        costTotal,
        margin,
        marginPct: e.revenue > 0 ? (margin / e.revenue) * 100 : null,
        realisationPerCft: e.cft > 0 ? e.revenue / e.cft : null,
        outsourceJobwork: outsourceByTemple.get(temple) ?? 0,
      };
    })
    .sort((a, b) => b.revenue - a.revenue);

  const tRevenue = temples.reduce((s, t) => s + t.revenue, 0);
  const tCost = temples.reduce((s, t) => s + t.costTotal, 0);
  const tCft = temples.reduce((s, t) => s + t.billedCft, 0);
  const tUnmeasured = temples.reduce((s, t) => s + t.unmeasuredRevenue, 0);

  return {
    period,
    temples,
    otherSalesRevenue,
    otherSalesInvoices,
    totals: {
      revenue: tRevenue,
      billedCft: tCft,
      cost: tCost,
      margin: tRevenue - tCost,
      marginPct: tRevenue > 0 ? ((tRevenue - tCost) / tRevenue) * 100 : null,
      unmeasuredRevenue: tUnmeasured,
    },
    rateCard: {
      producedCft,
      stonePool,
      cuttingPool,
      carvingPool,
      totalPool: stonePool + cuttingPool + carvingPool,
      stonePerCft,
      cuttingPerCft,
      carvingPerCft,
      makeCostPerCft,
      stoneSpend,
      stoneBillCft,
      stoneRatePerBlockCft,
      consumedBlockCft,
      stoneSpendNoCft,
      stoneBills,
      recoveryPct: consumedBlockCft > 0 ? (producedCft / consumedBlockCft) * 100 : null,
    },
    caveats: {
      noProduction: producedCft <= 0,
      predatesCosting: costingStartsAt != null && startDate < costingStartsAt,
      costingStartsAt,
    },
  };
}
