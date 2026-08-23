import type React from "react";

/**
 * Invoicing department shell (Daksh, Aug 2026).
 *
 * Renders NO box of its own — `display: contents` means the pages below stay
 * exactly where they were in the page-content flex column, same gaps, same
 * order, nothing moves.
 *
 * Its only job is to put ONE class in the DOM above every invoicing page:
 * `.page-content:has(> .page-fluid)` drops the 1720px cap, so challans,
 * invoices, other sales and approval all use the whole window on a wide
 * monitor instead of leaving a dead strip down both sides. Doing it here
 * rather than on each page means the department can grow pages without
 * anyone remembering to opt them in.
 *
 * Same trick the finance shell uses (accounts/layout.tsx), minus its table
 * styling — `page-fluid` is the neutral width-only hook.
 *
 * Keep it free of data fetching: role checks live on each page.
 */
export default function InvoicingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="page-fluid" style={{ display: "contents" }}>
      {children}
    </div>
  );
}
