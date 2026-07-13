/**
 * Running challan print (mig 182). Identical to the normal DELIVERY CHALLAN — same
 * letterhead, beige address/transport boxes, slab-table styling, signature row —
 * only the item rows are the running-challan line items (particulars / HSN / unit
 * / qty), with the per-slab L·W·H·weight columns removed. No rate/amount.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import { notFound, redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { canUseInvoicing } from "@/lib/invoicing-permissions";
import { dash } from "@/lib/dispatch-grouping";
import { fetchTempleBilling } from "@/lib/temple-billing";
import { challanCode } from "@/lib/doc-code";
import { groupBulkItems } from "@/lib/bulk-items";
import { PrintBtn } from "../../custom/print/print-btn";

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
          {(p.gstin || p.pan) && <div className="party-meta">GSTIN: {dash(p.gstin)}{p.pan ? ` · PAN: ${p.pan}` : ""}</div>}
        </>
      ) : (
        <div className="party-line muted">{fallback ?? "-"}</div>
      )}
    </div>
  );
}

export const dynamic = "force-dynamic";

export default async function RunningChallanPrintPage({ params }: { params: Params }) {
  const { profile } = await requireAuth();
  if (!canUseInvoicing(profile)) redirect("/");
  const { id } = await params;
  const admin = createAdminSupabaseClient();

  const { data: chRow } = await admin
    .from("challans")
    .select("id, challan_number, doc_fy, doc_seq, temple, challan_date, running_challan_at, transport_company, transport_phone, lr_no, transport_vehicle_no, transport_driver_name, transport_driver_phone")
    .eq("id", id)
    .maybeSingle();
  const c = chRow as any;
  if (!c || !c.running_challan_at) notFound();

  const { data: itemRows } = await admin.from("challan_custom_items").select("*").eq("challan_id", id).order("position");
  const sections = groupBulkItems((itemRows ?? []) as any[]);
  const multi = sections.length > 1 || sections.some((s) => (s.head ?? "").trim());
  const totalQty = ((itemRows ?? []) as any[]).reduce((a, it) => a + (Number(it.quantity) || 0), 0);
  const totalItems = ((itemRows ?? []) as any[]).length;

  const billing = await fetchTempleBilling(admin, c.temple);
  const billParty: PartyShape | null = billing
    ? { name: billing.name ?? c.temple ?? null, address: billing.address, city: billing.city, state: billing.state, state_code: billing.state_code, gstin: billing.gstin, pan: billing.pan, phone: billing.phone, email: billing.email }
    : c.temple ? { name: c.temple, address: null, city: null, state: null, state_code: null, gstin: null, pan: null, phone: null, email: null } : null;
  const shipParty: PartyShape | null = billing?.shipping ?? null;
  const billName = billParty?.name ?? c.temple ?? "—";
  const shipName = (shipParty?.name ?? "").trim() || billName;
  const docNum = challanCode(c.doc_fy, c.doc_seq) ?? c.challan_number;
  const contact = (name: string | null, phone: string | null) => [name, phone].filter(Boolean).join(" · ") || "-";

  return (
    <>
      <style>{`
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif; font-size: 11px; color: #1a1a1a; background: #f0f0f0; }
        * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        .print-wrap { max-width: 1180px; margin: 0 auto; background: #fff; padding: 14px 18px 18px; position: relative; }
        .screen-bar { background: #1a1a1a; color: #fff; padding: 9px 28px; display: flex; align-items: center; justify-content: space-between; gap: 12px; max-width: 1180px; margin: 0 auto; }
        .screen-bar-title { font-size: 12px; color: rgba(255,255,255,0.65); }
        .doc-title { text-align: center; margin: 0 0 7px; }
        .doc-title span { display: inline-block; font-size: 15px; font-weight: 800; letter-spacing: 0.18em; color: #fff; background: #0f2540; border-radius: 6px; padding: 4px 24px; text-transform: uppercase; }
        .head { display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; gap: 14px; border-bottom: 2.5px double #1e3a5f; padding-bottom: 8px; }
        .brand-logo { height: 68px; width: auto; display: block; }
        .company-block { text-align: center; min-width: 0; }
        .head > div:last-child { justify-self: end; }
        .company-name { font-size: 16.5px; font-weight: 800; color: #0f2540; letter-spacing: 0.02em; }
        .company-line { font-size: 10.5px; color: #666; margin-top: 1.5px; line-height: 1.45; }
        .doc-num { font-size: 17px; font-weight: 800; font-family: ui-monospace, monospace; text-align: right; margin-top: 2px; white-space: nowrap; color: #1a1a1a; }
        .doc-date { text-align: right; margin-top: 3px; font-size: 13.5px; font-weight: 800; color: #1a1a1a; white-space: nowrap; }
        .parties { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin: 8px 0 4px; align-items: start; }
        .party { border: 1px solid #d8d2c4; border-radius: 6px; padding: 7px 10px; background: #faf7f0; }
        .party-k { font-size: 8px; font-weight: 800; letter-spacing: 0.08em; text-transform: uppercase; color: #8a6a45; margin-bottom: 2px; }
        .party-name { font-size: 12.5px; font-weight: 800; color: #1a1a1a; }
        .party-line { font-size: 10px; color: #333; margin-top: 1px; line-height: 1.35; }
        .party-meta { font-size: 9px; color: #555; margin-top: 2px; font-family: ui-monospace, monospace; }
        .party .muted { color: #999; }
        .transport { border: 1px solid #d8d2c4; border-radius: 6px; background: #faf7f0; padding: 6px 10px; margin: 4px 0; }
        .transport-k { font-size: 8px; font-weight: 800; letter-spacing: 0.08em; text-transform: uppercase; color: #8a6a45; margin-bottom: 3px; }
        .transport-grid { display: grid; grid-template-columns: 1.4fr 1fr 1fr 1.4fr; gap: 12px; }
        .transport-grid > div { display: flex; flex-direction: column; min-width: 0; }
        .transport-grid .tk { font-size: 8px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.03em; color: #8a6a45; }
        .transport-grid .tv { font-size: 11px; font-weight: 700; color: #1a1a1a; }
        .transport-grid .tv.mono { font-family: ui-monospace, monospace; }
        .stone-title { text-transform: uppercase; font-size: 11.5px; font-weight: 800; color: #5b2e0a; background: #f3efe7; border-left: 3px solid #7c4a1e; padding: 4px 9px; margin: 12px 0 2px; border-radius: 3px; break-after: avoid; }
        table.slab-table { width: 100%; border-collapse: collapse; font-size: 10.5px; margin-top: 6px; }
        table.slab-table th { background: #f3efe7; padding: 4px 6px; text-align: left; font-size: 8.5px; font-weight: 800; color: #444; text-transform: uppercase; letter-spacing: 0.03em; border: 1px solid #d8d2c4; white-space: nowrap; }
        table.slab-table td { padding: 3px 6px; border: 1px solid #e6e1d6; vertical-align: top; font-weight: 700; color: #1a1a1a; }
        table.slab-table tfoot td { font-weight: 800; background: #faf7f0; border: 1px solid #d8d2c4; }
        .slab-table .r { text-align: right; white-space: nowrap; }
        .slab-table .mono { font-family: ui-monospace, monospace; }
        .slab-table th.cqty { background: #f6e5c4; }
        .slab-table td.cqty { background: #fdf6ea; }
        .totals { display: flex; gap: 18px; flex-wrap: wrap; font-size: 11px; font-weight: 800; margin-top: 8px; padding: 6px 10px; border: 1px solid #d8d2c4; border-radius: 6px; background: #faf7f0; }
        .signoff { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; margin-top: 22px; }
        .sign { border-top: 1.5px solid #888; padding-top: 5px; font-size: 9px; color: #888; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; }
        .sign .sub { font-size: 10px; color: #444; margin-top: 2px; text-transform: none; letter-spacing: 0; font-weight: 600; }
        @media print {
          body { background: #fff; }
          .screen-bar { display: none !important; }
          .print-wrap { max-width: none; padding: 0 2mm; margin: 0; }
          table.slab-table thead { display: table-header-group; }
          table.slab-table tr { page-break-inside: avoid; }
          .signoff { page-break-inside: avoid; }
          @page { size: A4 portrait; margin: 9mm; }
        }
        @media screen { body { padding: 0; } }
      `}</style>

      <div className="screen-bar">
        <span className="screen-bar-title">RUNNING CHALLAN — {docNum} · {billName} · A4 portrait</span>
        <PrintBtn />
      </div>

      <div className="print-wrap">
        <div className="doc-title"><span>Running Challan</span></div>
        <div className="head">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-mtcpl.png" alt="MTCPL" className="brand-logo" />
          <div className="company-block">
            <div className="company-name">MATESHWARI TEMPLE CONSTRUCTION PVT LTD</div>
            <div className="company-line">G-109, RIICO Ind. Area, Sirohi Road, Teh. Pindwara, Dist. Sirohi, Rajasthan</div>
            <div className="company-line">GSTIN: 08AAFCM15Q1ZA · ☎ 80941 56965 · temple@mtcpl.co</div>
          </div>
          <div>
            <div className="doc-num">{docNum}</div>
            <div className="doc-date">{new Date(`${c.challan_date}T00:00:00+05:30`).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric" })}</div>
          </div>
        </div>

        <div className="parties">
          <Party label="Billing To" name={billName} p={billParty} />
          <Party label="Shipping To" name={shipName} p={shipParty} fallback="Same as billing address" />
        </div>

        {(c.transport_company || c.transport_vehicle_no || c.transport_driver_name || c.lr_no) && (
          <div className="transport">
            <div className="transport-k">🚚 Transportation</div>
            <div className="transport-grid">
              <div><span className="tk">Company</span><span className="tv">{dash(c.transport_company)}{c.transport_phone ? ` · ${c.transport_phone}` : ""}</span></div>
              <div><span className="tk">LR no.</span><span className="tv mono">{dash(c.lr_no)}</span></div>
              <div><span className="tk">Vehicle no.</span><span className="tv mono">{dash(c.transport_vehicle_no)}</span></div>
              <div><span className="tk">Driver</span><span className="tv">{contact(c.transport_driver_name ? String(c.transport_driver_name).toUpperCase() : null, c.transport_driver_phone)}</span></div>
            </div>
          </div>
        )}

        {sections.length === 0 ? (
          <p style={{ color: "#888", fontSize: 11, marginTop: 12 }}>No line items.</p>
        ) : (
          <>
            {sections.map((sec, gi) => (
              <div key={sec.index}>
                {multi && <div className="stone-title">{dash(sec.head) === "-" ? `Table ${gi + 1}` : sec.head}</div>}
                <table className="slab-table">
                  <thead><tr><th style={{ width: 26 }}>#</th><th>Item / Particulars</th><th style={{ width: 90 }}>HSN</th><th style={{ width: 70 }}>Unit</th><th className="r cqty" style={{ width: 70 }}>Qty</th></tr></thead>
                  <tbody>
                    {sec.rows.map((it, i) => (
                      <tr key={(it as any).id ?? `${gi}-${i}`}>
                        <td>{i + 1}</td>
                        <td style={{ textTransform: "uppercase" }}>{dash(it.particulars)}</td>
                        <td className="mono">{dash(it.hsn)}</td>
                        <td>{dash(it.unit)}</td>
                        <td className="r mono cqty">{it.quantity != null ? Number(it.quantity) : "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
            <div className="totals">
              <span>Σ {totalItems} item{totalItems !== 1 ? "s" : ""}</span>
              <span>TOTAL QTY: {totalQty}</span>
            </div>
          </>
        )}

        <div className="signoff">
          <div className="sign">MTCPL Representative<div className="sub">&nbsp;</div></div>
          <div className="sign">Account Signature<div className="sub">VIRENDRA PAL</div></div>
          <div className="sign">Driver Signature<div className="sub">{dash(c.transport_driver_name)}</div></div>
          <div className="sign" style={{ textAlign: "right" }}>Client Signature<div className="sub">{billName}</div></div>
        </div>
      </div>
    </>
  );
}
