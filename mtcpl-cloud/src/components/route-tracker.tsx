"use client";

/**
 * Migration 053 follow-on — SPA route tracker.
 *
 * Daksh: the bill detail page's "← back" link was sticking on the
 * first page you ever visited. Root cause: document.referrer is
 * only updated on real document loads, NOT on Next.js client-side
 * Link navigations. So if you opened Pay Today first and then
 * navigated to All Bills → bill detail via clicks, the back link
 * still read "← Pay Today" because that was the last real page
 * load.
 *
 * This component subscribes to Next.js's usePathname +
 * useSearchParams hooks and persists every navigation into
 * sessionStorage as "current" and "previous". The bill detail
 * page's BillBackLink reads the "previous" entry to render the
 * correct label + href.
 *
 * Mounted once in the (app) layout so it observes every route the
 * authenticated user visits. No-op outside the browser; degrades
 * silently if sessionStorage is unavailable (Safari private mode).
 */

import { useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";

const PREV_ROUTE_KEY = "mtcpl-prev-route";
const CURRENT_ROUTE_KEY = "mtcpl-current-route";

/** A bill detail page is never a useful "previous" destination —
 *  going from one bill to its sibling and tapping back to a different
 *  sibling is disorienting. Excluded from being recorded as previous. */
const EXCLUDE_AS_PREV = /^\/accounts\/bills\/[^/]+\/?$/;

export function RouteTracker() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const search = searchParams.toString();
      const current = pathname + (search ? `?${search}` : "");
      const previousCurrent = sessionStorage.getItem(CURRENT_ROUTE_KEY);
      if (previousCurrent && previousCurrent !== current) {
        // Parse out the pathname to check the exclusion rule.
        let prevPathname = previousCurrent;
        const qIdx = previousCurrent.indexOf("?");
        if (qIdx >= 0) prevPathname = previousCurrent.slice(0, qIdx);
        if (!EXCLUDE_AS_PREV.test(prevPathname)) {
          sessionStorage.setItem(PREV_ROUTE_KEY, previousCurrent);
        }
      }
      sessionStorage.setItem(CURRENT_ROUTE_KEY, current);
    } catch {
      // sessionStorage unavailable (Safari private mode etc.) —
      // back link will fall through to its default fallback.
    }
  }, [pathname, searchParams]);

  return null;
}
