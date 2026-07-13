"use client";

import { useFormStatus } from "react-dom";

export function SubmitButton({ label, loadingLabel, className }: { label: string; loadingLabel?: string; className?: string }) {
  const { pending } = useFormStatus();
  return (
    <button className={className ?? "primary-button"} disabled={pending} type="submit">
      {pending ? (loadingLabel ?? "Saving...") : label}
    </button>
  );
}
