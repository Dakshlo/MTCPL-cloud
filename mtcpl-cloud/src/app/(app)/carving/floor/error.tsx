"use client";

/**
 * Error boundary for the carving wall.
 *
 * Daksh, Sep 2026, with a photo of the TV: "when the TV stays on for
 * like 2-3 hours the error occurs — is it possible we can fix this so
 * it will not appear again."
 *
 * The generic (app) boundary is the wrong thing on a wall display. It
 * offers "Try again" and "Dashboard", and there is nobody standing in
 * front of the TV to press either — so the board sits dead on the wall
 * until somebody walks past hours later and notices. That is what the
 * photo showed.
 *
 * This one reloads the page by itself. A wall display has exactly one
 * sensible response to a transient failure, which is to start again, so
 * that is what it does: a short visible countdown (long enough that a
 * human looking at it understands what is happening, short enough that
 * the floor never really loses the board) and then a hard reload. Hard,
 * not reset(): the whole point is to throw away whatever state has
 * accumulated over hours, which reset() would carefully preserve.
 *
 * It also reports the failure, because the card in that photo said "no
 * error reference was produced" — the failure was client-side, Next
 * gives those no digest, and nothing was recorded anywhere. Without
 * this, the same thing happens again next week and we still cannot say
 * what it was.
 */

import { useEffect, useState } from "react";

const RELOAD_AFTER_SEC = 8;
/** Stop auto-reloading after this many failures in a row. A transient
 *  fault is cured by one reload; a real one would otherwise have the
 *  wall hard-reloading every 8 seconds for ever, hammering the server
 *  and burning the error into the screen. After the cap it sits still
 *  and waits for a person, which by then is the correct outcome. */
const MAX_CONSECUTIVE = 4;
const KEY = "mtcpl-floor-reloads";

function failureCount(): number {
  try { return Number(window.sessionStorage.getItem(KEY)) || 0; } catch { return 0; }
}
function noteFailure(n: number) {
  try { window.sessionStorage.setItem(KEY, String(n)); } catch { /* private mode */ }
}

export default function FloorErrorBoundary({
  error,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const [left, setLeft] = useState(RELOAD_AFTER_SEC);
  const [giveUp, setGiveUp] = useState(false);

  useEffect(() => {
    // Report first, reload second — the reload kills this page, so the
    // send has to be on its way before the timer runs out. keepalive
    // lets it survive the navigation.
    try {
      const payload = {
        where: "carving/floor",
        message: error?.message ?? "(no message)",
        digest: error?.digest ?? null,
        consecutive: failureCount() + 1,
        stack: (error?.stack ?? "").slice(0, 2000),
        href: typeof window !== "undefined" ? window.location.href : "",
        ua: typeof navigator !== "undefined" ? navigator.userAgent : "",
        at: new Date().toISOString(),
      };
      console.error("[floor-error]", payload);
      void fetch("/api/client-error", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        keepalive: true,
      }).catch(() => {});
    } catch {
      /* reporting must never be the reason the reload does not happen */
    }

    const n = failureCount() + 1;
    noteFailure(n);
    if (n > MAX_CONSECUTIVE) { setGiveUp(true); return; }

    const t = setInterval(() => setLeft((x) => x - 1), 1000);
    const r = setTimeout(() => window.location.reload(), RELOAD_AFTER_SEC * 1000);
    return () => { clearInterval(t); clearTimeout(r); };
  }, [error]);

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "#12100a",
        color: "#fff",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 18,
        zIndex: 9999,
        fontFamily: "system-ui, -apple-system, sans-serif",
      }}
    >
      <div style={{ fontSize: 46, fontWeight: 700, letterSpacing: "-1px" }}>
        {giveUp ? "Wall needs a look" : "Reconnecting…"}
      </div>
      <div style={{ fontSize: 22, color: "rgba(255,255,255,0.6)", fontWeight: 500, textAlign: "center", padding: "0 24px" }}>
        {giveUp
          ? "It has tried restarting several times and keeps failing. Please tell the office."
          : `The wall lost its connection. Starting again in ${Math.max(0, left)}s.`}
      </div>
      {!giveUp && (
        <div style={{ width: 280, height: 6, borderRadius: 3, background: "rgba(255,255,255,0.12)", overflow: "hidden" }}>
          <div
            style={{
              height: "100%",
              background: "#c9973a",
              width: `${(Math.max(0, left) / RELOAD_AFTER_SEC) * 100}%`,
              transition: "width 1s linear",
            }}
          />
        </div>
      )}
      <button
        type="button"
        onClick={() => window.location.reload()}
        style={{
          marginTop: 6,
          padding: "10px 22px",
          fontSize: 15,
          fontWeight: 700,
          borderRadius: 8,
          border: "1px solid rgba(255,255,255,0.25)",
          background: "rgba(255,255,255,0.1)",
          color: "#fff",
          cursor: "pointer",
        }}
      >
        Reload now
      </button>
    </div>
  );
}
