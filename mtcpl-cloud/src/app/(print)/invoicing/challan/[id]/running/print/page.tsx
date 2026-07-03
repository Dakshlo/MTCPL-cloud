/**
 * Running challan print (Daksh, mig 182). A4 portrait — the running CHALLAN (no
 * rate/amount), item tables grouped by head, transport strip, Bill/Ship To. It's
 * the goods document before the running bill is invoiced (rate added later).
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
          {(p.gstin || p.pan) && <div className="party-meta">GSTIN: {dash(p.gstin)} · PAN: {dash(p.pan)}</div>}
        </>
      ) : (
        <div className="party-line muted">{fallback ?? "-"}</div>
      )}
    </div>
  );
}

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

  const billing = await fetchTempleBilling(admin, c.temple);
  const billParty: PartyShape | null = billing
    ? { name: billing.name ?? c.temple ?? null, address: billing.address, city: billing.city, state: billing.state, state_code: billing.state_code, gstin: billing.gstin, pan: billing.pan, phone: billing.phone, email: billing.email }
    : c.temple ? { name: c.temple, address: null, city: null, state: null, state_code: null, gstin: null, pan: null, phone: null, email: null } : null;
  const shipParty: PartyShape | null = billing?.shipping ?? null;
  const billName = billParty?.name ?? c.temple ?? "—";
  const shipName = (shipParty?.name ?? "").trim() || billName;
  const docNum = challanCode(c.doc_fy, c.doc_seq) ?? c.challan_number;

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
        .doc-title span { display: inline-block; font-size: 17px; font-weight: 800; letter-spacing: 0.16em; color: #fff; background: #5b21b6; border-radius: 6px; padding: 4px 24px; }
        .head { display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; gap: 14px; border-bottom: 2.5px double #5b21b6; padding-bottom: 6px; }
        .head > div:last-child { justify-self: end; }
        .brand-logo { height: 68px; width: auto; }
        .company-block { text-align: center; min-width: 0; }
        .cn { font-size: 16px; font-weight: 800; color: #0f2540; white-space: nowrap; }
        .cl { font-size: 10.5px; color: #666; margin-top: 1.5px; line-height: 1.45; }
        .num { font-size: 17px; font-weight: 800; font-family: ui-monospace, monospace; text-align: right; }
        .meta-date { font-size: 12.5px; font-weight: 800; color: #0f2540; text-align: right; margin-top: 3px; }
        .parties { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin: 8px 0 4px; }
        .party { border: 1px solid #ccc; border-radius: 6px; padding: 8px 10px; background: #f7fafc; }
        .party-k { font-size: 9px; font-weight: 800; letter-spacing: 0.08em; text-transform: uppercase; color: #888; margin-bottom: 2px; }
        .party-name { font-size: 14.5px; font-weight: 800; color: #1a1a1a; }
        .party-line { font-size: 11.5px; color: #333; margin-top: 1.5px; }
        .party-meta { font-size: 10.5px; color: #555; margin-top: 2px; font-family: ui-monospace, monospace; }
        .party .muted { color: #999; }
        .sec-head { margin-top: 10px; background: #5b21b6; color: #fff; font-size: 11px; font-weight: 800; padding: 5px 10px; border-radius: 5px 5px 0 0; }
        table.t { width: 100%; border-collapse: collapse; font-size: 10.5px; margin-top: 6px; }
        .sec-head + table.t { margin-top: 0; }
        table.t th { background: #eef2f7; padding: 4px 6px; text-align: left; font-size: 8.5px; font-weight: 800; color: #444; text-transform: uppercase; border: 1px solid #d3dae3; }
        table.t td { padding: 4px 6px; border: 1px solid #e2e7ee; vertical-align: top; font-weight: 700; color: #1a1a1a; }
        .t .r { text-align: right; white-space: nowrap; font-family: ui-monospace, monospace; }
        .totline { margin-top: 8px; font-size: 11px; font-weight: 800; color: #0f2540; background: #f5f3ff; border: 1px solid #ddd6fe; border-radius: 6px; padding: 6px 12px; }
        .signoff { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 18px; margin-top: 26px; }
        .sign { border-top: 1.5px solid #888; padding-top: 5px; font-size: 9px; color: #888; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; }
        .sign .sub { font-size: 10px; color: #444; margin-top: 2px; text-transform: none; letter-spacing: 0; font-weight: 600; }
        @media print {
          body { background: #fff; }
          .screen-bar { display: none !important; }
          .wrap { max-width: none; padding: 0 2mm; margin: 0; }
          table.t thead { display: table-header-group; }
          table.t tr { page-break-inside: avoid; }
          @page { size: A4 portrait; margin: 9mm; }
        }
        @media screen { body { padding: 0; } }
      `}</style>

      <div className="screen-bar">
        <span className="screen-bar-title">RUNNING CHALLAN — {docNum} · {billName} · A4 portrait</span>
        <PrintBtn />
      </div>

      <div className="wrap">
        <div className="doc-title"><span>RUNNING CHALLAN</span></div>
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
            <div className="meta-date">{new Date(`${c.challan_date}T00:00:00+05:30`).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric" })}</div>
          </div>
        </div>

        <div className="parties">
          <Party label="Bill To" name={billName} p={billParty} />
          <Party label="Ship To" name={shipName} p={shipParty} fallback="Same as billing address" />
        </div>

        {(c.transport_company || c.transport_vehicle_no || c.transport_driver_name || c.lr_no) && (
          <div style={{ fontSize: 10.5, color: "#5b21b6", margin: "8px 0 4px", fontWeight: 700, background: "#f5f3ff", border: "1px solid #ddd6fe", borderRadius: 6, padding: "6px 10px" }}>
            🚚 Transport: {[c.transport_company, c.lr_no ? `LR ${c.lr_no}` : "", c.transport_vehicle_no, c.transport_driver_name, c.transport_driver_phone].filter(Boolean).join("  ·  ")}
          </div>
        )}

        {sections.length === 0 ? (
          <p style={{ color: "#888", fontSize: 11, marginTop: 12 }}>No line items.</p>
        ) : (
          <>
            {sections.map((sec, gi) => (
              <div key={sec.index}>
                {multi && <div className="sec-head">{dash(sec.head) === "-" ? `Table ${gi + 1}` : sec.head}</div>}
                <table className="t">
                  <thead><tr><th style={{ width: 22 }}>#</th><th>Item / Particulars</th><th style={{ width: 90 }}>HSN</th><th style={{ width: 70 }}>Unit</th><th className="r" style={{ width: 70 }}>Qty</th></tr></thead>
                  <tbody>
                    {sec.rows.map((it, i) => (
                      <tr key={(it as any).id ?? `${gi}-${i}`}>
                        <td>{i + 1}</td>
                        <td>{dash(it.particulars)}</td>
                        <td style={{ fontFamily: "ui-monospace, monospace" }}>{dash(it.hsn)}</td>
                        <td>{dash(it.unit)}</td>
                        <td className="r">{it.quantity != null ? Number(it.quantity) : "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
            <div className="totline">Σ Total quantity: {totalQty}</div>
          </>
        )}

        <div className="signoff">
          <div className="sign">MTCPL Representative<div className="sub">&nbsp;</div></div>
          <div className="sign">Driver Signature<div className="sub">{dash(c.transport_driver_name)}</div></div>
          <div className="sign" style={{ textAlign: "right" }}>Client Signature<div className="sub">{dash(billName)}</div></div>
        </div>
      </div>
    </>
  );
}
