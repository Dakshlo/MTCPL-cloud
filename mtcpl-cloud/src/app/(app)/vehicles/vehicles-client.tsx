"use client";

/**
 * Vehicles board (mig 204) — owner + developer. One card per vehicle with
 * colour-coded expiry chips (insurance / PUC / fitness), an EMI monitor and
 * direct-to-storage document uploads. Add/Edit opens a centred modal
 * (portaled to <body> — the nested-modal transform gotcha).
 */

import { useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";
import { upsertVehicleAction, deleteVehicleAction, prepareVehicleDocUploadsAction, saveVehicleDocsAction, deleteVehicleDocAction } from "./actions";

export type VehicleDoc = { id: string; name: string; url: string; doc_type: string | null; created_at: string };
export type VehicleEvent = {
  id: string;
  event_type: "created" | "updated";
  changes: Array<{ field: string; label: string; from: string | null; to: string | null }>;
  created_by_name: string | null;
  created_at: string;
};
export type VehicleRow = {
  id: string; kind: "commercial" | "personal"; name: string; reg_no: string | null; make_model: string | null;
  owner_name: string | null;
  engine_no: string | null; chassis_no: string | null;
  emi_active: boolean; emi_amount: number | null; emi_day: number | null; emi_lender: string | null; emi_start: string | null; emi_end: string | null;
  insurance_company: string | null; insurance_policy_no: string | null; insurance_expiry: string | null;
  puc_expiry: string | null; fitness_expiry: string | null; notes: string | null;
  docs: VehicleDoc[];
  events: VehicleEvent[];
};

const DOC_TYPES = ["RC", "Insurance", "PUC", "Fitness", "Loan / EMI", "Permit", "Other"];

// ── date helpers ────────────────────────────────────────────────────
export function daysTo(date: string | null): number | null {
  if (!date) return null;
  const target = new Date(`${date.slice(0, 10)}T00:00:00+05:30`).getTime();
  return Math.floor((target - Date.now()) / 86_400_000);
}
const fmtD = (d: string | null) =>
  d ? new Date(`${d.slice(0, 10)}T00:00:00+05:30`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "—";

function monthsLeft(end: string | null): number | null {
  if (!end) return null;
  const now = new Date();
  const e = new Date(`${end.slice(0, 10)}T00:00:00+05:30`);
  const m = (e.getFullYear() - now.getFullYear()) * 12 + (e.getMonth() - now.getMonth());
  return Math.max(0, m + (e.getDate() >= now.getDate() ? 1 : 0));
}

const inr = (n: number) => "₹" + Math.round(n).toLocaleString("en-IN");

// ── shared field styles ─────────────────────────────────────────────
const ACCENT = "#4f6d9c";
const label: React.CSSProperties = { display: "grid", gap: 5, fontSize: 10.5, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--muted)" };
// All entry fields render UPPERCASE + bold; the focus ring comes from the
// scoped `.veh-in` <style> block below.
const input: React.CSSProperties = { fontSize: 14, fontWeight: 700, letterSpacing: "0.01em", padding: "10px 12px", borderRadius: 10, border: "1.5px solid var(--border)", background: "var(--surface)", color: "var(--text)", width: "100%", fontFamily: "inherit", textTransform: "uppercase", transition: "border-color .12s, box-shadow .12s" };
const btn: React.CSSProperties = { fontSize: 12.5, fontWeight: 800, padding: "9px 15px", borderRadius: 9, cursor: "pointer", border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)" };
const card: React.CSSProperties = { border: "1px solid var(--border)", borderRadius: 12, padding: "13px 15px", background: "var(--bg)" };
const sectionHd: React.CSSProperties = { fontSize: 11.5, fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--text)", marginBottom: 11 };

// Kills the browser's saved-data autofill dropdown + spellcheck squiggles on
// every field. Text fields add autoCapitalize so mobile keyboards start in CAPS.
const noFill = { autoComplete: "off", autoCorrect: "off", spellCheck: false, className: "veh-in" } as const;
const textFill = { ...noFill, autoCapitalize: "characters" } as const;

// ── Add / Edit modal ────────────────────────────────────────────────
const EMI_FIELDS = ["emi_amount", "emi_day", "emi_lender", "emi_start", "emi_end"] as const;

const fmtDT = (iso: string) =>
  new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });
