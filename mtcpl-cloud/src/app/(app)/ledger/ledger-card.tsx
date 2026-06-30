"use client";

/**
 * One personal-ledger account card (mig 174): current balance on top, a
 * receive/pay form (with a "to whom" datalist), and a Details expander listing
 * every entry (date · amount · counterparty · pending state).
 */

import { useState } from "react";
import { useFormStatus } from "react-dom";
import { rupee } from "@/lib/challan-pricing";
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
    <button type="submit" disabled={pending} style={{ fontSize: 13.5, fontWeight: 800, padding: "10px 18px", borderRadius: 10, border: "none", color: "#fff", background: "#0f172a", cursor: pending ? "default" : "pointer", opacity: pending ? 0.7 : 1, whiteSpace: "nowrap" }}>
      {pending ? "Saving…" : "＋ Add entry"}
    </button>
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
  /** datalist options for "to whom" (e.g. ["OFFICE","Other"]). First entry is the special transfer keyword. */
  options: string[];
}) {
  const [direction, setDirection] = useState<"receive" | "pay">("receive");
  const [showDetails, setShowDetails] = useState(false);
  const listId = `cp-${account}`;
  const positive = balance >= 0;

  const segBtn = (active: boolean, color: string): React.CSSProperties => ({
    flex: 1, padding: "9px 12px", fontSize: 13, fontWeight: 800, borderRadius: 9, cursor: "pointer",
    border: `1.5px solid ${active ? color : "var(--border)"}`,
    background: active ? color : "var(--bg)", color: active ? "#fff" : "var(--text)",
  });

  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: 16, background: "var(--surface, #fff)", overflow: "hidden", display: "flex", flexDirection: "column" }}>
      {/* Balance header */}
      <div style={{ padding: "16px 18px", background: "var(--bg)", borderBottom: "1px solid var(--border)" }}>
        <div style={{ fontSize: 13, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--muted)" }}>{emoji} {title}</div>
        <div style={{ fontSize: 30, fontWeight: 800, marginTop: 4, color: positive ? "#15803d" : "#b91c1c", fontFamily: "ui-monospace, monospace" }}>
          {rupee(balance)}
        </div>
        <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 2 }}>Current balance · {entries.filter((e) => e.status === "confirmed").length} confirmed entr{entries.filter((e) => e.status === "confirmed").length === 1 ? "y" : "ies"}</div>
      </div>

      {/* Receive / Pay form */}
      {canEdit && (
        <form action={addLedgerEntryAction} style={{ padding: "14px 18px", display: "flex", flexDirection: "column", gap: 11, borderBottom: "1px solid var(--border)" }}>
          <input type="hidden" name="account" value={account} />
          <input type="hidden" name="direction" value={direction} />

          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" onClick={() => setDirection("receive")} style={segBtn(direction === "receive", "#15803d")}>↓ Receive</button>
            <button type="button" onClick={() => setDirection("pay")} style={segBtn(direction === "pay", "#b45309")}>↑ Pay / Give</button>
          </div>

          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontSize: 11.5, fontWeight: 700, color: "var(--muted)" }}>Amount (₹)</span>
            <input name="amount" inputMode="decimal" required placeholder="0" style={inp} />
          </label>

          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontSize: 11.5, fontWeight: 700, color: "var(--muted)" }}>{direction === "receive" ? "Received from" : "Paid / given to"}</span>
            <input name="counterparty" list={listId} placeholder="Type a name, or pick…" style={inp} />
            <datalist id={listId}>
              {options.map((o) => <option key={o} value={o} />)}
            </datalist>
            <span style={{ fontSize: 10.5, color: "var(--muted)" }}>
              Pick <strong>{options[0]}</strong> to move money between the two accounts; anything else is just a note.
            </span>
          </label>

          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontSize: 11.5, fontWeight: 700, color: "var(--muted)" }}>Note <span style={{ fontWeight: 500 }}>(optional)</span></span>
            <input name="note" placeholder="What's this for?" style={inp} />
          </label>

          <div style={{ display: "flex", justifyContent: "flex-end" }}><SubmitBtn /></div>
        </form>
      )}

      {/* Details */}
      <div style={{ padding: "12px 18px" }}>
        <button type="button" onClick={() => setShowDetails((v) => !v)} style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", border: "none", background: "transparent", cursor: "pointer", fontSize: 13, fontWeight: 800, color: "var(--text)", padding: "2px 0" }}>
          <span>📋 Details <span style={{ color: "var(--muted)", fontWeight: 600 }}>· {entries.length}</span></span>
          <span style={{ fontSize: 12, color: "var(--muted)", transform: showDetails ? "rotate(180deg)" : "none", transition: "transform 0.15s" }}>▾</span>
        </button>
        {showDetails && (
          entries.length === 0 ? (
            <div style={{ fontSize: 12.5, color: "var(--muted)", padding: "10px 0" }}>No entries yet.</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 10 }}>
              {entries.map((e) => {
                const recv = e.direction === "receive";
                return (
                  <div key={e.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", border: "1px solid var(--border)", borderRadius: 9, background: "var(--bg)", opacity: e.status === "pending" ? 0.7 : 1 }}>
                    <span style={{ fontSize: 16, color: recv ? "#15803d" : "#b45309" }}>{recv ? "↓" : "↑"}</span>
                    <span style={{ minWidth: 0, flex: 1 }}>
                      <span style={{ fontSize: 13, fontWeight: 700, display: "block" }}>
                        {recv ? "From" : "To"} {e.counterparty}
                        {e.isTransfer && <span style={{ marginLeft: 6, fontSize: 9.5, fontWeight: 800, color: "#4f46e5", background: "rgba(99,102,241,0.12)", padding: "1px 6px", borderRadius: 6, verticalAlign: "middle" }}>⇄ Transfer</span>}
                      </span>
                      <span style={{ fontSize: 11, color: "var(--muted)" }}>
                        {new Date(`${e.date}T00:00:00+05:30`).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric" })}
                        {e.status === "pending" && <span style={{ marginLeft: 6, color: "#b45309", fontWeight: 800 }}>· ⏳ Pending approval</span>}
                        {e.status === "rejected" && <span style={{ marginLeft: 6, color: "#b91c1c", fontWeight: 800 }}>· ✕ Rejected</span>}
                      </span>
                    </span>
                    <span style={{ fontFamily: "ui-monospace, monospace", fontWeight: 800, fontSize: 13.5, color: recv ? "#15803d" : "#b91c1c", whiteSpace: "nowrap" }}>
                      {recv ? "+" : "−"}{rupee(e.amount)}
                    </span>
                  </div>
                );
              })}
            </div>
          )
        )}
      </div>
    </div>
  );
}

const inp: React.CSSProperties = {
  width: "100%", padding: "9px 11px", borderRadius: 8, border: "1px solid var(--border)",
  background: "var(--bg)", color: "var(--text)", fontSize: 14,
};
