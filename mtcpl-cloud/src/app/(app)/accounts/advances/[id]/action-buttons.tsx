"use client";

// Inline confirm-before-submit buttons for the advance detail page.
// Server components can't attach onSubmit/onClick handlers, so these
// thin client wrappers exist purely to gate the form post on a
// window.confirm. Forms still call the server actions directly.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  cancelAdvanceFormAction,
  confirmAdvanceAction,
  markAdvancePaidAction,
  unapplyAdvanceFormAction,
} from "../../actions";
import { ACCOUNTS_TOKENS, BUTTON_STYLES } from "../../_ui/components";

export function UnapplyButton({
  applicationId,
  billId,
}: {
  applicationId: string;
  billId: string;
}) {
  return (
    <form
      action={unapplyAdvanceFormAction}
      onSubmit={(e) => {
        if (
          !window.confirm(
            "Unapply this advance application?\n\nBill outstanding will go back up; credit returns to the vendor pool.",
          )
        ) {
          e.preventDefault();
        }
      }}
    >
      <input type="hidden" name="application_id" value={applicationId} />
      <input type="hidden" name="bill_id" value={billId} />
      <input type="hidden" name="reason" value="owner reversal" />
      <button
        type="submit"
        style={{
          ...BUTTON_STYLES.ghost,
          fontSize: 11,
          padding: "4px 10px",
          color: ACCOUNTS_TOKENS.danger,
          borderColor: ACCOUNTS_TOKENS.danger,
        }}
      >
        ↩ Unapply
      </button>
    </form>
  );
}

/** Owner confirm — moves proposed → confirmed. Mirrors the Pay
 *  Today confirm step but for a single advance row. */
export function ConfirmAdvanceButton({
  advanceId,
  token,
}: {
  advanceId: string;
  token: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handle() {
    if (!window.confirm(`Confirm advance ${token} for payment? Owner authorising the money to move.`))
      return;
    startTransition(async () => {
      const fd = new FormData();
      fd.set("advance_id", advanceId);
      const res = await confirmAdvanceAction(fd);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      router.refresh();
    });
  }
  return (
    <div style={{ display: "inline-flex", flexDirection: "column", gap: 4 }}>
      <button
        type="button"
        onClick={handle}
        disabled={pending}
        style={{ ...BUTTON_STYLES.primary, background: ACCOUNTS_TOKENS.accent }}
      >
        {pending ? "Confirming…" : "✓ Confirm advance"}
      </button>
      {error && (
        <span style={{ fontSize: 11, color: ACCOUNTS_TOKENS.danger }}>{error}</span>
      )}
    </div>
  );
}

/** Accountant Mark Paid — captures method + reference (UTR / cheque).
 *  Renders as a tiny inline form so the data goes in one click without
 *  leaving the page. */
export function MarkAdvancePaidButton({
  advanceId,
  token,
}: {
  advanceId: string;
  token: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [method, setMethod] = useState("NEFT");
  const [reference, setReference] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!reference.trim()) {
      setError("Enter the payment reference (UTR / cheque no).");
      return;
    }
    setError(null);
    startTransition(async () => {
      const fd = new FormData();
      fd.set("advance_id", advanceId);
      fd.set("payment_method", method);
      fd.set("payment_reference", reference.trim());
      const res = await markAdvancePaidAction(fd);
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
        onClick={() => setOpen(true)}
        style={{ ...BUTTON_STYLES.primary, background: ACCOUNTS_TOKENS.success }}
      >
        ✓ Mark {token} paid
      </button>
    );
  }
  return (
    <form
      onSubmit={handleSubmit}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 8,
        padding: 12,
        background: "#fff",
        border: `1.5px solid ${ACCOUNTS_TOKENS.success}`,
        borderRadius: 10,
        minWidth: 280,
      }}
    >
      <label style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)" }}>
        Method
        <select
          value={method}
          onChange={(e) => setMethod(e.target.value)}
          style={{ display: "block", marginTop: 2, padding: "6px 8px", width: "100%", border: "1px solid var(--border)", borderRadius: 6 }}
        >
          <option>NEFT</option>
          <option>RTGS</option>
          <option>IMPS</option>
          <option>UPI</option>
          <option>Cheque</option>
          <option>Cash</option>
        </select>
      </label>
      <label style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)" }}>
        Reference (UTR / cheque no)
        <input
          type="text"
          value={reference}
          onChange={(e) => setReference(e.target.value)}
          placeholder="e.g. UTRABC1234567"
          autoFocus
          style={{ display: "block", marginTop: 2, padding: "6px 10px", width: "100%", border: "1px solid var(--border)", borderRadius: 6, fontFamily: "ui-monospace, monospace" }}
        />
      </label>
      {error && <span style={{ fontSize: 11, color: ACCOUNTS_TOKENS.danger }}>{error}</span>}
      <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
        <button type="button" onClick={() => setOpen(false)} style={BUTTON_STYLES.secondary} disabled={pending}>
          Cancel
        </button>
        <button
          type="submit"
          disabled={pending || !reference.trim()}
          style={{ ...BUTTON_STYLES.primary, background: ACCOUNTS_TOKENS.success }}
        >
          {pending ? "Saving…" : "✓ Mark paid"}
        </button>
      </div>
    </form>
  );
}

export function CancelAdvanceButton({
  advanceId,
  token,
}: {
  advanceId: string;
  token: string;
}) {
  return (
    <form
      action={cancelAdvanceFormAction}
      onSubmit={(e) => {
        if (
          !window.confirm(
            `Cancel ${token}? This stops the advance before any money moves.`,
          )
        ) {
          e.preventDefault();
        }
      }}
    >
      <input type="hidden" name="advance_id" value={advanceId} />
      <input type="hidden" name="reason" value="owner cancelled pre-pay" />
      <button
        type="submit"
        style={{
          ...BUTTON_STYLES.secondary,
          color: ACCOUNTS_TOKENS.danger,
          borderColor: ACCOUNTS_TOKENS.danger,
        }}
      >
        🗑 Cancel advance
      </button>
    </form>
  );
}
