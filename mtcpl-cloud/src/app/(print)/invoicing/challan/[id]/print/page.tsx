/**
 * Tax invoice from a priced challan (Mig 157) — A4 LANDSCAPE.
 *
 * Same wide grid as the dispatch challan plus Rate + Amount, CFT and SFT rows
 * in separate tables, then subtotal + GST (IGST or CGST+SGST) + grand total.
 * Blanks print "-".
 */

import { notFound, redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { canUseInvoicing } from "@/lib/invoicing-permissions";
import { dash } from "@/lib/dispatch-grouping";
import { fetchTempleBilling } from "@/lib/temple-billing";
import { computeInvoiceTotals, rupee, type GstMode } from "@/lib/challan-pricing";
import { invoiceCode } from "@/lib/invoice-code";
import { PrintBtn } from "./print-btn";

// Code column: show at most 2 slab codes per line so a row with many codes
// doesn't blow out the (portrait) width.
function CodeCell({ codes }: { codes: string | null }) {
  const list = (codes ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (list.length === 0) return <>-</>;
  const lines: string[] = [];
  for (let i = 0; i < list.length; i += 2) lines.push(list.slice(i, i + 2).join(", "));
  return <>{lines.map((ln, i) => (<span key={i}>{ln}{i < lines.length - 1 ? <br /> : null}</span>))}</>;
}

type Params = Promise<{ id: string }>;

type Item = {
  id: string;
  codes: string | null;
  label: string | null;
  description: string | null;
  additional_description: string | null;
  component_section: string | null;
  component_element: string | null;
  length_ft: number | null;
  width_ft: number | null;
  thickness_ft: number | null;
  quantity: number | null;
  weight_tonnes: number | null;
  unit: string | null;
  measure_unit: string | null;
  measure_qty: number | null;
  rate: number | null;
  amount: number | null;
};

function fmt(n: number, dp = 2): string {
  return n.toLocaleString("en-IN", { minimumFractionDigits: dp, maximumFractionDigits: dp });
}

export default async function InvoicePrintPage({ params }: { params: Params }) {
  const { profile } = await requireAuth();
  if (!canUseInvoicing(profile)) redirect("/");
  const { id } = await params;
  const admin = createAdminSupabaseClient();

  const [{ data: challan }, { data: itemRows }] = await Promise.all([
    admin
      .from("challans")
      .select(
        "id, challan_number, challan_date, notes, source_dispatch_id, temple, gst_mode, igst_percent, cgst_percent, sgst_percent, priced_at, invoice_parties(name, gstin, address, phone)",
      )
      .eq("id", id)
      .maybeSingle(),
    admin
      .from("challan_items")
      .select(
        "id, position, codes, label, description, additional_description, component_section, component_element, length_ft, width_ft, thickness_ft, quantity, weight_tonnes, unit, measure_unit, measure_qty, rate, amount",
      )
      .eq("challan_id", id)
      .order("position"),
  ]);
  if (!challan) notFound();
  const c = challan as {
    id: string;
    challan_number: string;
    challan_date: string;
    notes: string | null;
    source_dispatch_id: string | null;
    gst_mode: string | null;
    igst_percent: number | null;
    cgst_percent: number | null;
    sgst_percent: number | null;
    priced_at: string | null;
    temple: string | null;
    invoice_parties:
      | { name: string; gstin: string | null; address: string | null; phone: string | null }
      | Array<{ name: string; gstin: string | null; address: string | null; phone: string | null }>
      | null;
  };
  // Mig 158 — bill-to = the temple. Fall back to a legacy party for pre-158 challans.
  const party = c.invoice_parties ? (Array.isArray(c.invoice_parties) ? c.invoice_parties[0] : c.invoice_parties) : null;
  const billing = c.temple
    ? await fetchTempleBilling(admin, c.temple)
    : party
    ? { name: party.name, gstin: party.gstin, pan: null, address: party.address, email: null, phone: party.phone }
    : null;
  const items = (itemRows ?? []) as Item[];

  const unitOf = (it: Item): "cft" | "sft" => ((it.measure_unit || it.unit) === "sft" ? "sft" : "cft");
  const measureOf = (it: Item) => (it.measure_qty != null && Number(it.measure_qty) > 0 ? Number(it.measure_qty) : Number(it.quantity) || 0);
  const amountOf = (it: Item) => (it.amount != null ? Number(it.amount) : (Number(it.rate) || 0) * measureOf(it));
  // Tax-invoice number (Daksh) — the priced challan IS the invoice, so present
  // it as INV-YYYY-N instead of the internal challan CH-YYYY-N code.
  const invCode = invoiceCode(c.challan_number, c.challan_date);

  // Stone per item — derived from its slab codes (challan_items has no stone
  // column). One lookup for all codes; a group is single-stone so its first
  // code's stone represents it. Works for old + new challans, no migration.
  const codeStone = new Map<string, string>();
  const allCodes = [...new Set(items.flatMap((it) => (it.codes ?? "").split(",").map((s) => s.trim()).filter(Boolean)))];
  for (let i = 0; i < allCodes.length; i += 300) {
    const chunk = allCodes.slice(i, i + 300);
    if (chunk.length === 0) break;
    const { data: sr } = await admin.from("slab_requirements").select("id, stone").in("id", chunk);
    for (const s of (sr ?? []) as Array<{ id: string; stone: string | null }>) codeStone.set(s.id, (s.stone ?? "").trim());
  }
  const stoneOf = (it: Item): string => {
    const first = (it.codes ?? "").split(",").map((s) => s.trim()).filter(Boolean)[0];
    return (first && codeStone.get(first)) || "—";
  };
  // Group items stone-wise (alphabetical); CFT + SFT sub-tables within each.
  const stoneGroups = (() => {
    const m = new Map<string, Item[]>();
    for (const it of items) { const s = stoneOf(it); const arr = m.get(s) ?? []; arr.push(it); m.set(s, arr); }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  })();

  const totals = computeInvoiceTotals(items.map(amountOf), {
    mode: (c.gst_mode === "igst" || c.gst_mode === "cgst_sgst" ? c.gst_mode : null) as GstMode,
    igst: Number(c.igst_percent) || 0,
    cgst: Number(c.cgst_percent) || 0,
    sgst: Number(c.sgst_percent) || 0,
  });

  const printDate = new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

  const Section = ({ rows, unit }: { rows: Item[]; unit: "cft" | "sft" }) => {
    if (rows.length === 0) return null;
    const sub = rows.reduce((a, it) => a + amountOf(it), 0);
    const measTotal = rows.reduce((a, it) => a + measureOf(it), 0);
    const qtyTotal = rows.reduce((a, it) => a + (Number(it.quantity) || 0), 0);
    return (
      <>
        <div className="grp-title">{unit === "cft" ? "CFT · volume billed" : "SFT · area billed"}</div>
        <table className="t">
          <thead>
            <tr>
              <th style={{ width: 20 }}>#</th>
              <th>Code(s)</th>
              <th>Label</th>
              <th>Description</th>
              <th>Additional</th>
              <th>Cat 2</th>
              <th>Cat 1</th>
              <th className="r">L</th>
              <th className="r">W</th>
              <th className="r">H</th>
              <th className="r">Qty</th>
              <th className="r">{unit.toUpperCase()}</th>
              <th className="r">Rate</th>
              <th className="r">Amount</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((it, i) => (
              <tr key={it.id}>
                <td className="muted">{i + 1}</td>
                <td className="mono"><CodeCell codes={it.codes} /></td>
                <td>{dash(it.label)}</td>
                <td>{dash(it.description)}</td>
                <td>{dash(it.additional_description)}</td>
                <td>{dash(it.component_element)}</td>
                <td>{dash(it.component_section)}</td>
                <td className="r mono">{it.length_ft ?? "-"}</td>
                <td className="r mono">{it.width_ft ?? "-"}</td>
                <td className="r mono">{it.thickness_ft ?? "-"}</td>
                <td className="r mono b">{Number(it.quantity) || 0}</td>
                <td className="r mono">{fmt(measureOf(it))}</td>
                <td className="r mono">{fmt(Number(it.rate) || 0)}</td>
                <td className="r mono b">{rupee(amountOf(it))}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={10} className="r">Total {unit.toUpperCase()}</td>
              <td className="r mono b">{qtyTotal}</td>
              <td className="r mono b">{fmt(measTotal)}</td>
              <td></td>
              <td className="r mono b">{rupee(sub)}</td>
            </tr>
          </tfoot>
        </table>
      </>
    );
  };

  return (
    <>
      <style>{`
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif; font-size: 11px; color: #1a1a1a; background: #f0f0f0; }
        .wrap { max-width: 820px; margin: 0 auto; background: #fff; padding: 14px 18px 18px; }
        .screen-bar { background: #1a1a1a; color: #fff; padding: 9px 28px; display: flex; align-items: center; justify-content: space-between; gap: 12px; max-width: 1180px; margin: 0 auto; }
        .screen-bar-title { font-size: 12px; color: rgba(255,255,255,0.65); }
        .head { display: flex; justify-content: space-between; align-items: flex-start; gap: 14px; border-bottom: 2.5px double #1e3a5f; padding-bottom: 8px; }
        .brand-logo { height: 56px; }
        .cn { font-size: 16px; font-weight: 800; color: #0f2540; }
        .cl { font-size: 9.5px; color: #666; margin-top: 2px; line-height: 1.5; }
        .pill { font-size: 13px; font-weight: 800; color: #0f2540; letter-spacing: 0.1em; text-transform: uppercase; border: 2px solid #1e3a5f; border-radius: 6px; padding: 4px 14px; background: #eef3f9; white-space: nowrap; }
        .num { font-size: 18px; font-weight: 800; font-family: ui-monospace, monospace; text-align: right; margin-top: 4px; }
        .dt { font-size: 9px; color: #888; text-align: right; }
        .info { display: grid; grid-template-columns: repeat(4, 1fr); gap: 3px 16px; margin: 8px 0 4px; border: 1px solid #ccc; border-radius: 6px; padding: 7px 10px; background: #f7fafc; }
        .info .k { font-size: 7.5px; font-weight: 800; letter-spacing: 0.06em; text-transform: uppercase; color: #999; }
        .info .v { font-size: 11px; font-weight: 700; color: #1a1a1a; line-height: 1.35; }
        .info .v.big { font-size: 13px; font-weight: 800; }
        .info .mono { font-family: ui-monospace, monospace; }
        .doc-title { text-align: center; font-size: 19px; font-weight: 800; letter-spacing: 0.18em; color: #0f2540; margin: 2px 0 8px; }
        .stone-block { margin-top: 4px; }
        .stone-title { font-size: 11.5px; font-weight: 800; color: #0f2540; background: #eef2f7; border-left: 3px solid #1e3a5f; padding: 4px 9px; margin: 12px 0 2px; border-radius: 3px; break-after: avoid; }
        .grp-title { font-size: 9.5px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.08em; color: #0f2540; margin: 10px 0 3px; }
        table.t { width: 100%; border-collapse: collapse; font-size: 8.5px; }
        table.t th { background: #eef2f7; padding: 2px 4px; text-align: left; font-size: 7px; font-weight: 800; color: #444; text-transform: uppercase; letter-spacing: 0.02em; border: 1px solid #d3dae3; }
        table.t td { padding: 2px 4px; border: 1px solid #e2e7ee; vertical-align: top; font-weight: 700; color: #1a1a1a; word-break: break-word; }
        table.t tfoot td { font-weight: 800; background: #f3f6fa; border: 1px solid #d3dae3; }
        .t .r { text-align: right; } .t .mono { font-family: ui-monospace, monospace; } .t .b { font-weight: 800; } .t .muted { color: #999; }
        .totbox { display: flex; justify-content: flex-end; margin-top: 10px; }
        .totals { min-width: 280px; border: 1px solid #d3dae3; border-radius: 8px; overflow: hidden; }
        .totals .row { display: flex; justify-content: space-between; gap: 24px; padding: 5px 14px; font-size: 11.5px; }
        .totals .row.alt { background: #f7fafc; }
        .totals .row.grand { background: #0f2540; color: #fff; font-weight: 800; font-size: 14px; padding: 8px 14px; }
        .totals .mono { font-family: ui-monospace, monospace; }
        .signoff { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; margin-top: 24px; }
        .sign { border-top: 1.5px solid #888; padding-top: 5px; font-size: 9px; color: #888; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; }
        .sign .sub { font-size: 10px; color: #444; margin-top: 2px; text-transform: none; letter-spacing: 0; font-weight: 600; }
        @media print {
          body { background: #fff; }
          .screen-bar { display: none !important; }
          .wrap { max-width: none; padding: 0 2mm; margin: 0; }
          /* Let long tables flow across pages (no big empty gaps); repeat the
             header each page and keep individual rows whole. */
          table.t thead { display: table-header-group; }
          /* Totals print ONCE at the table's true end, not on every page. */
          table.t tfoot { display: table-row-group; }
          table.t tr { page-break-inside: avoid; }
          .signoff, .totbox, .stone-title { page-break-inside: avoid; }
          @page { size: A4 portrait; margin: 9mm; }
        }
        @media screen { body { padding: 0; } }
      `}</style>

      <div className="screen-bar">
        <span className="screen-bar-title">Tax Invoice — {invCode} · {billing?.name ?? c.temple ?? "—"} · A4 portrait</span>
        <PrintBtn />
      </div>

      <div className="wrap">
        <div className="doc-title">TAX INVOICE</div>
        <div className="head">
          <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo-dark.png" alt="MTCPL" className="brand-logo" />
            <div>
              <div className="cn">MATESHWARI TEMPLE CONSTRUCTION PVT LTD</div>
              <div className="cl">NH-27, Opposite Ajari Gate, Pindwara, Dist. Sirohi, Rajasthan</div>
              <div className="cl">☎ +91 94141 52740 / +91 94143 74979 · mtcpl.org · mateshwaritemples.com</div>
            </div>
          </div>
          <div>
            <div className="num">{invCode}</div>
            <div className="dt">Date {c.challan_date}<br />Printed {printDate}</div>
          </div>
        </div>

        <div className="info">
          <div><div className="k">Bill to</div><div className="v big">🛕 {dash(billing?.name ?? c.temple)}</div></div>
          <div><div className="k">GSTIN</div><div className="v mono">{dash(billing?.gstin)}</div></div>
          <div><div className="k">PAN</div><div className="v mono">{dash(billing?.pan)}</div></div>
          <div><div className="k">Phone</div><div className="v mono">{dash(billing?.phone)}</div></div>
          <div style={{ gridColumn: "1 / -1" }}><div className="k">Address</div><div className="v">{dash(billing?.address)}</div></div>
        </div>

        {items.length === 0 ? (
          <p style={{ color: "#888", fontSize: 11, marginTop: 12 }}>No items on this invoice.</p>
        ) : (
          <>
            {stoneGroups.map(([stone, rows]) => (
              <div key={stone} className="stone-block">
                <div className="stone-title">🪨 {stone}</div>
                <Section rows={rows.filter((it) => unitOf(it) === "cft")} unit="cft" />
                <Section rows={rows.filter((it) => unitOf(it) === "sft")} unit="sft" />
              </div>
            ))}
            <div className="totbox">
              <div className="totals">
                <div className="row"><span>Subtotal</span><span className="mono">{rupee(totals.subtotal)}</span></div>
                {c.gst_mode === "igst" && <div className="row alt"><span>IGST @ {Number(c.igst_percent) || 0}%</span><span className="mono">{rupee(totals.igstAmt)}</span></div>}
                {c.gst_mode === "cgst_sgst" && (
                  <>
                    <div className="row alt"><span>CGST @ {Number(c.cgst_percent) || 0}%</span><span className="mono">{rupee(totals.cgstAmt)}</span></div>
                    <div className="row alt"><span>SGST @ {Number(c.sgst_percent) || 0}%</span><span className="mono">{rupee(totals.sgstAmt)}</span></div>
                  </>
                )}
                <div className="row grand"><span>Grand Total</span><span className="mono">{rupee(totals.grand)}</span></div>
              </div>
            </div>
          </>
        )}

        {c.notes && <p style={{ fontSize: 10, color: "#333", marginTop: 8 }}><strong>Notes:</strong> {c.notes}</p>}

        <div className="signoff">
          <div className="sign">For MTCPL · Authorised Signatory<div className="sub">&nbsp;</div></div>
          <div className="sign">Customer Signature<div className="sub">{dash(billing?.name ?? c.temple)}</div></div>
        </div>
      </div>
    </>
  );
}
