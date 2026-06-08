"use client";

// ──────────────────────────────────────────────────────────────────
// Maintenance — ticket workflow UI (shared by the tickets board and the
// machine detail page). Read + drive the lifecycle:
//   raised → inspecting → minor-fixed | quote → owner approve → in-repair → done
// Each card shows only the actions valid for its current stage. Stage
// forms post straight to the server actions (which redirect with a toast).
// ──────────────────────────────────────────────────────────────────

import { useState } from "react";
import Link from "next/link";
import {
  inspectTicketAction,
  markMinorFixedAction,
  fillQuotationAction,
  approveTicketAction,
  rejectTicketAction,
  markRepairDoneAction,
  cancelTicketAction,
  raiseTicketAction,
} from "./actions";

export type Ticket = {
  id: string;
  ticket_no: string | null;
  machine_id: string;
  machine_name: string;
  section: string | null;
  problem: string;
  priority: string;
  status: string;
  resolution_kind: string | null;
  inspection_notes: string | null;
  has_problem_photo: boolean;
  has_done_photo: boolean;
  quote_amount: number | null;
  quote_vendor: string | null;
  quote_scope: string | null;
  quote_expected_days: number | null;
  rejection_reason: string | null;
  repair_started_at: string | null;
  repair_expected_at: string | null;
  repair_completed_at: string | null;
  raised_by_name: string | null;
  raised_at: string | null;
};

const STATUS_META: Record<string, { label: string; bg: string; fg: string }> = {
  raised: { label: "Raised", bg: "rgba(217,119,6,0.14)", fg: "#92400e" },
  inspecting: { label: "Inspecting", bg: "rgba(37,99,235,0.14)", fg: "#1e40af" },
  awaiting_approval: { label: "Awaiting owner approval", bg: "rgba(124,58,237,0.16)", fg: "#6d28d9" },
  in_repair: { label: "In repair", bg: "rgba(234,88,12,0.16)", fg: "#9a3412" },
  completed: { label: "Completed", bg: "rgba(22,163,74,0.16)", fg: "#15803d" },
  rejected: { label: "Rejected", bg: "rgba(220,38,38,0.14)", fg: "#991b1b" },
  cancelled: { label: "Cancelled", bg: "rgba(148,163,184,0.2)", fg: "#475569" },
};
const PRIORITY_META: Record<string, { label: string; color: string }> = {
  urgent: { label: "⚡ Urgent", color: "#dc2626" },
  high: { label: "High", color: "#ea580c" },
  normal: { label: "Normal", color: "var(--muted)" },
  low: { label: "Low", color: "var(--muted)" },
};

function inr(n: number | null): string {
  if (n == null) return "—";
  return "₹" + Math.round(n).toLocaleString("en-IN");
}
function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso.length <= 10 ? `${iso}T00:00:00+05:30` : iso).toLocaleDateString("en-IN", {
      day: "numeric", month: "short", year: "2-digit", timeZone: "Asia/Kolkata",
    });
  } catch {
    return iso;
  }
}

