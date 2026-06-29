"use client";

/**
 * ChallansBoard (Daksh, Mig 173 UI) — the Challans page body.
 *
 *  • Top bar: 🟡 Approval + 📦 Bulk challans. The Bulk button doubles as a DROP
 *    TARGET: while a challan card is being dragged it grows + blinks "Drop here".
 *  • Temple-wise COLLAPSIBLE sections; each challan is a CARD (not a table row).
 *  • An OPEN challan card can be (a) clicked "Convert to invoice", or (b) dragged
 *    onto the Bulk button → a CUSTOM confirm dialog (not window.confirm) → it goes
 *    to the bulk pool via sendChallanToBulkAction.
 */

import { useRef, useState } from "react";
import Link from "next/link";
import { BUTTON_STYLES } from "../../accounts/_ui/components";
import { challanStatus } from "@/lib/challan-status";
import { ChallanStatusPill } from "./challan-status-pill";
import { ReturnToDispatchButton } from "./return-to-dispatch-button";
import { sendChallanToBulkAction, returnDispatchToWaitingAction } from "../actions";

export type BoardChallan = {
  id: string;
  code: string;
  date: string;
  notes: string | null;
  cancelled_at: string | null;
  converted_invoice_id: string | null;
  priced_at: string | null;
  owner_approved_at: string | null;
  owner_rejected_at: string | null;
  owner_reject_reason: string | null;
};
export type BoardGroup = { temple: string; rows: BoardChallan[] };

