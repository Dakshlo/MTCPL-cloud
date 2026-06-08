"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createWorkOrderDocAction, deleteWorkOrderDocAction, createWoVendorAction, updateWoVendorAction, deleteWoVendorAction } from "./actions";
import { VendorPicker, type VendorPickerOption } from "../../accounts/bills/new/vendor-picker";

export type DocRecord = {
  id: string;
  date: string;
  vendor: string;
  jobDescription: string;
  descriptionDetail: string;
  jobWorkNo: string;
  unit: "cft" | "sft";
  quantity: number;
  rate: number;
  total: number;
};
export type SavedVendor = { id: string; name: string; address: string };

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

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
      <span style={{ fontSize: 11, fontWeight: 800, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.06em" }}>{label}</span>
      {children}
      {hint && <span style={{ fontSize: 11, color: "var(--muted)" }}>{hint}</span>}
    </label>
  );
}

export function WorkOrderDocClient({
  records,
  vendors,
  toast,
  createdId,
  vendorAddedId,
  canDelete,
}: {
  records: DocRecord[];
  vendors: SavedVendor[];
  toast: string | null;
  createdId: string | null;
  vendorAddedId: string | null;
  canDelete: boolean;
}) {
  const [unit, setUnit] = useState<"cft" | "sft">("cft");
  const [qty, setQty] = useState("");
  const [rate, setRate] = useState("");
  const [vendorName, setVendorName] = useState("");
  const [address, setAddress] = useState("");
  const [selectedVendorId, setSelectedVendorId] = useState("");
  const [docDate, setDocDate] = useState(todayISO());
  const [showAddVendor, setShowAddVendor] = useState(false);
  const [showRecords, setShowRecords] = useState(false);
  // Edit-vendor modal (null = closed).
  const [editVendor, setEditVendor] = useState<{ id: string; name: string; address: string } | null>(null);
  // Custom (our-UI) confirmation gate. null = closed.
  const [confirmAction, setConfirmAction] = useState<
    | { kind: "generate" }
    | { kind: "delete"; id: string; vendor: string }
    | { kind: "deleteVendor"; id: string; name: string }
    | null
  >(null);

  const formRef = useRef<HTMLFormElement>(null);
  const deleteFormRef = useRef<HTMLFormElement>(null);
  const [deleteId, setDeleteId] = useState("");
  const vendorDeleteFormRef = useRef<HTMLFormElement>(null);
  const [vendorDeleteId, setVendorDeleteId] = useState("");

  useEffect(() => {
    if (!vendorAddedId) return;
    const v = vendors.find((x) => x.id === vendorAddedId);
    if (v) {
      setSelectedVendorId(v.id);
      setVendorName(v.name);
      setAddress(v.address);
    }
  }, [vendorAddedId, vendors]);

  function pickVendor(id: string) {
    setSelectedVendorId(id);
    const v = vendors.find((x) => x.id === id);
    if (v) {
      setVendorName(v.name);
      setAddress(v.address);
    }
  }

  // Finance-style combobox options (name + address shown as the subtitle).
  const vendorOptions: VendorPickerOption[] = useMemo(
    () => vendors.map((v) => ({ id: v.id, name: v.name, category: v.address || null, gstin: null })),
    [vendors],
  );
  const selectedVendor = useMemo(
    () => vendors.find((v) => v.id === selectedVendorId) ?? null,
    [vendors, selectedVendorId],
  );

  const total = (Number(qty) || 0) * (Number(rate) || 0);
  const canSubmit = vendorName.trim().length > 0 && (Number(qty) || 0) > 0 && (Number(rate) || 0) > 0;
  const justCreated = useMemo(() => records.find((r) => r.id === createdId) ?? null, [records, createdId]);

  // Live preview of the auto code (year tracks the selected date; the
  // running number is assigned server-side at save).
  const codeYear = /^\d{4}/.test(docDate) ? docDate.slice(0, 4) : String(new Date().getFullYear());
  const codePreview = `MTCPL-WO-${codeYear}-XXXX`;

  function confirmYes() {
    const a = confirmAction;
    setConfirmAction(null);
    if (!a) return;
    if (a.kind === "generate") {
      formRef.current?.requestSubmit();
    } else if (a.kind === "delete") {
      setDeleteId(a.id);
      // Let the hidden input's value flush before submitting.
      requestAnimationFrame(() => deleteFormRef.current?.requestSubmit());
    } else if (a.kind === "deleteVendor") {
      setVendorDeleteId(a.id);
      requestAnimationFrame(() => vendorDeleteFormRef.current?.requestSubmit());
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18, maxWidth: 920 }}>
      <style>{`
        .wod-in { width:100%; box-sizing:border-box; padding:10px 13px; font-size:14px; border:1px solid var(--border);
                  border-radius:10px; background:var(--bg); color:var(--text); transition:border-color .15s, box-shadow .15s; }
        .wod-in:focus { outline:none; border-color:var(--gold); box-shadow:0 0 0 3px rgba(201,161,74,0.18); }
        .wod-row:hover { background:rgba(201,161,74,0.05); }
        .wod-btn { transition:transform .08s ease, filter .15s ease; }
        .wod-btn:hover:not(:disabled) { filter:brightness(1.04); }
        .wod-btn:active:not(:disabled) { transform:translateY(1px); }
      `}</style>

      {/* ── Top action row ─────────────────────────────────────────── */}
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <button type="button" onClick={() => setShowAddVendor(true)} className="wod-btn" style={{ padding: "10px 18px", fontSize: 13, fontWeight: 800, color: "#fff", background: "var(--gold-dark)", border: "none", borderRadius: 10, cursor: "pointer", whiteSpace: "nowrap", boxShadow: "0 2px 8px rgba(146,64,14,0.22)" }}>
          ＋ Add vendor
        </button>
        <button type="button" onClick={() => setShowRecords(true)} className="wod-btn" style={{ padding: "10px 18px", fontSize: 13, fontWeight: 800, color: "var(--text)", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, cursor: "pointer", whiteSpace: "nowrap" }}>
          🗂️ Saved documents <span style={{ fontWeight: 700, color: "var(--muted)", background: "var(--surface-alt, rgba(0,0,0,0.05))", borderRadius: 999, padding: "1px 8px", marginLeft: 4 }}>{records.length}</span>
        </button>
      </div>

      {toast && (
        <div style={{ background: "rgba(217,119,6,0.1)", border: "1px solid rgba(217,119,6,0.35)", borderRadius: 12, padding: "11px 15px", fontSize: 13, color: "#92400e" }}>
          {toast}
        </div>
      )}

      {justCreated && (
        <div style={{ background: "linear-gradient(135deg, rgba(34,197,94,0.12), rgba(34,197,94,0.04))", border: "1px solid rgba(34,197,94,0.4)", borderRadius: 14, padding: "14px 18px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <span style={{ fontSize: 14, color: "#15803d", fontWeight: 700 }}>
            ✓ Document ready for <strong>{justCreated.vendor}</strong>
            {justCreated.jobWorkNo ? ` · ${justCreated.jobWorkNo}` : ""}
          </span>
          <a className="wod-btn" href={`/api/invoicing/work-order-doc/${justCreated.id}`} style={{ padding: "10px 20px", fontSize: 14, fontWeight: 800, color: "#fff", background: "var(--gold-dark)", borderRadius: 10, textDecoration: "none", whiteSpace: "nowrap", boxShadow: "0 2px 8px rgba(146,64,14,0.25)" }}>
            ⬇ Download document
          </a>
        </div>
      )}

      {/* ── The form card ─────────────────────────────────────────── */}
      <form ref={formRef} action={createWorkOrderDocAction} style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 16, overflow: "visible", boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
        {/* Hidden submitted values (vendor + address come from the picker). */}
        <input type="hidden" name="vendor" value={vendorName} />

        <div style={{ padding: 20, display: "flex", flexDirection: "column", gap: 16 }}>
          {/* Vendor (finance-style combobox) / date / auto code */}
          <div style={{ display: "grid", gridTemplateColumns: "minmax(240px, 2fr) minmax(150px, 1fr)", gap: 14 }}>
            <Field label="Vendor *" hint="Pick a saved vendor, or use ＋ Add vendor above.">
              <VendorPicker
                vendors={vendorOptions}
                selectedId={selectedVendorId}
                onChange={pickVendor}
                placeholder="— Select a vendor —"
              />
              {selectedVendor && (
                <div style={{ display: "flex", gap: 8, marginTop: 2 }}>
                  <button
                    type="button"
                    onClick={() => setEditVendor({ id: selectedVendor.id, name: selectedVendor.name, address: selectedVendor.address })}
                    style={{ fontSize: 12, fontWeight: 700, color: "var(--gold-dark)", background: "var(--bg)", border: "1px solid var(--gold)", borderRadius: 8, padding: "4px 10px", cursor: "pointer" }}
                  >
                    ✏️ Edit vendor
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmAction({ kind: "deleteVendor", id: selectedVendor.id, name: selectedVendor.name })}
                    style={{ fontSize: 12, fontWeight: 700, color: "#b91c1c", background: "rgba(220,38,38,0.08)", border: "1px solid rgba(220,38,38,0.3)", borderRadius: 8, padding: "4px 10px", cursor: "pointer" }}
                  >
                    🗑 Delete vendor
                  </button>
                </div>
              )}
            </Field>
            <Field label="Date">
              <input name="doc_date" type="date" value={docDate} onChange={(e) => setDocDate(e.target.value)} className="wod-in" />
            </Field>
          </div>

          <Field label="Work order code" hint="Generated automatically when you create the document.">
            <div style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "10px 13px", border: "1px dashed var(--border)", borderRadius: 10, background: "var(--surface-alt, rgba(0,0,0,0.03))", fontFamily: "ui-monospace, monospace", fontWeight: 800, color: "var(--gold-dark)", fontSize: 14, width: "fit-content" }}>
              🏷️ {codePreview}
              <span style={{ fontFamily: "system-ui, sans-serif", fontWeight: 600, fontSize: 10.5, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>auto</span>
            </div>
          </Field>

          <Field label="Address">
            <input name="address" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Vendor address" className="wod-in" />
          </Field>

          <Field label="Job work description">
            <textarea name="job_description" rows={2} placeholder="e.g. Carving of pillars — black granite" className="wod-in" style={{ resize: "vertical", fontFamily: "inherit", lineHeight: 1.5 }} />
          </Field>

          <Field label="Description detail (optional)">
            <textarea name="description_detail" rows={2} placeholder="Any extra notes / specifications (optional)" className="wod-in" style={{ resize: "vertical", fontFamily: "inherit", lineHeight: 1.5 }} />
          </Field>

          {/* ── Pricing strip ───────────────────────────────────────── */}
          <div style={{ background: "var(--gold-subtle, rgba(201,161,74,0.08))", border: "1px solid var(--gold-border, rgba(201,161,74,0.3))", borderRadius: 12, padding: 16, display: "flex", gap: 16, alignItems: "flex-end", justifyContent: "space-between", flexWrap: "wrap" }}>
            <div style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "flex-end" }}>
              <Field label="Unit">
                <select name="unit" value={unit} onChange={(e) => setUnit(e.target.value as "cft" | "sft")} className="wod-in" style={{ width: 96 }}>
                  <option value="cft">CFT</option>
                  <option value="sft">SFT</option>
                </select>
              </Field>
              <Field label="Quantity">
                <input name="quantity" type="number" min="0" step="0.001" inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} placeholder={`Total ${unit.toUpperCase()}`} className="wod-in" style={{ width: 130 }} />
              </Field>
              <Field label={`Price · ₹/${unit.toUpperCase()}`}>
                <input name="rate" type="number" min="0" step="0.01" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} placeholder="₹ per unit" className="wod-in" style={{ width: 150 }} />
              </Field>
            </div>
            <div style={{ textAlign: "right", minWidth: 140 }}>
              <div style={{ fontSize: 11, fontWeight: 800, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>Total (auto)</div>
              <div style={{ fontSize: 26, fontWeight: 900, color: "var(--gold-dark)", fontFamily: "ui-monospace, monospace", lineHeight: 1 }}>{inr(total)}</div>
            </div>
          </div>

          {/* Generate — opens our confirmation modal (no browser confirm). */}
          <button type="button" onClick={() => canSubmit && setConfirmAction({ kind: "generate" })} disabled={!canSubmit} className="wod-btn" style={{ alignSelf: "flex-end", padding: "12px 28px", fontSize: 15, fontWeight: 800, color: "#fff", background: canSubmit ? "var(--gold-dark)" : "var(--border)", border: "none", borderRadius: 12, cursor: canSubmit ? "pointer" : "not-allowed", boxShadow: canSubmit ? "0 3px 10px rgba(146,64,14,0.25)" : "none" }}>
            ✅ Generate &amp; download
          </button>
        </div>
      </form>

      {/* Hidden delete form, driven by the confirm modal (owner only). */}
      <form ref={deleteFormRef} action={deleteWorkOrderDocAction} style={{ display: "none" }}>
        <input type="hidden" name="id" value={deleteId} readOnly />
      </form>
      {/* Hidden vendor-delete form, driven by the confirm modal. */}
      <form ref={vendorDeleteFormRef} action={deleteWoVendorAction} style={{ display: "none" }}>
        <input type="hidden" name="id" value={vendorDeleteId} readOnly />
      </form>

      {/* ── Saved-documents peek (centered modal) ─────────────────── */}
      {showRecords && (
        <div
          onClick={() => setShowRecords(false)}
          style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(15,23,42,0.5)", backdropFilter: "blur(3px)", display: "flex", alignItems: "center", justifyContent: "center", padding: "6vh 16px", overflowY: "auto" }}
        >
          <div onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: 860, maxHeight: "88vh", display: "flex", flexDirection: "column", background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 16, boxShadow: "0 24px 60px rgba(0,0,0,0.3)", overflow: "hidden" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "16px 20px", borderBottom: "1px solid var(--border)" }}>
              <h2 style={{ margin: 0, fontSize: 18, display: "flex", alignItems: "center", gap: 8 }}>
                🗂️ Saved documents
                <span style={{ fontSize: 12, fontWeight: 700, color: "var(--muted)", background: "var(--surface-alt, rgba(0,0,0,0.05))", borderRadius: 999, padding: "2px 9px" }}>{records.length}</span>
              </h2>
              <button type="button" onClick={() => setShowRecords(false)} style={{ background: "none", border: "none", fontSize: 26, lineHeight: 1, cursor: "pointer", color: "var(--muted)" }} aria-label="Close">×</button>
            </div>
            <div style={{ overflow: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, minWidth: 720 }}>
                <thead>
                  <tr style={{ background: "var(--surface-alt, rgba(0,0,0,0.03))", textAlign: "left", position: "sticky", top: 0 }}>
                    {["Date", "Code", "Vendor", "Unit", "Qty", "Rate", "Total", "", ""].map((h, i) => (
                      <th key={i} style={{ padding: "11px 14px", fontSize: 10.5, fontWeight: 800, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.05em", borderBottom: "1px solid var(--border)", whiteSpace: "nowrap", textAlign: i === 4 || i === 5 || i === 6 ? "right" : "left" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {records.length === 0 ? (
                    <tr><td colSpan={9} style={{ padding: 32, textAlign: "center", color: "var(--muted)" }}>No documents yet.</td></tr>
                  ) : (
                    records.map((r) => (
                      <tr key={r.id} className="wod-row" style={{ borderBottom: "1px solid var(--border)", background: r.id === createdId ? "rgba(34,197,94,0.08)" : "transparent", transition: "background .12s" }}>
                        <td style={{ padding: "11px 14px", whiteSpace: "nowrap" }}>{fmtDate(r.date)}</td>
                        <td style={{ padding: "11px 14px", fontFamily: "ui-monospace, monospace", fontWeight: 700, whiteSpace: "nowrap" }}>{r.jobWorkNo || "—"}</td>
                        <td style={{ padding: "11px 14px", fontWeight: 600 }}>{r.vendor}</td>
                        <td style={{ padding: "11px 14px", textTransform: "uppercase", color: "var(--muted)" }}>{r.unit}</td>
                        <td style={{ padding: "11px 14px", textAlign: "right", fontFamily: "ui-monospace, monospace" }}>{r.quantity}</td>
                        <td style={{ padding: "11px 14px", textAlign: "right", fontFamily: "ui-monospace, monospace", color: "var(--muted)" }}>{inr(r.rate)}</td>
                        <td style={{ padding: "11px 14px", textAlign: "right", fontFamily: "ui-monospace, monospace", fontWeight: 800 }}>{inr(r.total)}</td>
                        <td style={{ padding: "11px 14px", whiteSpace: "nowrap" }}>
                          <a href={`/api/invoicing/work-order-doc/${r.id}`} style={{ color: "var(--gold-dark)", fontWeight: 700, textDecoration: "none" }}>⬇ PDF</a>
                        </td>
                        <td style={{ padding: "11px 14px", whiteSpace: "nowrap", textAlign: "right" }}>
                          {canDelete && (
                            <button
                              type="button"
                              onClick={() => setConfirmAction({ kind: "delete", id: r.id, vendor: r.vendor })}
                              style={{ fontSize: 12, fontWeight: 700, color: "#b91c1c", background: "rgba(220,38,38,0.08)", border: "1px solid rgba(220,38,38,0.3)", borderRadius: 8, padding: "5px 11px", cursor: "pointer" }}
                            >
                              Delete
                            </button>
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
      )}

      {/* ── Custom confirmation modal (our UI — not the browser dialog) ── */}
      {confirmAction && (
        <div
          onClick={() => setConfirmAction(null)}
          style={{ position: "fixed", inset: 0, zIndex: 1100, background: "rgba(15,23,42,0.55)", backdropFilter: "blur(3px)", display: "flex", alignItems: "center", justifyContent: "center", padding: "16px" }}
        >
          <div onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: 420, background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 16, padding: 24, boxShadow: "0 24px 60px rgba(0,0,0,0.32)" }}>
            {confirmAction.kind === "generate" ? (
              <>
                <h2 style={{ margin: "0 0 6px", fontSize: 19 }}>Generate this work order?</h2>
                <p className="muted" style={{ margin: "0 0 16px", fontSize: 13 }}>
                  A document will be created and saved. You can download it right after.
                </p>
                <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: "12px 14px", display: "flex", flexDirection: "column", gap: 6, fontSize: 13, marginBottom: 18 }}>
                  <Row k="Vendor" v={vendorName || "—"} />
                  <Row k="Code" v={codePreview} mono />
                  <Row k="Date" v={fmtDate(docDate)} />
                  <Row k="Qty × Rate" v={`${qty || 0} ${unit.toUpperCase()} × ${inr(Number(rate) || 0)}`} />
                  <Row k="Total" v={inr(total)} strong />
                </div>
                <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                  <button type="button" onClick={() => setConfirmAction(null)} style={btnGhost}>Cancel</button>
                  <button type="button" onClick={confirmYes} className="wod-btn" style={{ ...btnPrimary, background: "var(--gold-dark)" }}>✅ Confirm &amp; generate</button>
                </div>
              </>
            ) : confirmAction.kind === "deleteVendor" ? (
              <>
                <h2 style={{ margin: "0 0 6px", fontSize: 19 }}>Delete this vendor?</h2>
                <p className="muted" style={{ margin: "0 0 18px", fontSize: 13 }}>
                  <strong style={{ color: "var(--text)" }}>{confirmAction.name}</strong> will be removed from the saved-vendor list. Documents already generated are unaffected.
                </p>
                <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                  <button type="button" onClick={() => setConfirmAction(null)} style={btnGhost}>Cancel</button>
                  <button type="button" onClick={confirmYes} className="wod-btn" style={{ ...btnPrimary, background: "#b91c1c" }}>Delete vendor</button>
                </div>
              </>
            ) : (
              <>
                <h2 style={{ margin: "0 0 6px", fontSize: 19 }}>Delete this document?</h2>
                <p className="muted" style={{ margin: "0 0 18px", fontSize: 13 }}>
                  The saved work order for <strong style={{ color: "var(--text)" }}>{confirmAction.vendor}</strong> will be permanently removed. This can&apos;t be undone.
                </p>
                <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                  <button type="button" onClick={() => setConfirmAction(null)} style={btnGhost}>Cancel</button>
                  <button type="button" onClick={confirmYes} className="wod-btn" style={{ ...btnPrimary, background: "#b91c1c" }}>Delete</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* ── Add-vendor modal (separate form, not nested) ──────────── */}
      {showAddVendor && (
        <div
          onClick={() => setShowAddVendor(false)}
          style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(15,23,42,0.5)", backdropFilter: "blur(3px)", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "8vh 16px", overflowY: "auto" }}
        >
          <div onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: 440, background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 16, padding: 22, boxShadow: "0 24px 60px rgba(0,0,0,0.3)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <h2 style={{ margin: 0, fontSize: 18 }}>👤 Add vendor</h2>
              <button type="button" onClick={() => setShowAddVendor(false)} style={{ background: "none", border: "none", fontSize: 24, lineHeight: 1, cursor: "pointer", color: "var(--muted)" }} aria-label="Close">×</button>
            </div>
            <form action={createWoVendorAction} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <Field label="Vendor name *">
                <input name="name" required placeholder="e.g. Mr. Pintu jii" className="wod-in" />
              </Field>
              <Field label="Address">
                <input name="address" placeholder="Vendor address" className="wod-in" />
              </Field>
              <div style={{ fontSize: 11, color: "var(--muted)" }}>Saving will pre-select this vendor on the form.</div>
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                <button type="button" onClick={() => setShowAddVendor(false)} style={btnGhost}>Cancel</button>
                <button type="submit" className="wod-btn" style={{ ...btnPrimary, background: "var(--gold-dark)" }}>Save vendor</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Edit-vendor modal ─────────────────────────────────────── */}
      {editVendor && (
        <div
          onClick={() => setEditVendor(null)}
          style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(15,23,42,0.5)", backdropFilter: "blur(3px)", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "8vh 16px", overflowY: "auto" }}
        >
          <div onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: 440, background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 16, padding: 22, boxShadow: "0 24px 60px rgba(0,0,0,0.3)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <h2 style={{ margin: 0, fontSize: 18 }}>✏️ Edit vendor</h2>
              <button type="button" onClick={() => setEditVendor(null)} style={{ background: "none", border: "none", fontSize: 24, lineHeight: 1, cursor: "pointer", color: "var(--muted)" }} aria-label="Close">×</button>
            </div>
            <form action={updateWoVendorAction} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <input type="hidden" name="id" value={editVendor.id} />
              <Field label="Vendor name *">
                <input name="name" required defaultValue={editVendor.name} placeholder="e.g. Mr. Pintu jii" className="wod-in" />
              </Field>
              <Field label="Address">
                <input name="address" defaultValue={editVendor.address} placeholder="Vendor address" className="wod-in" />
              </Field>
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                <button type="button" onClick={() => setEditVendor(null)} style={btnGhost}>Cancel</button>
                <button type="submit" className="wod-btn" style={{ ...btnPrimary, background: "var(--gold-dark)" }}>Save changes</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

function Row({ k, v, mono, strong }: { k: string; v: string; mono?: boolean; strong?: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
      <span style={{ color: "var(--muted)" }}>{k}</span>
      <span style={{ fontWeight: strong ? 900 : 600, fontFamily: mono ? "ui-monospace, monospace" : "inherit", color: strong ? "var(--gold-dark)" : "var(--text)", textAlign: "right" }}>{v}</span>
    </div>
  );
}

const btnGhost: React.CSSProperties = { padding: "10px 16px", fontSize: 13, fontWeight: 700, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, cursor: "pointer", color: "var(--text)" };
const btnPrimary: React.CSSProperties = { padding: "10px 22px", fontSize: 13, fontWeight: 800, color: "#fff", border: "none", borderRadius: 10, cursor: "pointer" };
