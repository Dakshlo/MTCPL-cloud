"use client";

// ──────────────────────────────────────────────────────────────────
// Hold-bill form (migration 072, Daksh May 2026)
// ──────────────────────────────────────────────────────────────────
// Owner can hold (withhold) a slice of an approved bill so the
// accountant can only propose the un-held remainder. Same shape as
// PartialRejectionForm — inline expanding form on the bill detail
// page. Re-holding overwrites (audit log preserves history); a
// separate "Release hold" button on the parent page handles
// clearing.
//
// Numeric cap is the outstanding amount (passed in as maxAmount)
// since you can't hold more than what's still owed. The server
// action re-validates the same constraint.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { holdBillAmountAction } from "../../actions";
import { BUTTON_STYLES } from "../../_ui/components";

export function HoldBillForm({
  billId,
  maxAmount,
  currentAmount,
  currentReason,
}: {
  billId: string;
  /** Cap = bill's amount_outstanding (so the held amount can't ever
   *  exceed what's still owed). Server enforces too. */
  maxAmount: number;
  /** Existing held amount (0 if none). When > 0, the button label
   *  becomes "Adjust" and the form pre-fills. */
  currentAmount: number;
  /** Existing hold reason (null if none). */
  currentReason: string | null;
}) {
  const router = useRouter();
  const isEdit = currentAmount > 0;
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState<string>(
    isEdit ? String(currentAmount) : "",
  );
  const [reason, setReason] = useState<string>(currentReason ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    const n = Number(amount);
    if (!Number.isFinite(n) || n <= 0) {
      setError("Enter a hold amount greater than zero.");
      return;
    }
    if (n > maxAmount + 0.005) {
      setError(
        `Hold (₹${n.toLocaleString("en-IN")}) cannot exceed outstanding (₹${maxAmount.toLocaleString("en-IN")}).`,
      );
      return;
    }
    if (reason.trim().length < 3) {
      setError(
        "Add a short reason (e.g. 'shortage', 'retention', 'quality dispute').",
      );
      return;
    }

    // Mig 082 follow-on (Daksh) — explicit confirmation step before
    // the hold writes. Hold freezes money in Pay Today, so an
    // accidental click here can silently delay a real payment.
    // Confirm summarises the bill ID, the amount, the reason, and
    // (when editing) the delta vs. the existing hold so the owner
    // can pace the click.
    const deltaLine =
      isEdit && currentAmount !== n
        ? `\nDelta: ${n > currentAmount ? "+" : ""}₹${(n - currentAmount).toLocaleString("en-IN")} vs current ₹${currentAmount.toLocaleString("en-IN")}`
        : "";
    const msg = [
      isEdit ? "ADJUST HOLD on this bill?" : "APPLY HOLD on this bill?",
      "",
      `Amount: ₹${n.toLocaleString("en-IN")}`,
      `Reason: ${reason.trim()}`,
      deltaLine,
      "",
      "This freezes the amount from Pay Today proposals until the",
      "hold is released. Bill total + audit are unchanged.",
    ]
      .filter((s) => s !== "")
      .join("\n");
    if (!window.confirm(msg)) return;

    startTransition(async () => {
      const fd = new FormData();
      fd.set("bill_id", billId);
      fd.set("amount", String(n));
      fd.set("reason", reason.trim());
      const result = await holdBillAmountAction(fd);
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
          background: isEdit ? "#fff" : "#fef3c7",
          borderColor: "#d97706",
          color: "#92400e",
          fontWeight: 700,
        }}
      >
        {isEdit ? "✏ Adjust hold" : "🔒 Hold amount"}
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
        background: "#fef3c7",
        border: "1px solid #d97706",
        borderRadius: 10,
      }}
    >
      <div
        style={{
          fontSize: 11,
          fontWeight: 800,
          color: "#92400e",
          textTransform: "uppercase",
          letterSpacing: "0.06em",
        }}
      >
        {isEdit ? "Adjust hold" : "Hold a portion of this bill"}
      </div>
      <p
        style={{
          margin: 0,
          fontSize: 12,
          color: "var(--muted)",
          lineHeight: 1.5,
        }}
      >
        Withholds part of the payable so accountant can only propose
        the rest. Bill total + audit are unchanged — only the
        proposable amount drops. Release the hold any time.
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
        Amount to hold (₹)
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
          border: "1px solid #b45309",
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
        Max ₹{maxAmount.toLocaleString("en-IN")} (the bill's
        outstanding)
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
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        rows={3}
        placeholder="Shortage / retention / quality dispute / pending GR / etc."
        style={{
          fontSize: 13,
          padding: "9px 12px",
          border: "1px solid #b45309",
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
            color: "#b91c1c",
            background: "rgba(220,38,38,0.08)",
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
            background: "#d97706",
            boxShadow: "0 1px 2px rgba(217,119,6,0.18)",
          }}
        >
          {pending ? "Saving…" : isEdit ? "Save changes" : "Apply hold"}
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setAmount(isEdit ? String(currentAmount) : "");
            setReason(currentReason ?? "");
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
