"use client";

// Branded "something is working" overlay for server-action <form>s. Drop it as a
// child of any <form action={serverAction}> and it shows the spinning MTCPL logo
// while that form is submitting (useFormStatus reads the parent form's state).
// Reuses the FinanceLoadingOverlay visual so the spinner is consistent app-wide.

import { useFormStatus } from "react-dom";
import { FinanceLoadingOverlay } from "@/components/finance-loading-overlay";

export function FormPendingOverlay({ label }: { label?: string }) {
  const { pending } = useFormStatus();
  return <FinanceLoadingOverlay show={pending} label={label} />;
}