export function ChallansBoard({
  groups,
  status,
  from,
  to,
  total,
}: {
  groups: BoardGroup[];
  status: string;
  from: string;
  to: string;
  total: number;
}) {
  const [dragId, setDragId] = useState<string | null>(null);
  const [isOver, setIsOver] = useState(false);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [pendingDrop, setPendingDrop] = useState<{ id: string; code: string } | null>(null);
  const [sending, setSending] = useState(false);

  const formRef = useRef<HTMLFormElement>(null);
  const idRef = useRef<HTMLInputElement>(null);

  const dragging = dragId != null;

  function toggle(temple: string) {
    setCollapsed((p) => ({ ...p, [temple]: !p[temple] }));
  }

  function onDrop() {
    setIsOver(false);
    const id = dragId;
    setDragId(null);
    if (!id) return;
    // Find the card so the confirm dialog can name it.
    for (const g of groups) {
      const hit = g.rows.find((r) => r.id === id);
      if (hit) { setPendingDrop({ id: hit.id, code: hit.code }); return; }
    }
  }

  function confirmSend() {
    if (!pendingDrop || !idRef.current) return;
    setSending(true);
    idRef.current.value = pendingDrop.id;
    formRef.current?.requestSubmit();
    // The action redirects back to /invoicing/challans, so the page navigates and
    // this overlay disappears on its own.
  }

  return (
    <>
      <style>{`
        @keyframes bulkPulse { 0%,100% { box-shadow: 0 0 0 0 rgba(180,83,9,0.55); } 50% { box-shadow: 0 0 0 9px rgba(180,83,9,0); } }
        @keyframes cardLift { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
      `}</style>

      {/* Hidden form that performs the actual "send to bulk" on confirm. */}
      <form ref={formRef} action={sendChallanToBulkAction} style={{ display: "none" }}>
        <input ref={idRef} type="hidden" name="id" />
      </form>

      {/* Top action bar — Approval + the Bulk drop target. */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginBottom: 6 }}>
        <Link href="/invoicing/approval" style={BUTTON_STYLES.secondary}>🟡 Approval</Link>

        <Link
          href="/invoicing/bulk"
          onDragOver={(e) => { if (dragging) { e.preventDefault(); e.dataTransfer.dropEffect = "move"; setIsOver(true); } }}
          onDragEnter={(e) => { if (dragging) { e.preventDefault(); setIsOver(true); } }}
          onDragLeave={() => setIsOver(false)}
          onDrop={(e) => { e.preventDefault(); onDrop(); }}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            textDecoration: "none",
            fontWeight: 800,
            borderRadius: 12,
            cursor: "pointer",
            transition: "transform 0.15s, background 0.15s, padding 0.15s, border-color 0.15s",
            border: `2px ${dragging ? "dashed" : "solid"} ${isOver ? "#b45309" : dragging ? "#f59e0b" : "var(--border)"}`,
            background: isOver ? "#b45309" : dragging ? "rgba(245,158,11,0.12)" : "var(--surface, #fff)",
            color: isOver ? "#fff" : dragging ? "#92400e" : "var(--text)",
            padding: dragging ? "14px 22px" : "9px 16px",
            fontSize: dragging ? 15 : 13,
            transform: isOver ? "scale(1.12)" : dragging ? "scale(1.06)" : "none",
            animation: dragging ? "bulkPulse 1.1s ease-in-out infinite" : "none",
          }}
        >
          📦 {dragging ? (isOver ? "⬇ Drop to send to bulk" : "Drop here → Bulk") : "Bulk challans"}
        </Link>

        {dragging && (
          <span style={{ fontSize: 12, color: "var(--muted)", fontWeight: 600 }}>
            Release over the Bulk button to park this challan for bulk billing.
          </span>
        )}
      </div>

      {/* Filter row — plain GET form. */}
      <form
        method="get"
        action="/invoicing/challans"
        style={{ display: "grid", gridTemplateColumns: "minmax(140px,1fr) minmax(140px,1fr) minmax(140px,1fr) auto auto", alignItems: "end", columnGap: 10, margin: "10px 0 14px" }}
      >
        <Field label="Status">
          <select name="status" defaultValue={status} style={SELECT}>
            <option value="all">All</option>
            <option value="open">Open</option>
            <option value="pending_approval">Under owner review</option>
            <option value="rejected">Rejected</option>
            <option value="invoiced">Invoiced</option>
            <option value="converted">Converted</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </Field>
        <Field label="From"><input type="date" name="from" defaultValue={from} style={SELECT} /></Field>
        <Field label="To"><input type="date" name="to" defaultValue={to} style={SELECT} /></Field>
        <button type="submit" style={BUTTON_STYLES.secondary}>Apply filters</button>
        <Link href="/invoicing/challans" style={{ ...BUTTON_STYLES.ghost, alignSelf: "center" }}>Reset</Link>
      </form>

      <div style={{ fontSize: 12, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 10 }}>
        Challans <span style={{ color: "var(--text)" }}>· {total}</span>
      </div>

      {groups.length === 0 ? (
        <div style={{ background: "var(--surface)", border: "1px dashed var(--border)", borderRadius: 12, padding: "30px 22px", textAlign: "center", color: "var(--muted)" }}>
          No challans match. Try clearing the filters, or <Link href="/invoicing/challans/new" style={{ color: "var(--gold-dark)", fontWeight: 700 }}>create a new challan</Link>.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {groups.map((g) => {
            const isCollapsed = !!collapsed[g.temple];
            return (
              <div key={g.temple} style={{ border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden", background: "var(--surface, #fff)" }}>
                <button
                  type="button"
                  onClick={() => toggle(g.temple)}
                  style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "11px 14px", border: "none", background: "var(--bg)", cursor: "pointer", textAlign: "left" }}
                >
                  <span style={{ fontWeight: 800, fontSize: 13.5, color: "var(--text)" }}>
                    🛕 {g.temple} <span style={{ color: "var(--muted)", fontWeight: 600 }}>· {g.rows.length}</span>
                  </span>
                  <span style={{ fontSize: 12, color: "var(--muted)", transform: isCollapsed ? "none" : "rotate(180deg)", transition: "transform 0.15s" }}>▾</span>
                </button>
                {!isCollapsed && (
                  <div style={{ padding: 12, display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(258px, 1fr))", gap: 10 }}>
                    {g.rows.map((c) => (
                      <Card key={c.id} c={c} dragging={dragId === c.id} onDragStart={() => setDragId(c.id)} onDragEnd={() => { setDragId(null); setIsOver(false); }} />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Custom confirm dialog (NOT window.confirm). */}
      {pendingDrop && (
        <div
          style={{ position: "fixed", inset: 0, zIndex: 60, background: "rgba(15,23,42,0.45)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}
          onClick={() => { if (!sending) setPendingDrop(null); }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ width: "min(440px, 100%)", background: "var(--surface, #fff)", borderRadius: 16, padding: "22px 22px 18px", boxShadow: "0 24px 60px rgba(0,0,0,0.3)" }}
          >
            <div style={{ fontSize: 34, marginBottom: 6 }}>📦</div>
            <div style={{ fontSize: 17, fontWeight: 800, color: "var(--text)", marginBottom: 6 }}>Send to Bulk challans?</div>
            <p style={{ fontSize: 13, color: "var(--muted)", lineHeight: 1.5, margin: "0 0 18px" }}>
              <strong style={{ fontFamily: "ui-monospace, monospace", color: "var(--text)" }}>{pendingDrop.code}</strong> will leave this page and wait on the <strong>Bulk challans</strong> page, where it can be billed together with the temple&apos;s other challans on one tax invoice. You can send it back anytime.
            </p>
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button type="button" disabled={sending} onClick={() => setPendingDrop(null)} style={{ ...BUTTON_STYLES.ghost, opacity: sending ? 0.5 : 1 }}>Cancel</button>
              <button type="button" disabled={sending} onClick={confirmSend} style={{ fontSize: 13, fontWeight: 800, padding: "10px 18px", borderRadius: 10, border: "none", color: "#fff", background: "#b45309", cursor: sending ? "default" : "pointer", opacity: sending ? 0.7 : 1 }}>
                {sending ? "Sending…" : "📦 Send to bulk"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function Card({ c, dragging, onDragStart, onDragEnd }: { c: BoardChallan; dragging: boolean; onDragStart: () => void; onDragEnd: () => void }) {
  const st = challanStatus(c);
  const open = st === "open";
  return (
    <div
      draggable={open}
      onDragStart={open ? (e) => { e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", c.id); onDragStart(); } : undefined}
      onDragEnd={open ? onDragEnd : undefined}
      style={{
        border: "1px solid var(--border)",
        borderRadius: 12,
        background: "var(--bg)",
        padding: "11px 12px 12px",
        display: "flex",
        flexDirection: "column",
        gap: 8,
        cursor: open ? "grab" : "default",
        opacity: dragging ? 0.4 : 1,
        animation: "cardLift 0.18s ease",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <Link href={`/invoicing/challans/${c.id}`} style={{ fontFamily: "ui-monospace, monospace", fontWeight: 800, fontSize: 13.5, color: "var(--gold-dark)", textDecoration: "none" }}>
          {c.code}
        </Link>
        <ChallanStatusPill challan={c} />
      </div>
      <div style={{ fontSize: 12, color: "var(--muted)" }}>{c.date}</div>

      {st === "rejected" && c.owner_reject_reason && (
        <div style={{ fontSize: 11.5, color: "#991b1b", background: "rgba(220,38,38,0.06)", border: "1px solid #fecaca", borderRadius: 6, padding: "5px 8px" }}>
          Rejected: {c.owner_reject_reason}
        </div>
      )}
      {st !== "rejected" && c.notes && !c.notes.startsWith("Auto from dispatch") && (
        <div style={{ fontSize: 11.5, color: "var(--muted)" }}>{c.notes}</div>
      )}

      <div style={{ marginTop: "auto", paddingTop: 4 }}>
        {open ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
            <Link href={`/invoicing/challans/${c.id}/review`} style={{ ...BUTTON_STYLES.secondary, fontSize: 12, textAlign: "center" }}>
              🧾 Convert to invoice
            </Link>
            <span style={{ fontSize: 10.5, color: "var(--muted)", display: "inline-flex", alignItems: "center", gap: 5 }}>
              <span style={{ fontSize: 13, cursor: "grab" }}>⠿</span> drag onto 📦 Bulk to park for bulk billing
            </span>
          </div>
        ) : st === "rejected" ? (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>
            <Link href={`/invoicing/challans/${c.id}/review`} style={{ ...BUTTON_STYLES.secondary, fontSize: 12 }}>✏️ Re-price</Link>
            <ReturnToDispatchButton challanId={c.id} action={returnDispatchToWaitingAction} />
          </div>
        ) : st === "pending_approval" ? (
          <Link href="/invoicing/approval" style={{ fontSize: 12, fontWeight: 700, color: "#92400e", textDecoration: "none" }}>Awaiting approval →</Link>
        ) : (
          <span style={{ color: "var(--muted)", fontSize: 12 }}>—</span>
        )}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "block" }}>
      <span style={{ display: "block", fontSize: 11, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 5 }}>{label}</span>
      {children}
    </label>
  );
}

const SELECT: React.CSSProperties = {
  width: "100%",
  padding: "8px 10px",
  borderRadius: 8,
  border: "1px solid var(--border)",
  background: "var(--bg)",
  color: "var(--text)",
  fontSize: 13,
};
