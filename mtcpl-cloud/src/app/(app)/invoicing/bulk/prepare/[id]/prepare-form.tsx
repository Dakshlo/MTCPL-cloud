"use client";

/** Prepare work order challan (Daksh, Jul 2026). Full split: the delivery challan
 *  LEFT updates LIVE as you type transport on the RIGHT (the fields are pushed to
 *  the embedded challan as query params). "Convert to work order challan" posts
 *  saveBulkTransportAction (fills transport, marks the final work order challan,
 *  releases the dispatch). No separate preview button — the left IS the preview. */

import { useEffect, useState } from "react";
import Link from "next/link";
import { useFormStatus } from "react-dom";
import { FinanceLoadingOverlay } from "@/components/finance-loading-overlay";
import { saveBulkTransportAction } from "../../../actions";

type Transport = { company: string; phone: string; lr: string; vehicle: string; driver: string; driverPhone: string };

function buildSrc(dispatchId: string, t: Transport): string {
  const p = new URLSearchParams({ embed: "1", tc: t.company, tph: t.phone, lr: t.lr, veh: t.vehicle, drv: t.driver, drvph: t.driverPhone });
  return `/dispatch/${dispatchId}/print?${p.toString()}`;
}

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
  const [t, setT] = useState<Transport>(transport);
  const set = (k: keyof Transport, v: string) => setT((p) => ({ ...p, [k]: v }));

  // Debounced live-preview src — reload the embedded challan ~0.4s after typing
  // stops so it reflects the current (un-saved) transport fields.
  const [src, setSrc] = useState(() => (sourceDispatchId ? buildSrc(sourceDispatchId, transport) : ""));
  useEffect(() => {
    if (!sourceDispatchId) return;
    const h = setTimeout(() => setSrc(buildSrc(sourceDispatchId, t)), 400);
    return () => clearTimeout(h);
  }, [t, sourceDispatchId]);

  const field: React.CSSProperties = { width: "100%", padding: "10px 12px", borderRadius: 9, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)", fontSize: 14 };
  const lbl: React.CSSProperties = { fontSize: 11.5, fontWeight: 700, color: "var(--muted)", display: "block", marginBottom: 4 };

  return (
    <div style={{ display: "flex", gap: 16, alignItems: "flex-start", paddingBottom: 40 }}>
      {/* LEFT — the challan, live. */}
      {sourceDispatchId ? (
        <div style={{ flex: "1 1 560px", minWidth: 380, position: "sticky", top: 10, display: "flex", flexDirection: "column", height: "calc(100vh - 20px)", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden", background: "var(--surface)", marginTop: 44 }}>
          <div style={{ padding: "9px 14px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
            <span style={{ fontSize: 12, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--muted)" }}>📋 Work order challan — {code} <span style={{ fontWeight: 600, textTransform: "none", color: "#b45309" }}>· live preview</span></span>
            <Link href={`/dispatch/${sourceDispatchId}/print`} target="_blank" rel="noopener noreferrer" style={{ fontSize: 11.5, fontWeight: 700, color: "var(--gold-dark)", textDecoration: "none", whiteSpace: "nowrap" }}>Open full ↗</Link>
          </div>
          <iframe src={src} title="Work order challan" style={{ flex: 1, width: "100%", border: "none", background: "#f0f0f0" }} />
        </div>
      ) : (
        <div style={{ flex: "1 1 400px", minWidth: 340, marginTop: 44 }} className="banner">This challan has no linked dispatch — nothing to preview.</div>
      )}

      {/* RIGHT — transport form. */}
      <div style={{ flex: "1 1 460px", minWidth: 340, marginTop: 44 }}>
        <Link href="/invoicing/challans" style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)", textDecoration: "none" }}>← Challans</Link>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginTop: 6, marginBottom: 2 }}>
          <h1 style={{ margin: 0, fontSize: 21 }}>Work order challan</h1>
          <span style={{ fontFamily: "ui-monospace, monospace", fontWeight: 800, color: "#0f172a", fontSize: 15 }}>{code}</span>
          {alreadyReady && <span style={{ fontSize: 10.5, fontWeight: 800, color: "#15803d", background: "rgba(22,101,52,0.12)", borderRadius: 999, padding: "3px 9px" }}>✅ Ready</span>}
        </div>
        <p style={{ fontSize: 12.5, color: "var(--muted)", margin: "0 0 16px" }}>🏛 {temple} · fill transport (it updates the challan on the left as you type), then convert. This <strong>is</strong> the dispatch challan (same CH number).</p>

        <form action={saveBulkTransportAction} style={{ border: "1px solid var(--border)", borderRadius: 14, padding: 18, background: "var(--surface)" }}>
          <input type="hidden" name="id" value={id} />
          <div style={{ fontSize: 12, fontWeight: 800, textTransform: "uppercase", color: "var(--muted)", marginBottom: 12, letterSpacing: "0.04em" }}>🚚 Transportation</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <label><span style={lbl}>Transport company</span><input name="transport_company" list="prep-companies" value={t.company} onChange={(e) => set("company", e.target.value)} placeholder="Company name" style={field} /><datalist id="prep-companies">{companies.map((n) => <option key={n} value={n} />)}</datalist></label>
            <label><span style={lbl}>LR no.</span><input name="lr_no" value={t.lr} onChange={(e) => set("lr", e.target.value)} placeholder="LR / builty no." style={field} /></label>
            <label><span style={lbl}>Vehicle no.</span><input name="transport_vehicle_no" value={t.vehicle} onChange={(e) => set("vehicle", e.target.value)} style={{ ...field, fontFamily: "ui-monospace, monospace" }} /></label>
            <label><span style={lbl}>Transport phone <span style={{ fontWeight: 500 }}>(optional)</span></span><input name="transport_phone" value={t.phone} onChange={(e) => set("phone", e.target.value)} style={field} /></label>
            <label><span style={lbl}>Driver name</span><input name="transport_driver_name" value={t.driver} onChange={(e) => set("driver", e.target.value)} style={field} /></label>
            <label><span style={lbl}>Driver phone</span><input name="transport_driver_phone" value={t.driverPhone} onChange={(e) => set("driverPhone", e.target.value)} style={field} /></label>
          </div>

          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center", marginTop: 18 }}>
            <ConvertBtn ready={alreadyReady} />
          </div>
          <p style={{ fontSize: 11.5, color: "var(--muted)", margin: "12px 0 0" }}>The challan on the left is a <strong>live preview</strong>. After converting, download the valid challan from the Bulk page and create the work order invoice there.</p>
        </form>
      </div>
    </div>
  );
}
