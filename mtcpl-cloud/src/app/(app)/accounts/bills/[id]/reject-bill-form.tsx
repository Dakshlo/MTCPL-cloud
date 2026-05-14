"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { rejectBillAction } from "../../actions";
import { ACCOUNTS_TOKENS, BUTTON_STYLES } from "../../_ui/components";

export function RejectBillForm({ billId }: { billId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const fd = new FormData();
      fd.set("bill_id", billId);
      fd.set("note", note.trim());
      const result = await rejectBillAction(fd);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setOpen(false);
      setNote("");
      router.refresh();
    });
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        style={BUTTON_STYLES.danger}
      >
        ↩ Reject (send back for edit)
      </button>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      style={{
        flex: 1,
        minWidth: 280,
        display: "flex",
        flexDirection: "column",
        gap: 10,
        padding: 14,
        background: "#fff",
        border: `1px solid ${ACCOUNTS_TOKENS.border}`,
        borderRadius: 10,
      }}
    >
      <label
        style={{
          fontSize: 11,
          fontWeight: 700,
          color: "var(--muted)",
          textTransform: "uppercase",
          letterSpacing: "0.05em",
        }}
      >
        Note for the biller (optional)
      </label>
      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        rows={3}

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
          style={{ ...BUTTON_STYLES.primary, background: ACCOUNTS_TOKENS.danger, boxShadow: "0 1px 2px rgba(220,38,38,0.18)" }}
        >
          {pending ? "Sending back…" : "↩ Confirm reject"}
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setNote("");
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
