"use client";

// ──────────────────────────────────────────────────────────────────
// LoginLocationProbe — one-shot location capture per browser session
// ──────────────────────────────────────────────────────────────────
// Mounted on the app shell layout, alongside the Heartbeat. Runs
// EXACTLY ONCE per browser session (sessionStorage flag), totally
// in the background, never blocks anything.
//
// What it does:
//   1. POST to /api/login-location WITHOUT a GPS payload. The route
//      captures IP + Vercel-provided city/country regardless. This
//      ensures we get *something* for every login, even if the user
//      denies GPS.
//   2. Then try navigator.geolocation.getCurrentPosition() with a
//      short timeout. On success, POST again with the GPS lat/lng/
//      accuracy. On denial or failure, POST with the status flag
//      ('denied' / 'unavailable' / 'timeout').
//
// Why two posts? So IP-geo is captured even before the user
// approves/denies the browser prompt — and the second post
// upgrades the row with GPS if granted. Both are fire-and-forget.
//
// Privacy: the browser shows its standard geolocation permission
// prompt the first time. The user has full control to deny — we
// just record the denial state.
//
// To re-trigger after a deploy / DB wipe, clear sessionStorage
// or open a new tab.

import { useEffect } from "react";

const SESSION_KEY = "mtcpl_loc_probed_v1";

type GpsStatus = "granted" | "denied" | "unavailable" | "timeout" | "unknown";

function postLocation(payload: {
  status: GpsStatus;
  lat?: number;
  lng?: number;
  accuracy?: number;
}) {
  // No-await fetch with .catch — silently ignore network errors.
  fetch("/api/login-location", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }).catch(() => {});
}

export function LoginLocationProbe() {
  useEffect(() => {
    // Guard: only fire once per browser session.
    try {
      if (typeof window === "undefined") return;
      if (sessionStorage.getItem(SESSION_KEY) === "1") return;
      sessionStorage.setItem(SESSION_KEY, "1");
    } catch {
      // sessionStorage may be blocked (private mode in some browsers).
      // Falling through is fine — we'll just probe every page load
      // for those users. Still cheap.
    }

    // ── First post: IP-only, regardless of GPS outcome ───────────
    postLocation({ status: "unknown" });

    // ── Second post: try GPS ─────────────────────────────────────
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      postLocation({ status: "unavailable" });
      return;
    }

    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        postLocation({ status: "timeout" });
      }
    }, 8000);

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        postLocation({
          status: "granted",
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
        });
      },
      (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        // err.code 1 = PERMISSION_DENIED, 2 = POSITION_UNAVAILABLE,
        // 3 = TIMEOUT. Map to our flag set.
        let status: GpsStatus = "unavailable";
        if (err.code === 1) status = "denied";
        else if (err.code === 3) status = "timeout";
        postLocation({ status });
      },
      {
        enableHighAccuracy: false, // city-block accuracy is enough
        timeout: 7000,
        maximumAge: 5 * 60 * 1000, // re-use a 5-min-old fix if available
      },
    );

    return () => {
      clearTimeout(timer);
    };
  }, []);

  return null;
}
