"use client";

/**
 * Bulk invoice live PREVIEW (Daksh) — renders the tax invoice from the UNSAVED
 * create-form state inside a modal, mirroring the real bulk print
 * (/invoicing/bulk/[id]/print): company header, Bill To / Ship To, covered
 * challans, line items, totals + tax summary + amount in words, signatures, and
 * the "NOT VALID INVOICE" watermark (it's a draft until the owner approves).
 */

import { computeInvoiceTotals, rupee, type GstMode } from "@/lib/challan-pricing";
import { amountInWordsIN } from "@/lib/amount-words";

export type PreviewParty = {
  name: string | null; address: string | null; city: string | null; state: string | null;
  state_code: string | null; gstin: string | null; pan: string | null; phone: string | null; email: string | null;
};
export type PreviewItem = { particulars: string; hsn: string; unit: string; quantity: number; rate: number; amount: number };

const dash = (s: string | null | undefined) => (s && String(s).trim() ? String(s) : "-");
const fmt = (n: number, dp = 2) => n.toLocaleString("en-IN", { minimumFractionDigits: dp, maximumFractionDigits: dp });

function Party({ label, name, p, vendorCode, workOrderNo, fallback }: { label: string; name: string | null; p: PreviewParty | null; vendorCode?: string | null; workOrderNo?: string | null; fallback?: string }) {
  const loc = p ? [p.city, p.state, p.state_code ? `(code ${p.state_code})` : null].filter(Boolean).join(", ") : "";
  return (
    <div className="bip-party">
      <div className="bip-k">{label}</div>
      {name && <div className="bip-name">{name}</div>}
      {p ? (
        <>
          {p.address && <div className="bip-line">{p.address}</div>}
          {loc && <div className="bip-line">{loc}</div>}
          {(p.gstin || p.pan) && <div className="bip-meta">GSTIN: {dash(p.gstin)} · PAN: {dash(p.pan)}</div>}
          {(p.phone || p.email) && <div className="bip-meta">{[p.phone, p.email].filter(Boolean).join(" · ")}</div>}
          {(vendorCode || workOrderNo) && (
            <div className="bip-meta">{[vendorCode ? `Vendor: ${vendorCode}` : null, workOrderNo ? `W/O: ${workOrderNo}` : null].filter(Boolean).join(" · ")}</div>
          )}
        </>
      ) : (
        <div className="bip-line" style={{ color: "#999" }}>{fallback ?? "-"}</div>
      )}
    </div>
  );
}

