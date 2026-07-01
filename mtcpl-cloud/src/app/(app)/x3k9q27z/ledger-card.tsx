"use client";

/**
 * One personal-ledger account card (mig 174): big current balance, a receive/pay
 * form (with a "to whom" datalist) showing the branded spinning-logo overlay on
 * submit, and a Details button that opens the full entry history in a centered
 * peek modal.
 */

import { useRef, useState, useTransition } from "react";
import { useFormStatus } from "react-dom";
import { rupee } from "@/lib/challan-pricing";
import { FinanceLoadingOverlay } from "@/components/finance-loading-overlay";
import { addLedgerEntryAction, deleteLedgerEntryAction } from "./actions";

export type EntryView = {
  id: string;
  date: string;
  direction: "receive" | "pay";
  amount: number;
  counterparty: string;
  status: "confirmed" | "pending" | "rejected";
  isTransfer: boolean;
  note: string | null;
};

// Branded spinning overlay while the form's action runs (useFormStatus must be a
// child of the <form>).
function FormPending() {
  const { pending } = useFormStatus();
  return <FinanceLoadingOverlay show={pending} label="Saving entry…" />;
}

export function LedgerCard({
  account, title, emoji, balance, entries, canEdit, canCancel = false, options,
}: {
  account: "home" | "office";
  title: string;
  emoji: string;
  balance: number;
  entries: EntryView[];
  canEdit: boolean;
  canCancel?: boolean;
  options: string[];
}) {
  const [direction, setDirection] = useState<"receive" | "pay" | null>(null);
  const [dirErr, setDirErr] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [confirm, setConfirm] = useState<{ amount: number; counterparty: string; note: string } | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const positive = balance >= 0;
  const confirmedCount = entries.filter((e) => e.status === "confirmed").length;

  // "Add entry" → read the current form values and open OUR confirm modal first.
  function openConfirm() {
    const f = formRef.current;
    if (!f) return;
    if (direction !== "receive" && direction !== "pay") { setDirErr(true); return; } // must pick one
    if (!f.reportValidity()) return; // required amount + counterparty select
    const fd = new FormData(f);
    const amount = Math.round((Number(String(fd.get("amount") ?? "").replace(/,/g, "")) || 0) * 100) / 100;
    if (!(amount > 0)) { f.reportValidity(); return; }
    const counterparty = String(fd.get("counterparty") ?? "").trim();
    if (!counterparty) { f.reportValidity(); return; }
    setConfirm({ amount, counterparty, note: String(fd.get("note") ?? "").trim() });
  }
  const isTransfer = !!confirm && confirm.counterparty.toUpperCase() === options[0];

  const segBtn = (active: boolean, color: string): React.CSSProperties => ({
    flex: 1, padding: "11px 12px", fontSize: 13.5, fontWeight: 800, borderRadius: 10, cursor: "pointer",
    border: `1.5px solid ${active ? color : "var(--border)"}`,
    background: active ? color : "var(--bg)", color: active ? "#fff" : "var(--text)",
    transition: "all 0.12s",
  });

  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: 18, background: "var(--surface, #fff)", overflow: "hidden", display: "flex", flexDirection: "column", boxShadow: "0 1px 3px rgba(15,23,42,0.06)" }}>
      {/* Balance header */}
      <div style={{ padding: "18px 20px 16px", background: `linear-gradient(135deg, ${positive ? "rgba(22,101,52,0.08)" : "rgba(185,28,28,0.08)"}, transparent)`, borderBottom: "1px solid var(--border)" }}>
        <div style={{ fontSize: 13, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--muted)" }}>{emoji} {title}</div>
        <div style={{ fontSize: 34, fontWeight: 800, marginTop: 6, color: positive ? "#15803d" : "#b91c1c", fontFamily: "ui-monospace, monospace", letterSpacing: "-0.02em" }}>
          {rupee(balance)}
        </div>
        <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 3 }}>Current balance · {confirmedCount} confirmed</div>
      </div>

      {/* Receive / Pay form */}
      {canEdit && (
        <form ref={formRef} action={addLedgerEntryAction} autoComplete="off" style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: 13, borderBottom: "1px solid var(--border)" }}>
          <input type="hidden" name="account" value={account} />
          <input type="hidden" name="direction" value={direction ?? ""} />

          <div>
            <div style={{ display: "flex", gap: 9 }}>
              <button type="button" onClick={() => { setDirection("receive"); setDirErr(false); }} style={segBtn(direction === "receive", "#15803d")}>↓ Receive</button>
              <button type="button" onClick={() => { setDirection("pay"); setDirErr(false); }} style={segBtn(direction === "pay", "#b45309")}>↑ Pay / Give</button>
            </div>
            {dirErr && <div style={{ fontSize: 11.5, color: "#b91c1c", fontWeight: 700, marginTop: 5 }}>Choose Receive or Pay first.</div>}
          </div>

          <AmountField />

          <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            <span style={lbl}>{direction === "pay" ? "Paid / given to" : "Received from"}</span>
            <select name="counterparty" required defaultValue="" style={{ ...inp, cursor: "pointer" }}>
              <option value="" disabled>Select…</option>
              {options.map((o) => <option key={o} value={o}>{`${WHOM_EMOJI[o] ?? ""} ${o}`.trim()}</option>)}
            </select>
            <span style={{ fontSize: 10.5, color: "var(--muted)" }}>Pick <strong>{`${WHOM_EMOJI[options[0]] ?? ""} ${options[0]}`.trim()}</strong> to move money between the two accounts. For a party&apos;s name, put it in the Note.</span>
          </label>

          <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            <span style={lbl}>Note <span style={{ fontWeight: 500 }}>(optional)</span></span>
            <input name="note" autoComplete="off" placeholder="What's this for?" style={inp} />
          </label>

          <FormPending />
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <button type="button" onClick={openConfirm} style={{ fontSize: 14, fontWeight: 800, padding: "11px 20px", borderRadius: 11, border: "none", color: "#fff", background: "#0f172a", cursor: "pointer", whiteSpace: "nowrap" }}>
              ＋ Add entry
            </button>
          </div>
        </form>
      )}

      {/* Our own confirmation (not window.confirm) before the entry is saved. */}
      {confirm && (
        <div onClick={() => setConfirm(null)} style={{ position: "fixed", inset: 0, zIndex: 3300, background: "rgba(15,23,42,0.55)", backdropFilter: "blur(3px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: "min(420px, 100%)", background: "var(--surface, #fff)", borderRadius: 16, padding: "22px 22px 18px", boxShadow: "0 28px 70px rgba(0,0,0,0.4)" }}>
            <div style={{ fontSize: 30, marginBottom: 6 }}>{direction === "receive" ? "↓" : "↑"}</div>
            <div style={{ fontSize: 17, fontWeight: 800, color: "var(--text)", marginBottom: 8 }}>Confirm this entry?</div>
            <div style={{ fontSize: 14, color: "var(--text)", lineHeight: 1.55, marginBottom: 4 }}>
              <strong style={{ color: direction === "receive" ? "#15803d" : "#b45309" }}>{direction === "receive" ? "Receive" : "Pay / give"}</strong>{" "}
              <strong style={{ fontFamily: "ui-monospace, monospace" }}>{rupee(confirm.amount)}</strong>{" "}
              {direction === "receive" ? "from" : "to"} <strong>{confirm.counterparty || "—"}</strong> on <strong>{emoji} {title}</strong>.
            </div>
            {confirm.note && <div style={{ fontSize: 12.5, color: "var(--muted)", marginBottom: 4 }}>Note: {confirm.note}</div>}
            {isTransfer && (
              <div style={{ fontSize: 12, color: "#4f46e5", fontWeight: 700, background: "rgba(99,102,241,0.1)", border: "1px solid rgba(99,102,241,0.3)", borderRadius: 8, padding: "7px 10px", marginTop: 8 }}>
                ⇄ This moves money between Home and Office.
              </div>
            )}
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 18 }}>
              <button type="button" onClick={() => setConfirm(null)} style={{ fontSize: 13, fontWeight: 700, padding: "10px 16px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)", cursor: "pointer" }}>Cancel</button>
              <button type="button" onClick={() => { setConfirm(null); formRef.current?.requestSubmit(); }} style={{ fontSize: 13, fontWeight: 800, padding: "10px 18px", borderRadius: 10, border: "none", color: "#fff", background: "#0f172a", cursor: "pointer" }}>✓ Confirm &amp; add</button>
            </div>
          </div>
        </div>
      )}

      {/* Details opener */}
      <button type="button" onClick={() => setShowDetails(true)} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", border: "none", background: "transparent", cursor: "pointer", fontSize: 13, fontWeight: 800, color: "var(--text)", padding: "14px 20px" }}>
        <span>📋 Details <span style={{ color: "var(--muted)", fontWeight: 600 }}>· {entries.length} entr{entries.length === 1 ? "y" : "ies"}</span></span>
        <span style={{ fontSize: 12, color: "var(--muted)" }}>Open ›</span>
      </button>

      {showDetails && (
        <DetailsModal title={title} emoji={emoji} balance={balance} positive={positive} entries={entries} canCancel={canCancel} onClose={() => setShowDetails(false)} />
      )}
    </div>
  );
}