/** Timeline value display: dates prettified, EMI amounts as ₹. */
function evVal(field: string, v: string | null): string {
  if (!v) return "—";
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return fmtD(v);
  if (field === "emi_amount") { const n = Number(v); if (Number.isFinite(n)) return inr(n); }
  return v;
}

function VehicleModal({ kind, v, canEditIdentity, onClose }: { kind: "commercial" | "personal"; v: VehicleRow | null; canEditIdentity: boolean; onClose: () => void }) {
  // Identity lock (mig 211): after creation, only the developer can change
  // vehicle details — everyone else sees them read-only (server enforces too).
  const lockId = !!v && !canEditIdentity;
  const [saving, setSaving] = useState(false);
  // EMI is all-or-none: fields are always visible; filling ANY makes all five
  // mandatory (server enforces the same rule).
  const [emiErr, setEmiErr] = useState<string | null>(null);
  return createPortal(
    <div onMouseDown={(e) => e.stopPropagation()} onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 3000, background: "rgba(15,23,42,0.5)", backdropFilter: "blur(2px)", display: "grid", placeItems: "center", padding: 16 }}>
      <form
        action={upsertVehicleAction}
        onSubmit={(e) => {
          const fd = new FormData(e.currentTarget);
          const filled = EMI_FIELDS.filter((n) => String(fd.get(n) ?? "").trim()).length;
          if (filled > 0 && filled < EMI_FIELDS.length) {
            e.preventDefault();
            setEmiErr("Fill ALL the EMI fields (amount, due day, lender, loan start, loan ends) — or leave every one empty.");
            return;
          }
          setEmiErr(null);
          setSaving(true);
        }}
        onClick={(e) => e.stopPropagation()}
        autoComplete="off"
        style={{ width: "min(780px, 96vw)", maxHeight: "92vh", overflowY: "auto", background: "var(--surface)", border: "1px solid var(--border)", borderTop: `3px solid ${ACCENT}`, borderRadius: 16, boxShadow: "0 24px 70px rgba(0,0,0,0.4)", padding: "20px 24px 22px" }}
      >
        <style>{`.veh-in:focus{border-color:${ACCENT} !important;box-shadow:0 0 0 3px rgba(79,109,156,0.18)}.veh-in::placeholder{font-weight:500;text-transform:none;opacity:.55}`}</style>
        <input type="hidden" name="kind" value={kind} />
        {v && <input type="hidden" name="id" value={v.id} />}

        {/* header */}
        <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
          <span style={{ fontSize: 24, lineHeight: 1 }}>{kind === "commercial" ? "🚛" : "🚗"}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 17, fontWeight: 900, lineHeight: 1.15 }}>{v ? "Edit vehicle" : "Add vehicle"}</div>
            <div style={{ fontSize: 10.5, fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.07em", color: ACCENT }}>{kind} vehicle</div>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" style={{ border: "none", background: "transparent", color: "var(--muted)", fontSize: 19, fontWeight: 900, cursor: "pointer", lineHeight: 1 }}>✕</button>
        </div>
        <div style={{ height: 1, background: "var(--border)", margin: "14px 0 16px" }} />

        {/* identity — registration number leads (that's how a vehicle is
            identified); name + make/model + registered owner follow. */}
        <div style={card}>
          <div style={sectionHd}>{kind === "commercial" ? "🚛" : "🚗"} Vehicle details</div>
          {lockId && (
            <div style={{ fontSize: 11, color: "var(--muted)", margin: "-5px 0 11px", lineHeight: 1.4 }}>
              🔒 Locked after creation — only the developer can change these. EMI &amp; expiry dates stay editable; every change lands on the timeline below.
            </div>
          )}
          {/* One wide row: Reg no → Name → Make/model; owner underneath. */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
            <label style={label}>
              Registration no.
              <input name="reg_no" defaultValue={v?.reg_no ?? ""} autoFocus={!lockId} readOnly={lockId} style={{ ...input, fontFamily: "ui-monospace, monospace", letterSpacing: "0.03em", ...(lockId ? { opacity: 0.6, background: "var(--bg)" } : {}) }} {...textFill} />
            </label>
            <label style={label}>
              Vehicle name *
              <input name="name" required defaultValue={v?.name ?? ""} readOnly={lockId} style={{ ...input, ...(lockId ? { opacity: 0.6, background: "var(--bg)" } : {}) }} {...textFill} />
            </label>
            <label style={label}>
              Make / model
              <input name="make_model" defaultValue={v?.make_model ?? ""} readOnly={lockId} style={{ ...input, ...(lockId ? { opacity: 0.6, background: "var(--bg)" } : {}) }} {...textFill} />
            </label>
            <label style={label}>
              Engine no.
              <input name="engine_no" defaultValue={v?.engine_no ?? ""} readOnly={lockId} style={{ ...input, fontFamily: "ui-monospace, monospace", letterSpacing: "0.03em", ...(lockId ? { opacity: 0.6, background: "var(--bg)" } : {}) }} {...textFill} />
            </label>
            <label style={label}>
              Chassis no.
              <input name="chassis_no" defaultValue={v?.chassis_no ?? ""} readOnly={lockId} style={{ ...input, fontFamily: "ui-monospace, monospace", letterSpacing: "0.03em", ...(lockId ? { opacity: 0.6, background: "var(--bg)" } : {}) }} {...textFill} />
            </label>
            <label style={{ ...label, gridColumn: "1 / -1" }}>
              Owner / registered to
              <input name="owner_name" defaultValue={v?.owner_name ?? ""} readOnly={lockId} style={{ ...input, ...(lockId ? { opacity: 0.6, background: "var(--bg)" } : {}) }} {...textFill} />
            </label>
          </div>
        </div>

        {/* EMI (left) + Expiry dates (right) — side by side on wide screens.
            No on-EMI checkbox any more: fields are always open; empty = no
            loan, any filled = all five mandatory (validated on submit +
            server-side). */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 14, marginTop: 14, alignItems: "start" }}>
          <div style={card}>
            <div style={sectionHd}>💳 EMI / loan</div>
            <div style={{ fontSize: 11, color: "var(--muted)", margin: "-5px 0 11px", lineHeight: 1.4 }}>
              No loan? Leave all empty. Filling any field makes all of them required.
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <label style={label}>
                EMI amount (₹)
                <input name="emi_amount" type="number" min="0" step="0.01" inputMode="decimal" defaultValue={v?.emi_active ? (v?.emi_amount ?? "") : ""} style={input} {...noFill} />
              </label>
              <label style={label}>
                Due day of month
                <input name="emi_day" type="number" min="1" max="31" inputMode="numeric" defaultValue={v?.emi_active ? (v?.emi_day ?? "") : ""} style={input} {...noFill} />
              </label>
              <label style={{ ...label, gridColumn: "1 / -1" }}>
                Lender / bank
                <input name="emi_lender" defaultValue={v?.emi_active ? (v?.emi_lender ?? "") : ""} style={input} {...textFill} />
              </label>
              <label style={label}>
                Loan start
                <input name="emi_start" type="date" defaultValue={v?.emi_active ? (v?.emi_start ?? "") : ""} style={input} {...noFill} />
              </label>
              <label style={label}>
                Loan ends
                <input name="emi_end" type="date" defaultValue={v?.emi_active ? (v?.emi_end ?? "") : ""} style={input} {...noFill} />
              </label>
            </div>
            {emiErr && (
              <div style={{ marginTop: 11, fontSize: 12, fontWeight: 700, color: "#b91c1c", background: "rgba(220,38,38,0.07)", border: "1px solid #fecaca", borderRadius: 8, padding: "7px 10px", lineHeight: 1.4 }}>
                ⚠ {emiErr}
              </div>
            )}
          </div>

          <div style={card}>
            <div style={sectionHd}>📅 Expiry dates</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <label style={label}>
                Insurance company
                <input name="insurance_company" defaultValue={v?.insurance_company ?? ""} style={input} {...textFill} />
              </label>
              <label style={label}>
                Policy no.
                <input name="insurance_policy_no" defaultValue={v?.insurance_policy_no ?? ""} style={input} {...textFill} />
              </label>
              <label style={label}>
                Insurance expiry
                <input name="insurance_expiry" type="date" defaultValue={v?.insurance_expiry ?? ""} style={input} {...noFill} />
              </label>
              <label style={label}>
                PUC expiry
                <input name="puc_expiry" type="date" defaultValue={v?.puc_expiry ?? ""} style={input} {...noFill} />
              </label>
              {kind === "commercial" && (
                <label style={label}>
                  Fitness expiry
                  <input name="fitness_expiry" type="date" defaultValue={v?.fitness_expiry ?? ""} style={input} {...noFill} />
                </label>
              )}
            </div>
          </div>
        </div>

        {/* Notes */}
        <div style={{ ...card, marginTop: 14 }}>
          <div style={sectionHd}>📝 Notes / other info</div>
          <textarea name="notes" rows={2} defaultValue={v?.notes ?? ""} style={{ ...input, resize: "vertical", minHeight: 58 }} {...textFill} />
        </div>

        {/* Timeline (mig 211) — full history of this vehicle: added + every
            change (old → new), e.g. an insurance renewal keeps both policies
            on record instead of overwriting. */}
        {v && (
          <div style={{ ...card, marginTop: 14 }}>
            <div style={sectionHd}>🕘 Timeline</div>
            {v.events.length === 0 ? (
              <div style={{ fontSize: 12, color: "var(--muted)" }}>No changes recorded yet — history starts from the next save.</div>
            ) : (
              <div style={{ display: "grid", gap: 11, maxHeight: 240, overflowY: "auto", paddingRight: 4 }}>
                {v.events.map((ev) => (
                  <div key={ev.id} style={{ borderLeft: `3px solid ${ev.event_type === "created" ? "#16a34a" : ACCENT}`, paddingLeft: 11 }}>
                    <div style={{ fontSize: 11, fontWeight: 800, color: "var(--muted)" }}>
                      {fmtDT(ev.created_at)}{ev.created_by_name ? ` · ${ev.created_by_name}` : ""}
                    </div>
                    {ev.event_type === "created" ? (
                      <div style={{ fontSize: 12.5, fontWeight: 800, color: "#15803d", marginTop: 2 }}>✚ Vehicle added</div>
                    ) : (
                      <div style={{ display: "grid", gap: 2, marginTop: 2 }}>
                        {ev.changes.map((c, i) => (
                          <div key={i} style={{ fontSize: 12, lineHeight: 1.45 }}>
                            <span style={{ fontWeight: 800 }}>{c.label}:</span>{" "}
                            <span style={{ color: "var(--muted)", textDecoration: "line-through" }}>{evVal(c.field, c.from)}</span>
                            <span style={{ color: "var(--muted)" }}> → </span>
                            <span style={{ fontWeight: 700 }}>{evVal(c.field, c.to)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 18 }}>
          <button type="button" disabled={saving} onClick={onClose} style={btn}>Cancel</button>
          <button type="submit" disabled={saving} style={{ ...btn, padding: "9px 18px", background: ACCENT, borderColor: "#415980", color: "#fff", boxShadow: "0 4px 14px rgba(79,109,156,0.35)", opacity: saving ? 0.7 : 1 }}>
            {saving ? "Saving…" : v ? "✓ Save changes" : "➕ Add vehicle"}
          </button>
        </div>
      </form>
    </div>,
    document.body,
  );
}

// Loan completion (elapsed / total term) — powers the per-card progress bar.
function loanProgress(start: string | null, end: string | null): number | null {
  if (!start || !end) return null;
  const s = new Date(`${start.slice(0, 10)}T00:00:00+05:30`).getTime();
  const e = new Date(`${end.slice(0, 10)}T00:00:00+05:30`).getTime();
  if (!(e > s)) return null;
  return Math.max(0, Math.min(100, Math.round(((Date.now() - s) / (e - s)) * 100)));
}

// One expiry line inside a card: coloured status dot + label + date + days-left.
// Reads as an at-a-glance compliance panel — clearer than the crammed pills.
function ExpiryRow({ label, date }: { label: string; date: string | null }) {
  const d = daysTo(date);
  const c =
    d == null ? { fg: "var(--muted)", note: "not set" } :
    d < 0 ? { fg: "#dc2626", note: `expired ${Math.abs(d)}d ago` } :
    d <= 30 ? { fg: "#d97706", note: `${d}d left` } :
    { fg: "#16a34a", note: `${d}d left` };
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 9, padding: "5px 0", borderTop: "1px solid var(--border)" }}>
      <span style={{ width: 8, height: 8, borderRadius: "50%", background: c.fg, flexShrink: 0 }} />
      <span style={{ width: 74, fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--muted)" }}>{label}</span>
      <span style={{ fontSize: 12, fontWeight: 700 }}>{date ? fmtD(date) : "—"}</span>
      <span style={{ marginLeft: "auto", fontSize: 10.5, fontWeight: 800, color: c.fg, whiteSpace: "nowrap" }}>{c.note}</span>
    </div>
  );
}

// ── one vehicle card (vertical) ─────────────────────────────────────
function VehicleCard({ v, onEdit }: { v: VehicleRow; onEdit: () => void }) {
  const router = useRouter();
  const [showDocs, setShowDocs] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const [docType, setDocType] = useState("Other");
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const icon = v.kind === "commercial" ? "🚛" : "🚗";
  const mLeft = v.emi_active ? monthsLeft(v.emi_end) : null;
  const prog = v.emi_active ? loanProgress(v.emi_start, v.emi_end) : null;

  // Worst expiry status drives a slim colour rail down the left of the card, so
  // a red/amber card is spottable in a grid without reading anything.
  const applicable = [v.insurance_expiry, v.puc_expiry, ...(v.kind === "commercial" ? [v.fitness_expiry] : [])];
  const days = applicable.map(daysTo).filter((d): d is number => d != null);
  const rail = days.some((d) => d < 0) ? "#dc2626" : days.some((d) => d <= 30) ? "#d97706" : days.length ? "#16a34a" : "var(--border)";

  async function uploadFiles(files: File[]) {
    if (files.length === 0) return;
    setUploading(true);
    setErr(null);
    try {
      const fd = new FormData();
      fd.set("vehicle_id", v.id);
      fd.set("names", JSON.stringify(files.map((f) => ({ name: f.name }))));
      const prep = await prepareVehicleDocUploadsAction(fd);
      if (!prep.ok) { setErr(prep.error); return; }
      const sb = createBrowserSupabaseClient();
      const metas: Array<{ name: string; path: string; mime: string | null; size: number | null }> = [];
      for (let i = 0; i < files.length; i++) {
        const u = prep.uploads[i];
        const { error } = await sb.storage.from("vehicle-docs").uploadToSignedUrl(u.path, u.token, files[i]);
        if (error) { setErr(`Upload failed for ${files[i].name}: ${error.message}`); return; }
        metas.push({ name: files[i].name, path: u.path, mime: files[i].type || null, size: files[i].size });
      }
      const fd2 = new FormData();
      fd2.set("vehicle_id", v.id);
      fd2.set("doc_type", docType);
      fd2.set("files", JSON.stringify(metas));
      const saved = await saveVehicleDocsAction(fd2);
      if (!saved.ok) { setErr(saved.error); return; }
      setShowDocs(true);
      router.refresh();
    } finally {
      setUploading(false);
    }
  }

  async function removeDoc(docId: string) {
    const fd = new FormData();
    fd.set("doc_id", docId);
    const r = await deleteVehicleDocAction(fd);
    if (!r.ok) { setErr(r.error); return; }
    router.refresh();
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", border: "1px solid var(--border)", borderLeft: `4px solid ${rail}`, borderRadius: 14, background: "var(--surface)", overflow: "hidden", boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
      {/* header — REGISTRATION NUMBER leads (Daksh: names are hard to tell
          apart; the reg no is how people actually identify a vehicle). */}
      <div style={{ display: "flex", alignItems: "flex-start", gap: 11, padding: "13px 15px 11px" }}>
        <span style={{ fontSize: 26, lineHeight: 1 }}>{icon}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 16, fontWeight: 900, lineHeight: 1.2, fontFamily: "ui-monospace, monospace", letterSpacing: "0.02em", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {v.reg_no || v.name}
          </div>
          <div style={{ fontSize: 11.5, fontWeight: 700, color: "var(--muted)", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {v.reg_no ? v.name : ""}{v.reg_no && v.make_model ? " · " : ""}{v.make_model ?? ""}
            {!v.reg_no && !v.make_model ? "no reg. no" : ""}
          </div>
          {v.owner_name && (
            <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>👤 {v.owner_name}</div>
          )}
        </div>
        <button type="button" onClick={onEdit} title="Edit" style={{ border: "1px solid var(--border)", background: "var(--bg)", color: "var(--muted)", borderRadius: 8, width: 30, height: 30, cursor: "pointer", fontSize: 13, flexShrink: 0, lineHeight: 1 }}>✎</button>
      </div>

      {/* status panel */}
      <div style={{ padding: "0 15px 4px" }}>
        <ExpiryRow label="Insurance" date={v.insurance_expiry} />
        <ExpiryRow label="PUC" date={v.puc_expiry} />
        {v.kind === "commercial" && <ExpiryRow label="Fitness" date={v.fitness_expiry} />}
      </div>

      {/* EMI block */}
      {v.emi_active && v.emi_amount != null ? (
        <div style={{ margin: "8px 15px 0", padding: "9px 11px", borderRadius: 10, background: "rgba(79,109,156,0.08)", border: "1px solid rgba(79,109,156,0.22)" }}>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontSize: 14, fontWeight: 900, color: "#4f6d9c", fontFamily: "ui-monospace, monospace" }}>💳 {inr(v.emi_amount)}<span style={{ fontSize: 10.5, fontWeight: 700, color: "var(--muted)", fontFamily: "inherit" }}>/mo</span></span>
            <span style={{ fontSize: 10.5, fontWeight: 800, color: "var(--muted)" }}>{v.emi_day ? `due day ${v.emi_day}` : ""}{v.emi_lender ? `${v.emi_day ? " · " : ""}${v.emi_lender}` : ""}</span>
          </div>
          {prog != null && (
            <div style={{ marginTop: 7 }}>
              <div style={{ height: 5, borderRadius: 999, background: "rgba(79,109,156,0.2)", overflow: "hidden" }}>
                <div style={{ width: `${prog}%`, height: "100%", background: "#4f6d9c", borderRadius: 999 }} />
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 10, fontWeight: 700, color: "var(--muted)", marginTop: 3 }}>
                <span>{prog}% paid</span>
                {mLeft != null && (
                  <span>
                    {mLeft} EMI{mLeft === 1 ? "" : "s"} left · <span style={{ fontWeight: 900, color: "#4f6d9c", fontFamily: "ui-monospace, monospace" }}>{inr((v.emi_amount ?? 0) * mLeft)}</span>
                  </span>
                )}
              </div>
            </div>
          )}
        </div>
      ) : null}

      {v.notes && <div style={{ margin: "9px 15px 0", fontSize: 11.5, color: "var(--muted)", lineHeight: 1.45 }}><span style={{ fontWeight: 700 }}>Note:</span> {v.notes}</div>}

      {/* footer — docs toggle + remove, pinned to card bottom. Bottom padding
          matters: without it the buttons sit flush on the card edge and look
          like they spill out (Daksh flagged). */}
      <div style={{ marginTop: "auto", padding: "11px 15px 13px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", borderTop: "1px solid var(--border)", paddingTop: 10 }}>
          {/* One entry point: the docs drawer holds the tag picker AND the
              Upload button together (two separate buttons here read as two
              different features — Daksh flagged). */}
          <button type="button" onClick={() => setShowDocs((s) => !s)} style={{ ...btn, padding: "6px 11px", fontSize: 12 }}>
            📎 {v.docs.length} doc{v.docs.length === 1 ? "" : "s"} {showDocs ? "▴" : "▾"}
          </button>
          <span style={{ flex: 1 }} />
          <button type="button" onClick={() => setConfirmDel(true)} title="Remove vehicle" style={{ ...btn, padding: "6px 10px", fontSize: 12, color: "#b91c1c", borderColor: "#fecaca" }}>🗑</button>
        </div>
      </div>

      {/* documents drawer */}
      {showDocs && (
        <div style={{ padding: "0 15px 14px" }}>
          {err && <div style={{ fontSize: 12, fontWeight: 700, color: "#b91c1c", marginBottom: 8 }}>⚠ {err}</div>}
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: v.docs.length ? 9 : 8 }}>
            <span style={{ fontSize: 10.5, fontWeight: 800, textTransform: "uppercase", color: "var(--muted)" }}>Tag next upload:</span>
            <select value={docType} onChange={(e) => setDocType(e.target.value)} style={{ ...input, width: "auto", padding: "5px 8px", fontSize: 12 }}>
              {DOC_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            <input ref={fileInput} type="file" multiple style={{ display: "none" }} onChange={(e) => { const fs = [...(e.target.files ?? [])]; if (fs.length) void uploadFiles(fs); e.target.value = ""; }} />
            <button type="button" disabled={uploading} onClick={() => fileInput.current?.click()} style={{ ...btn, padding: "5px 12px", fontSize: 12, background: "#4f6d9c", borderColor: "#415980", color: "#fff" }}>
              {uploading ? "Uploading…" : "＋ Upload"}
            </button>
          </div>
          {v.docs.length === 0 ? (
            <div style={{ fontSize: 12, color: "var(--muted)" }}>No papers yet — RC, insurance, PUC, anything.</div>
          ) : (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>
              {v.docs.map((d) => (
                <span key={d.id} style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: 12, fontWeight: 700, background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 9, padding: "5px 10px", maxWidth: "100%" }}>
                  {d.doc_type && <span style={{ fontSize: 9.5, fontWeight: 900, textTransform: "uppercase", color: "#4f6d9c", background: "rgba(79,109,156,0.1)", borderRadius: 5, padding: "1px 6px" }}>{d.doc_type}</span>}
                  <a href={d.url} target="_blank" rel="noopener noreferrer" style={{ color: "var(--text)", textDecoration: "none", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 200 }}>{d.name}</a>
                  <button type="button" title="Delete" onClick={() => void removeDoc(d.id)} style={{ border: "none", background: "transparent", color: "#b91c1c", fontWeight: 900, cursor: "pointer", fontSize: 14, lineHeight: 1, padding: 0 }}>×</button>
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {confirmDel && createPortal(
        <div onMouseDown={(e) => e.stopPropagation()} onClick={() => setConfirmDel(false)} style={{ position: "fixed", inset: 0, zIndex: 3000, background: "rgba(15,23,42,0.5)", display: "grid", placeItems: "center", padding: 16 }}>
          <form action={deleteVehicleAction} onClick={(e) => e.stopPropagation()} style={{ width: "min(400px, 94vw)", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 16, boxShadow: "0 24px 70px rgba(0,0,0,0.35)", padding: "20px 22px" }}>
          <input type="hidden" name="id" value={v.id} />
          <input type="hidden" name="kind" value={v.kind} />
          <div style={{ fontSize: 28, marginBottom: 6 }}>🗑</div>
          <div style={{ fontSize: 15.5, fontWeight: 900, marginBottom: 6 }}>Remove {v.name}?</div>
          <p style={{ fontSize: 12.5, color: "var(--muted)", margin: "0 0 14px", lineHeight: 1.5 }}>The vehicle and all its uploaded documents are deleted. This cannot be undone.</p>
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
            <button type="button" onClick={() => setConfirmDel(false)} style={btn}>Keep it</button>
            <button type="submit" style={{ ...btn, background: "#b91c1c", borderColor: "#991b1b", color: "#fff" }}>🗑 Remove vehicle</button>
          </div>
          </form>
        </div>,
        document.body,
      )}
    </div>
  );
}

// ── the page board ──────────────────────────────────────────────────
export function VehiclesBoard({ kind, vehicles, canEditIdentity = false }: { kind: "commercial" | "personal"; vehicles: VehicleRow[]; canEditIdentity?: boolean }) {
  const [modal, setModal] = useState<null | { v: VehicleRow | null }>(null);
  const [q, setQ] = useState("");
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return vehicles;
    return vehicles.filter((v) => [v.name, v.reg_no ?? "", v.make_model ?? "", v.owner_name ?? "", v.emi_lender ?? ""].join(" ").toLowerCase().includes(s));
  }, [vehicles, q]);

  return (
    <div style={{ marginTop: 14 }}>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 14 }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="🔍 Search reg no, name, owner…" style={{ ...input, maxWidth: 320 }} />
        <span style={{ flex: 1 }} />
        <button type="button" onClick={() => setModal({ v: null })} style={{ ...btn, background: "#4f6d9c", borderColor: "#415980", color: "#fff", padding: "9px 16px" }}>
          ➕ Add vehicle
        </button>
      </div>

      {shown.length === 0 ? (
        <div style={{ border: "1px dashed var(--border)", borderRadius: 14, background: "var(--surface)", padding: "36px 20px", textAlign: "center", color: "var(--muted)" }}>
          {vehicles.length === 0 ? `No ${kind} vehicles yet — add the first one.` : "Nothing matches the search."}
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 14, alignItems: "start" }}>
          {shown.map((v) => <VehicleCard key={v.id} v={v} onEdit={() => setModal({ v })} />)}
        </div>
      )}

      {modal && <VehicleModal kind={kind} v={modal.v} canEditIdentity={canEditIdentity} onClose={() => setModal(null)} />}
    </div>
  );
}
