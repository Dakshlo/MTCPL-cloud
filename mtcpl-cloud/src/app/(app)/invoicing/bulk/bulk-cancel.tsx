"use client";

// Dismiss a rejected bulk invoice. Its challans already returned to the pool on
// reject; this just clears the rejected record from view (Daksh).
import { cancelBulkInvoiceAction } from "../actions";

export function BulkCancel({ id }: { id: string }) {
  return (
    <form
      action={cancelBulkInvoiceAction}
      onSubmit={(e) => { if (!confirm("Dismiss this rejected bulk invoice? Its challans are already back in the pool.")) e.preventDefault(); }}
      style={{ display: "inline" }}
    >
      <input type="hidden" name="id" value={id} />
      <button
        type="submit"
        style={{ fontSize: 12, fontWeight: 700, padding: "8px 12px", border: "1.5px solid rgba(220,38,38,0.4)", borderRadius: 8, background: "var(--bg)", color: "#b91c1c", cursor: "pointer" }}
      >
        ✕ Dismiss
      </button>
    </form>
  );
}
