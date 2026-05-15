"use client";

// ──────────────────────────────────────────────────────────────────
// Partial-rejection form (migration 045)
// ──────────────────────────────────────────────────────────────────
// Inline expanding form on the bill detail page. Lets owner /
// accountant / developer mark or update a partial rejection on a
// bill — e.g. "₹40,000 of the ₹100,000 raw-material order was bad,
// only paying for the surviving ₹60,000".
//
// State machine:
//   • collapsed → button "+ Mark partial rejection" (or "✏ Edit"
//     when an existing rejection is being modified)
//   • expanded  → numeric amount + reason textarea + Apply / Cancel
//
// The numeric input is constrained client-side to (0, maxAmount]
// (where maxAmount = bill subtotal); the server action re-checks
// the same bounds with race-guards.
//
// "Clear rejection" is a separate one-click form on the parent page
// — not a button on this form, to keep the destructive action
// obvious + auditable.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { markPartialRejectionAction } from "../../actions";
import { ACCOUNTS_TOKENS, BUTTON_STYLES } from "../../_ui/components";

export function PartialRejectionForm({
  billId,
  maxAmount,
  currentAmount,
  currentNote,
}: {
  billId: string;
  /** Cap = bill's amount_subtotal. Can't reject more than the
   *  subtotal — server action enforces too. */
  maxAmount: number;
  /** Existing rejection amount (0 if none). When > 0, the button
   *  label becomes "Edit" and the form pre-fills. */
  currentAmount: number;
  /** Existing rejection note (null if none). */
  currentNote: string | null;
}) {
  const router = useRouter();
  const isEdit = currentAmount > 0;
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState<string>(
    isEdit ? String(currentAmount) : "",
  );
  const [note, setNote] = useState<string>(currentNote ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    const n = Number(amount);
    if (!Number.isFinite(n) || n <= 0) {
      setError("Enter a rejection amount greater than zero.");
      return;
    }
    if (n > maxAmount) {
      setError(
        `Rejection (₹${n.toLocaleString("en-IN")}) cannot exceed the bill subtotal (₹${maxAmount.toLocaleString("en-IN")}).`,
      );
      return;
    }
    if (note.trim().length < 3) {
      setError("Add a short note explaining the rejection (e.g. 'wet material').");
      return;
    }

    startTransition(async () => {
      const fd = new FormData();
      fd.set("bill_id", billId);
      fd.set("partial_rejection_amount", String(n));
      fd.set("partial_rejection_note", note.trim());
      const result = await markPartialRejectionAction(fd);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setOpen(false);
      router.refresh();
    });
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        style={{
          ...BUTTON_STYLES.secondary,
          background: isEdit ? "#fff" : ACCOUNTS_TOKENS.warningLight,
          borderColor: ACCOUNTS_TOKENS.warning,
          color: ACCOUNTS_TOKENS.warning,
          fontWeight: 700,
        }}
      >
        {isEdit ? "✏ Edit partial rejection" : "+ Mark partial rejection"}
      </button>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 10,
        padding: 14,
        background: ACCOUNTS_TOKENS.warningLight,
        border: `1px solid ${ACCOUNTS_TOKENS.warning}`,
        borderRadius: 10,
      }}
    >
      <div
        style={{
          fontSize: 11,
          fontWeight: 800,
          color: ACCOUNTS_TOKENS.warning,
          textTransform: "uppercase",
          letterSpacing: "0.06em",
        }}
      >
        {isEdit ? "Edit partial rejection" : "Mark partial rejection"}
      </div>
      <p
        style={{
          margin: 0,
          fontSize: 12,
          color: "var(--muted)",
          lineHeight: 1.5,
        }}
      >
        Reduces the vendor payable. The vendor's invoice total stays
        unchanged (audit truth); only what we pay drops. GST + TDS +
        TCS auto-recompute on the surviving subtotal.
      </p>

      <label
        style={{
          fontSize: 11,
          fontWeight: 700,
          color: "var(--muted)",
          textTransform: "uppercase",
          letterSpacing: "0.05em",
        }}
      >
        Amount rejected (₹)
      </label>
      <input
        type="number"
        min="0"
        max={maxAmount}
        step="0.01"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        autoFocus
        style={{
          fontSize: 14,
          padding: "9px 12px",
          border: `1px solid ${ACCOUNTS_TOKENS.borderStrong}`,
          borderRadius: 8,
          background: "#fff",
          color: "var(--text)",
          fontFamily: "ui-monospace, monospace",
          fontWeight: 700,
        }}
      />
      <p
        style={{
          margin: 0,
          fontSize: 11,
          color: "var(--muted)",
          fontFamily: "ui-monospace, monospace",
        }}
      >
        Max ₹{maxAmount.toLocaleString("en-IN")} (the bill's net /
        subtotal)
      </p>

      <label
        style={{
          fontSize: 11,
          fontWeight: 700,
          color: "var(--muted)",
          textTransform: "uppercase",
          letterSpacing: "0.05em",
        }}
      >
        Reason
      </label>
      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        rows={3}
        placeholder="Wet material / wrong spec / quality fail / etc."
        style={{
          fontSize: 13,
          padding: "9px 12px",
          border: `1px solid ${ACCOUNTS_TOKENS.borderStrong}`,
          borderRadius: 8,
          background: "#fff",
          color: "var(--text)",
          resize: "vertical",
          fontFamily: "inherit",
        }}
      />

      {error && (
        <div
          role="alert"
          style={{
            fontSize: 12,
            color: ACCOUNTS_TOKENS.danger,
            background: ACCOUNTS_TOKENS.dangerLight,
            padding: "6px 10px",
            borderRadius: 6,
          }}
        >
          {error}
        </div>
      )}

      <div style={{ display: "flex", gap: 8 }}>
        <button
          type="submit"
          disabled={pending}
          style={{
            ...BUTTON_STYLES.primary,
            background: ACCOUNTS_TOKENS.warning,
            boxShadow: "0 1px 2px rgba(217,119,6,0.18)",
          }}
        >
          {pending
            ? "Saving…"
            : isEdit
              ? "Save changes"
              : "Apply rejection"}
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setAmount(isEdit ? String(currentAmount) : "");
            setNote(currentNote ?? "");
            setError(null);
          }}
          disabled={pending}
          style={BUTTON_STYLES.secondary}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
