"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { rejectBillAction } from "../../actions";

/** Reject-bill mini-form. Shows a "↩ Reject (with note)" button that
 *  opens an inline note textarea. Mirrors the cutting-approval
 *  send-back flow. */
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
        style={{
          fontSize: 13,
          padding: "8px 16px",
          background: "var(--bg)",
          border: "1px solid var(--border)",
          borderRadius: 6,
          color: "#b91c1c",
          fontWeight: 600,
          cursor: "pointer",
        }}
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
        gap: 8,
        padding: 12,
        background: "var(--bg)",
        border: "1px solid var(--border)",
        borderRadius: 6,
      }}
    >
      <label
        style={{
          fontSize: 10,
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
        placeholder="e.g. Check the amount — total seems off. Re-confirm GST%."
        style={{
          fontSize: 13,
          padding: "8px 10px",
          border: "1px solid var(--border)",
          borderRadius: 4,
          background: "var(--surface)",
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
            color: "#7f1d1d",
            background: "rgba(220,38,38,0.08)",
            padding: "6px 10px",
            borderRadius: 4,
          }}
        >
          {error}
        </div>
      )}
      <div style={{ display: "flex", gap: 8 }}>
        <button
          type="submit"
          disabled={pending}
          className="primary-button"
          style={{ fontSize: 13, background: "#b45309" }}
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
          style={{
            fontSize: 13,
            padding: "8px 14px",
            background: "transparent",
            border: "1px solid var(--border)",
            borderRadius: 6,
            color: "var(--muted)",
            cursor: pending ? "wait" : "pointer",
          }}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
