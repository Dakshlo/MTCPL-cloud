"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

/**
 * Per-user heartbeat. Pings /api/heartbeat so the server can:
 *   • track when each user was last seen → online indicator
 *   • track which page each user is on  → developer-only Live
 *     Users card on /settings
 *
 * THROTTLED (Daksh, Sep 2026 — "any action on a page seems slow").
 * It used to ping on EVERY navigation, and each ping is a serverless
 * invocation plus two writes (profiles.last_seen_at / last_path and a
 * heartbeat_log row) that the user is waiting behind. heartbeat_log
 * had reached 151,136 rows by 10 Sep.
 *
 * The "when did we last ping" mark lives in sessionStorage, and that
 * detail is the whole fix. Two cheaper places were tried and measured
 * failing first:
 *   • a useRef — this component REMOUNTS on navigation, so the ref
 *     reset every time and it pinged anyway (which is how the
 *     ping-per-navigation behaviour existed in the first place);
 *   • a module-level variable — better, but route chunks can hold
 *     their own copy of the module, so the mark was not shared and
 *     roughly half the navigations still pinged (measured: 3 pings
 *     across 6 navigations).
 * sessionStorage is per tab and survives both, so the limit actually
 * holds. It is wrapped in try/catch because storage throws outright
 * in some privacy modes; if it is unavailable we simply ping as
 * before rather than break the online indicator.
 *
 * Worst case the Live Users card is half a minute stale about which
 * page someone is on, well inside what it is used for.
 */

const MIN_GAP_MS = 30_000;
const INTERVAL_MS = 2 * 60 * 1000;
const KEY = "mtcpl-hb-at";

function lastPingAt(): number {
  try {
    return Number(window.sessionStorage.getItem(KEY)) || 0;
  } catch {
    return 0; // storage blocked — fall back to always pinging
  }
}

function markPinged() {
  try {
    window.sessionStorage.setItem(KEY, String(Date.now()));
  } catch {
    /* ignore */
  }
}

function sendPing(path: string) {
  markPinged();
  fetch("/api/heartbeat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path }),
  }).catch(() => {});
}

const here = (fallback: string) =>
  typeof window !== "undefined" ? window.location.pathname : fallback;

export function Heartbeat() {
  const pathname = usePathname();

  useEffect(() => {
    const since = Date.now() - lastPingAt();
    if (since >= MIN_GAP_MS) sendPing(pathname || here(""));

    // The timer and the focus ping keep "last seen" and the current
    // path fresh without needing a navigation.
    const id = setInterval(() => {
      if (Date.now() - lastPingAt() >= MIN_GAP_MS) sendPing(here(pathname));
    }, INTERVAL_MS);
    const onFocus = () => {
      if (Date.now() - lastPingAt() >= MIN_GAP_MS) sendPing(here(pathname));
    };
    window.addEventListener("focus", onFocus);

    return () => {
      clearInterval(id);
      window.removeEventListener("focus", onFocus);
    };
  }, [pathname]);

  return null;
}
