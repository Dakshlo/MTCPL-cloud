/**
 * Mig 177 — custom whole-piece bill print for a DROPPED challan. A4 portrait,
 * same look as the bulk tax invoice (Bill To / Ship To from the temple billing,
 * free line items, GST, totals, amount in words). Prints as a CHALLAN (keeps the
 * original CH number) until it's invoiced, then as a TAX INVOICE (INV number).
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import { notFound, redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { canUseInvoicing } from "@/lib/invoicing-permissions";
import { dash } from "@/lib/dispatch-grouping";
import { fetchTempleBilling } from "@/lib/temple-billing";
import { applyDiscount, computeGroupedGstTotals, discountLabel, gstGroupLabel, rupee, type GstMode } from "@/lib/challan-pricing";
import { invoiceCodeFromDoc, challanCode } from "@/lib/doc-code";
import { amountInWordsIN } from "@/lib/amount-words";
import { PrintBtn } from "./print-btn";

type Params = Promise<{ id: string }>;
type PartyShape = { name: string | null; address: string | null; city: string | null; state: string | null; state_code: string | null; gstin: string | null; pan: string | null; phone: string | null; email: string | null };

function Party({ label, name, p, fallback }: { label: string; name: string | null; p: PartyShape | null; fallback?: string }) {
  const loc = p ? [p.city, p.state, p.state_code ? `(code ${p.state_code})` : null].filter(Boolean).join(", ") : "";
  return (
    <div className="party">
      <div className="party-k">{label}</div>
      {name && <div className="party-name">{name}</div>}
      {p ? (
        <>
          {p.address && <div className="party-line">{p.address}</div>}
          {loc && <div className="party-line">{loc}</div>}
          {(p.gstin || p.pan) && <div className="party-meta">GSTIN: {dash(p.gstin)} · PAN: {dash(p.pan)}</div>}
          {(p.phone || p.email) && <div className="party-meta">{[p.phone, p.email].filter(Boolean).join(" · ")}</div>}
        </>
      ) : (
        <div className="party-line muted">{fallback ?? "-"}</div>
      )}
    </div>
  );
}
function fmt(n: number, dp = 2): string { return n.toLocaleString("en-IN", { minimumFractionDigits: dp, maximumFractionDigits: dp }); }

export const dynamic = "force-dynamic";

export default async function CustomBillPrintPage({ params }: { params: Params }) {
  const { profile } = await requireAuth();
  if (!canUseInvoicing(profile)) redirect("/");
  const { id } = await params;
  const admin = createAdminSupabaseClient();

  const { data: chRow } = await admin
    .from("challans")
    .select("id, challan_number, doc_fy, doc_seq, temple, challan_date, gst_mode, igst_percent, cgst_percent, sgst_percent, inv_fy, inv_seq, custom_billed_at, transport_company, transport_phone, lr_no, transport_vehicle_no, transport_driver_name, transport_driver_phone")
    .eq("id", id)
    .maybeSingle();
  const c = chRow as any;
  if (!c || !c.custom_billed_at) notFound();

  const { data: itemRows } = await admin.from("challan_custom_items").select("*").eq("challan_id", id).order("position");
  const items = (itemRows ?? []) as any[];

  const billing = await fetchTempleBilling(admin, c.temple);
  const billParty: PartyShape | null = billing
    ? { name: billing.name ?? c.temple ?? null, address: billing.address, city: billing.city, state: billing.state, state_code: billing.state_code, gstin: billing.gstin, pan: billing.pan, phone: billing.phone, email: billing.email }
    : c.temple ? { name: c.temple, address: null, city: null, state: null, state_code: null, gstin: null, pan: null, phone: null, email: null } : null;
  const shipParty: PartyShape | null = billing?.shipping ?? null;
  const billName = billParty?.name ?? c.temple ?? "—";
  const shipName = (shipParty?.name ?? "").trim() || billName;

  const converted = c.inv_seq != null;
  const docTitle = converted ? "TAX INVOICE" : "CHALLAN";
  const docNum = converted
    ? (invoiceCodeFromDoc(c.inv_fy, c.inv_seq) ?? c.challan_number)
    : (challanCode(c.doc_fy, c.doc_seq) ?? c.challan_number);

  const gstMode = (c.gst_mode === "igst" || c.gst_mode === "cgst_sgst" ? c.gst_mode : null) as GstMode;
  // Mig 199 — per-table slabs; pre-mig items (null section_gst) fall back to
  // the invoice-level %, so old invoices print exactly as before.
  const totals = computeGroupedGstTotals(
    items.map((it) => ({ amount: it.amount != null ? Number(it.amount) : (Number(it.quantity) || 0) * (Number(it.rate) || 0), gstPercent: it.section_gst != null ? Number(it.section_gst) : null })),
    { mode: gstMode, igst: Number(c.igst_percent) || 0, cgst: Number(c.cgst_percent) || 0, sgst: Number(c.sgst_percent) || 0 },
  );
  // Mig 200 — discount on the final amount (best-effort; pre-mig = off).
  let disc = applyDiscount(totals.grand, null, 0);
  {
    const { data: dc, error } = await admin.from("challans").select("discount_mode, discount_value").eq("id", id).maybeSingle();
    const d = dc as { discount_mode?: string | null; discount_value?: number | null } | null;
    if (!error && d) disc = applyDiscount(totals.grand, d.discount_mode ?? null, Number(d.discount_value) || 0);
  }

  return (
    <>
      <style>{`
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif; font-size: 11px; color: #1a1a1a; background: #f0f0f0; }
        * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        .wrap { max-width: 820px; margin: 0 auto; background: #fff; padding: 14px 18px 18px; position: relative; }
        .screen-bar { background: #1a1a1a; color: #fff; padding: 9px 28px; display: flex; align-items: center; justify-content: space-between; gap: 12px; max-width: 1180px; margin: 0 auto; }
        .screen-bar-title { font-size: 12px; color: rgba(255,255,255,0.65); }
        .doc-title { text-align: center; margin: 0 0 7px; }
        .doc-title span { display: inline-block; font-size: 17px; font-weight: 800; letter-spacing: 0.18em; color: #fff; background: #0f2540; border-radius: 6px; padding: 4px 24px; }
        .head { display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; gap: 14px; border-bottom: 2.5px double #1e3a5f; padding-bottom: 6px; }
        .head > div:last-child { justify-self: end; }
        .brand-logo { height: 68px; width: auto; }
        .company-block { text-align: center; min-width: 0; }
        .cn { font-size: 16px; font-weight: 800; color: #0f2540; white-space: nowrap; }
        .cl { font-size: 10.5px; color: #666; margin-top: 1.5px; line-height: 1.45; }
        .num { font-size: 17px; font-weight: 800; font-family: ui-monospace, monospace; text-align: right; margin-top: 2px; }
        .meta { text-align: right; margin-top: 3px; font-size: 10.5px; font-weight: 800; color: #1a1a1a; line-height: 1.5; }
        .meta-date { font-size: 12.5px; font-weight: 800; color: #0f2540; }
        .parties { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin: 8px 0 4px; }
        .party { border: 1px solid #ccc; border-radius: 6px; padding: 8px 10px; background: #f7fafc; }
        .party-k { font-size: 9px; font-weight: 800; letter-spacing: 0.08em; text-transform: uppercase; color: #888; margin-bottom: 2px; }
        .party-name { font-size: 14.5px; font-weight: 800; color: #1a1a1a; }
        .party-line { font-size: 11.5px; color: #333; margin-top: 1.5px; }
        .party-meta { font-size: 10.5px; color: #555; margin-top: 2px; font-family: ui-monospace, monospace; }
        .party .muted { color: #999; }
        table.t { width: 100%; border-collapse: collapse; font-size: 10.5px; margin-top: 6px; }
        table.t th { background: #eef2f7; padding: 4px 6px; text-align: left; font-size: 8.5px; font-weight: 800; color: #444; text-transform: uppercase; border: 1px solid #d3dae3; }
        table.t td { padding: 4px 6px; border: 1px solid #e2e7ee; vertical-align: top; font-weight: 700; color: #1a1a1a; }
        .t .r { text-align: right; white-space: nowrap; font-family: ui-monospace, monospace; }
        table.t tfoot td { font-weight: 800; background: #f3f6fa; border: 1px solid #d3dae3; }
        .t th.q { background: #c7ddf6; } .t td.q { background: #e6f0fb; }
        .t th.a { background: #ffe6a8; } .t td.a { background: #fff7e0; }
        .totbox { display: flex; justify-content: space-between; align-items: flex-start; gap: 24px; margin-top: 10px; }
        .terms { flex: 1 1 auto; max-width: 58%; }
        .terms-title { font-size: 9.5px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.06em; color: #0f2540; margin-bottom: 3px; }
        .terms-list { margin: 0; padding-left: 15px; }
        .terms-list li { font-size: 9px; color: #444; line-height: 1.5; }
        .totals { min-width: 280px; flex: 0 0 auto; border: 1px solid #d3dae3; border-radius: 8px; overflow: hidden; }
        .totals .row { display: flex; justify-content: space-between; gap: 24px; padding: 5px 14px; font-size: 11.5px; }
        .totals .row.alt { background: #f7fafc; }
        .totals .row.grand { background: #0f2540; color: #fff; font-weight: 800; font-size: 14px; padding: 8px 14px; }
        .totals .mono { font-family: ui-monospace, monospace; }
        .taxsum { width: 100%; border-collapse: collapse; font-size: 10.5px; margin-top: 12px; }
        .taxsum th { background: #eef2f7; border: 1px solid #d3dae3; padding: 5px 9px; text-align: left; font-size: 8.5px; font-weight: 800; text-transform: uppercase; color: #444; }
        .taxsum td { border: 1px solid #d3dae3; padding: 6px 9px; font-weight: 700; }
        .taxsum td.mono { font-family: ui-monospace, monospace; text-align: right; }
        .amt-words { margin-top: 7px; font-size: 11.5px; color: #1a1a1a; border: 1px solid #d3dae3; border-radius: 6px; padding: 7px 11px; background: #f7fafc; }
        .signoff { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; margin-top: 24px; }
        .sign { border-top: 1.5px solid #888; padding-top: 5px; font-size: 9px; color: #888; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; }
        .sign .sub { font-size: 10px; color: #444; margin-top: 2px; text-transform: none; letter-spacing: 0; font-weight: 600; }
        @media print {
          body { background: #fff; }
          .screen-bar { display: none !important; }
          .wrap { max-width: none; padding: 0 2mm; margin: 0; }
          table.t thead { display: table-header-group; }
          table.t tr { page-break-inside: avoid; }
          .signoff, .totbox, .taxsum { page-break-inside: avoid; }
          @page { size: A4 portrait; margin: 9mm; }
        }
        @media screen { body { padding: 0; } }
      `}</style>

      <div className="screen-bar">
        <span className="screen-bar-title">{docTitle} — {docNum} · {billName} · A4 portrait</span>
        <PrintBtn />
      </div>

      <div className="wrap">
        <div className="doc-title"><span>{docTitle}</span></div>
        <div className="head">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-mtcpl.png" alt="MTCPL" className="brand-logo" />
          <div className="company-block">
            <div className="cn">MATESHWARI TEMPLE CONSTRUCTION PVT LTD</div>
            <div className="cl">G-109, RIICO Ind. Area, Sirohi Road, Teh. Pindwara, Dist. Sirohi, Rajasthan</div>
            <div className="cl">GSTIN: 08AAFCM15Q1ZA · ☎ 80941 56965 · temple@mtcpl.co</div>
          </div>
          <div>
            <div className="num">{docNum}</div>
            <div className="meta">
              <div className="meta-date">{new Date(`${c.challan_date}T00:00:00+05:30`).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric" })}</div>
            </div>
          </div>
        </div>

        <div className="parties">
          <Party label="Bill To" name={billName} p={billParty} />
          <Party label="Ship To" name={shipName} p={shipParty} fallback="Same as billing address" />
        </div>

        {(c.transport_company || c.transport_vehicle_no || c.transport_driver_name || c.lr_no) && (
          <div style={{ fontSize: 10.5, color: "#0f2540", margin: "8px 0 4px", fontWeight: 700, background: "#eef5fd", border: "1px solid #c7ddf6", borderRadius: 6, padding: "6px 10px" }}>
            🚚 Transport: {[c.transport_company, c.lr_no ? `LR ${c.lr_no}` : "", c.transport_vehicle_no, c.transport_driver_name, c.transport_driver_phone].filter(Boolean).join("  ·  ")}
          </div>
        )}

        {items.length === 0 ? (
          <p style={{ color: "#888", fontSize: 11, marginTop: 12 }}>No line items.</p>
        ) : (
          <>
            <table className="t">
              <thead>
                <tr>
                  <th style={{ width: 22 }}>#</th>
                  <th>Item / Particulars</th>
                  <th style={{ width: 80 }}>HSN</th>
                  <th style={{ width: 56 }}>Unit</th>
                  <th className="r q" style={{ width: 56 }}>Qty</th>
                  <th className="r q" style={{ width: 80 }}>Rate</th>
                  <th className="r a" style={{ width: 96 }}>Amount</th>
                </tr>
              </thead>
              <tbody>
                {items.map((it, i) => {
                  const amt = it.amount != null ? Number(it.amount) : (Number(it.quantity) || 0) * (Number(it.rate) || 0);
                  return (
                    <tr key={it.id ?? i}>
                      <td>{i + 1}</td>
                      <td style={{ textTransform: "uppercase" }}>{dash(it.particulars)}</td>
                      <td style={{ fontFamily: "ui-monospace, monospace" }}>{dash(it.hsn)}</td>
                      <td>{dash(it.unit)}</td>
                      <td className="r q">{it.quantity != null ? fmt(Number(it.quantity)) : "-"}</td>
                      <td className="r q">{it.rate != null ? fmt(Number(it.rate)) : "-"}</td>
                      <td className="r a">{rupee(amt)}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr><td colSpan={6} className="r" style={{ textAlign: "right" }}>Subtotal</td><td className="r">{rupee(totals.subtotal)}</td></tr>
              </tfoot>
            </table>

            <div className="totbox">
              <div className="terms">
                <div className="terms-title">Terms &amp; Conditions</div>
                <ol className="terms-list">
                  <li>Goods once sold will not be taken back.</li>
                  <li>Interest will be charged @ 24% p.a. from the date of bill.</li>
                  <li>All disputes are subject to PINDWARA jurisdiction only.</li>
                  <li>We are not responsible for any shortage or damage after the goods leaves our godown.</li>
                </ol>
              </div>
              <div className="totals">
                <div className="row"><span>Subtotal</span><span className="mono">{rupee(totals.subtotal)}</span></div>
                {totals.groups.map((g, i) => (
                  <div key={i} className="row alt"><span>{gstGroupLabel(gstMode, g)}{totals.multi ? ` on ${rupee(g.taxable)}` : ""}</span><span className="mono">{rupee(g.taxAmt)}</span></div>
                ))}
                {disc.amt > 0 ? (
                  <>
                    <div className="row"><span>Grand Total</span><span className="mono">{rupee(totals.grand)}</span></div>
                    <div className="row alt"><span>{discountLabel(disc)}</span><span className="mono">−{rupee(disc.amt)}</span></div>
                    <div className="row grand"><span>Amount Payable</span><span className="mono">{rupee(disc.payable)}</span></div>
                  </>
                ) : (
                  <div className="row grand"><span>Grand Total</span><span className="mono">{rupee(totals.grand)}</span></div>
                )}
              </div>
            </div>

            <table className="taxsum">
              <thead><tr><th>Taxable Amount</th><th>GST</th><th>Total Tax</th><th>{docTitle === "TAX INVOICE" ? "Invoice" : "Challan"} Total</th></tr></thead>
              <tbody>
                {totals.groups.length === 0 ? (
                  <tr><td className="mono">{rupee(totals.subtotal)}</td><td>—</td><td className="mono">{rupee(0)}</td><td className="mono">{rupee(disc.payable)}</td></tr>
                ) : (
                  totals.groups.map((g, i) => (
                    <tr key={i}>
                      <td className="mono">{rupee(g.taxable)}</td>
                      <td>{gstGroupLabel(gstMode, g)}</td>
                      <td className="mono">{rupee(g.taxAmt)}</td>
                      {i === 0 && <td className="mono" rowSpan={totals.groups.length} style={{ verticalAlign: "middle", fontWeight: 800 }}>{rupee(disc.payable)}</td>}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
            <div className="amt-words"><strong>Amount in words:</strong> {amountInWordsIN(disc.payable)}</div>
          </>
        )}

        <div className="signoff">
          <div className="sign">Customer Signature<div className="sub">{dash(billName)}</div></div>
          <div className="sign" style={{ textAlign: "right" }}>For MTCPL · Authorised Signatory<div className="sub">&nbsp;</div></div>
        </div>
      </div>
    </>
  );
}
