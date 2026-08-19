/**
 * Tax-invoice totals for a priced challan (Mig 157). Shared by the invoicing
 * review form's live preview and the landscape invoice print so the numbers
 * always agree. GST is either a single IGST %, or split CGST + SGST %, or none.
 */

export type GstMode = "igst" | "cgst_sgst" | null;

export type InvoiceTotals = {
  subtotal: number;
  igstAmt: number;
  cgstAmt: number;
  sgstAmt: number;
  gstTotal: number;
  grand: number;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

export function computeInvoiceTotals(
  amounts: number[],
  gst: { mode: GstMode; igst: number; cgst: number; sgst: number },
): InvoiceTotals {
  const subtotal = round2(amounts.reduce((a, n) => a + (Number(n) || 0), 0));
  let igstAmt = 0;
  let cgstAmt = 0;
  let sgstAmt = 0;
  if (gst.mode === "igst") {
    igstAmt = round2((subtotal * (Number(gst.igst) || 0)) / 100);
  } else if (gst.mode === "cgst_sgst") {
    cgstAmt = round2((subtotal * (Number(gst.cgst) || 0)) / 100);
    sgstAmt = round2((subtotal * (Number(gst.sgst) || 0)) / 100);
  }
  const gstTotal = round2(igstAmt + cgstAmt + sgstAmt);
  return { subtotal, igstAmt, cgstAmt, sgstAmt, gstTotal, grand: round2(subtotal + gstTotal) };
}

export function rupee(n: number): string {
  return `₹${(Number(n) || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Whole rupees, no paise — for a mig-220 rounded invoice value. */
export function rupee0(n: number): string {
  return `₹${Math.round(Number(n) || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}

/** The amount-payable figure, printed the way THIS invoice was billed: clean
 *  whole rupees once it is rounded (mig 220), paise on a legacy invoice. */
export function rupeePayable(d: DiscountResult): string {
  return d.rounded ? rupee0(d.payable) : rupee(d.payable);
}

/** "+ ₹0.43" / "− ₹0.50" for the Round Off totals row. */
export function roundOffText(d: DiscountResult): string {
  const n = Math.abs(d.roundOff);
  return `${d.roundOff < 0 ? "−" : "+"} ${rupee(n)}`;
}

// ── Mig 199 — multiple GST slabs in ONE invoice ─────────────────────────────
// Each line item may carry ITS TABLE's slab % (section_gst / stone_gst). Items
// without one fall back to the invoice-level %, so pre-mig-199 invoices compute
// EXACTLY as before (single group == computeInvoiceTotals math, same rounding).
// In cgst_sgst mode a per-table slab splits half CGST / half SGST; the legacy
// fallback keeps the invoice's own (possibly asymmetric) cgst/sgst pair.

export type GstItem = { amount: number; gstPercent: number | null };

export type GstRateGroup = {
  /** Display slab (igst pct, or cgst+sgst total). */
  pct: number;
  igstPct: number;
  cgstPct: number;
  sgstPct: number;
  taxable: number;
  igstAmt: number;
  cgstAmt: number;
  sgstAmt: number;
  /** igstAmt + cgstAmt + sgstAmt for this slab. */
  taxAmt: number;
};

export type GroupedInvoiceTotals = InvoiceTotals & {
  /** One entry per distinct slab, ascending pct. Empty when mode is null. */
  groups: GstRateGroup[];
  /** True when the invoice mixes MORE THAN ONE slab (per-table GST in play). */
  multi: boolean;
};

export function computeGroupedGstTotals(
  items: GstItem[],
  gst: { mode: GstMode; igst: number; cgst: number; sgst: number },
): GroupedInvoiceTotals {
  const subtotal = round2(items.reduce((a, it) => a + (Number(it.amount) || 0), 0));
  if (gst.mode !== "igst" && gst.mode !== "cgst_sgst") {
    return { subtotal, igstAmt: 0, cgstAmt: 0, sgstAmt: 0, gstTotal: 0, grand: subtotal, groups: [], multi: false };
  }

  // Bucket the raw amounts by their effective slab (per-item % when stored,
  // else the invoice-level %). Keyed by the exact igst|cgst|sgst split so a
  // legacy asymmetric cgst/sgst pair stays its own group.
  const buckets = new Map<string, { igstPct: number; cgstPct: number; sgstPct: number; sum: number }>();
  for (const it of items) {
    const own = it.gstPercent != null && Number.isFinite(Number(it.gstPercent)) ? Number(it.gstPercent) : null;
    let igstPct = 0, cgstPct = 0, sgstPct = 0;
    if (gst.mode === "igst") {
      igstPct = own != null ? own : Number(gst.igst) || 0;
    } else {
      if (own != null) { cgstPct = own / 2; sgstPct = own / 2; }
      else { cgstPct = Number(gst.cgst) || 0; sgstPct = Number(gst.sgst) || 0; }
    }
    const key = `${igstPct}|${cgstPct}|${sgstPct}`;
    const b = buckets.get(key) ?? { igstPct, cgstPct, sgstPct, sum: 0 };
    b.sum += Number(it.amount) || 0;
    buckets.set(key, b);
  }

  // Round each group's taxable FIRST, then its tax — the same order the legacy
  // single-% path used, so a one-group invoice matches computeInvoiceTotals.
  const groups: GstRateGroup[] = [...buckets.values()]
    .map((b) => {
      const taxable = round2(b.sum);
      const igstAmt = round2((taxable * b.igstPct) / 100);
      const cgstAmt = round2((taxable * b.cgstPct) / 100);
      const sgstAmt = round2((taxable * b.sgstPct) / 100);
      return {
        pct: round2(b.igstPct + b.cgstPct + b.sgstPct),
        igstPct: b.igstPct, cgstPct: b.cgstPct, sgstPct: b.sgstPct,
        taxable, igstAmt, cgstAmt, sgstAmt,
        taxAmt: round2(igstAmt + cgstAmt + sgstAmt),
      };
    })
    .sort((a, b) => a.pct - b.pct);

  const igstAmt = round2(groups.reduce((a, g) => a + g.igstAmt, 0));
  const cgstAmt = round2(groups.reduce((a, g) => a + g.cgstAmt, 0));
  const sgstAmt = round2(groups.reduce((a, g) => a + g.sgstAmt, 0));
  const gstTotal = round2(igstAmt + cgstAmt + sgstAmt);
  return {
    subtotal, igstAmt, cgstAmt, sgstAmt, gstTotal,
    grand: round2(subtotal + gstTotal),
    groups,
    multi: groups.length > 1,
  };
}

/** "IGST @ 18%" / "CGST + SGST @ 9% + 9%" for ONE slab group. */
export function gstGroupLabel(mode: GstMode, g: GstRateGroup): string {
  if (mode === "igst") return `IGST @ ${g.igstPct}%`;
  if (mode === "cgst_sgst") return `CGST + SGST @ ${g.cgstPct}% + ${g.sgstPct}%`;
  return "—";
}

/** The % every table shares, or null when they differ / no items. Used to keep
 *  writing the legacy invoice-level *_percent columns when uniform (any reader
 *  not yet on the grouped helper stays correct for the common case). */
export function uniformGstPercent(pcts: Array<number | null | undefined>): number | null {
  if (pcts.length === 0) return null;
  const first = Number(pcts[0]);
  if (!Number.isFinite(first)) return null;
  return pcts.every((p) => Number(p) === first) ? first : null;
}

// ── Mig 200 — discount on the FINAL amount ──────────────────────────────────
// Applied AFTER GST, on the grand total (subtotal + tax): either a flat ₹
// amount or a % of the total. Default OFF. e.g. 100 taxable + 18 GST = 118;
// discount ₹18 → payable 100.

export type DiscountMode = "amount" | "percent" | null;

export type DiscountResult = {
  mode: DiscountMode;
  value: number;
  /** The ₹ knocked off (0 when off). */
  amt: number;
  /** What the customer actually pays — grand − discount, ROUNDED to a whole
   *  rupee when the invoice carries round_total (mig 220). */
  payable: number;
  /** grand − discount BEFORE rounding. Equals `payable` when rounding is off. */
  preRound: number;
  /** payable − preRound: the ± paise the "Round Off" line shows. 0 when off. */
  roundOff: number;
  /** True when this invoice's amount was rounded (mig 220). Drives whether the
   *  figure prints with paise or as a clean whole rupee. */
  rounded: boolean;
};

// ── Mig 220 — whole-rupee invoice value ─────────────────────────────────────
// HALF-DOWN, exactly as Daksh specified: 200.43 → 200, 200.50 → 200,
// 200.51 → 201. (Math.round would send 200.50 up to 201.) round2 first so
// float dust like 200.4999999997 can never tip the .50 boundary the wrong way.

/** Round an invoice amount to a whole rupee, ties DOWN. */
export function roundInvoiceAmount(n: number): number {
  const r = round2(Number(n) || 0);
  return r < 0 ? -Math.ceil(-r - 0.5) : Math.ceil(r - 0.5);
}

export function applyDiscount(
  grand: number,
  mode: string | null | undefined,
  value: number | null | undefined,
  /** The invoice's round_total (mig 220). Omitted / false → the exact
   *  pre-mig-220 result, so already-issued invoices never move. */
  roundTotal?: boolean | null,
): DiscountResult {
  const m: DiscountMode = mode === "amount" || mode === "percent" ? mode : null;
  const v = Math.max(0, Number(value) || 0);
  const g = round2(Number(grand) || 0);
  const rounded = roundTotal === true;
  /** Shared tail so the discount-off and discount-on branches round identically. */
  const withRound = (base: Omit<DiscountResult, "payable" | "preRound" | "roundOff" | "rounded">): DiscountResult => {
    const preRound = round2(g - base.amt);
    const payable = rounded ? roundInvoiceAmount(preRound) : preRound;
    return { ...base, preRound, payable, roundOff: round2(payable - preRound), rounded };
  };
  if (!m || v <= 0) return withRound({ mode: null, value: 0, amt: 0 });
  const amt = m === "percent" ? round2((g * v) / 100) : round2(Math.min(v, g));
  return withRound({ mode: m, value: v, amt });
}

/** "Less: Discount @ 10%" / "Less: Discount" for the totals rows. */
export function discountLabel(d: DiscountResult): string {
  return d.mode === "percent" ? `Less: Discount @ ${d.value}%` : "Less: Discount";
}
