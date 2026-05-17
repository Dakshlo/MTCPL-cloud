"use client";

/**
 * Cancel-bill confirmation wrapper.
 *
 * Daksh (Mig 058 follow-on): "I accidentally deleted the wrong
 * bill. It didn't ask for confirmation to delete." Right —
 * the original was a bare form submit. This wraps the same
 * server action with a window.confirm() check + a small
 * loading overlay so a single misclick can't cancel a real
 * bill.
 */

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { FinanceLoadingOverlay } from "@/components/finance-loading-overlay";
import { BUTTON_STYLES } from "../../_ui/components";

type ActionResult = { ok: true } | { ok: false; error: string };

export function CancelBillButton({
  billId,
  billToken,
  cancelAction,
}: {
  billId: string;
  billToken: string;
  cancelAction: (formData: FormData) => Promise<ActionResult>;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function handleClick() {
    // Two-step confirmation. First an "are you sure?" with the
    // token shown so the user can spot if they're on the wrong
    // bill. Then a typed confirmation for the final commit —
    // they have to type CANCEL (in caps) to proceed. That's
    // friction by design — this surface deletes real billing
    // data.
    const ok = window.confirm(
      `Cancel bill ${billToken}?\n\n` +
        `This moves it to status: cancelled. The bill stays in the system\n` +
        `for the audit trail, but it disappears from the active lists.\n\n` +
        `Use this ONLY if you need to recreate the bill with a different\n` +
        `date or vendor invoice number. Click OK to continue.`,
    );
    if (!ok) return;

    const typed = window.prompt(
      `Final confirmation — type CANCEL (in caps) to confirm cancelling ${billToken}:`,
      "",
    );
    if (typed !== "CANCEL") {
      if (typed !== null) {
        window.alert("Cancellation aborted — you didn't type CANCEL exactly.");
      }
      return;
    }

    startTransition(async () => {
      const fd = new FormData();
      fd.set("bill_id", billId);
      const r = await cancelAction(fd);
      if (!r.ok) {
        window.alert(`Couldn't cancel: ${r.error}`);
        return;
      }
      router.refresh();
    });
  }

  return (
    <>
      <FinanceLoadingOverlay show={pending} label="Cancelling bill…" />
      <button
        type="button"
        onClick={handleClick}
        disabled={pending}
        style={{ ...BUTTON_STYLES.ghost, width: "100%" }}
      >
        Cancel this bill
      </button>
    </>
  );
}
