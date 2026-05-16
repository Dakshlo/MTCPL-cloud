"use client";

/**
 * Migration 053 follow-on — context-aware back link for the bill
 * detail page.
 *
 * Daksh: "in finance when I open a bill card, the back button is
 * always 'All bills'. If I came from Due Bills, it should go back
 * to Due Bills."
 *
 * Approach: read document.referrer on mount, match it against the
 * known finance routes, and render the appropriate label + href.
 * Falls back to "All bills" when:
 *   - Referrer is empty (direct URL visit, opened in new tab, etc.)
 *   - Referrer is from a different origin (e.g. Gmail link)
 *   - Referrer doesn't match any known finance route
 *
 * The href reuses the FULL referrer URL (pathname + search) so the
 * user lands back on the exact page they left, with all their
 * filters / sort / pagination state intact.
 */

import Link from "next/link";
import { useEffect, useState } from "react";

type KnownPage = {
  /** Tested against url.pathname. Order matters — first match wins,
   *  so more specific paths must come before less specific ones. */
  pathRegex: RegExp;
  /** Label shown in the back link (after the arrow). */
  label: string;
};

const KNOWN_FINANCE_PAGES: KnownPage[] = [
  // Specific finance pages first
  { pathRegex: /^\/accounts\/pay-today/, label: "Pay Today" },
  { pathRegex: /^\/accounts\/approvals/, label: "Crosscheck Queue" },
  { pathRegex: /^\/accounts\/final-audit/, label: "Final Audit" },
  { pathRegex: /^\/accounts\/payments/, label: "Payment History" },
  { pathRegex: /^\/accounts\/vendors\/[^/]+/, label: "Vendor profile" },
  { pathRegex: /^\/accounts\/vendors/, label: "Vendor Account" },
  { pathRegex: /^\/accounts\/bills\/new/, label: "New bill" },
  { pathRegex: /^\/accounts\/bills/, label: "All bills" },
  // Catch-all for the Due Bills landing (just /accounts).
  { pathRegex: /^\/accounts\/?$/, label: "Due Bills" },
];

export function BillBackLink({
  fallbackHref = "/accounts/bills",
  fallbackLabel = "All bills",
}: {
  fallbackHref?: string;
  fallbackLabel?: string;
}) {
  const [href, setHref] = useState(fallbackHref);
  const [label, setLabel] = useState(fallbackLabel);

  useEffect(() => {
    const referrer = document.referrer;
    if (!referrer) return;
    try {
      const url = new URL(referrer);
      // Only honour same-origin referrers — external clicks (Gmail,
      // WhatsApp, etc.) shouldn't shape our in-app back nav.
      if (url.origin !== window.location.origin) return;
      // Skip if the referrer was the bill detail page itself
      // (e.g. user navigated bill → bill via the topbar lookup).
      // Sending them "back" to a sibling bill detail is confusing.
      if (/^\/accounts\/bills\/[^/]+\/?$/.test(url.pathname)) return;

      const match = KNOWN_FINANCE_PAGES.find((p) => p.pathRegex.test(url.pathname));
      if (match) {
        setLabel(match.label);
        // Preserve query string so the user lands on the EXACT page
        // they left — including any filters / vendor / date range.
        setHref(url.pathname + url.search);
      }
    } catch {
      // Bad URL — keep the fallback.
    }
  }, []);

  return (
    <Link
      href={href}
      style={{
        color: "var(--muted)",
        textDecoration: "none",
        fontSize: 13,
        fontWeight: 600,
      }}
    >
      ← {label}
    </Link>
  );
}
