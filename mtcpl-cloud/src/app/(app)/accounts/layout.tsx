import type React from "react";

/**
 * Finance department shell (Daksh, Aug 2026).
 *
 * This renders NO box of its own — `.acct-fluid` is `display: contents`
 * in globals.css, so the pages below stay exactly where they were in
 * the page-content flex column (same gaps, same order, nothing moves).
 *
 * Its only job is to put ONE class in the DOM above every Accounts
 * page, which gives us two things we otherwise couldn't have without
 * editing all ~60 finance files:
 *
 *   1. Full-width stretch — `.page-content:has(> .acct-fluid)` drops
 *      the 1720px cap, so finance uses the whole window on a wide
 *      monitor (Daksh: "make it stretch with widening of window").
 *   2. A styling hook for every finance table (zebra rows, row hover)
 *      — inline style objects can't express :hover or :nth-child.
 *
 * Keep it free of data fetching: role checks live on each page.
 */
export default function AccountsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <div className="acct-fluid">{children}</div>;
}
