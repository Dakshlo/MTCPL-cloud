"use client";

/**
 * Soft-refresh the ledger periodically (Daksh). New entries + approvals made in
 * OTHER open sessions (manager ↔ owner) now show up without a manual reload:
 * the manager adds an entry → the owner's open ledger picks it up → the owner
 * approves → the manager's open ledger picks THAT up. router.refresh() re-fetches
 * only the server data, so a half-typed form / open modal is preserved. Pauses
 * while the tab is hidden.
 */

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export function LedgerAutoRefresh({ intervalMs = 5000 }: { intervalMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    const id = setInterval(() => {
      if (typeof document === "undefined" || document.visibilityState === "visible") {
        router.refresh();
      }
    }, intervalMs);
    return () => clearInterval(id);
  }, [router, intervalMs]);
  return null;
}
