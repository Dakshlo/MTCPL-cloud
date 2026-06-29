"use client";

/**
 * Temple Codes editor — one row per temple that opens a MODAL peek with all of
 * that temple's billing / shipping / installation / vendor / GST info (Daksh —
 * too much to show inline). Saving shows the spinning MTCPL logo. The GST %
 * fields are shown only for the selected GST type. Reused by the full Settings →
 * Temple Codes section (with rename + delete) and the accountant /settings/
 * temples editor (edit-only).
 */

import { useState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { updateTempleAction, deleteTempleAction } from "./actions";
import { BILLING_FIELDS, SHIPPING_FIELDS, SHARED_FIELDS } from "@/lib/temple-billing-fields";
import { FinanceLoadingOverlay } from "@/components/finance-loading-overlay";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Temple = Record<string, any>;

// Save feedback now uses the SAME branded overlay as the Finance department
// (the circular MTCPL mark in a glowing disc) instead of spinning the full
// wordmark logo, which read oddly (Daksh). useFormStatus keeps it driven by the
// surrounding <form>'s pending state.
function SaveOverlay() {
  const { pending } = useFormStatus();
  return <FinanceLoadingOverlay show={pending} label="Saving…" />;
}

export function TempleEditModal({
  temple, canDelete = false, returnTo, renameSlot = null,
}: {
  temple: Temple;
  canDelete?: boolean;
  /** Where updateTempleAction redirects back to. */
  returnTo: "settings" | "temples";
  /** Owner/dev-only rename form (rendered server-side, passed in). */
  renameSlot?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [gstMode, setGstMode] = useState<string>(temple.gst_mode ?? "none");

  const gstSummary = temple.gst_mode === "igst"
    ? `IGST ${temple.igst_percent ?? ""}%`
    : temple.gst_mode === "cgst_sgst"
    ? `CGST+SGST ${temple.cgst_percent ?? ""}+${temple.sgst_percent ?? ""}%`
    : "No GST";

  const fieldset: React.CSSProperties = { flex: "1 1 300px", minWidth: 260, border: "1px solid var(--border)", borderRadius: 10, padding: "10px 12px", display: "flex", flexDirection: "column", gap: 7 };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        style={{ width: "100%", textAlign: "left", display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", border: "1px solid var(--border)", borderRadius: 10, background: "var(--surface)", cursor: "pointer", color: "var(--text)", fontSize: 15, fontWeight: 800 }}
      >
        🛕 {temple.name}
        <code className="code-badge" style={{ fontWeight: 700 }}>{temple.code_prefix}</code>
        {!temple.is_active && <span className="role-pill badge-discarded" style={{ fontSize: 10 }}>Inactive</span>}
        <span style={{ marginLeft: "auto", fontSize: 11.5, fontWeight: 600, color: "var(--muted)" }}>{gstSummary}</span>
        <span style={{ fontSize: 12, color: "var(--muted)" }}>Edit ▸</span>
      </button>

      {open && (
        <div
          onClick={(e) => { if (e.target === e.currentTarget) setOpen(false); }}
          style={{ position: "fixed", inset: 0, zIndex: 900, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "5vh 14px", overflowY: "auto" }}
        >
          <div style={{ width: "100%", maxWidth: 920, background: "var(--bg)", borderRadius: 14, border: "1px solid var(--border)", boxShadow: "0 20px 60px rgba(0,0,0,0.3)", overflow: "hidden" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 18px", borderBottom: "1px solid var(--border)", background: "var(--surface)" }}>
              <div style={{ fontSize: 16, fontWeight: 800 }}>🛕 {temple.name}</div>
              <code className="code-badge">{temple.code_prefix}</code>
              <span className="muted" style={{ fontSize: 12 }}>Stone: {temple.default_stone ?? "—"} · 🔒 name / code / stone locked</span>
              <button type="button" onClick={() => setOpen(false)} style={{ marginLeft: "auto", border: "none", background: "transparent", fontSize: 20, cursor: "pointer", color: "var(--muted)", lineHeight: 1 }}>✕</button>
            </div>

            <div style={{ padding: "14px 18px", maxHeight: "78vh", overflowY: "auto" }}>
              {renameSlot}

              <form action={updateTempleAction}>
                <SaveOverlay />
                <input type="hidden" name="id" value={temple.id} />
                <input type="hidden" name="temple_name" value={temple.name} />
                <input type="hidden" name="return" value={returnTo} />

                <div className="settings-form-row">
                  <label className="stack" style={{ flex: 1 }}>
                    <span>Installation By</span>
                    <input name="installer_name" defaultValue={temple.installer_name ?? ""} />
                  </label>
                  <label className="stack" style={{ flex: "0 0 170px" }}>
                    <span>Installation Mobile No.</span>
                    <input name="installer_phone" type="tel" defaultValue={temple.installer_phone ?? ""} />
                  </label>
                  <label className="stack" style={{ flex: "0 0 140px" }}>
                    <span>Status</span>
                    <select name="is_active" defaultValue={String(temple.is_active)}>
                      <option value="true">Active</option>
                      <option value="false">Inactive</option>
                    </select>
                  </label>
                </div>

                <div style={{ display: "flex", gap: 12, marginTop: 14, flexWrap: "wrap" }}>
                  <fieldset style={fieldset}>
                    <legend style={{ fontSize: 12.5, fontWeight: 800, padding: "0 6px" }}>🧾 Billing To</legend>
                    {BILLING_FIELDS.map((f) => (
                      <label key={f.key} className="stack"><span>{f.label}</span><input name={f.key} defaultValue={temple[f.key] ?? ""} /></label>
                    ))}
                  </fieldset>
                  <fieldset style={fieldset}>
                    <legend style={{ fontSize: 12.5, fontWeight: 800, padding: "0 6px" }}>📦 Shipping To <span className="muted" style={{ fontWeight: 600 }}>· blank = same as billing</span></legend>
                    {SHIPPING_FIELDS.map((f) => (
                      <label key={f.key} className="stack"><span>{f.label}</span><input name={f.key} defaultValue={temple[f.key] ?? ""} /></label>
                    ))}
                  </fieldset>
                </div>

                {/* GST — only the % for the chosen type is shown. */}
                <div className="settings-form-row" style={{ marginTop: 12, alignItems: "flex-end" }}>
                  <label className="stack" style={{ flex: "0 0 200px" }}>
                    <span>🧾 GST type (client)</span>
                    <select name="gst_mode" value={gstMode} onChange={(e) => setGstMode(e.target.value)}>
                      <option value="none">No GST</option>
                      <option value="igst">IGST</option>
                      <option value="cgst_sgst">CGST + SGST</option>
                    </select>
                  </label>
                  {gstMode === "igst" && (
                    <label className="stack" style={{ flex: "0 0 130px" }}><span>IGST %</span><input name="igst_percent" type="number" step="0.01" min="0" defaultValue={temple.igst_percent ?? ""} /></label>
                  )}
                  {gstMode === "cgst_sgst" && (
                    <>
                      <label className="stack" style={{ flex: "0 0 130px" }}><span>CGST %</span><input name="cgst_percent" type="number" step="0.01" min="0" defaultValue={temple.cgst_percent ?? ""} /></label>
                      <label className="stack" style={{ flex: "0 0 130px" }}><span>SGST %</span><input name="sgst_percent" type="number" step="0.01" min="0" defaultValue={temple.sgst_percent ?? ""} /></label>
                    </>
                  )}
                  {/* Mig 171 — which HSN to print for this temple. Vendor HSN
                      forces an 18% GST slab when pricing. */}
                  <label className="stack" style={{ flex: "0 0 240px" }}>
                    <span>🪨 HSN on invoice</span>
                    <select name="hsn_use_vendor" defaultValue={temple.hsn_use_vendor ? "true" : "false"}>
                      <option value="false">HSN code (default)</option>
                      <option value="true">Vendor HSN → 18% GST</option>
                    </select>
                  </label>
                </div>

                <div className="settings-form-row" style={{ marginTop: 12, alignItems: "flex-end" }}>
                  {SHARED_FIELDS.map((f) => (
                    <label key={f.key} className="stack" style={{ flex: 1 }}><span>{f.label}</span><input name={f.key} defaultValue={temple[f.key] ?? ""} /></label>
                  ))}
                  <div style={{ display: "flex", gap: 8, marginLeft: "auto" }}>
                    <button className="primary-button" type="submit">Save</button>
                    {canDelete && (
                      <button className="ghost-button danger-ghost" formAction={deleteTempleAction} formNoValidate type="submit">Delete</button>
                    )}
                  </div>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
