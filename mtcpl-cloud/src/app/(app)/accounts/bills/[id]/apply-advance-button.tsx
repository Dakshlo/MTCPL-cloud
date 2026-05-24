"use client";

/**
 * Apply-vendor-advance modal — opens from the Vendor advance credit
 * panel on the bill detail page.
 *
 * UX: user picks one of the vendor's open advances + types how much
 * to apply (capped at min(advance.remaining, bill.outstanding)).
 * Server clamps too. On success → server-action redirect refreshes
 * the bill page with the toast.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { applyAdvanceToBillAction } from "../../actions";
import { BUTTON_STYLES, ACCOUNTS_TOKENS } from "../../_ui/components";

type AdvOption = { id: string; token: string; remaining: number };

export function ApplyAdvanceButton({
  billId,
  billOutstanding,
  advances,
}: {
  billId: string;
  billOutstanding: number;
  advances: AdvOption[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [advanceId, setAdvanceId] = useState<string>(advances[0]?.id ?? "");
  const selected = advances.find((a) => a.id === advanceId) ?? advances[0];
  const maxApplicable = selected
    ? Math.min(selected.remaining, billOutstanding)
    : 0;
  const [amount, setAmount] = useState<string>(
    maxApplicable > 0 ? String(maxApplicable) : "",
  );
  const [note, setNote] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    const n = Number(amount);
    if (!Number.isFinite(n) || n <= 0) {
      setError("Enter an amount to apply.");
      return;
    }
    if (selected && n > selected.remaining + 0.005) {
      setError(
        `Max ₹${selected.remaining.toLocaleString("en-IN")} available on ${selected.token}.`,
      );
      return;
    }
    if (n > billOutstanding + 0.005) {
      setError(
        `Bill outstanding is ₹${billOutstanding.toLocaleString("en-IN")}.`,
      );
      return;
    }

    startTransition(async () => {
      const fd = new FormData();
      fd.set("bill_id", billId);
      fd.set("advance_id", advanceId);
      fd.set("amount_applied", String(n));
      fd.set("note", note.trim());
      const res = await applyAdvanceToBillAction(fd);
      if (!res.ok) {
        setError(res.error);
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
        onClick={() => {
          setOpen(true);
          setError(null);
          if (selected) {
            setAmount(
              String(Math.min(selected.remaining, billOutstanding)),
            );
          }
        }}
        style={{
          ...BUTTON_STYLES.secondary,
          background: "#fff",
          borderColor: "#047857",
          color: "#047857",
          fontWeight: 700,
        }}
      >
        ➕ Apply advance to this bill
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
        background: "#fff",
        border: "1.5px solid #10b981",
        borderRadius: 10,
        width: "100%",
        maxWidth: 520,
      }}
    >
      <div
        style={{
          fontSize: 11,
          fontWeight: 800,
          color: "#047857",
          textTransform: "uppercase",
          letterSpacing: "0.06em",
        }}
      >
        Apply advance credit
      </div>

      <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <span style={fieldLabel()}>Advance</span>
        <select
          value={advanceId}
          onChange={(e) => {
            const id = e.target.value;
            setAdvanceId(id);
            const adv = advances.find((a) => a.id === id);
            if (adv) {
              setAmount(String(Math.min(adv.remaining, billOutstanding)));
            }
          }}
          style={{
            padding: "8px 12px",
            fontSize: 13,
            border: "1px solid var(--border)",
            borderRadius: 7,
            background: "#fff",
            color: "var(--text)",
          }}
        >
          {advances.map((a) => (
            <option key={a.id} value={a.id}>
              {a.token} · ₹{a.remaining.toLocaleString("en-IN")} available
            </option>
          ))}
        </select>
      </label>

      <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <span style={fieldLabel()}>Amount to apply (₹)</span>
        <input
          type="number"
          min="0"
          max={maxApplicable}
          step="0.01"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          autoFocus
          style={{
            padding: "9px 12px",
            fontSize: 14,
            border: "1px solid #10b981",
            borderRadius: 7,
            background: "#fff",
            color: "var(--text)",
            fontFamily: "ui-monospace, monospace",
            fontWeight: 700,
          }}
        />
        <span style={{ fontSize: 11, color: "var(--muted)", fontFamily: "ui-monospace, monospace" }}>
          Max ₹{maxApplicable.toLocaleString("en-IN")}{" "}
          (min of advance remaining + bill outstanding)
        </span>
      </label>

      <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <span style={fieldLabel()}>Note (optional)</span>
        <input
          type="text"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="e.g. against shortage / partial advance"
          maxLength={500}
          style={{
            padding: "8px 12px",
            fontSize: 13,
            border: "1px solid var(--border)",
            borderRadius: 7,
            background: "#fff",
            color: "var(--text)",
          }}
        />
      </label>

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

      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setError(null);
          }}
          disabled={pending}
          style={BUTTON_STYLES.secondary}
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={pending || !advanceId || !amount}
          style={{
            ...BUTTON_STYLES.primary,
            background: "#10b981",
            boxShadow: "0 1px 2px rgba(16,185,129,0.2)",
          }}
        >
          {pending ? "Applying…" : "✓ Apply credit"}
        </button>
      </div>
    </form>
  );
}

function fieldLabel(): React.CSSProperties {
  return {
    fontSize: 10,
    fontWeight: 800,
    color: "var(--muted)",
    textTransform: "uppercase",
    letterSpacing: "0.06em",
  };
}
