"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

/**
 * Per-user heartbeat. Pings /api/heartbeat every 2 minutes (and
 * once on mount) so the server can:
 *   • track when each user was last seen → online indicator
 *   • track which page each user is on  → developer-only Live
 *     Users card on /settings
 *
 * Pathname is sourced from next/navigation so it stays in sync as
 * the user navigates within the app shell — every soft navigation
 * fires a fresh ping. We also re-ping on tab focus so a user
 * coming back from another window updates their "last seen"
 * promptly (otherwise it could be ~2 minutes stale).
 */
export function Heartbeat() {
  const pathname = usePathname();

  useEffect(() => {
    function ping() {
      const path = pathname || (typeof window !== "undefined" ? window.location.pathname : "");
      fetch("/api/heartbeat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path }),
      }).catch(() => {});
    }
    ping();
    const id = setInterval(ping, 2 * 60 * 1000);
    const onFocus = () => ping();
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(id);
      window.removeEventListener("focus", onFocus);
    };
  }, [pathname]);

  return null;
}
