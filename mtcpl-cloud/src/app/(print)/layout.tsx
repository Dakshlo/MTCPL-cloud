import type { ReactNode } from "react";

/**
 * Minimal layout for print pages — no sidebar, no topbar, no app chrome.
 * Auth is checked inside each print page directly.
 */
export default function PrintLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
