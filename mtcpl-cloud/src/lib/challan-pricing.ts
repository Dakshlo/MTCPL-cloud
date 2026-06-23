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
