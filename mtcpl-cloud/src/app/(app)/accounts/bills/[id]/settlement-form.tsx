"use client";

/**
 * Mig 219 — "Settle this bill" (Daksh, Aug 2026). Owner / developer only.
 *
 * For bills already paid to the vendor OUTSIDE this software, sitting in
 * Due Bills with an outstanding that isn't real. Clearing it writes off
 * money with no bank movement and no approval step, so the form is
 * deliberately slow and loud:
 *   • full vs partial is an explicit choice (no silently-prefilled box);
 *   • the reason is mandatory and must be a real sentence;
 *   • the button spells out the exact rupees, and confirms once more.
 *
 * Reversal lives here too — a mistaken settlement can be undone (also
 * with a reason), which soft-cancels the row and puts the outstanding
 * straight back.
 */

import { useState } from "react";
import { settleBillFormAction, reverseBillSettlementFormAction } from "../../actions";

const REASON_MIN = 8;

const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;

const field: React.CSSProperties = {
  width: "100%",
  padding: "8px 10px",
  fontSize: 13,
  border: "1px solid #cbd5e1",
  borderRadius: 8,
  background: "#fff",
  color: "#0f172a",
  outline: "none",
};

export function SettlementForm({
  billId,
  outstanding,
  heldAmount,
}: {
  billId: string;
  outstanding: number;
  heldAmount: number;
}) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"full" | "partial">("full");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");

  const typed = Number(amount);
  const partialValid = mode === "partial" ? Number.isFinite(typed) && typed > 0 && typed <= outstanding + 0.5 : true;
  const effective = mode === "full" ? outstanding : Number.isFinite(typed) ? Math.min(typed, outstanding) : 0;
  const ready = reason.trim().length >= REASON_MIN && partialValid && effective > 0;

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        style={{
          fontSize: 12,
          fontWeight: 700,
          padding: "8px 14px",
          borderRadius: 8,
          border: "1px solid #7c3aed",
          background: "#f5f3ff",
          color: "#5b21b6",
          cursor: "pointer",
          alignSelf: "flex-start",
        }}
      >
        ⚖ Settle this bill
      </button>
    );
  }

  return (
    <form
      action={settleBillFormAction}
      onSubmit={(e) => {
        const what = mode === "full" ? `the FULL ${inr(outstanding)}` : inr(effective);
        if (
          !window.confirm(
            `Settle ${what} on this bill?\n\nThis clears the outstanding without any bank payment — use it only when the vendor was already paid outside this software.\n\nReason: ${reason.trim()}`,
          )
        ) {
          e.preventDefault();
        }
      }}
      style={{ display: "flex", flexDirection: "column", gap: 10 }}
    >
      <input type="hidden" name="bill_id" value={billId} />
      <input type="hidden" name="mode" value={mode} />

      {/* Full vs partial */}
      <div style={{ display: "flex", gap: 8 }}>
        {(["full", "partial"] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            style={{
              flex: 1,
              fontSize: 12,
              fontWeight: 800,
              padding: "8px 10px",
              borderRadius: 8,
              cursor: "pointer",
              border: `1px solid ${mode === m ? "#7c3aed" : "#cbd5e1"}`,
              background: mode === m ? "#7c3aed" : "#fff",
              color: mode === m ? "#fff" : "#475569",
            }}
          >
            {m === "full" ? `Full · ${inr(outstanding)}` : "Part amount"}
          </button>
        ))}
      </div>

      {mode === "partial" && (
        <div>
          <input
            name="amount"
            type="number"
            min={1}
            max={Math.round(outstanding)}
            step="1"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder={`Amount to settle — max ${Math.round(outstanding)}`}
            style={{ ...field, borderColor: amount && !partialValid ? "#dc2626" : "#cbd5e1" }}
          />
          {amount && !partialValid && (
            <div style={{ fontSize: 11, color: "#b91c1c", marginTop: 4 }}>
              More than the {inr(outstanding)} outstanding.
            </div>
          )}
        </div>
      )}

      <div>
        <textarea
          name="reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={2}
          placeholder="Why is this being settled? e.g. paid by cash on 12 Mar 2025, receipt with Naresh ji"
          style={{ ...field, resize: "vertical", fontFamily: "inherit" }}
        />
        <div style={{ fontSize: 10.5, color: reason.trim().length >= REASON_MIN ? "#64748b" : "#b45309", marginTop: 4 }}>
          Required — this is the only record of why the outstanding was written off.
        </div>
      </div>

      {heldAmount > 0 && (
        <div style={{ fontSize: 11, color: "#92400e", background: "#fffbeb", border: "1px solid #fcd34d", borderRadius: 8, padding: "7px 10px" }}>
          Note: {inr(heldAmount)} of this bill is under owner hold. Settling clears the outstanding regardless.
        </div>
      )}

      <div style={{ display: "flex", gap: 8 }}>
        <button
          type="submit"
          disabled={!ready}
          style={{
            flex: 1,
            fontSize: 12.5,
            fontWeight: 800,
            padding: "9px 14px",
            borderRadius: 8,
            border: "none",
            background: ready ? "#7c3aed" : "#c4b5fd",
            color: "#fff",
            cursor: ready ? "pointer" : "not-allowed",
          }}
        >
          Settle {effective > 0 ? inr(effective) : ""}
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setReason("");
            setAmount("");
            setMode("full");
          }}
          style={{
            fontSize: 12.5,
            fontWeight: 700,
            padding: "9px 14px",
            borderRadius: 8,
            border: "1px solid #cbd5e1",
            background: "#fff",
            color: "#475569",
            cursor: "pointer",
          }}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

/** Undo one settlement — same gate, its own mandatory reason. */
export function ReverseSettlementButton({
  paymentId,
  amount,
}: {
  paymentId: string;
  amount: number;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const ready = reason.trim().length >= REASON_MIN;

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        style={{
          fontSize: 11,
          fontWeight: 700,
          padding: "5px 11px",
          borderRadius: 7,
          border: "1px solid #cbd5e1",
          background: "#fff",
          color: "#475569",
          cursor: "pointer",
        }}
      >
        ↩ Undo settlement
      </button>
    );
  }

  return (
    <form
      action={reverseBillSettlementFormAction}
      onSubmit={(e) => {
        if (!window.confirm(`Reverse this ${inr(amount)} settlement? The outstanding comes back on the bill.`)) {
          e.preventDefault();
        }
      }}
      style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8 }}
    >
      <input type="hidden" name="payment_id" value={paymentId} />
      <textarea
        name="reverse_reason"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        rows={2}
        placeholder="Why is this settlement being reversed?"
        style={{ ...field, resize: "vertical", fontFamily: "inherit" }}
      />
      <div style={{ display: "flex", gap: 8 }}>
        <button
          type="submit"
          disabled={!ready}
          style={{
            fontSize: 12,
            fontWeight: 800,
            padding: "8px 13px",
            borderRadius: 8,
            border: "none",
            background: ready ? "#b91c1c" : "#fca5a5",
            color: "#fff",
            cursor: ready ? "pointer" : "not-allowed",
          }}
        >
          Reverse {inr(amount)}
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setReason("");
          }}
          style={{
            fontSize: 12,
            fontWeight: 700,
            padding: "8px 13px",
            borderRadius: 8,
            border: "1px solid #cbd5e1",
            background: "#fff",
            color: "#475569",
            cursor: "pointer",
          }}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
