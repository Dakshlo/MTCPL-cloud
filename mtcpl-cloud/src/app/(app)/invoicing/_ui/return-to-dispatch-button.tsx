"use client";

/**
 * Mig 167 — Accountant "Cancel → return to dispatch" for a REJECTED challan.
 *
 * The owner bounced the priced challan back. The accountant can either re-price
 * it (a plain link elsewhere) or cancel it here WITH A REASON — which deletes
 * the challan and sends its dispatch back to Waiting approval (flagged Returned).
 *
 * Calls returnDispatchToWaitingAction (NOT redirect-style → returns {ok,error}),
 * so this client component prompts for the required reason, surfaces errors, and
 * refreshes on success.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FinanceLoadingOverlay } from "@/components/finance-loading-overlay";
import { BUTTON_STYLES } from "../../accounts/_ui/components";

type ActionResult = { ok: true } | { ok: false; error: string };

export function ReturnToDispatchButton({
  challanId,
  action,
  label = "Cancel (return to dispatch)",
}: {
  challanId: string;
  action: (formData: FormData) => Promise<ActionResult>;
  label?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handle() {
    const reason = window.prompt(
      "Cancel this rejected challan and send the dispatch back to Waiting approval?\n\nA reason is required:",
      "",
    );
    if (reason === null) return; // cancelled the prompt
    const trimmed = reason.trim();
    if (!trimmed) {
      const msg = "A cancellation reason is required.";
      setError(msg);
      alert(msg);
      return;
    }
    startTransition(async () => {
      setError(null);
      const fd = new FormData();
      fd.set("challan_id", challanId);
      fd.set("reason", trimmed);
      const r = await action(fd);
      if (!r.ok) {
        setError(r.error);
        alert(r.error);
        return;
      }
      // The challan row is gone — bounce to the challans list with a toast.
      router.push(
        `/invoicing/challans?toast=${encodeURIComponent("Returned to dispatch — back in Waiting approval")}`,
      );
      router.refresh();
    });
  }

  return (
    <>
      <FinanceLoadingOverlay show={pending} label="Returning to dispatch…" />
      <button
        type="button"
        onClick={handle}
        disabled={pending}
        style={BUTTON_STYLES.danger}
      >
        {label}
      </button>
      {error && (
        <span style={{ marginLeft: 8, fontSize: 12, color: "#b91c1c" }}>{error}</span>
      )}
    </>
  );
}
