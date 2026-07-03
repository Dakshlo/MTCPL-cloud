"use client";

/** Transport form on the Prepare page (Daksh, Jul 2026). "Convert to work order
 *  challan" posts saveBulkTransportAction (fills transport, marks the final work
 *  order challan, releases the dispatch). "Preview work order challan" opens the
 *  challan with a NOT-VALID watermark. */

import Link from "next/link";
import { useFormStatus } from "react-dom";
import { FinanceLoadingOverlay } from "@/components/finance-loading-overlay";
import { saveBulkTransportAction } from "../../../actions";

type Transport = { company: string; phone: string; lr: string; vehicle: string; driver: string; driverPhone: string };

function ConvertBtn({ ready }: { ready: boolean }) {
  const { pending } = useFormStatus();
  return (
    <>
      <FinanceLoadingOverlay show={pending} label="Making the work order challan…" />
      <button type="submit" disabled={pending} style={{ fontSize: 14.5, fontWeight: 800, padding: "12px 22px", borderRadius: 11, border: "none", color: "#fff", background: pending ? "var(--border)" : "#0f172a", cursor: pending ? "default" : "pointer" }}>
        {pending ? "Saving…" : ready ? "💾 Update work order challan →" : "🚚 Convert to work order challan →"}
      </button>
    </>
  );
}

export function PrepareForm({ id, code, temple, alreadyReady, sourceDispatchId, transport, companies }: {
  id: string; code: string; temple: string; alreadyReady: boolean;
  sourceDispatchId: string | null; transport: Transport; companies: string[];
}) {
  const field: React.CSSProperties = { width: "100%", padding: "10px 12px", borderRadius: 9, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)", fontSize: 14 };
  const lbl: React.CSSProperties = { fontSize: 11.5, fontWeight: 700, color: "var(--muted)", display: "block", marginBottom: 4 };
  return (
    <div>
      <Link href="/invoicing/challans" style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)", textDecoration: "none" }}>← Challans</Link>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginTop: 6, marginBottom: 2 }}>
        <h1 style={{ margin: 0, fontSize: 21 }}>Work order challan</h1>
        <span style={{ fontFamily: "ui-monospace, monospace", fontWeight: 800, color: "#0f172a", fontSize: 15 }}>{code}</span>
        {alreadyReady && <span style={{ fontSize: 10.5, fontWeight: 800, color: "#15803d", background: "rgba(22,101,52,0.12)", borderRadius: 999, padding: "3px 9px" }}>✅ Ready</span>}
      </div>
      <p style={{ fontSize: 12.5, color: "var(--muted)", margin: "0 0 16px" }}>🏛 {temple} · fill transport, then convert. This <strong>is</strong> the dispatch challan (same CH number) — converting sends the truck out and readies it for a work order invoice.</p>

      <form action={saveBulkTransportAction} style={{ border: "1px solid var(--border)", borderRadius: 14, padding: 18, background: "var(--surface)" }}>
        <input type="hidden" name="id" value={id} />
        <div style={{ fontSize: 12, fontWeight: 800, textTransform: "uppercase", color: "var(--muted)", marginBottom: 12, letterSpacing: "0.04em" }}>🚚 Transportation</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <label><span style={lbl}>Transport company</span><input name="transport_company" list="prep-companies" defaultValue={transport.company} placeholder="Company name" style={field} /><datalist id="prep-companies">{companies.map((n) => <option key={n} value={n} />)}</datalist></label>
          <label><span style={lbl}>LR no.</span><input name="lr_no" defaultValue={transport.lr} placeholder="LR / builty no." style={field} /></label>
          <label><span style={lbl}>Vehicle no.</span><input name="transport_vehicle_no" defaultValue={transport.vehicle} style={{ ...field, fontFamily: "ui-monospace, monospace" }} /></label>
          <label><span style={lbl}>Transport phone <span style={{ fontWeight: 500 }}>(optional)</span></span><input name="transport_phone" defaultValue={transport.phone} style={field} /></label>
          <label><span style={lbl}>Driver name</span><input name="transport_driver_name" defaultValue={transport.driver} style={field} /></label>
          <label><span style={lbl}>Driver phone</span><input name="transport_driver_phone" defaultValue={transport.driverPhone} style={field} /></label>
        </div>

        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center", marginTop: 18 }}>
          <ConvertBtn ready={alreadyReady} />
          {sourceDispatchId && (
            <Link href={`/dispatch/${sourceDispatchId}/print?draft=1`} target="_blank" rel="noopener noreferrer" style={{ fontSize: 13.5, fontWeight: 800, padding: "12px 18px", borderRadius: 11, border: "1.5px solid #0f2540", background: "var(--surface, #fff)", color: "#0f2540", textDecoration: "none" }}>
              👁 Preview work order challan
            </Link>
          )}
        </div>
        <p style={{ fontSize: 11.5, color: "var(--muted)", margin: "12px 0 0" }}>Preview shows the challan with a <strong>NOT VALID</strong> watermark. After converting, download the valid challan from the Bulk page and create the work order invoice there.</p>
      </form>
    </div>
  );
}
