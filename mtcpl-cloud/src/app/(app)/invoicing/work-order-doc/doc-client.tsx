"use client";

import { useMemo, useState } from "react";
import { createWorkOrderDocAction, deleteWorkOrderDocAction } from "./actions";
import { ConfirmButton } from "@/components/confirm-button";

export type DocRecord = {
  id: string;
  date: string;
  vendor: string;
  jobDescription: string;
  jobWorkNo: string;
  unit: "cft" | "sft";
  quantity: number;
  rate: number;
  total: number;
};

function inr(n: number): string {
  return "₹" + (Math.round(n * 100) / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtDate(d: string): string {
  if (!d) return "—";
  try {
    return new Date(`${d}T00:00:00+05:30`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
  } catch {
    return d;
  }
}
function todayISO(): string {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

const inputStyle: React.CSSProperties = {
  padding: "9px 12px",
  fontSize: 14,
  border: "1px solid var(--border)",
  borderRadius: 8,
  background: "var(--bg)",
  color: "var(--text)",
  width: "100%",
};
function Field({ label, children, flex }: { label: string; children: React.ReactNode; flex?: string }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 4, flex: flex ?? "1 1 200px" }}>
      <span style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>{label}</span>
      {children}
    </label>
  );
}

export function WorkOrderDocClient({
  records,
  toast,
  createdId,
  canDelete,
}: {
  records: DocRecord[];
  toast: string | null;
  createdId: string | null;
  canDelete: boolean;
}) {
  const [unit, setUnit] = useState<"cft" | "sft">("cft");
  const [qty, setQty] = useState("");
  const [rate, setRate] = useState("");
  const total = (Number(qty) || 0) * (Number(rate) || 0);
  const canSubmit = (Number(qty) || 0) > 0 && (Number(rate) || 0) > 0;

  const justCreated = useMemo(() => records.find((r) => r.id === createdId) ?? null, [records, createdId]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {toast && (
        <div style={{ background: "rgba(217,119,6,0.1)", border: "1px solid rgba(217,119,6,0.35)", borderRadius: 10, padding: "10px 14px", fontSize: 13, color: "#92400e" }}>
          {toast}
        </div>
      )}

      {justCreated && (
        <div style={{ background: "rgba(34,197,94,0.1)", border: "1px solid rgba(34,197,94,0.4)", borderRadius: 10, padding: "12px 16px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <span style={{ fontSize: 13, color: "#15803d", fontWeight: 600 }}>
            ✓ Document created for <strong>{justCreated.vendor}</strong>
            {justCreated.jobWorkNo ? ` (No. ${justCreated.jobWorkNo})` : ""}.
          </span>
          <a
            href={`/api/invoicing/work-order-doc/${justCreated.id}`}
            style={{ padding: "9px 18px", fontSize: 13, fontWeight: 800, color: "#fff", background: "var(--gold-dark)", border: "none", borderRadius: 8, textDecoration: "none", whiteSpace: "nowrap" }}
          >
            ⬇ Download document
          </a>
        </div>
      )}

      {/* Form */}
      <form
        action={createWorkOrderDocAction}
        style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 14, padding: 18, display: "flex", flexDirection: "column", gap: 12 }}
      >
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <Field label="Vendor *" flex="2 1 280px">
            <input name="vendor" required placeholder="e.g. Mr. Pintu jii" style={inputStyle} />
          </Field>
          <Field label="Date" flex="0 1 160px">
            <input name="doc_date" type="date" defaultValue={todayISO()} style={inputStyle} />
          </Field>
          <Field label="Job work no." flex="0 1 180px">
            <input name="job_work_no" placeholder="e.g. WO-12" style={inputStyle} />
          </Field>
        </div>
        <Field label="Address">
          <input name="address" placeholder="Vendor address" style={inputStyle} />
        </Field>
        <Field label="Job work description">
          <textarea name="job_description" rows={2} placeholder="e.g. Carving of pillars — black granite" style={{ ...inputStyle, resize: "vertical", fontFamily: "inherit" }} />
        </Field>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
          <Field label="Unit" flex="0 1 130px">
            <select name="unit" value={unit} onChange={(e) => setUnit(e.target.value as "cft" | "sft")} style={inputStyle}>
              <option value="cft">CFT</option>
              <option value="sft">SFT</option>
            </select>
          </Field>
          <Field label="Quantity" flex="0 1 150px">
            <input name="quantity" type="number" min="0" step="0.001" inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} placeholder={`Total ${unit.toUpperCase()}`} style={inputStyle} />
          </Field>
          <Field label={`Price (₹ / ${unit.toUpperCase()})`} flex="0 1 170px">
            <input name="rate" type="number" min="0" step="0.01" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} placeholder="₹ per unit" style={inputStyle} />
          </Field>
          <div style={{ flex: "1 1 160px", display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Total (auto)</span>
            <div style={{ padding: "9px 12px", fontSize: 16, fontWeight: 800, border: "1px solid var(--border)", borderRadius: 8, background: "var(--bg)", fontFamily: "ui-monospace, monospace" }}>
              {inr(total)}
            </div>
          </div>
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button
            type="submit"
            disabled={!canSubmit}
            style={{ padding: "11px 24px", fontSize: 14, fontWeight: 800, color: "#fff", background: canSubmit ? "var(--gold-dark)" : "var(--border)", border: "none", borderRadius: 10, cursor: canSubmit ? "pointer" : "not-allowed" }}
          >
            ✅ Generate document
          </button>
        </div>
      </form>

      {/* Saved records */}
      <div>
        <div style={{ fontSize: 12, fontWeight: 700, color: "var(--muted)", marginBottom: 8 }}>
          Saved documents ({records.length})
        </div>
        <div style={{ overflowX: "auto", border: "1px solid var(--border)", borderRadius: 12, background: "var(--surface)" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, minWidth: 820 }}>
            <thead>
              <tr style={{ background: "var(--surface-alt, rgba(0,0,0,0.03))", textAlign: "left" }}>
                {["Date", "Job no.", "Vendor", "Unit", "Qty", "Rate", "Total", "", ""].map((h, i) => (
                  <th key={i} style={{ padding: "10px 12px", fontSize: 11, fontWeight: 800, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.04em", borderBottom: "1px solid var(--border)", whiteSpace: "nowrap" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {records.length === 0 ? (
                <tr><td colSpan={9} style={{ padding: 24, textAlign: "center", color: "var(--muted)" }}>No documents yet. Fill the form above and tap “Generate document”.</td></tr>
              ) : (
                records.map((r) => (
                  <tr key={r.id} style={{ borderBottom: "1px solid var(--border)", background: r.id === createdId ? "rgba(34,197,94,0.07)" : "transparent" }}>
                    <td style={{ padding: "9px 12px", whiteSpace: "nowrap" }}>{fmtDate(r.date)}</td>
                    <td style={{ padding: "9px 12px", fontFamily: "ui-monospace, monospace", whiteSpace: "nowrap" }}>{r.jobWorkNo || "—"}</td>
                    <td style={{ padding: "9px 12px" }}>{r.vendor}</td>
                    <td style={{ padding: "9px 12px", textTransform: "uppercase" }}>{r.unit}</td>
                    <td style={{ padding: "9px 12px", textAlign: "right", fontFamily: "ui-monospace, monospace" }}>{r.quantity}</td>
                    <td style={{ padding: "9px 12px", textAlign: "right", fontFamily: "ui-monospace, monospace" }}>{inr(r.rate)}</td>
                    <td style={{ padding: "9px 12px", textAlign: "right", fontFamily: "ui-monospace, monospace", fontWeight: 700 }}>{inr(r.total)}</td>
                    <td style={{ padding: "9px 12px", whiteSpace: "nowrap" }}>
                      <a href={`/api/invoicing/work-order-doc/${r.id}`} style={{ color: "var(--gold-dark)", fontWeight: 700, textDecoration: "none" }}>⬇ Download</a>
                    </td>
                    <td style={{ padding: "9px 12px", whiteSpace: "nowrap", textAlign: "right" }}>
                      {canDelete && (
                        <form action={deleteWorkOrderDocAction} style={{ display: "inline" }}>
                          <input type="hidden" name="id" value={r.id} />
                          <ConfirmButton
                            message={`Delete this saved document for ${r.vendor}?`}
                            style={{ fontSize: 12, fontWeight: 700, color: "#b91c1c", background: "rgba(220,38,38,0.08)", border: "1px solid rgba(220,38,38,0.3)", borderRadius: 7, padding: "4px 10px", cursor: "pointer" }}
                          >
                            Delete
                          </ConfirmButton>
                        </form>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
