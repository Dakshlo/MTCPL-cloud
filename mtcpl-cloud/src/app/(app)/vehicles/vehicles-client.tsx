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
export type VehicleRow = {
  id: string; kind: "commercial" | "personal"; name: string; reg_no: string | null; make_model: string | null;
  emi_active: boolean; emi_amount: number | null; emi_day: number | null; emi_lender: string | null; emi_start: string | null; emi_end: string | null;
  insurance_company: string | null; insurance_policy_no: string | null; insurance_expiry: string | null;
  puc_expiry: string | null; fitness_expiry: string | null; notes: string | null;
  docs: VehicleDoc[];
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

/** Colour-coded expiry chip: red expired · amber ≤30 days · green ok · grey unset. */
function ExpiryChip({ label, date }: { label: string; date: string | null }) {
  const d = daysTo(date);
  const c =
    d == null ? { fg: "var(--muted)", bg: "var(--bg)", bd: "var(--border)", note: "not set" } :
    d < 0 ? { fg: "#b91c1c", bg: "rgba(220,38,38,0.1)", bd: "#fecaca", note: `expired ${Math.abs(d)}d ago` } :
    d <= 30 ? { fg: "#b45309", bg: "rgba(217,119,6,0.12)", bd: "#fde68a", note: `${d}d left` } :
    { fg: "#15803d", bg: "rgba(22,163,74,0.1)", bd: "#bbf7d0", note: `${d}d left` };
  return (
    <span title={date ? `${label}: ${fmtD(date)}` : `${label} date not set`} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11, fontWeight: 800, color: c.fg, background: c.bg, border: `1px solid ${c.bd}`, borderRadius: 999, padding: "3px 10px", whiteSpace: "nowrap" }}>
      {label}
      <span style={{ fontWeight: 700, opacity: 0.9 }}>{date ? `${fmtD(date)} · ${c.note}` : "—"}</span>
    </span>
  );
}

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
function VehicleModal({ kind, v, onClose }: { kind: "commercial" | "personal"; v: VehicleRow | null; onClose: () => void }) {
  const [emi, setEmi] = useState(v?.emi_active ?? false);
  const [saving, setSaving] = useState(false);
  return createPortal(
    <div onMouseDown={(e) => e.stopPropagation()} onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 3000, background: "rgba(15,23,42,0.5)", backdropFilter: "blur(2px)", display: "grid", placeItems: "center", padding: 16 }}>
      <form
        action={upsertVehicleAction}
        onSubmit={() => setSaving(true)}
        onClick={(e) => e.stopPropagation()}
        autoComplete="off"
        style={{ width: "min(560px, 96vw)", maxHeight: "92vh", overflowY: "auto", background: "var(--surface)", border: "1px solid var(--border)", borderTop: `3px solid ${ACCENT}`, borderRadius: 16, boxShadow: "0 24px 70px rgba(0,0,0,0.4)", padding: "20px 24px 22px" }}
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

        {/* identity */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <label style={{ ...label, gridColumn: "1 / -1" }}>
            Vehicle name *
            <input name="name" required defaultValue={v?.name ?? ""} placeholder="e.g. TATA 407" autoFocus style={input} {...textFill} />
          </label>
          <label style={label}>
            Registration no.
            <input name="reg_no" defaultValue={v?.reg_no ?? ""} placeholder="RJ 24 GA 1234" style={input} {...textFill} />
          </label>
          <label style={label}>
            Make / model
            <input name="make_model" defaultValue={v?.make_model ?? ""} placeholder="Tata 407 Gold SFC" style={input} {...textFill} />
          </label>
        </div>

        {/* EMI */}
        <div style={{ ...card, marginTop: 16 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", fontSize: 13, fontWeight: 800 }}>
            <input type="checkbox" name="emi_active" checked={emi} onChange={(e) => setEmi(e.target.checked)} style={{ width: 17, height: 17, accentColor: ACCENT }} />
            💳 Vehicle is on EMI / loan
          </label>
          {emi && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 13 }}>
              <label style={label}>
                EMI amount (₹)
                <input name="emi_amount" type="number" min="0" step="0.01" inputMode="decimal" defaultValue={v?.emi_amount ?? ""} placeholder="18500" style={input} {...noFill} />
              </label>
              <label style={label}>
                Due day of month
                <input name="emi_day" type="number" min="1" max="31" inputMode="numeric" defaultValue={v?.emi_day ?? ""} placeholder="7" style={input} {...noFill} />
              </label>
              <label style={{ ...label, gridColumn: "1 / -1" }}>
                Lender / bank
                <input name="emi_lender" defaultValue={v?.emi_lender ?? ""} placeholder="HDFC Bank" style={input} {...textFill} />
              </label>
              <label style={label}>
                Loan start
                <input name="emi_start" type="date" defaultValue={v?.emi_start ?? ""} style={input} {...noFill} />
              </label>
              <label style={label}>
                Loan ends
                <input name="emi_end" type="date" defaultValue={v?.emi_end ?? ""} style={input} {...noFill} />
              </label>
            </div>
          )}
        </div>

        {/* Expiries */}
        <div style={{ ...card, marginTop: 14 }}>
          <div style={sectionHd}>📅 Expiry dates</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <label style={label}>
              Insurance company
              <input name="insurance_company" defaultValue={v?.insurance_company ?? ""} placeholder="ICICI Lombard" style={input} {...textFill} />
            </label>
            <label style={label}>
              Policy no.
              <input name="insurance_policy_no" defaultValue={v?.insurance_policy_no ?? ""} placeholder="POLICY NUMBER" style={input} {...textFill} />
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

        {/* Notes */}
        <div style={{ ...card, marginTop: 14 }}>
          <div style={sectionHd}>📝 Notes / other info</div>
          <textarea name="notes" rows={2} defaultValue={v?.notes ?? ""} placeholder="Permit details, driver, anything else…" style={{ ...input, resize: "vertical", minHeight: 58 }} {...textFill} />
        </div>

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

