"use client";

/**
 * One personal-ledger account card (mig 174): big current balance, a receive/pay
 * form (with a "to whom" datalist) showing the branded spinning-logo overlay on
 * submit, and a Details button that opens the full entry history in a centered
 * peek modal.
 */

import { useState } from "react";
import { useFormStatus } from "react-dom";
import { rupee } from "@/lib/challan-pricing";
import { FinanceLoadingOverlay } from "@/components/finance-loading-overlay";
import { addLedgerEntryAction } from "./actions";

export type EntryView = {
  id: string;
  date: string;
  direction: "receive" | "pay";
  amount: number;
  counterparty: string;
  status: "confirmed" | "pending" | "rejected";
  isTransfer: boolean;
};

function SubmitBtn() {
  const { pending } = useFormStatus();
  return (
    <>
      <FinanceLoadingOverlay show={pending} label="Saving entry…" />
      <button type="submit" disabled={pending} style={{ fontSize: 14, fontWeight: 800, padding: "11px 20px", borderRadius: 11, border: "none", color: "#fff", background: "#0f172a", cursor: pending ? "default" : "pointer", opacity: pending ? 0.7 : 1, whiteSpace: "nowrap" }}>
        {pending ? "Saving…" : "＋ Add entry"}
      </button>
    </>
  );
}

export function LedgerCard({
  account, title, emoji, balance, entries, canEdit, options,
}: {
  account: "home" | "office";
  title: string;
  emoji: string;
  balance: number;
  entries: EntryView[];
  canEdit: boolean;
  options: string[];
}) {
  const [direction, setDirection] = useState<"receive" | "pay">("receive");
  const [showDetails, setShowDetails] = useState(false);
  const listId = `cp-${account}`;
  const positive = balance >= 0;
  const confirmedCount = entries.filter((e) => e.status === "confirmed").length;

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
        <form action={addLedgerEntryAction} style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: 13, borderBottom: "1px solid var(--border)" }}>
          <input type="hidden" name="account" value={account} />
          <input type="hidden" name="direction" value={direction} />

          <div style={{ display: "flex", gap: 9 }}>
            <button type="button" onClick={() => setDirection("receive")} style={segBtn(direction === "receive", "#15803d")}>↓ Receive</button>
            <button type="button" onClick={() => setDirection("pay")} style={segBtn(direction === "pay", "#b45309")}>↑ Pay / Give</button>
          </div>

          <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            <span style={lbl}>Amount</span>
            <span style={{ position: "relative", display: "block" }}>
              <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", fontSize: 15, color: "var(--muted)", fontWeight: 700 }}>₹</span>
              <input name="amount" inputMode="decimal" required placeholder="0" style={{ ...inp, paddingLeft: 28, fontSize: 16, fontWeight: 700, fontFamily: "ui-monospace, monospace" }} />
            </span>
          </label>

          <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            <span style={lbl}>{direction === "receive" ? "Received from" : "Paid / given to"}</span>
            <input name="counterparty" list={listId} placeholder="Type a name, or pick…" style={inp} />
            <datalist id={listId}>{options.map((o) => <option key={o} value={o} />)}</datalist>
            <span style={{ fontSize: 10.5, color: "var(--muted)" }}>
              Pick <strong>{options[0]}</strong> to move money between the two accounts; anything else is just a note.
            </span>
          </label>

          <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            <span style={lbl}>Note <span style={{ fontWeight: 500 }}>(optional)</span></span>
            <input name="note" placeholder="What's this for?" style={inp} />
          </label>

          <div style={{ display: "flex", justifyContent: "flex-end" }}><SubmitBtn /></div>
        </form>
      )}

      {/* Details opener */}
      <button type="button" onClick={() => setShowDetails(true)} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", border: "none", background: "transparent", cursor: "pointer", fontSize: 13, fontWeight: 800, color: "var(--text)", padding: "14px 20px" }}>
        <span>📋 Details <span style={{ color: "var(--muted)", fontWeight: 600 }}>· {entries.length} entr{entries.length === 1 ? "y" : "ies"}</span></span>
        <span style={{ fontSize: 12, color: "var(--muted)" }}>Open ›</span>
      </button>

      {showDetails && (
        <DetailsModal title={title} emoji={emoji} balance={balance} positive={positive} entries={entries} onClose={() => setShowDetails(false)} />
      )}
    </div>
  );
}

function DetailsModal({ title, emoji, balance, positive, entries, onClose }: { title: string; emoji: string; balance: number; positive: boolean; entries: EntryView[]; onClose: () => void }) {
  return (
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
          {entries.length === 0 ? (
            <div style={{ fontSize: 13, color: "var(--muted)", textAlign: "center", padding: "24px 0" }}>No entries yet.</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
              {entries.map((e) => {
                const recv = e.direction === "receive";
                return (
                  <div key={e.id} style={{ display: "flex", alignItems: "center", gap: 11, padding: "9px 12px", border: "1px solid var(--border)", borderRadius: 10, background: "var(--bg)", opacity: e.status === "pending" ? 0.75 : 1 }}>
                    <span style={{ fontSize: 17, color: recv ? "#15803d" : "#b45309" }}>{recv ? "↓" : "↑"}</span>
                    <span style={{ minWidth: 0, flex: 1 }}>
                      <span style={{ fontSize: 13, fontWeight: 700, display: "block" }}>
                        {recv ? "From" : "To"} {e.counterparty}
                        {e.isTransfer && <span style={{ marginLeft: 6, fontSize: 9.5, fontWeight: 800, color: "#4f46e5", background: "rgba(99,102,241,0.12)", padding: "1px 6px", borderRadius: 6, verticalAlign: "middle" }}>⇄ Transfer</span>}
                      </span>
                      <span style={{ fontSize: 11, color: "var(--muted)" }}>
                        {new Date(`${e.date}T00:00:00+05:30`).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric" })}
                        {e.status === "pending" && <span style={{ marginLeft: 6, color: "#b45309", fontWeight: 800 }}>· ⏳ Pending approval</span>}
                      </span>
                    </span>
                    <span style={{ fontFamily: "ui-monospace, monospace", fontWeight: 800, fontSize: 14, color: recv ? "#15803d" : "#b91c1c", whiteSpace: "nowrap" }}>
                      {recv ? "+" : "−"}{rupee(e.amount)}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const inp: React.CSSProperties = {
  width: "100%", padding: "10px 12px", borderRadius: 9, border: "1px solid var(--border)",
  background: "var(--bg)", color: "var(--text)", fontSize: 14,
};
const lbl: React.CSSProperties = { fontSize: 11.5, fontWeight: 700, color: "var(--muted)" };