export function BulkInvoicePreview({
  bill, ship, vendorCode, workOrderNo, coveredCodes, items,
  mode, igst, cgst, sgst, invoiceNo, invoiceDate, onClose,
}: {
  bill: PreviewParty | null;
  ship: PreviewParty | null;
  vendorCode: string | null;
  workOrderNo: string | null;
  coveredCodes: string[];
  items: PreviewItem[];
  mode: GstMode; igst: number; cgst: number; sgst: number;
  invoiceNo: string;
  invoiceDate: string;
  onClose: () => void;
}) {
  const billName = bill?.name ?? "—";
  const shipName = (ship?.name ?? "").trim() || billName;
  const totals = computeInvoiceTotals(items.map((i) => i.amount), { mode, igst, cgst, sgst });
  const totalTax = mode === "igst" ? totals.igstAmt : mode === "cgst_sgst" ? totals.cgstAmt + totals.sgstAmt : 0;
  const gstLabel = mode === "igst" ? `IGST @ ${igst || 0}%` : mode === "cgst_sgst" ? `CGST + SGST @ ${cgst || 0}% + ${sgst || 0}%` : "—";
  const code = invoiceNo.trim() || "INV — assigned on approval";

  return (
    <div
      onClick={onClose}
      // Anchor to the content area (right of the sidebar) via --content-left so the
      // peek centers over the page, not the whole screen (Daksh).
      style={{ position: "fixed", top: 0, right: 0, bottom: 0, left: "var(--content-left)", zIndex: 70, background: "rgba(15,23,42,0.55)", display: "flex", flexDirection: "column", alignItems: "center", padding: "18px 12px", overflowY: "auto" }}
    >
      <style>{`
        .bip-bar { width: min(840px, 100%); display: flex; align-items: center; justify-content: space-between; gap: 12px; color: #fff; margin-bottom: 10px; }
        .bip-sheet { width: min(840px, 100%); background: #fff; color: #1a1a1a; border-radius: 8px; padding: 18px 22px 22px; position: relative; overflow: hidden; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif; font-size: 11px; }
        .bip-wm { position: absolute; inset: 0; z-index: 5; pointer-events: none; overflow: hidden; display: grid; grid-template-columns: repeat(4, 1fr); align-content: space-evenly; justify-items: center; padding: 26px 0; }
        .bip-wm span { transform: rotate(-30deg); white-space: nowrap; font: 800 15px/1 Arial, sans-serif; color: #d40000; opacity: 0.16; }
        .bip-doc { text-align: center; margin: 0 0 7px; position: relative; z-index: 6; }
        .bip-doc span { display: inline-block; font-size: 17px; font-weight: 800; letter-spacing: 0.18em; color: #fff; background: #0f2540; border-radius: 6px; padding: 4px 24px; }
        .bip-head { display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; gap: 14px; border-bottom: 2.5px double #1e3a5f; padding-bottom: 6px; position: relative; z-index: 6; }
        .bip-head > div:last-child { justify-self: end; }
        .bip-logo { height: 60px; width: auto; }
        .bip-cn { font-size: 15.5px; font-weight: 800; color: #0f2540; white-space: nowrap; text-align: center; }
        .bip-cl { font-size: 10px; color: #666; margin-top: 1.5px; line-height: 1.45; text-align: center; }
        .bip-num { font-size: 15px; font-weight: 800; font-family: ui-monospace, monospace; text-align: right; }
        .bip-date { font-size: 12px; font-weight: 800; color: #0f2540; text-align: right; margin-top: 3px; }
        .bip-parties { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin: 8px 0 4px; position: relative; z-index: 6; }
        .bip-party { border: 1px solid #ccc; border-radius: 6px; padding: 8px 10px; background: #f7fafc; }
        .bip-k { font-size: 9px; font-weight: 800; letter-spacing: 0.08em; text-transform: uppercase; color: #888; margin-bottom: 2px; }
        .bip-name { font-size: 14px; font-weight: 800; color: #1a1a1a; }
        .bip-line { font-size: 11px; color: #333; margin-top: 1.5px; }
        .bip-meta { font-size: 10px; color: #555; margin-top: 2px; font-family: ui-monospace, monospace; }
        .bip-covers { font-size: 10.5px; color: #0f2540; margin: 8px 0 4px; font-weight: 800; position: relative; z-index: 6; background: #eef5fd; border: 1px solid #c7ddf6; border-radius: 6px; padding: 6px 10px; }
        table.bip-t { width: 100%; border-collapse: collapse; font-size: 10.5px; margin-top: 6px; position: relative; z-index: 6; }
        table.bip-t th { background: #eef2f7; padding: 4px 6px; text-align: left; font-size: 8.5px; font-weight: 800; color: #444; text-transform: uppercase; border: 1px solid #d3dae3; }
        table.bip-t td { padding: 4px 6px; border: 1px solid #e2e7ee; vertical-align: top; font-weight: 700; color: #1a1a1a; }
        .bip-t .r { text-align: right; white-space: nowrap; font-family: ui-monospace, monospace; }
        table.bip-t tfoot td { font-weight: 800; background: #f3f6fa; border: 1px solid #d3dae3; }
        /* Excel-style colour: Qty + Rate = blue, Amount = amber (Daksh). */
        .bip-t th.bip-q { background: #c7ddf6; } .bip-t td.bip-q { background: #e6f0fb; }
        .bip-t th.bip-a { background: #ffe6a8; } .bip-t td.bip-a { background: #fff7e0; }
        .bip-totbox { display: flex; justify-content: space-between; align-items: flex-start; gap: 24px; margin-top: 10px; position: relative; z-index: 6; }
        .bip-terms { flex: 1 1 auto; max-width: 58%; }
        .bip-terms-title { font-size: 9.5px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.06em; color: #0f2540; margin-bottom: 3px; }
        .bip-terms ol { margin: 0; padding-left: 15px; }
        .bip-terms li { font-size: 9px; color: #444; line-height: 1.5; }
        .bip-totals { min-width: 260px; flex: 0 0 auto; border: 1px solid #d3dae3; border-radius: 8px; overflow: hidden; }
        .bip-row { display: flex; justify-content: space-between; gap: 24px; padding: 5px 14px; font-size: 11.5px; }
        .bip-row.alt { background: #f7fafc; }
        .bip-row.grand { background: #0f2540; color: #fff; font-weight: 800; font-size: 14px; padding: 8px 14px; }
        .bip-mono { font-family: ui-monospace, monospace; }
        .bip-taxsum { width: 100%; border-collapse: collapse; font-size: 10.5px; margin-top: 12px; position: relative; z-index: 6; }
        .bip-taxsum th { background: #eef2f7; border: 1px solid #d3dae3; padding: 5px 9px; text-align: left; font-size: 8.5px; font-weight: 800; text-transform: uppercase; color: #444; }
        .bip-taxsum td { border: 1px solid #d3dae3; padding: 6px 9px; font-weight: 700; }
        .bip-taxsum td.m { font-family: ui-monospace, monospace; text-align: right; }
        .bip-words { margin-top: 7px; font-size: 11.5px; color: #1a1a1a; border: 1px solid #d3dae3; border-radius: 6px; padding: 7px 11px; background: #f7fafc; position: relative; z-index: 6; }
        .bip-sign { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; margin-top: 22px; position: relative; z-index: 6; }
        .bip-sign .c { border-top: 1.5px solid #888; padding-top: 5px; font-size: 9px; color: #888; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; }
        .bip-sign .sub { font-size: 10px; color: #444; margin-top: 2px; text-transform: none; letter-spacing: 0; font-weight: 600; }
      `}</style>

      <div className="bip-bar" onClick={(e) => e.stopPropagation()}>
        <span style={{ fontSize: 13, fontWeight: 700 }}>👁 Invoice preview <span style={{ opacity: 0.7, fontWeight: 500 }}>· draft, not yet submitted</span></span>
        <button type="button" onClick={onClose} style={{ fontSize: 13, fontWeight: 800, padding: "8px 16px", borderRadius: 9, border: "1px solid rgba(255,255,255,0.4)", background: "rgba(255,255,255,0.12)", color: "#fff", cursor: "pointer" }}>✕ Close</button>
      </div>

      <div className="bip-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="bip-wm" aria-hidden="true">
          {Array.from({ length: 24 }).map((_, i) => <span key={i}>NOT VALID INVOICE</span>)}
        </div>

        <div className="bip-doc"><span>TAX INVOICE</span></div>
        <div className="bip-head">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-mtcpl.png" alt="MTCPL" className="bip-logo" />
          <div>
            <div className="bip-cn">MATESHWARI TEMPLE CONSTRUCTION PVT LTD</div>
            <div className="bip-cl">G-109, RIICO Ind. Area, Sirohi Road, Teh. Pindwara, Dist. Sirohi, Rajasthan</div>
            <div className="bip-cl">GSTIN: 08AAFCM15Q1ZA · ☎ XXXXXXXXXX · temple@mtcpl.co</div>
          </div>
          <div>
            <div className="bip-num">{code}</div>
            <div className="bip-date">{new Date(`${invoiceDate}T00:00:00+05:30`).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric" })}</div>
          </div>
        </div>

        <div className="bip-parties">
          <Party label="Bill To" name={billName} p={bill} vendorCode={vendorCode} workOrderNo={workOrderNo} />
          <Party label="Ship To" name={shipName} p={ship} fallback="Same as billing address" />
        </div>
        {coveredCodes.length > 0 && <div className="bip-covers">Against delivery challan(s): {coveredCodes.map((c) => `(${c})`).join(" ")}</div>}

        {items.length === 0 ? (
          <p style={{ color: "#888", fontSize: 11, marginTop: 12, position: "relative", zIndex: 6 }}>No line items yet.</p>
        ) : (
          <>
            <table className="bip-t">
              <thead>
                <tr>
                  <th style={{ width: 22 }}>#</th>
                  <th>Item / Particulars</th>
                  <th style={{ width: 80 }}>HSN</th>
                  <th style={{ width: 56 }}>Unit</th>
                  <th className="r bip-q" style={{ width: 56 }}>Qty</th>
                  <th className="r bip-q" style={{ width: 80 }}>Rate</th>
                  <th className="r bip-a" style={{ width: 96 }}>Amount</th>
                </tr>
              </thead>
              <tbody>
                {items.map((it, i) => (
                  <tr key={i}>
                    <td>{i + 1}</td>
                    <td>{dash(it.particulars)}</td>
                    <td style={{ fontFamily: "ui-monospace, monospace" }}>{dash(it.hsn)}</td>
                    <td>{dash(it.unit)}</td>
                    <td className="r bip-q">{it.quantity ? fmt(it.quantity) : "-"}</td>
                    <td className="r bip-q">{it.rate ? fmt(it.rate) : "-"}</td>
                    <td className="r bip-a">{rupee(it.amount)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr><td colSpan={6} className="r" style={{ textAlign: "right" }}>Subtotal</td><td className="r">{rupee(totals.subtotal)}</td></tr>
              </tfoot>
            </table>

            <div className="bip-totbox">
              <div className="bip-terms">
                <div className="bip-terms-title">Terms &amp; Conditions</div>
                <ol>
                  <li>Goods once sold will not be taken back.</li>
                  <li>Interest will be charged @ 24% p.a. from the date of bill.</li>
                  <li>All disputes are subject to PINDWARA jurisdiction only.</li>
                  <li>We are not responsible for any shortage or damage after the goods leaves our godown.</li>
                </ol>
              </div>
              <div className="bip-totals">
                <div className="bip-row"><span>Subtotal</span><span className="bip-mono">{rupee(totals.subtotal)}</span></div>
                {mode === "igst" && <div className="bip-row alt"><span>IGST @ {igst || 0}%</span><span className="bip-mono">{rupee(totals.igstAmt)}</span></div>}
                {mode === "cgst_sgst" && (<><div className="bip-row alt"><span>CGST @ {cgst || 0}%</span><span className="bip-mono">{rupee(totals.cgstAmt)}</span></div><div className="bip-row alt"><span>SGST @ {sgst || 0}%</span><span className="bip-mono">{rupee(totals.sgstAmt)}</span></div></>)}
                <div className="bip-row grand"><span>Grand Total</span><span className="bip-mono">{rupee(totals.grand)}</span></div>
              </div>
            </div>

            <table className="bip-taxsum">
              <thead><tr><th>Taxable Amount</th><th>GST</th><th>Total Tax</th><th>Invoice Total</th></tr></thead>
              <tbody><tr><td className="m">{rupee(totals.subtotal)}</td><td>{gstLabel}</td><td className="m">{rupee(totalTax)}</td><td className="m">{rupee(totals.grand)}</td></tr></tbody>
            </table>
            <div className="bip-words"><strong>Amount in words:</strong> {amountInWordsIN(totals.grand)}</div>
          </>
        )}

        <div className="bip-sign">
          <div className="c">Customer Signature<div className="sub">{dash(billName)}</div></div>
          <div className="c" style={{ textAlign: "right" }}>For MTCPL · Authorised Signatory<div className="sub">&nbsp;</div></div>
        </div>
      </div>
    </div>
  );
}
