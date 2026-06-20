"use client";

// Tiny corner sign-out for the "tv" wall-display kiosk role, which runs with
// no top bar (so there's no normal logout). Self-contained — clears the
// Supabase session then hard-redirects — and kept small + low-opacity so it
// doesn't distract on the wall.
import { createBrowserSupabaseClient } from "@/lib/supabase/client";

export function TvKioskSignOut() {
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
