"use client";

/**
 * Mig 167 — OWNER "Reject" control on the Approval queue.
 *
 * ownerRejectChallanAction is redirect-style (it navigates away on success), so
 * a plain <form action={...}> works. We wrap it in a small client component only
 * to add an inline reason input + a confirm, keeping the queue uncluttered: the
 * reason field reveals on first click, the second click submits.
 */

import { useRef, useState } from "react";
import { BUTTON_STYLES } from "../../accounts/_ui/components";

export function OwnerRejectButton({
  challanId,
  action,
}: {
  challanId: string;
  action: (formData: FormData) => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        style={BUTTON_STYLES.danger}
      >
        ✕ Reject
      </button>
    );
  }

  return (
    <form
      ref={formRef}
      action={action}
      style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}
    >
      <input type="hidden" name="challan_id" value={challanId} />
      <input
        name="reason"
        placeholder="Reason (optional)"
        autoFocus
        style={{
          fontSize: 12,
          padding: "6px 8px",
          border: "1px solid var(--border, #cbd5e1)",
          borderRadius: 6,
          minWidth: 160,
        }}
      />
      <button type="submit" style={BUTTON_STYLES.danger}>
        ✕ Confirm reject
      </button>
      <button
        type="button"
        onClick={() => setOpen(false)}
        style={{ ...BUTTON_STYLES.ghost, fontSize: 12 }}
      >
        Cancel
      </button>
    </form>
  );
}