function DetailsModal({ title, emoji, balance, positive, entries, canCancel, onClose }: { title: string; emoji: string; balance: number; positive: boolean; entries: EntryView[]; canCancel: boolean; onClose: () => void }) {
  const [cancelEntry, setCancelEntry] = useState<EntryView | null>(null);
  const [stage, setStage] = useState<1 | 2>(1);
  const [pending, start] = useTransition();

  function doDelete() {
    if (!cancelEntry) return;
    start(async () => {
      const fd = new FormData();
      fd.set("id", cancelEntry.id);
      await deleteLedgerEntryAction(fd); // redirects to /ledger
    });
  }

  return (
    <>
      <FinanceLoadingOverlay show={pending} label="Cancelling…" />
      <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 3200, background: "rgba(15,23,42,0.55)", backdropFilter: "blur(3px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
        <div onClick={(e) => e.stopPropagation()} style={{ width: "min(540px, 100%)", maxHeight: "85vh", display: "flex", flexDirection: "column", background: "var(--surface, #fff)", borderRadius: 18, overflow: "hidden", boxShadow: "0 28px 70px rgba(0,0,0,0.4)" }}>
          <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--muted)" }}>{emoji} {title} · Details</div>
              <div style={{ fontSize: 20, fontWeight: 800, color: positive ? "#15803d" : "#b91c1c", fontFamily: "ui-monospace, monospace", marginTop: 2 }}>{rupee(balance)}</div>
            </div>
            <button type="button" onClick={onClose} style={{ border: "none", background: "transparent", fontSize: 22, cursor: "pointer", color: "var(--muted)", lineHeight: 1 }}>✕</button>
          </div>
          <div style={{ padding: 16, overflowY: "auto" }}>
            <style>{`@keyframes ledgerPending { 0%,100% { box-shadow: 0 0 0 0 rgba(217,119,6,0.6); } 50% { box-shadow: 0 0 0 6px rgba(217,119,6,0); } }`}</style>
            {entries.length === 0 ? (
              <div style={{ fontSize: 13, color: "var(--muted)", textAlign: "center", padding: "24px 0" }}>No entries yet.</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                {entries.map((e) => {
                  const recv = e.direction === "receive";
                  const pend = e.status === "pending";
                  return (
                    <div key={e.id} style={{
                      display: "flex", alignItems: "center", gap: 11, padding: "9px 12px", borderRadius: 10,
                      border: pend ? "1.5px dashed #9ca3af" : `1px solid ${e.isTransfer ? "rgba(99,102,241,0.35)" : "var(--border)"}`,
                      borderLeft: !pend && e.isTransfer ? "3px solid #6366f1" : undefined,
                      background: pend ? "rgba(148,163,184,0.18)" : e.isTransfer ? "rgba(99,102,241,0.08)" : "var(--bg)",
                      animation: pend ? "ledgerPending 1.3s ease-in-out infinite" : undefined,
                    }}>
                      <span style={{ fontSize: 17, color: pend ? "#9ca3af" : recv ? "#15803d" : "#b45309" }}>{recv ? "↓" : "↑"}</span>
                      <span style={{ minWidth: 0, flex: 1 }}>
                        <span style={{ fontSize: 13, fontWeight: 700, display: "block", color: pend ? "#6b7280" : "var(--text)" }}>
                          {recv ? "From" : "To"} {e.counterparty}
                          {e.isTransfer && <span style={{ marginLeft: 6, fontSize: 9.5, fontWeight: 800, color: pend ? "#6b7280" : "#4f46e5", background: pend ? "rgba(107,114,128,0.15)" : "rgba(99,102,241,0.12)", padding: "1px 6px", borderRadius: 6, verticalAlign: "middle" }}>⇄ Transfer</span>}
                        </span>
                        <span style={{ fontSize: 11, color: "var(--muted)", display: "block" }}>
                          {new Date(`${e.date}T00:00:00+05:30`).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric" })}
                          {pend && <span style={{ marginLeft: 6, color: "#b45309", fontWeight: 800 }}>· ⏳ Pending approval</span>}
                        </span>
                        {e.note && <span style={{ fontSize: 11.5, color: "var(--muted)", display: "block", marginTop: 2 }}>📝 {e.note}</span>}
                      </span>
                      <span style={{ fontFamily: "ui-monospace, monospace", fontWeight: 800, fontSize: 14, color: pend ? "#6b7280" : recv ? "#15803d" : "#b91c1c", whiteSpace: "nowrap" }}>
                        {recv ? "+" : "−"}{rupee(e.amount)}
                      </span>
                      {canCancel && (
                        <button type="button" onClick={() => { setCancelEntry(e); setStage(1); }} title="Cancel entry" style={{ border: "none", background: "transparent", cursor: "pointer", color: "#b91c1c", fontSize: 15, fontWeight: 800, padding: "4px 4px", lineHeight: 1 }}>✕</button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Two-step cancel confirm (owner only). */}
      {cancelEntry && (
        <div onClick={() => { if (!pending) setCancelEntry(null); }} style={{ position: "fixed", inset: 0, zIndex: 3500, background: "rgba(15,23,42,0.6)", backdropFilter: "blur(3px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: "min(420px, 100%)", background: "var(--surface, #fff)", borderRadius: 16, padding: "22px 22px 18px", boxShadow: "0 28px 70px rgba(0,0,0,0.4)" }}>
            {stage === 1 ? (
              <>
                <div style={{ fontSize: 30, marginBottom: 6 }}>🗑️</div>
                <div style={{ fontSize: 17, fontWeight: 800, marginBottom: 8 }}>Cancel this entry?</div>
                <div style={{ fontSize: 13.5, color: "var(--text)", lineHeight: 1.5 }}>
                  <strong>{cancelEntry.direction === "receive" ? "From" : "To"} {cancelEntry.counterparty}</strong> · <strong style={{ fontFamily: "ui-monospace, monospace" }}>{rupee(cancelEntry.amount)}</strong>
                  {cancelEntry.isTransfer && <span style={{ display: "block", marginTop: 6, fontSize: 12, color: "#4f46e5", fontWeight: 700 }}>⇄ This is a transfer — its matching half in the other account will be cancelled too.</span>}
                </div>
                <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 18 }}>
                  <button type="button" onClick={() => setCancelEntry(null)} style={ghostBtn}>Keep it</button>
                  <button type="button" onClick={() => setStage(2)} style={{ ...dangerBtn, background: "#b45309" }}>Continue →</button>
                </div>
              </>
            ) : (
              <>
                <div style={{ fontSize: 30, marginBottom: 6 }}>⚠️</div>
                <div style={{ fontSize: 17, fontWeight: 800, marginBottom: 8 }}>Are you absolutely sure?</div>
                <div style={{ fontSize: 13.5, color: "var(--text)", lineHeight: 1.5 }}>
                  This <strong>permanently</strong> removes the entry{cancelEntry.isTransfer ? " and its matching transfer half" : ""}. It can&apos;t be undone.
                </div>
                <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 18 }}>
                  <button type="button" disabled={pending} onClick={() => setCancelEntry(null)} style={ghostBtn}>No, keep it</button>
                  <button type="button" disabled={pending} onClick={doDelete} style={dangerBtn}>{pending ? "Cancelling…" : "✕ Yes, cancel it"}</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}

const ghostBtn: React.CSSProperties = { fontSize: 13, fontWeight: 700, padding: "10px 16px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)", cursor: "pointer" };
const dangerBtn: React.CSSProperties = { fontSize: 13, fontWeight: 800, padding: "10px 18px", borderRadius: 10, border: "none", color: "#fff", background: "#b91c1c", cursor: "pointer" };

// Indian digit grouping as you type: 100000 → 1,00,000 (lakh/crore). Submitted
// with commas; the server strips them. Keeps up to 2 decimals.
function groupIndian(s: string): string {
  const cleaned = s.replace(/,/g, "");
  if (cleaned === "") return "";
  const neg = cleaned.startsWith("-");
  const body = neg ? cleaned.slice(1) : cleaned;
  const dot = body.indexOf(".");
  const intDigits = (dot >= 0 ? body.slice(0, dot) : body).replace(/\D/g, "");
  const decDigits = dot >= 0 ? body.slice(dot + 1).replace(/\D/g, "").slice(0, 2) : "";
  const grouped = intDigits ? Number(intDigits).toLocaleString("en-IN") : (dot >= 0 ? "0" : "");
  return (neg ? "-" : "") + grouped + (dot >= 0 ? "." + decDigits : "");
}

function AmountField() {
  const [v, setV] = useState("");
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
      <span style={lbl}>Amount</span>
      <span style={{ position: "relative", display: "block" }}>
        <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", fontSize: 15, color: "var(--muted)", fontWeight: 700 }}>₹</span>
        <input name="amount" inputMode="decimal" required autoComplete="off" data-1p-ignore data-lpignore="true" value={v} onChange={(e) => setV(groupIndian(e.target.value))} placeholder="0" style={{ ...inp, paddingLeft: 28, fontSize: 16, fontWeight: 700, fontFamily: "ui-monospace, monospace" }} />
      </span>
    </label>
  );
}

// "To whom" is a mandatory pick (no free typing) — party names go in the Note.
// Emoji makes Home / Office / Other easy to tell apart in the dropdown.
const WHOM_EMOJI: Record<string, string> = { OFFICE: "🏢", HOME: "🏠", OTHER: "✏️" };

const inp: React.CSSProperties = {
  width: "100%", padding: "10px 12px", borderRadius: 9, border: "1px solid var(--border)",
  background: "var(--bg)", color: "var(--text)", fontSize: 14,
};
const lbl: React.CSSProperties = { fontSize: 11.5, fontWeight: 700, color: "var(--muted)" };