// ── one vehicle card ────────────────────────────────────────────────
function VehicleCard({ v, onEdit }: { v: VehicleRow; onEdit: () => void }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const [docType, setDocType] = useState("Other");
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const icon = v.kind === "commercial" ? "🚛" : "🚗";
  const mLeft = v.emi_active ? monthsLeft(v.emi_end) : null;

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
    <div style={{ border: "1px solid var(--border)", borderRadius: 14, background: "var(--surface)", overflow: "hidden" }}>
      {/* header — always visible, click to expand */}
      <button type="button" onClick={() => setOpen((o) => !o)} style={{ width: "100%", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", padding: "13px 16px", background: "transparent", border: "none", cursor: "pointer", textAlign: "left", color: "var(--text)" }}>
        <span style={{ fontSize: 22 }}>{icon}</span>
        <span style={{ minWidth: 140 }}>
          <span style={{ display: "block", fontSize: 15, fontWeight: 900 }}>{v.name}</span>
          <span style={{ display: "block", fontSize: 11.5, color: "var(--muted)", fontFamily: "ui-monospace, monospace" }}>{v.reg_no || "no reg. no"}{v.make_model ? ` · ${v.make_model}` : ""}</span>
        </span>
        <span style={{ display: "flex", gap: 6, flexWrap: "wrap", flex: 1 }}>
          <ExpiryChip label="INSURANCE" date={v.insurance_expiry} />
          <ExpiryChip label="PUC" date={v.puc_expiry} />
          {v.kind === "commercial" && <ExpiryChip label="FITNESS" date={v.fitness_expiry} />}
          {v.emi_active && v.emi_amount != null && (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11, fontWeight: 800, color: "#4f6d9c", background: "rgba(79,109,156,0.1)", border: "1px solid rgba(79,109,156,0.35)", borderRadius: 999, padding: "3px 10px", whiteSpace: "nowrap" }}>
              💳 {inr(v.emi_amount)}{v.emi_day ? ` · day ${v.emi_day}` : ""}{mLeft != null ? ` · ${mLeft} left` : ""}
            </span>
          )}
        </span>
        <span style={{ fontSize: 11.5, fontWeight: 700, color: "var(--muted)", whiteSpace: "nowrap" }}>📎 {v.docs.length} · {open ? "▴ close" : "▾ open"}</span>
      </button>

      {open && (
        <div style={{ borderTop: "1px solid var(--border)", padding: "14px 16px", display: "grid", gap: 14 }}>
          {/* details grid */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 10, fontSize: 12.5 }}>
            <div><span style={{ color: "var(--muted)", fontWeight: 700 }}>Insurance:</span> {v.insurance_company || "—"}{v.insurance_policy_no ? ` · ${v.insurance_policy_no}` : ""}</div>
            {v.emi_active ? (
              <div><span style={{ color: "var(--muted)", fontWeight: 700 }}>EMI:</span> {v.emi_amount != null ? inr(v.emi_amount) : "—"}{v.emi_day ? ` on day ${v.emi_day}` : ""}{v.emi_lender ? ` · ${v.emi_lender}` : ""}{v.emi_end ? ` · ends ${fmtD(v.emi_end)}` : ""}{mLeft != null ? ` (${mLeft} EMIs left)` : ""}</div>
            ) : (
              <div><span style={{ color: "var(--muted)", fontWeight: 700 }}>EMI:</span> no loan</div>
            )}
            {v.notes && <div style={{ gridColumn: "1 / -1" }}><span style={{ color: "var(--muted)", fontWeight: 700 }}>Notes:</span> {v.notes}</div>}
          </div>

          {/* documents */}
          <div style={{ border: "1px solid var(--border)", borderRadius: 11, padding: "11px 13px", background: "var(--bg)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: v.docs.length ? 10 : 0 }}>
              <span style={{ fontSize: 12, fontWeight: 900 }}>📄 Documents</span>
              <span style={{ flex: 1 }} />
              <select value={docType} onChange={(e) => setDocType(e.target.value)} style={{ ...input, width: "auto", padding: "6px 9px", fontSize: 12 }}>
                {DOC_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
              <input ref={fileInput} type="file" multiple style={{ display: "none" }} onChange={(e) => { const fs = [...(e.target.files ?? [])]; if (fs.length) void uploadFiles(fs); e.target.value = ""; }} />
              <button type="button" disabled={uploading} onClick={() => fileInput.current?.click()} style={{ ...btn, padding: "6px 12px", fontSize: 12 }}>
                {uploading ? "Uploading…" : "📎 Upload"}
              </button>
            </div>
            {err && <div style={{ fontSize: 12, fontWeight: 700, color: "#b91c1c", marginBottom: 8 }}>⚠ {err}</div>}
            {v.docs.length === 0 ? (
              <div style={{ fontSize: 12, color: "var(--muted)" }}>No papers uploaded yet — RC, insurance policy, PUC, anything.</div>
            ) : (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>
                {v.docs.map((d) => (
                  <span key={d.id} style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: 12, fontWeight: 700, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 9, padding: "5px 10px", maxWidth: "100%" }}>
                    {d.doc_type && <span style={{ fontSize: 9.5, fontWeight: 900, textTransform: "uppercase", color: "#4f6d9c", background: "rgba(79,109,156,0.1)", borderRadius: 5, padding: "1px 6px" }}>{d.doc_type}</span>}
                    <a href={d.url} target="_blank" rel="noopener noreferrer" style={{ color: "var(--text)", textDecoration: "none", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 220 }}>{d.name}</a>
                    <button type="button" title="Delete" onClick={() => void removeDoc(d.id)} style={{ border: "none", background: "transparent", color: "#b91c1c", fontWeight: 900, cursor: "pointer", fontSize: 14, lineHeight: 1, padding: 0 }}>×</button>
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* actions */}
          <div style={{ display: "flex", gap: 9, justifyContent: "flex-end" }}>
            <button type="button" onClick={onEdit} style={btn}>✎ Edit</button>
            <button type="button" onClick={() => setConfirmDel(true)} style={{ ...btn, color: "#b91c1c", borderColor: "#fecaca" }}>🗑 Remove</button>
          </div>
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
export function VehiclesBoard({ kind, vehicles }: { kind: "commercial" | "personal"; vehicles: VehicleRow[] }) {
  const [modal, setModal] = useState<null | { v: VehicleRow | null }>(null);
  const [q, setQ] = useState("");
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return vehicles;
    return vehicles.filter((v) => [v.name, v.reg_no ?? "", v.make_model ?? "", v.emi_lender ?? ""].join(" ").toLowerCase().includes(s));
  }, [vehicles, q]);

  return (
    <div style={{ marginTop: 14 }}>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 14 }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="🔍 Search name, reg no, lender…" style={{ ...input, maxWidth: 320 }} />
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
        <div style={{ display: "grid", gap: 10 }}>
          {shown.map((v) => <VehicleCard key={v.id} v={v} onEdit={() => setModal({ v })} />)}
        </div>
      )}

      {modal && <VehicleModal kind={kind} v={modal.v} onClose={() => setModal(null)} />}
    </div>
  );
}