const inputStyle: React.CSSProperties = {
  width: "100%", boxSizing: "border-box", padding: "9px 12px", fontSize: 14,
  border: "1px solid var(--border)", borderRadius: 9, background: "var(--bg)", color: "var(--text)",
};
const btnGhost: React.CSSProperties = { padding: "8px 14px", fontSize: 13, fontWeight: 700, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 9, cursor: "pointer", color: "var(--text)" };
function actionBtn(bg: string): React.CSSProperties {
  return { padding: "7px 13px", fontSize: 12.5, fontWeight: 800, color: "#fff", background: bg, border: "none", borderRadius: 9, cursor: "pointer", whiteSpace: "nowrap" };
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 1100, background: "rgba(15,23,42,0.5)", backdropFilter: "blur(3px)", display: "flex", alignItems: "center", justifyContent: "center", padding: "16px" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: 440, background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 16, padding: 22, boxShadow: "0 24px 60px rgba(0,0,0,0.32)", maxHeight: "88vh", overflowY: "auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <h2 style={{ margin: 0, fontSize: 18 }}>{title}</h2>
          <button type="button" onClick={onClose} style={{ background: "none", border: "none", fontSize: 24, lineHeight: 1, cursor: "pointer", color: "var(--muted)" }} aria-label="Close">×</button>
        </div>
        {children}
      </div>
    </div>
  );
}
function FieldLabel({ children }: { children: React.ReactNode }) {
  return <span style={{ fontSize: 11, fontWeight: 800, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.05em", display: "block", marginBottom: 5 }}>{children}</span>;
}

// ── Raise-ticket button + modal (machine detail) ────────────────────
export function RaiseTicketButton({ machineId, back }: { machineId: string; back: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} style={actionBtn("var(--gold-dark, #a16207)")}>
        ＋ Raise ticket
      </button>
      {open && (
        <Modal title="Raise a maintenance ticket" onClose={() => setOpen(false)}>
          <form action={raiseTicketAction} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <input type="hidden" name="machine_id" value={machineId} />
            <input type="hidden" name="back" value={back} />
            <label><FieldLabel>Problem *</FieldLabel>
              <textarea name="problem" required rows={3} placeholder="What's wrong with the machine?" style={{ ...inputStyle, resize: "vertical", fontFamily: "inherit" }} />
            </label>
            <label><FieldLabel>Priority</FieldLabel>
              <select name="priority" defaultValue="normal" style={inputStyle}>
                <option value="low">Low</option>
                <option value="normal">Normal</option>
                <option value="high">High</option>
                <option value="urgent">Urgent</option>
              </select>
            </label>
            <label><FieldLabel>Photo of the problem (optional)</FieldLabel>
              <input type="file" name="problem_photo" accept="image/*,application/pdf" style={{ fontSize: 13 }} />
            </label>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 4 }}>
              <button type="button" onClick={() => setOpen(false)} style={btnGhost}>Cancel</button>
              <button type="submit" style={actionBtn("var(--gold-dark, #a16207)")}>Raise ticket</button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}

// ── Ticket list ─────────────────────────────────────────────────────
export function TicketList({ tickets, back, showMachine = true }: { tickets: Ticket[]; back: string; showMachine?: boolean }) {
  if (tickets.length === 0) {
    return <div className="banner">No tickets here.</div>;
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {tickets.map((t) => <TicketCard key={t.id} t={t} back={back} showMachine={showMachine} />)}
    </div>
  );
}

type ModalKind = null | "inspect" | "minor" | "quote" | "approve" | "reject" | "done" | "cancel";

function TicketCard({ t, back, showMachine }: { t: Ticket; back: string; showMachine: boolean }) {
  const [modal, setModal] = useState<ModalKind>(null);
  const sm = STATUS_META[t.status] ?? { label: t.status, bg: "rgba(0,0,0,0.06)", fg: "var(--muted)" };
  const pm = PRIORITY_META[t.priority] ?? PRIORITY_META.normal;
  const close = () => setModal(null);
  const hasQuote = t.quote_amount != null;

  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: 14, background: "var(--surface)", padding: 16, boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
      {/* Header row */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 8 }}>
        <code style={{ fontFamily: "ui-monospace, monospace", fontWeight: 800, fontSize: 13 }}>{t.ticket_no ?? "—"}</code>
        <span style={{ fontSize: 10.5, fontWeight: 800, padding: "2px 9px", borderRadius: 999, background: sm.bg, color: sm.fg, textTransform: "uppercase", letterSpacing: "0.04em" }}>{sm.label}</span>
        <span style={{ fontSize: 11.5, fontWeight: 700, color: pm.color }}>{pm.label}</span>
        {showMachine && (
          <Link href={`/maintenance/${t.machine_id}`} style={{ marginLeft: "auto", fontSize: 13, fontWeight: 700, color: "var(--gold-dark)", textDecoration: "none" }}>
            {t.machine_name} →
          </Link>
        )}
      </div>

      <div style={{ fontSize: 14, color: "var(--text)", marginBottom: 6 }}>{t.problem}</div>
      <div className="muted" style={{ fontSize: 11.5, display: "flex", gap: 12, flexWrap: "wrap", marginBottom: hasQuote || t.inspection_notes ? 10 : 12 }}>
        <span>Raised {fmtDate(t.raised_at)}{t.raised_by_name ? ` · by ${t.raised_by_name}` : ""}</span>
        {t.section && <span>· {t.section}</span>}
        {t.has_problem_photo && <a href={`/api/maintenance/proof/${t.id}?which=problem`} target="_blank" rel="noreferrer" style={{ color: "var(--gold-dark)", fontWeight: 700 }}>📷 Problem photo</a>}
        {t.has_done_photo && <a href={`/api/maintenance/proof/${t.id}?which=done`} target="_blank" rel="noreferrer" style={{ color: "var(--gold-dark)", fontWeight: 700 }}>📷 Done photo</a>}
      </div>

      {t.inspection_notes && (
        <div style={{ fontSize: 12.5, color: "var(--muted)", marginBottom: 10 }}>
          <strong style={{ color: "var(--text)" }}>Inspection:</strong> {t.inspection_notes}
        </div>
      )}

      {hasQuote && (
        <div style={{ background: "var(--surface-alt, rgba(0,0,0,0.03))", border: "1px solid var(--border)", borderRadius: 10, padding: "10px 12px", marginBottom: 10, fontSize: 12.5 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
            <span className="muted">Quotation</span>
            <strong style={{ fontSize: 15, color: "var(--gold-dark)" }}>{inr(t.quote_amount)}</strong>
          </div>
          {t.quote_vendor && <div className="muted">Repairer: <span style={{ color: "var(--text)" }}>{t.quote_vendor}</span></div>}
          {t.quote_scope && <div className="muted">Scope: <span style={{ color: "var(--text)" }}>{t.quote_scope}</span></div>}
          {t.quote_expected_days != null && <div className="muted">Expected: {t.quote_expected_days} day(s)</div>}
        </div>
      )}

      {(t.repair_started_at || t.repair_completed_at) && (
        <div className="muted" style={{ fontSize: 11.5, display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 10 }}>
          {t.repair_started_at && <span>Repair started {fmtDate(t.repair_started_at)}</span>}
          {t.repair_expected_at && <span>· due {fmtDate(t.repair_expected_at)}</span>}
          {t.repair_completed_at && <span>· done {fmtDate(t.repair_completed_at)}</span>}
        </div>
      )}

      {t.status === "rejected" && t.rejection_reason && (
        <div style={{ fontSize: 12.5, color: "#991b1b", marginBottom: 10 }}>Rejected: {t.rejection_reason}</div>
      )}

      {/* Stage actions */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {t.status === "raised" && (
          <button type="button" onClick={() => setModal("inspect")} style={actionBtn("#2563eb")}>Start inspection</button>
        )}
        {t.status === "inspecting" && (
          <>
            <button type="button" onClick={() => setModal("minor")} style={actionBtn("#16a34a")}>Mark fixed (minor)</button>
            <button type="button" onClick={() => setModal("quote")} style={actionBtn("#7c3aed")}>Needs repair — fill quotation</button>
          </>
        )}
        {t.status === "awaiting_approval" && (
          <>
            <button type="button" onClick={() => setModal("approve")} style={actionBtn("#16a34a")}>Approve (owner)</button>
            <button type="button" onClick={() => setModal("reject")} style={actionBtn("#dc2626")}>Reject</button>
            <button type="button" onClick={() => setModal("quote")} style={btnGhost}>Edit quotation</button>
          </>
        )}
        {t.status === "rejected" && (
          <button type="button" onClick={() => setModal("quote")} style={actionBtn("#7c3aed")}>Edit &amp; resubmit quotation</button>
        )}
        {t.status === "in_repair" && (
          <button type="button" onClick={() => setModal("done")} style={actionBtn("#16a34a")}>Mark repair done</button>
        )}
        {!["completed", "cancelled"].includes(t.status) && (
          <button type="button" onClick={() => setModal("cancel")} style={btnGhost}>Cancel ticket</button>
        )}
      </div>

      {/* ── Modals ── */}
      {modal === "inspect" && (
        <Modal title="Start inspection" onClose={close}>
          <form action={inspectTicketAction} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <input type="hidden" name="id" value={t.id} /><input type="hidden" name="back" value={back} />
            <label><FieldLabel>Inspection notes (optional)</FieldLabel>
              <textarea name="inspection_notes" rows={3} placeholder="What did you find?" style={{ ...inputStyle, resize: "vertical", fontFamily: "inherit" }} />
            </label>
            <p className="muted" style={{ fontSize: 12, margin: 0 }}>After inspecting, choose <strong>minor fix</strong> or <strong>fill a quotation</strong> for a major repair.</p>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button type="button" onClick={close} style={btnGhost}>Cancel</button>
              <button type="submit" style={actionBtn("#2563eb")}>Save &amp; mark inspecting</button>
            </div>
          </form>
        </Modal>
      )}
      {modal === "minor" && (
        <Modal title="Mark fixed (minor)" onClose={close}>
          <form action={markMinorFixedAction} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <input type="hidden" name="id" value={t.id} /><input type="hidden" name="back" value={back} />
            <p className="muted" style={{ fontSize: 13, margin: 0 }}>This closes the ticket directly (no quotation / approval). The machine stays <strong>working</strong>.</p>
            <label><FieldLabel>Photo after fix (optional)</FieldLabel>
              <input type="file" name="done_photo" accept="image/*,application/pdf" style={{ fontSize: 13 }} />
            </label>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button type="button" onClick={close} style={btnGhost}>Cancel</button>
              <button type="submit" style={actionBtn("#16a34a")}>Mark fixed</button>
            </div>
          </form>
        </Modal>
      )}
      {modal === "quote" && (
        <Modal title="Repair quotation" onClose={close}>
          <form action={fillQuotationAction} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <input type="hidden" name="id" value={t.id} /><input type="hidden" name="back" value={back} />
            <label><FieldLabel>Total amount (₹) *</FieldLabel>
              <input name="quote_amount" type="number" min="0" step="1" required defaultValue={t.quote_amount ?? ""} placeholder="e.g. 25000" style={inputStyle} />
            </label>
            <label><FieldLabel>Repairer / vendor</FieldLabel>
              <input name="quote_vendor" defaultValue={t.quote_vendor ?? ""} placeholder="Who will do the repair" style={inputStyle} />
            </label>
            <label><FieldLabel>Scope of work</FieldLabel>
              <textarea name="quote_scope" rows={2} defaultValue={t.quote_scope ?? ""} placeholder="What the repair covers" style={{ ...inputStyle, resize: "vertical", fontFamily: "inherit" }} />
            </label>
            <label><FieldLabel>Expected days</FieldLabel>
              <input name="quote_expected_days" type="number" min="0" step="1" defaultValue={t.quote_expected_days ?? ""} placeholder="e.g. 5" style={inputStyle} />
            </label>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button type="button" onClick={close} style={btnGhost}>Cancel</button>
              <button type="submit" style={actionBtn("#7c3aed")}>Send for approval</button>
            </div>
          </form>
        </Modal>
      )}
      {modal === "approve" && (
        <Modal title="Approve this repair?" onClose={close}>
          <form action={approveTicketAction} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <input type="hidden" name="id" value={t.id} /><input type="hidden" name="back" value={back} />
            <p className="muted" style={{ fontSize: 13, margin: 0 }}>Approving <strong style={{ color: "var(--text)" }}>{inr(t.quote_amount)}</strong>{t.quote_vendor ? ` to ${t.quote_vendor}` : ""} starts the repair. The machine will be marked <strong>Under maintenance</strong>{t.quote_expected_days != null ? `, due in ${t.quote_expected_days} day(s)` : ""}.</p>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button type="button" onClick={close} style={btnGhost}>Cancel</button>
              <button type="submit" style={actionBtn("#16a34a")}>Approve &amp; start repair</button>
            </div>
          </form>
        </Modal>
      )}
      {modal === "reject" && (
        <Modal title="Reject quotation" onClose={close}>
          <form action={rejectTicketAction} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <input type="hidden" name="id" value={t.id} /><input type="hidden" name="back" value={back} />
            <label><FieldLabel>Reason (optional)</FieldLabel>
              <textarea name="rejection_reason" rows={2} placeholder="Why is this rejected?" style={{ ...inputStyle, resize: "vertical", fontFamily: "inherit" }} />
            </label>
            <p className="muted" style={{ fontSize: 12, margin: 0 }}>Administration can edit the quotation and resubmit.</p>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button type="button" onClick={close} style={btnGhost}>Cancel</button>
              <button type="submit" style={actionBtn("#dc2626")}>Reject</button>
            </div>
          </form>
        </Modal>
      )}
      {modal === "done" && (
        <Modal title="Mark repair done" onClose={close}>
          <form action={markRepairDoneAction} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <input type="hidden" name="id" value={t.id} /><input type="hidden" name="back" value={back} />
            <p className="muted" style={{ fontSize: 13, margin: 0 }}>The machine goes back to <strong>working</strong>.</p>
            <label><FieldLabel>Photo after repair (optional)</FieldLabel>
              <input type="file" name="done_photo" accept="image/*,application/pdf" style={{ fontSize: 13 }} />
            </label>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button type="button" onClick={close} style={btnGhost}>Cancel</button>
              <button type="submit" style={actionBtn("#16a34a")}>Mark done</button>
            </div>
          </form>
        </Modal>
      )}
      {modal === "cancel" && (
        <Modal title="Cancel this ticket?" onClose={close}>
          <form action={cancelTicketAction} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <input type="hidden" name="id" value={t.id} /><input type="hidden" name="back" value={back} />
            <label><FieldLabel>Reason (optional)</FieldLabel>
              <input name="cancel_reason" placeholder="Why cancel?" style={inputStyle} />
            </label>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button type="button" onClick={close} style={btnGhost}>Keep ticket</button>
              <button type="submit" style={actionBtn("#dc2626")}>Cancel ticket</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
