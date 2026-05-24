"use client";

/**
 * Migration 053 follow-on — context-aware back link for the bill
 * detail page.
 *
 * Daksh: "no matter which page I opened the bill from, the back
 * button only says one fixed page."
 *
 * Root cause: the earlier version read `document.referrer`, which
 * does NOT update on Next.js client-side Link navigation — only on
 * real document reloads. So after one Pay Today visit, every
 * subsequent bill-detail open showed "← Pay Today" forever.
 *
 * Fix: read sessionStorage key written by <RouteTracker /> in the
 * app layout. RouteTracker subscribes to usePathname +
 * useSearchParams and updates the entry on every SPA navigation,
 * so the "previous route" is always the actual immediately-prior
 * page, with its full query string intact.
 *
 * Daksh May 2026 — also use router.back() when history is back-able,
 * so the destination page's scroll position is restored (Next.js
 * App Router does this automatically for browser-back navigation).
 * Previously the back link was a plain <Link href> push, which
 * scrolls the target page to the top — that meant after going into
 * a bill from deep in the Due Bills list, the user landed back at
 * the top and had to scroll all the way down again.
 *
 * Falls back to:
 *   1. document.referrer (for hard refreshes / external entry)
 *   2. /accounts/bills "All bills" — safe default
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

const PREV_ROUTE_KEY = "mtcpl-prev-route";

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
  const router = useRouter();
  const [href, setHref] = useState(fallbackHref);
  const [label, setLabel] = useState(fallbackLabel);
  // Daksh May 2026 — when set, the click handler calls router.back()
  // instead of pushing href. router.back() restores the destination
  // page's scroll position automatically (App Router behaviour),
  // which is what dad asked for ("take me back to where I was in
  // the list, not the top"). We only flip this on when we're
  // confident there IS a back entry that matches our prevRoute —
  // otherwise router.back() could navigate off the app.
  const [useBack, setUseBack] = useState(false);

  useEffect(() => {
    // 1. Try sessionStorage (written by RouteTracker on every SPA
    //    navigation). This is the reliable path for in-app clicks.
    let prevRoute: string | null = null;
    try {
      prevRoute = sessionStorage.getItem(PREV_ROUTE_KEY);
    } catch {
      // sessionStorage unavailable
    }

    // 2. Fallback to document.referrer for hard-refresh / external
    //    entry points. Only honour same-origin.
    if (!prevRoute && typeof document !== "undefined" && document.referrer) {
      try {
        const url = new URL(document.referrer);
        if (url.origin === window.location.origin) {
          prevRoute = url.pathname + url.search;
        }
      } catch {
        // Bad URL — skip
      }
    }

    if (!prevRoute) return;

    // Parse the route into pathname + search for the match below.
    let urlPath: string;
    let urlSearch: string;
    try {
      const u = new URL(prevRoute, window.location.origin);
      urlPath = u.pathname;
      urlSearch = u.search;
    } catch {
      return;
    }

    // Don't allow back-link to point at another bill detail page —
    // going from one bill to its sibling and tapping back to ANOTHER
    // sibling is confusing.
    if (/^\/accounts\/bills\/[^/]+\/?$/.test(urlPath)) return;

    const match = KNOWN_FINANCE_PAGES.find((p) => p.pathRegex.test(urlPath));
    if (match) {
      setLabel(match.label);
      // Preserve query string so the user lands on the EXACT page
      // they left — filters / sort / pagination intact.
      setHref(urlPath + urlSearch);
      // History-aware back: if the browser thinks there's a back
      // entry, route via router.back() so the destination's scroll
      // position is restored. window.history.length is at least 1
      // (the current entry); >1 means there's at least one entry
      // to go back to. Combined with the prevRoute match above,
      // we're very likely in an SPA-back situation.
      if (typeof window !== "undefined" && window.history.length > 1) {
        setUseBack(true);
      }
    }
  }, []);

  const baseStyle: React.CSSProperties = {
    color: "var(--muted)",
    textDecoration: "none",
    fontSize: 13,
    fontWeight: 600,
  };

  if (useBack) {
    // Render as a button — calling router.back() triggers App
    // Router's automatic scroll-restoration. Falls back to
    // router.push if history is somehow already at the start.
    return (
      <button
        type="button"
        onClick={() => {
          try {
            router.back();
          } catch {
            router.push(href);
          }
        }}
        style={{
          ...baseStyle,
          background: "transparent",
          border: "none",
          padding: 0,
          cursor: "pointer",
          font: "inherit",
        }}
      >
        ← {label}
      </button>
    );
  }

  return (
    <Link href={href} style={baseStyle}>
      ← {label}
    </Link>
  );
}
