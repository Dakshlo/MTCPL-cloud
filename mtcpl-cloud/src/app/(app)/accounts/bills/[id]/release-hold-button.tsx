"use client";

/**
 * Mig 082 follow-on (Daksh, June 2026) — release-hold action with
 * explicit confirmation. The hold panel's "🔓 Release hold" button
 * used to be a server-side `<form action={…}>` that fired the
 * release immediately on click. Daksh wanted a confirm step (same
 * spirit as the apply / adjust confirm in hold-bill-form.tsx) so
 * an accidental owner click can't silently unfreeze a held slice
 * — those holds typically guard real disputes.
 *
 * Client-side `<form onSubmit>` pattern: the form still submits to
 * releaseBillHoldFormAction, but we intercept and ask the user to
 * confirm with the held amount + reason summary first. Cancel
 * aborts the submit; OK lets it through.
 */

import { releaseBillHoldFormAction } from "../../actions";
import { BUTTON_STYLES } from "../../_ui/components";

export function ReleaseHoldButton({
  billId,
  heldAmount,
  reason,
}: {
  billId: string;
  /** Held amount being released — surfaced in the confirm prompt. */
  heldAmount: number;
  /** Existing hold reason — surfaced in the confirm prompt. */
  reason: string | null;
}) {
  return (
    <form
      action={releaseBillHoldFormAction}
      onSubmit={(e) => {
        const msg = [
          "RELEASE HOLD on this bill?",
          "",
          `Releasing: ₹${heldAmount.toLocaleString("en-IN")}`,
          reason ? `Original reason: ${reason}` : "",
          "",
          "The full outstanding becomes proposable in Pay Today again.",
          "Bill total + audit are unchanged — only the proposable",
          "amount goes back up.",
        ]
          .filter((s) => s !== "")
          .join("\n");
        if (!window.confirm(msg)) {
          e.preventDefault();
        }
      }}
    >
      <input type="hidden" name="bill_id" value={billId} />
      <button
        type="submit"
        style={{
          ...BUTTON_STYLES.ghost,
          color: "#15803d",
          borderColor: "#15803d",
        }}
        title="Release the hold — full outstanding becomes proposable again"
      >
        🔓 Release hold
      </button>
    </form>
  );
}
