"use client";

// Cancel a rejected bulk invoice → its challans return to the bulk pool (Daksh).
import { cancelBulkInvoiceAction } from "../actions";

export function BulkCancel({ id }: { id: string }) {
  return (
    <form
      action={cancelBulkInvoiceAction}
      onSubmit={(e) => { if (!confirm("Cancel this bulk invoice? Its challans return to the pool so you can re-bill them.")) e.preventDefault(); }}
      style={{ display: "inline" }}
    >
      <input type="hidden" name="id" value={id} />
      <button
        type="submit"
        style={{ fontSize: 12, fontWeight: 700, padding: "8px 12px", border: "1.5px solid rgba(220,38,38,0.4)", borderRadius: 8, background: "var(--bg)", color: "#b91c1c", cursor: "pointer" }}
      >
        ✕ Cancel invoice
      </button>
    </form>
  );
}
