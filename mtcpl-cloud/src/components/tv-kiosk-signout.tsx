"use client";

// Wall-display kiosk helpers for the "tv" role (runs with no top bar):
//   • auto full-screen — browsers refuse full-screen without a user gesture,
//     so we trigger it on the FIRST interaction (tap / click / key) after the
//     page opens. One touch on the kiosk and the browser chrome is gone. For a
//     PERMANENT no-browser kiosk, launch Chrome with --kiosk (OS-level; a web
//     page can't remove the browser itself).
//   • a tiny corner sign-out (there's no top-bar logout for this role).
import { useEffect } from "react";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";

export function TvKioskSignOut() {
  useEffect(() => {
    if (typeof document === "undefined") return;
    const go = () => {
      if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen?.().catch(() => {
          /* user/Permissions-Policy may still block it — the ⛶ button remains */
        });
      }
      window.removeEventListener("pointerdown", go);
      window.removeEventListener("keydown", go);
    };
    window.addEventListener("pointerdown", go);
    window.addEventListener("keydown", go);
    return () => {
      window.removeEventListener("pointerdown", go);
      window.removeEventListener("keydown", go);
    };
  }, []);

  return (
    <button
      type="button"
      title="Sign out"
      aria-label="Sign out"
      onClick={async () => {
        try {
          await createBrowserSupabaseClient().auth.signOut();
        } catch {
          /* navigate regardless — the auth gate reruns on the next load */
        }
        window.location.href = "/login";
      }}
      style={{
        position: "fixed",
        bottom: 10,
        right: 10,
        zIndex: 10000,
        padding: "5px 10px",
        borderRadius: 8,
        border: "1px solid rgba(0,0,0,0.18)",
        background: "rgba(255,255,255,0.7)",
        color: "#555",
        fontSize: 11,
        fontWeight: 700,
        cursor: "pointer",
        opacity: 0.5,
        backdropFilter: "blur(4px)",
        WebkitBackdropFilter: "blur(4px)",
      }}
    >
      ⎋ Sign out
    </button>
  );
}
