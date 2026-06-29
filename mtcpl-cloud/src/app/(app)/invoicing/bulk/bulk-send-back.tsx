"use client";

// Send a bulk challan back to the Challans page, with a confirm (Daksh).
import { sendChallanBackFromBulkAction } from "../actions";

export function BulkSendBack({ id }: { id: string }) {
  return (
    <form
      action={sendChallanBackFromBulkAction}
      onSubmit={(e) => { if (!confirm("Send this challan back to the Challans page?")) e.preventDefault(); }}
      style={{ display: "inline" }}
    >
      <input type="hidden" name="id" value={id} />
      <button
        type="submit"
        style={{ fontSize: 12, fontWeight: 700, padding: "8px 12px", border: "1px solid var(--border)", borderRadius: 8, background: "var(--bg)", color: "var(--text)", cursor: "pointer" }}
      >
        ↩ Send back
      </button>
    </form>
  );
}
