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

/**
 * How long before the next try, by how many have already failed.
 *
 * Nov 2026 — the team: "display kuch time ke baad band ho jaata hai. TV
 * bandh nahi hoti, sirf software offline jaata hai."
 *
 * This used to stop dead after four failures. Four tries at eight
 * seconds is THIRTY-TWO SECONDS of patience, and then the wall sat on
 * "Wall needs a look" until a human walked past and reloaded it —
 * which on a shop floor is the next morning. Anything longer than half
 * a minute killed it for the day: a deploy, a Vercel cold start, the
 * shed wifi dropping, a Supabase blip. We ship several deploys on a
 * busy afternoon, so we were very likely switching the wall off
 * ourselves and then being told it had gone off by itself.
 *
 * Backing off is the right instinct; stopping is not. A display with
 * nobody in front of it has one job — come back on its own — so it now
 * keeps trying for ever, just slowly enough that a genuinely broken
 * server is not being hammered every eight seconds: 8s, 15s, 30s, 60s,
 * then every two minutes until the end of time.
 *
 * The message still changes after a few goes, so anybody walking past
 * knows it needs looking at. It just no longer stops trying.
 */
const BACKOFF_SEC = [8, 15, 30, 60];
const LONG_WAIT_SEC = 120;
/** After this many consecutive failures the wording changes from
 *  "reconnecting" to "needs a look" — it keeps retrying either way. */
const SAY_SOMETHING_AFTER = 4;
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
  const fails = typeof window === "undefined" ? 1 : failureCount() + 1;
  const waitSec = BACKOFF_SEC[Math.min(fails - 1, BACKOFF_SEC.length - 1)] ?? LONG_WAIT_SEC;
  const wait = fails > BACKOFF_SEC.length ? LONG_WAIT_SEC : waitSec;

  const [left, setLeft] = useState(wait);
  const worrying = fails > SAY_SOMETHING_AFTER;

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

    noteFailure(fails);

    const t = setInterval(() => setLeft((x) => x - 1), 1000);
    const r = setTimeout(() => window.location.reload(), wait * 1000);

    // The network coming back is better news than any timer. A shed
    // wifi drop is the common case and it can outlast several tries;
    // without this the wall would sit out the whole two-minute wait
    // after the connection has already returned.
    const onBack = () => window.location.reload();
    window.addEventListener("online", onBack);

    return () => {
      clearInterval(t);
      clearTimeout(r);
      window.removeEventListener("online", onBack);
    };
  }, [error, fails, wait]);

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
        {worrying ? "Wall needs a look" : "Reconnecting…"}
      </div>
      <div style={{ fontSize: 22, color: "rgba(255,255,255,0.6)", fontWeight: 500, textAlign: "center", padding: "0 24px" }}>
        {worrying
          ? `It has tried ${fails} times and keeps failing — please tell the office. Still trying, next in ${Math.max(0, left)}s.`
          : `The wall lost its connection. Starting again in ${Math.max(0, left)}s.`}
      </div>
      <div style={{ width: 280, height: 6, borderRadius: 3, background: "rgba(255,255,255,0.12)", overflow: "hidden" }}>
        <div
          style={{
            height: "100%",
            background: worrying ? "#dc2626" : "#c9973a",
            width: `${(Math.max(0, left) / wait) * 100}%`,
            transition: "width 1s linear",
          }}
        />
      </div>
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
