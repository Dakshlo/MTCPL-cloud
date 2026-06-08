"use client";

// ──────────────────────────────────────────────────────────────────
// Idle auto-logout (Daksh, June 2026)
//
// For accounts-desk users (handling money), sign out automatically
// after 10 minutes of NO activity. Any interaction — mouse, keyboard,
// scroll, touch — resets the timer, so someone actively using the
// system is never logged out; only a left-unattended session is.
//
// A 60-second warning appears first ("Stay signed in") so an accounts
// person mid-entry can keep their session (and unsaved work) alive.
//
// Cross-tab aware: activity in any tab resets all tabs (via a shared
// localStorage timestamp), and a logout in one tab logs out the rest.
//
// Mounted (enabled) only for the accounts roles — see (app)/layout.tsx.
// Renders nothing until the warning fires, so it's effectively free
// otherwise (just listeners + a 1s timer).
// ──────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useRef, useState } from "react";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";

const IDLE_MS = 10 * 60 * 1000; // 10 minutes of inactivity → logout
const WARN_BEFORE_MS = 60 * 1000; // show the warning 60s before
const ACTIVITY_KEY = "mtcpl:lastActivity";
const LOGOUT_KEY = "mtcpl:idleLogout";

export function IdleLogout({ enabled }: { enabled: boolean }) {
  const [warnLeft, setWarnLeft] = useState<number | null>(null); // secs left, or null = hidden
  const warnLeftRef = useRef<number | null>(null);
  const lastActivity = useRef(Date.now());
  const lastBroadcast = useRef(0);
  const loggedOut = useRef(false);

  useEffect(() => {
    warnLeftRef.current = warnLeft;
  }, [warnLeft]);

  const doLogout = useCallback(() => {
    if (loggedOut.current) return;
    loggedOut.current = true;
    try {
      localStorage.setItem(LOGOUT_KEY, String(Date.now())); // tell other tabs
    } catch {
      /* ignore */
    }
    const go = () => {
      window.location.href = "/login?reason=idle";
    };
    try {
      const supabase = createBrowserSupabaseClient();
      void supabase.auth.signOut().catch(() => {}).finally(go);
    } catch {
      go();
    }
    // Safety net if signOut hangs — navigate anyway.
    setTimeout(go, 1500);
  }, []);

  const stayActive = useCallback(() => {
    const now = Date.now();
    lastActivity.current = now;
    setWarnLeft(null);
    try {
      localStorage.setItem(ACTIVITY_KEY, String(now));
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;

    const onActivity = () => {
      const now = Date.now();
      lastActivity.current = now;
      if (warnLeftRef.current !== null) setWarnLeft(null);
      // Throttle cross-tab writes so we don't hammer localStorage on
      // every mousemove.
      if (now - lastBroadcast.current > 4000) {
        lastBroadcast.current = now;
        try {
          localStorage.setItem(ACTIVITY_KEY, String(now));
        } catch {
          /* ignore */
        }
      }
    };

    const events = ["mousemove", "mousedown", "keydown", "scroll", "touchstart", "click", "wheel"] as const;
    for (const ev of events) window.addEventListener(ev, onActivity, { passive: true });

    const onStorage = (e: StorageEvent) => {
      if (e.key === ACTIVITY_KEY && e.newValue) {
        const t = Number(e.newValue);
        if (t > lastActivity.current) {
          lastActivity.current = t;
          if (warnLeftRef.current !== null) setWarnLeft(null);
        }
      } else if (e.key === LOGOUT_KEY) {
        if (!loggedOut.current) {
          loggedOut.current = true;
          window.location.href = "/login?reason=idle";
        }
      }
    };
    window.addEventListener("storage", onStorage);

    const tick = setInterval(() => {
      if (loggedOut.current) return;
      const elapsed = Date.now() - lastActivity.current;
      if (elapsed >= IDLE_MS) {
        doLogout();
      } else if (elapsed >= IDLE_MS - WARN_BEFORE_MS) {
        setWarnLeft(Math.max(1, Math.ceil((IDLE_MS - elapsed) / 1000)));
      } else if (warnLeftRef.current !== null) {
        setWarnLeft(null);
      }
    }, 1000);

    return () => {
      for (const ev of events) window.removeEventListener(ev, onActivity);
      window.removeEventListener("storage", onStorage);
      clearInterval(tick);
    };
  }, [enabled, doLogout]);

  if (!enabled || warnLeft === null) return null;

  return (
    <div
      role="alertdialog"
      aria-live="assertive"
      aria-label="Inactivity warning"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 99990,
        background: "rgba(15,12,6,0.55)",
        backdropFilter: "blur(4px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 380,
          background: "var(--bg, #fff)",
          border: "1px solid var(--border)",
          borderRadius: 16,
          padding: 24,
          textAlign: "center",
          boxShadow: "0 24px 60px rgba(0,0,0,0.35)",
        }}
      >
        <div style={{ fontSize: 34, lineHeight: 1, marginBottom: 10 }}>⏳</div>
        <h2 style={{ margin: "0 0 6px", fontSize: 19, color: "var(--text)" }}>Still there?</h2>
        <p className="muted" style={{ margin: "0 0 4px", fontSize: 13 }}>
          You&apos;ve been inactive. For security, you&apos;ll be signed out in
        </p>
        <div style={{ fontSize: 40, fontWeight: 900, color: "#b45309", fontFamily: "ui-monospace, monospace", lineHeight: 1.1, margin: "2px 0 16px" }}>
          {warnLeft}s
        </div>
        <button
          type="button"
          onClick={stayActive}
          style={{
            width: "100%",
            padding: "12px 16px",
            fontSize: 15,
            fontWeight: 800,
            color: "#fff",
            background: "var(--gold-dark, #a16207)",
            border: "none",
            borderRadius: 12,
            cursor: "pointer",
          }}
        >
          Stay signed in
        </button>
      </div>
    </div>
  );
}
