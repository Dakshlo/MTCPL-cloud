/**
 * Tax invoice from a priced challan (Mig 157) — A4 PORTRAIT.
 *
 * Compact stone-wise grid (Code/Label/dims + Rate + Amount), CFT and SFT in
 * separate tables, then subtotal + GST (IGST or CGST+SGST) + grand total.
 * Bill To + Ship To address blocks; code shown as INV-<FY>-N. Blanks print "-".
 */

import { notFound, redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { canUseInvoicing } from "@/lib/invoicing-permissions";
import { dash } from "@/lib/dispatch-grouping";
import { fetchTempleBilling } from "@/lib/temple-billing";
import { stonePrintLabel, type StoneCategory } from "@/lib/stone-categories";
import { applyDiscount, computeGroupedGstTotals, discountLabel, gstGroupLabel, rupee, type GstMode } from "@/lib/challan-pricing";
import { invoiceCode } from "@/lib/invoice-code";
import { invoiceCodeFromDoc, challanCode } from "@/lib/doc-code";
import { amountInWordsIN } from "@/lib/amount-words";
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

// Combined Category cell — joins two parts with " — " in one column to save
// width. Called as catText(Category 1, Category 2) → "MAIN TEMPLE — GROUND FLOOR".
function catText(a: string | null, b: string | null): string {
  const parts = [a, b].map((v) => (v ?? "").trim()).filter(Boolean);
  return parts.length ? parts.join(" — ") : "-";
}

type PartyShape = {
  name: string | null; address: string | null; city: string | null; state: string | null;
  state_code: string | null; gstin: string | null; pan: string | null; phone: string | null; email: string | null;
};

// One bill-to / ship-to address block. The temple `name` sits UNDER the label
// (Daksh); `p` carries the address lines (null ⇒ show the fallback note).
function Party({ label, name, p, fallback, vendorCode, workOrderNo }: { label: string; name: string | null; p: PartyShape | null; fallback?: string; vendorCode?: string | null; workOrderNo?: string | null }) {
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
      {(vendorCode || workOrderNo) && (
        <div className="party-meta">{[vendorCode ? `Vendor code: ${vendorCode}` : null, workOrderNo ? `Work order no: ${workOrderNo}` : null].filter(Boolean).join(" · ")}</div>
      )}
    </div>
  );
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

// Print pages must never be served stale — an invoice edit has to show up
// immediately (Daksh Jul 2026: "edit didn't apply on the invoice").
export const dynamic = "force-dynamic";

export default async function InvoicePrintPage({ params }: { params: Params }) {
  const { profile } = await requireAuth();
  if (!canUseInvoicing(profile)) redirect("/");
  const { id } = await params;
  const admin = createAdminSupabaseClient();

  const [{ data: challan }, { data: itemRows }, { data: stoneTypeRows }] = await Promise.all([
    admin
      .from("challans")
      .select(
        "id, challan_number, doc_fy, doc_seq, challan_date, notes, source_dispatch_id, temple, gst_mode, igst_percent, cgst_percent, sgst_percent, priced_at, owner_approved_at, invoice_no_override, invoice_parties(name, gstin, address, phone)",
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
    // Stone categories — drive the customer-facing stone label.
    admin.from("stone_types").select("name, stone_category"),
  ]);
  const stoneCatMap: Record<string, StoneCategory> = {};
  for (const r of (stoneTypeRows ?? []) as Array<{ name: string; stone_category?: string | null }>) {
    stoneCatMap[r.name] = r.stone_category === "marble" ? "marble" : "sandstone";
  }
  if (!challan) notFound();
  const c = challan as {
    id: string;
    challan_number: string;
    doc_fy: string | null;
    doc_seq: number | null;
    challan_date: string;
    notes: string | null;
    source_dispatch_id: string | null;
    gst_mode: string | null;
    igst_percent: number | null;
    cgst_percent: number | null;
    sgst_percent: number | null;
    priced_at: string | null;
    owner_approved_at: string | null;
    invoice_no_override: string | null;
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
    ? {
        name: party.name, gstin: party.gstin, pan: null, address: party.address, city: null, state: null,
        state_code: null, email: null, phone: party.phone, vendor_code: null, work_order_no: null, shipping: null,
      }
    : null;
  // Bill-to / Ship-to address blocks for the print (ship null ⇒ same as billing).
  const billParty: PartyShape | null = billing
    ? { name: billing.name ?? c.temple ?? null, address: billing.address, city: billing.city, state: billing.state, state_code: billing.state_code, gstin: billing.gstin, pan: billing.pan, phone: billing.phone, email: billing.email }
    : c.temple
    ? { name: c.temple, address: null, city: null, state: null, state_code: null, gstin: null, pan: null, phone: null, email: null }
    : null;
  const shipParty: PartyShape | null = billing?.shipping ?? null;
  // Temple name shown UNDER each Bill To / Ship To label (Daksh). Ship-to name
  // falls back to the billing name when there's no separate shipping party.
  const billName = billParty?.name ?? c.temple ?? "—";
  const shipName = (shipParty?.name ?? "").trim() || billName;
  // Vehicle no + driver — from the source dispatch (Daksh; the transport card
  // takes these from the challan/dispatch, only company + LR are entered).
  const { data: dispRow } = c.source_dispatch_id
    ? await admin.from("dispatches").select("vehicle_no, driver_name, driver_phone").eq("id", c.source_dispatch_id).maybeSingle()
    : { data: null };
  const disp = (dispRow as { vehicle_no?: string | null; driver_name?: string | null; driver_phone?: string | null } | null) ?? null;
  const vehicleNo = disp?.vehicle_no ?? null;
  const driverName = disp?.driver_name ?? null;
  const driverPhone = disp?.driver_phone ?? null;
  // Mig 169 — transportation: only the company + LR no are entered by the
  // accountant; vehicle + driver come from the dispatch (above). Best-effort.
  let transportCompany: string | null = null;
  let lrNo: string | null = null;
  {
    const { data: tr, error } = await admin
      .from("challans")
      .select("transport_company, lr_no")
      .eq("id", id)
      .maybeSingle();
    if (!error && tr) {
      const t = tr as Record<string, string | null>;
      transportCompany = (t.transport_company ?? "").trim() || null;
      lrNo = (t.lr_no ?? "").trim() || null;
    }
  }

  // Mig 171 — HSN per stone + this temple's HSN choice (best-effort). Vendor HSN
  // prints (and 18% GST) only when the temple is set to use it.
  const stoneHsn = new Map<string, { hsn: string | null; vendor: string | null }>();
  {
    const { data: hs, error } = await admin.from("stone_types").select("name, hsn_code, hsn_vendor_code");
    if (!error) for (const r of (hs ?? []) as Array<{ name: string; hsn_code: string | null; hsn_vendor_code: string | null }>) stoneHsn.set(r.name, { hsn: r.hsn_code, vendor: r.hsn_vendor_code });
  }
  let templeHsnUseVendor = false;
  if (c.temple) {
    const { data: tv, error } = await admin.from("temples").select("hsn_use_vendor").eq("name", c.temple).maybeSingle();
    if (!error && tv) templeHsnUseVendor = !!(tv as { hsn_use_vendor?: boolean }).hsn_use_vendor;
  }
  const hsnFor = (stone: string): string | null => {
    const h = stoneHsn.get(stone);
    if (!h) return null;
    const v = (h.vendor ?? "").trim();
    return templeHsnUseVendor && v ? v : ((h.hsn ?? "").trim() || null);
  };
  // Mig 187 — this invoice's custom per-stone table headings (LEFT of each band).
  // Separate best-effort fetch (jsonb column) so a pre-migration schema still
  // prints; pre-mig the band just falls back to the stone name.
  const stoneHead = new Map<string, string>();
  {
    const { data: sh, error } = await (admin.from("challans") as unknown as {
      select: (c: string) => { eq: (k: string, v: string) => { maybeSingle: () => Promise<{ data: { stone_heads: Record<string, string> | null } | null; error: unknown }> } };
    }).select("stone_heads").eq("id", id).maybeSingle();
    if (!error && sh?.stone_heads && typeof sh.stone_heads === "object") {
      for (const [k, v] of Object.entries(sh.stone_heads)) { const t = String(v ?? "").trim(); if (t) stoneHead.set(k, t); }
    }
  }
  const headFor = (stone: string): string => stoneHead.get(stone) ?? "";

  // Mig 199 — this invoice's per-stone-table GST slabs ({ "<stone>|<unit>" →
  // pct }). Separate best-effort fetch: a pre-mig-199 schema (or a pre-199
  // invoice, where the map is simply absent) keeps the invoice-level %.
  const stoneGst = new Map<string, number>();
  {
    const { data: sg, error } = await (admin.from("challans") as unknown as {
      select: (c: string) => { eq: (k: string, v: string) => { maybeSingle: () => Promise<{ data: { stone_gst: Record<string, number> | null } | null; error: unknown }> } };
    }).select("stone_gst").eq("id", id).maybeSingle();
    if (!error && sg?.stone_gst && typeof sg.stone_gst === "object") {
      for (const [k, v] of Object.entries(sg.stone_gst)) { const n = Number(v); if (Number.isFinite(n)) stoneGst.set(k, n); }
    }
  }
  const gstFor = (stone: string, unit: "cft" | "sft"): number | null => stoneGst.get(`${stone}|${unit}`) ?? null;

  const items = (itemRows ?? []) as Item[];

  const unitOf = (it: Item): "cft" | "sft" => ((it.measure_unit || it.unit) === "sft" ? "sft" : "cft");
  const measureOf = (it: Item) => (it.measure_qty != null && Number(it.measure_qty) > 0 ? Number(it.measure_qty) : Number(it.quantity) || 0);
  const amountOf = (it: Item) => (it.amount != null ? Number(it.amount) : (Number(it.rate) || 0) * measureOf(it));
  // Mig 172 — the invoice number now runs its OWN series (inv_fy/inv_seq),
  // independent of the challan's CH number. Best-effort fetch (survives a
  // pre-migration schema). Override wins → INV series → legacy doc/challan code.
  let invFy: string | null = null;
  let invSeq: number | null = null;
  {
    const { data: iv, error } = await admin.from("challans").select("inv_fy, inv_seq").eq("id", id).maybeSingle();
    if (!error && iv) { const t = iv as { inv_fy?: string | null; inv_seq?: number | null }; invFy = t.inv_fy ?? null; invSeq = t.inv_seq ?? null; }
  }
  const invCode = (c.invoice_no_override?.trim() || invoiceCodeFromDoc(invFy, invSeq) || invoiceCodeFromDoc(c.doc_fy, c.doc_seq) || invoiceCode(c.challan_number, c.challan_date));
  // Source challan no. (the priced challan IS this invoice) — shown under the
  // date so the floor links the bill to its delivery challan at a glance.
  // Jul 2026 fix: use the UNIFIED code (CH-26/27-N, mig 168) — the legacy
  // CHLN-#### only as a fallback for pre-168 rows (the printed "CHLN-CH-2026-24"
  // was this label built from the old challan_number).
  const challanLabel =
    challanCode(c.doc_fy, c.doc_seq) ??
    (c.challan_number != null && String(c.challan_number).trim() !== ""
      ? `CHLN-${String(c.challan_number).padStart(4, "0")}`
      : null);

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

  const gstMode = (c.gst_mode === "igst" || c.gst_mode === "cgst_sgst" ? c.gst_mode : null) as GstMode;
  // Mig 199 — per-stone-table slabs; items without one (all pre-199 invoices)
  // fall back to the invoice-level %, so old invoices print exactly as before.
  const totals = computeGroupedGstTotals(
    items.map((it) => ({ amount: amountOf(it), gstPercent: gstFor(stoneOf(it), unitOf(it)) })),
    { mode: gstMode, igst: Number(c.igst_percent) || 0, cgst: Number(c.cgst_percent) || 0, sgst: Number(c.sgst_percent) || 0 },
  );

  // Mig 200 — discount on the final amount (best-effort; pre-mig = off).
  let disc = applyDiscount(totals.grand, null, 0);
  {
    const { data: dc, error } = await admin.from("challans").select("discount_mode, discount_value").eq("id", id).maybeSingle();
    const d = dc as { discount_mode?: string | null; discount_value?: number | null } | null;
    if (!error && d) disc = applyDiscount(totals.grand, d.discount_mode ?? null, Number(d.discount_value) || 0);
  }

  const printDate = new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

  // Mig 167 — a PRICED but NOT-yet-owner-APPROVED challan is printable (the
  // accountant/owner can review it) but is NOT a valid tax invoice yet, so it
  // carries a repeating diagonal "UNDER APPROVAL — NOT VALID" watermark. Once
  // the owner approves, owner_approved_at is set and the watermark disappears.
  const underApproval = !!c.priced_at && !c.owner_approved_at;

  const Section = ({ rows, unit, gst }: { rows: Item[]; unit: "cft" | "sft"; gst?: number | null }) => {
    if (rows.length === 0) return null;
    const sub = rows.reduce((a, it) => a + amountOf(it), 0);
    const measTotal = rows.reduce((a, it) => a + measureOf(it), 0);
    const qtyTotal = rows.reduce((a, it) => a + (Number(it.quantity) || 0), 0);
    return (
      <>
        <div className="grp-title" style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
          <span>{unit === "cft" ? "CFT · volume billed" : "SFT · area billed"}</span>
          {gstMode && gst != null && <span>GST {gst}%</span>}
        </div>
        <table className="t">
          <thead>
            <tr>
              <th style={{ width: 26, whiteSpace: "nowrap", textAlign: "center" }}>#</th>
              <th>Category</th>
              <th>Label</th>
              <th>Description</th>
              <th>Code(s)</th>
              <th className="r">L</th>
              <th className="r">W</th>
              <th className="r">H</th>
              <th className="r hl1">Qty</th>
              <th className="r hl1">{unit.toUpperCase()}</th>
              <th className="r hl2">Rate</th>
              <th className="r hl2">Amount</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((it, i) => (
              <tr key={it.id}>
                <td className="muted" style={{ whiteSpace: "nowrap", wordBreak: "normal", textAlign: "center", fontSize: 8 }}>{i + 1}</td>
                <td>{catText(it.component_section, it.component_element)}</td>
                <td>{dash(it.label)}</td>
                <td>{dash(it.description)}</td>
                <td className="mono"><CodeCell codes={it.codes} /></td>
                <td className="r mono">{it.length_ft ?? "-"}</td>
                <td className="r mono">{it.width_ft ?? "-"}</td>
                <td className="r mono">{it.thickness_ft ?? "-"}</td>
                <td className="r mono b hl1">{Number(it.quantity) || 0}</td>
                <td className="r mono b hl1">{fmt(measureOf(it))}</td>
                <td className="r mono hl2">{fmt(Number(it.rate) || 0)}</td>
                <td className="r mono b hl2">{rupee(amountOf(it))}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={8} className="r">Total</td>
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
        /* Print the on-screen colours (highlights, stone bars, totals) exactly,
           without needing the browser's "Background graphics" toggle. */
        * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        .wrap { max-width: 820px; margin: 0 auto; background: #fff; padding: 14px 18px 18px; position: relative; }
        /* Mig 167 — "NOT VALID INVOICE" watermark for a priced but not-yet-owner-
           approved invoice. REAL DOM text in a grid (NOT a CSS background image —
           those print unreliably): a 4-column grid of rotated red labels spread
           evenly over the page, sitting OVER the content at low opacity and never
           intercepting clicks. position:fixed in print repeats it on every page. */
        .approval-wm {
          position: absolute; inset: 0; z-index: 50; pointer-events: none; overflow: hidden;
          display: grid; grid-template-columns: repeat(4, 1fr);
          align-content: space-evenly; justify-items: center; padding: 26px 0;
        }
        .approval-wm span {
          transform: rotate(-30deg); white-space: nowrap;
          font: 800 15px/1 Arial, sans-serif; color: #d40000; opacity: 0.18;
        }
        .screen-bar { background: #1a1a1a; color: #fff; padding: 9px 28px; display: flex; align-items: center; justify-content: space-between; gap: 12px; max-width: 1180px; margin: 0 auto; }
        .screen-bar-title { font-size: 12px; color: rgba(255,255,255,0.65); }
        /* 3-column grid (logo | company | code) so the company name is centered
           on the page AND never wraps (auto middle column sizes to it). */
        .head { display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; gap: 14px; border-bottom: 2.5px double #1e3a5f; padding-bottom: 6px; }
        .head > div:last-child { justify-self: end; }
        .brand-logo { height: 68px; width: auto; }
        .company-block { text-align: center; min-width: 0; }
        .cn { font-size: 16px; font-weight: 800; color: #0f2540; white-space: nowrap; }
        .cl { font-size: 10.5px; color: #666; margin-top: 1.5px; line-height: 1.45; }
        .pill { font-size: 13px; font-weight: 800; color: #0f2540; letter-spacing: 0.1em; text-transform: uppercase; border: 2px solid #1e3a5f; border-radius: 6px; padding: 4px 14px; background: #eef3f9; white-space: nowrap; }
        .num { font-size: 17px; font-weight: 800; font-family: ui-monospace, monospace; text-align: right; margin-top: 2px; }
        .meta { text-align: right; margin-top: 3px; font-size: 10.5px; font-weight: 800; color: #1a1a1a; line-height: 1.5; }
        .meta-date { font-size: 12.5px; font-weight: 800; color: #0f2540; }
        .dt { font-size: 8.5px; color: #888; text-align: right; margin-top: 2px; line-height: 1.45; }
        .info { display: grid; grid-template-columns: repeat(4, 1fr); gap: 3px 16px; margin: 8px 0 4px; border: 1px solid #ccc; border-radius: 6px; padding: 7px 10px; background: #f7fafc; }
        .info .k { font-size: 7.5px; font-weight: 800; letter-spacing: 0.06em; text-transform: uppercase; color: #999; }
        .info .v { font-size: 11px; font-weight: 700; color: #1a1a1a; line-height: 1.35; }
        .info .v.big { font-size: 13px; font-weight: 800; }
        .info .mono { font-family: ui-monospace, monospace; }
        .cust { font-size: 15px; font-weight: 800; color: #0f2540; margin: 8px 0 5px; }
        .parties { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin: 4px 0 4px; }
        .party { border: 1px solid #ccc; border-radius: 6px; padding: 8px 10px; background: #f7fafc; }
        .party-k { font-size: 9px; font-weight: 800; letter-spacing: 0.08em; text-transform: uppercase; color: #888; margin-bottom: 2px; }
        .party-name { font-size: 14.5px; font-weight: 800; color: #1a1a1a; }
        .party-line { font-size: 11.5px; color: #333; margin-top: 1.5px; }
        .party-meta { font-size: 10.5px; color: #555; margin-top: 2px; font-family: ui-monospace, monospace; }
        .party .muted { color: #999; }
        .vw { font-size: 9.5px; color: #444; margin: 5px 0 0; font-weight: 700; }
        /* Transportation card under Bill To / Ship To (Mig 169). */
        .transport { border: 1px solid #ccc; border-radius: 6px; padding: 7px 11px; background: #f7fafc; margin: 8px 0 4px; }
        .transport-k { font-size: 8.5px; font-weight: 800; letter-spacing: 0.08em; text-transform: uppercase; color: #888; margin-bottom: 4px; }
        .transport-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 5px 18px; }
        .transport-grid > div { display: flex; flex-direction: column; }
        .transport .tk { font-size: 8px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.04em; color: #999; }
        .transport .tv { font-size: 11.5px; font-weight: 700; color: #1a1a1a; }
        .doc-title { text-align: center; margin: 0 0 7px; }
        .doc-title span { display: inline-block; font-size: 15px; font-weight: 800; letter-spacing: 0.18em; color: #fff; background: #0f2540; border-radius: 6px; padding: 4px 24px; }
        .stone-block { margin-top: 4px; }
        /* Stone band — 3 zones: custom heading (left) · HSN (centre) · stone (right). */
        .stone-title { display: flex; align-items: center; gap: 10px; font-size: 12.5px; font-weight: 800; color: #0f2540; background: #eef2f7; border-left: 3px solid #1e3a5f; padding: 5px 10px; margin: 12px 0 0; border-radius: 3px; break-after: avoid; }
        .stone-title .st-head { flex: 1 1 0; text-align: left; }
        .stone-title .st-hsn { flex: 0 0 auto; text-align: center; font-weight: 700; color: #555; font-size: 11px; font-family: ui-monospace, monospace; }
        .stone-title .st-hsn b { color: #0f2540; }
        .stone-title .st-stone { flex: 1 1 0; text-align: right; font-weight: 800; color: #0f2540; }
        /* CFT/SFT line is JOINED to its table — a header cap directly on top, no
           gap, same tint + borders as the table header row (Daksh). */
        .grp-title { font-size: 9.5px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.08em; color: #0f2540; background: #eef2f7; border: 1px solid #d3dae3; border-bottom: none; border-radius: 4px 4px 0 0; padding: 3px 9px; margin: 9px 0 0; break-after: avoid; }
        .grp-title + table.t th { border-top: none; }
        table.t { width: 100%; border-collapse: collapse; font-size: 9.5px; }
        table.t th { background: #eef2f7; padding: 2px 4px; text-align: left; font-size: 8px; font-weight: 800; color: #444; text-transform: uppercase; letter-spacing: 0.02em; border: 1px solid #d3dae3; }
        table.t td { padding: 2.5px 4px; border: 1px solid #e2e7ee; vertical-align: top; font-weight: 700; color: #1a1a1a; word-break: break-word; }
        /* Tax summary + amount in words (Daksh). */
        .taxsum { width: 100%; border-collapse: collapse; font-size: 10.5px; margin-top: 12px; }
        .taxsum th { background: #eef2f7; border: 1px solid #d3dae3; padding: 5px 9px; text-align: left; font-size: 8.5px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.03em; color: #444; }
        .taxsum td { border: 1px solid #d3dae3; padding: 6px 9px; font-weight: 700; color: #1a1a1a; }
        .taxsum td.mono { font-family: ui-monospace, monospace; text-align: right; }
        .amt-words { margin-top: 7px; font-size: 11.5px; color: #1a1a1a; border: 1px solid #d3dae3; border-radius: 6px; padding: 7px 11px; background: #f7fafc; }
        table.t tfoot td { font-weight: 800; background: #f3f6fa; border: 1px solid #d3dae3; }
        .t .r { text-align: right; white-space: nowrap; } .t .mono { font-family: ui-monospace, monospace; } .t .b { font-weight: 800; } .t .muted { color: #999; }
        /* Highlighted columns — never wrap. Two colour groups:
           hl1 = Qty + CFT/SFT (blue) · hl2 = Rate + Amount (amber). The TOTAL
           row stays the plain tfoot colour (Daksh — the tint there was
           confusing). */
        .t .hl1, .t .hl2 { white-space: nowrap; }
        .t td.hl1 { background: #e6f0fb; }
        .t th.hl1 { background: #c7ddf6; }
        .t td.hl2 { background: #fff7e0; }
        .t th.hl2 { background: #ffe6a8; }
        .totbox { display: flex; justify-content: space-between; align-items: flex-start; gap: 24px; margin-top: 10px; }
        .terms { flex: 1 1 auto; max-width: 58%; }
        .terms-title { font-size: 9.5px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.06em; color: #0f2540; margin-bottom: 3px; }
        .terms-list { margin: 0; padding-left: 15px; }
        .terms-list li { font-size: 9px; color: #444; line-height: 1.5; margin-bottom: 1px; }
        .totals { min-width: 280px; flex: 0 0 auto; border: 1px solid #d3dae3; border-radius: 8px; overflow: hidden; }
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
          /* Mig 167 — print the "NOT VALID" watermark on EVERY page, tiled. An
             ABSOLUTE layer only paints page 1 (and gets clipped to ~one line);
             position:fixed makes the browser repeat the whole tiled pattern on
             each printed page. */
          .approval-wm { position: fixed; inset: 0; }
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
        <span className="screen-bar-title">
          Tax Invoice — {invCode} · {billing?.name ?? c.temple ?? "—"} · A4 portrait
          {underApproval && (
            <span style={{ marginLeft: 10, color: "#fca5a5", fontWeight: 800 }}>· UNDER APPROVAL — NOT VALID</span>
          )}
        </span>
        <PrintBtn />
      </div>

      <div className="wrap">
        {underApproval && (
          <div className="approval-wm" aria-hidden="true">
            {Array.from({ length: 24 }).map((_, i) => <span key={i}>NOT VALID INVOICE</span>)}
          </div>
        )}
        <div className="doc-title"><span>TAX INVOICE</span></div>
        <div className="head">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-mtcpl.png" alt="MTCPL" className="brand-logo" />
          <div className="company-block">
            <div className="cn">MATESHWARI TEMPLE CONSTRUCTION PVT LTD</div>
            <div className="cl">G-109, RIICO Ind. Area, Sirohi Road, Teh. Pindwara, Dist. Sirohi, Rajasthan</div>
            <div className="cl">GSTIN: 08AAFCM15Q1ZA · ☎ 80941 56965 · temple@mtcpl.co</div>
          </div>
          <div>
            <div className="num">{invCode}</div>
            <div className="meta">
              <div className="meta-date">{new Date(`${c.challan_date}T00:00:00+05:30`).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric" })}</div>
              {challanLabel ? <div>Challan {challanLabel}</div> : null}
            </div>
          </div>
        </div>

        <div className="parties">
          <Party label="Bill To" name={billName} p={billParty} vendorCode={billing?.vendor_code} workOrderNo={billing?.work_order_no} />
          <Party label="Ship To" name={shipName} p={shipParty} fallback="Same as billing address" />
        </div>
        {(transportCompany || lrNo) && (
          <div className="transport">
            <div className="transport-k">Transportation</div>
            <div className="transport-grid">
              {transportCompany && <div><span className="tk">Company</span><span className="tv">{transportCompany}</span></div>}
              {lrNo && <div><span className="tk">LR no.</span><span className="tv">{lrNo}</span></div>}
              {vehicleNo && <div><span className="tk">Vehicle no.</span><span className="tv">{vehicleNo}</span></div>}
              {(driverName || driverPhone) && <div><span className="tk">Driver</span><span className="tv">{[driverName, driverPhone].filter(Boolean).join(" · ")}</span></div>}
            </div>
          </div>
        )}

        {items.length === 0 ? (
          <p style={{ color: "#888", fontSize: 11, marginTop: 12 }}>No items on this invoice.</p>
        ) : (
          <>
            {stoneGroups.map(([stone, rows]) => {
              // 3-zone band: custom heading (left) · HSN (centre) · stone (right).
              // No heading typed → fall back to the stone name on the left.
              const head = headFor(stone);
              const label = stonePrintLabel(stone, stoneCatMap);
              const hsn = hsnFor(stone);
              return (
                <div key={stone} className="stone-block">
                  <div className="stone-title">
                    <span className="st-head">{head || label}</span>
                    <span className="st-hsn">{hsn ? <>HSN&nbsp;<b>{hsn}</b></> : ""}</span>
                    <span className="st-stone">{head ? label : ""}</span>
                  </div>
                  <Section rows={rows.filter((it) => unitOf(it) === "cft")} unit="cft" gst={gstFor(stone, "cft")} />
                  <Section rows={rows.filter((it) => unitOf(it) === "sft")} unit="sft" gst={gstFor(stone, "sft")} />
                </div>
              );
            })}
            <div className="totbox">
              {/* Terms & conditions sit on the LEFT, opposite the totals (Daksh). */}
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

            {/* Tax summary + amount in words (Daksh). One row per GST slab
                (mig 199) — a single-slab invoice reads exactly as before. */}
            <table className="taxsum">
              <thead>
                <tr><th>Taxable Amount</th><th>GST</th><th>Total Tax</th><th>Invoice Total</th></tr>
              </thead>
              <tbody>
                {totals.groups.length === 0 ? (
                  <tr>
                    <td className="mono">{rupee(totals.subtotal)}</td>
                    <td>—</td>
                    <td className="mono">{rupee(0)}</td>
                    <td className="mono">{rupee(totals.grand)}</td>
                  </tr>
                ) : (
                  totals.groups.map((g, i) => (
                    <tr key={i}>
                      <td className="mono">{rupee(g.taxable)}</td>
                      <td>{gstGroupLabel(gstMode, g)}</td>
                      <td className="mono">{rupee(g.taxAmt)}</td>
                      {i === 0 && <td className="mono" rowSpan={totals.groups.length} style={{ verticalAlign: "middle", fontWeight: 800 }}>{rupee(totals.grand)}</td>}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
            <div className="amt-words"><strong>Amount in words:</strong> {amountInWordsIN(disc.payable)}</div>
          </>
        )}

        {/* Customer signs on the LEFT, MTCPL on the RIGHT (Daksh). */}
        <div className="signoff">
          <div className="sign">Customer Signature<div className="sub">{dash(billing?.name ?? c.temple)}</div></div>
          <div className="sign" style={{ textAlign: "right" }}>For MTCPL · Authorised Signatory<div className="sub">&nbsp;</div></div>
        </div>
      </div>
    </>
  );
}
