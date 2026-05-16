"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FinanceLoadingOverlay } from "@/components/finance-loading-overlay";
import { BUTTON_STYLES } from "../../../accounts/_ui/components";

type ActionResult = { ok: true } | { ok: false; error: string };

export function CancelChallanButton({
  challanId,
  cancelAction,
}: {
  challanId: string;
  cancelAction: (formData: FormData) => Promise<ActionResult>;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handle() {
    const reason = window.prompt(
      "Cancel this challan? Optional reason:",
      "",
    );
    // Cancel button → null prompt = abort. Empty string is still
    // a valid (no-reason) cancel.
    if (reason === null) return;
    startTransition(async () => {
      setError(null);
      const fd = new FormData();
      fd.set("id", challanId);
      fd.set("reason", reason.trim());
      const r = await cancelAction(fd);
      if (!r.ok) {
        setError(r.error);
        alert(r.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <>
      <FinanceLoadingOverlay show={pending} label="Cancelling challan…" />
      <button
        type="button"
        onClick={handle}
        disabled={pending}
        style={BUTTON_STYLES.danger}
      >
        Cancel challan
      </button>
      {error && (
        <span style={{ marginLeft: 8, fontSize: 12, color: "#b91c1c" }}>{error}</span>
      )}
    </>
  );
}
