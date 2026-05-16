"use client";

/**
 * Migration 053 follow-on — branded approve button for the bill
 * detail page.
 *
 * Wraps the existing `<form action={approveBillFormAction}>` with a
 * client-side `useFormStatus()` so we can render the
 * FinanceLoadingOverlay while the server action is in flight. Same
 * approve action, same button, same auditor flow — just adds the
 * spinning-logo overlay so the click feels like the rest of the
 * finance department.
 */

import { useFormStatus } from "react-dom";
import { FinanceLoadingOverlay } from "@/components/finance-loading-overlay";
import { BUTTON_STYLES } from "../../_ui/components";

export function ApproveBillButton({
  billId,
  action,
}: {
  billId: string;
  /** Server action that approves the bill. Must match the form-
   *  action signature React expects: returns Promise<void> or void.
   *  The real approveBillFormAction redirects after success, so its
   *  effective return type is void. */
  action: (formData: FormData) => Promise<void> | void;
}) {
  return (
    <form action={action} style={{ display: "inline" }}>
      <input type="hidden" name="bill_id" value={billId} />
      <ApproveSubmitInner />
    </form>
  );
}

function ApproveSubmitInner() {
  const { pending } = useFormStatus();
  return (
    <>
      <FinanceLoadingOverlay show={pending} label="Approving bill…" />
      <button type="submit" disabled={pending} style={BUTTON_STYLES.primary}>
        {pending ? "Approving…" : "✓ Approve bill"}
      </button>
    </>
  );
}
