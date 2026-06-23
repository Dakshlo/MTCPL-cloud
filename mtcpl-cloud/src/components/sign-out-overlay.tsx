"use client";

/**
 * Daksh May 2026 — sign-out flourish.
 *
 * Mirrors the login "Verified successfully" full-card takeover but
 * uses a sand/gold palette so it reads as a calm "see you out"
 * moment instead of the alarmy orange-red used for successful sign-in.
 *
 * Trigger:
 *   const signOut = useSignOut();
 *   <button onClick={signOut}>Sign out</button>
 *
 * Behaviour:
 *   1. Click → full-viewport overlay mounts, plays a fade-up
 *      animation. supabase.auth.signOut() fires in parallel — the
 *      animation never blocks on the network call.
 *   2. Big focal box with the MTCPL logomark spins / pulses for
 *      ~1.4 s. Caption changes from "Signing you out…" →
 *      "Session ended" once the signOut promise resolves.
 *   3. Hard-redirects to /login at the 1.6-s mark via
 *      window.location.href so server-side cookies are re-read.
 *
 * Why a hook + portal instead of a button component:
 *   The two existing logout surfaces (LogoutButton in the topbar
 *   AND the sidebar footer) want the same animation but have
 *   different wrapping markup. Exposing it as a hook lets each
 *   surface keep its own button styling while sharing the
 *   overlay code.
 */

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";

type Phase = "out" | "confirm" | "signing" | "done";

/** SignOutController — the singleton state. Lives at module scope so
 *  multiple buttons can call the same flourish without each mounting
 *  a duplicate overlay. */
let setSharedPhase: ((p: Phase) => void) | null = null;

export function useSignOut() {
  // Daksh (Jun 2026) — pressing Sign out now ASKS first (the system's own
  // confirm card, not the browser dialog). Only on confirm does the flourish
  // + sign-out fire. (Auto-logouts — idle / TV kiosk — sign out directly and
  // never call this, so they're unaffected.)
  return function startSignOut() {
    if (!setSharedPhase) {
      // Overlay host not mounted (shouldn't happen — root layout mounts it).
      // Fall back to a plain confirm + sign-out.
      if (typeof window !== "undefined" && !window.confirm("Sign out of MTCPL?")) return;
      void plainSignOut().then(() => {
        window.location.href = "/login";
      });
      return;
    }
    setSharedPhase("confirm");
  };
}

/** The actual sign-out flourish — fired only after the user confirms. */
function executeSignOut() {
  setSharedPhase?.("signing");
  void plainSignOut().then(() => {
    setSharedPhase?.("done");
  });
  // Hard redirect after the flourish has had time to play. Using
  // window.location.href (not router.push) so server cookies are
  // fresh on the new page.
  setTimeout(() => {
    window.location.href = "/login";
  }, 1600);
}

async function plainSignOut() {
  try {
    const supabase = createBrowserSupabaseClient();
    await supabase.auth.signOut();
  } catch {
    // Swallow — even if Supabase choked, we still navigate to
    // /login. The auth gate will rerun on the next load.
  }
}

/** Host component. Mount this ONCE somewhere high in the tree (the
 *  root (app) layout). Without it, useSignOut() falls back to a
 *  plain sign-out with no animation. */
export function SignOutOverlayHost() {
  const [phase, setPhase] = useState<Phase>("out");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    setSharedPhase = setPhase;
    return () => {
      setSharedPhase = null;
    };
  }, []);

  if (!mounted) return null;
  if (phase === "out") return null;

  if (phase === "confirm") {
    return createPortal(
      <SignOutConfirm onConfirm={executeSignOut} onCancel={() => setPhase("out")} />,
      document.body,
    );
  }
  return createPortal(<SignOutOverlay phase={phase} />, document.body);
}

/** Confirmation card shown when a user presses Sign out (manual only). */
function SignOutConfirm({ onConfirm, onCancel }: { onConfirm: () => void; onCancel: () => void }) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onCancel();
      else if (e.key === "Enter") onConfirm();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onConfirm, onCancel]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Confirm sign out"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onCancel(); }}
      style={{
        position: "fixed", inset: 0, zIndex: 99999,
        background: "rgba(15, 12, 6, 0.72)",
        backdropFilter: "blur(6px)", WebkitBackdropFilter: "blur(6px)",
        display: "flex", alignItems: "center", justifyContent: "center", padding: 24,
        animation: "mtcpl-signout-fade 0.18s ease-out both",
      }}
    >
      <style dangerouslySetInnerHTML={{ __html: `
        @keyframes mtcpl-signout-fade { from { opacity: 0; } to { opacity: 1; } }
        @keyframes mtcpl-signout-confirm-pop { from { transform: scale(0.92); opacity: 0; } to { transform: scale(1); opacity: 1; } }
      ` }} />
      <div
        style={{
          width: "100%", maxWidth: 380,
          background: "var(--surface, #fff)", color: "var(--text, #1a1a1a)",
          border: "1px solid var(--border, #e5e5e5)", borderRadius: 18,
          boxShadow: "0 24px 70px rgba(0,0,0,0.45)",
          padding: 24, textAlign: "center",
          animation: "mtcpl-signout-confirm-pop 0.2s cubic-bezier(0.34,1.56,0.64,1) both",
        }}
      >
        <div style={{ width: 56, height: 56, borderRadius: 16, margin: "0 auto 14px", display: "flex", alignItems: "center", justifyContent: "center", background: "linear-gradient(135deg, #d4a017 0%, #a16207 60%, #78350f 100%)", fontSize: 28 }}>👋</div>
        <div style={{ fontSize: 18, fontWeight: 800, letterSpacing: "-0.01em" }}>Sign out?</div>
        <div style={{ fontSize: 13.5, color: "var(--muted, #666)", marginTop: 6, lineHeight: 1.5 }}>
          You&apos;ll be returned to the login screen.
        </div>
        <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
          <button
            type="button"
            onClick={onCancel}
            style={{ flex: 1, padding: "11px 16px", fontSize: 14, fontWeight: 700, borderRadius: 10, border: "1px solid var(--border, #ddd)", background: "var(--surface-alt, #f5f5f5)", color: "var(--text, #1a1a1a)", cursor: "pointer" }}
          >
            Cancel
          </button>
          <button
            type="button"
            autoFocus
            onClick={onConfirm}
            style={{ flex: 1, padding: "11px 16px", fontSize: 14, fontWeight: 800, borderRadius: 10, border: "none", background: "#b91c1c", color: "#fff", cursor: "pointer" }}
          >
            Sign out
          </button>
        </div>
      </div>
    </div>
  );
}

function SignOutOverlay({ phase }: { phase: Phase }) {
  return (
    <div
      aria-live="polite"
      aria-label={phase === "done" ? "Session ended" : "Signing you out"}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 99999,
        background: "rgba(15, 12, 6, 0.78)",
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 28,
        padding: 24,
        animation: "mtcpl-signout-fade 0.22s ease-out both",
      }}
    >
      <style
        dangerouslySetInnerHTML={{
          __html: `
            @keyframes mtcpl-signout-fade {
              from { opacity: 0; }
              to   { opacity: 1; }
            }
            @keyframes mtcpl-signout-rise {
              from { transform: translateY(10px); opacity: 0; }
              to   { transform: translateY(0); opacity: 1; }
            }
            @keyframes mtcpl-signout-pop {
              0%   { transform: scale(0.5); opacity: 0; }
              60%  { transform: scale(1.06); opacity: 1; }
              100% { transform: scale(1); opacity: 1; }
            }
            @keyframes mtcpl-signout-glow {
              0%, 100% {
                box-shadow:
                  0 0 32px 8px rgba(202, 138, 4, 0.42),
                  0 0 64px 16px rgba(120, 53, 15, 0.22),
                  inset 0 0 24px 4px rgba(202, 138, 4, 0.28);
                transform: scale(1);
              }
              50% {
                box-shadow:
                  0 0 48px 12px rgba(202, 138, 4, 0.62),
                  0 0 96px 24px rgba(120, 53, 15, 0.35),
                  inset 0 0 32px 6px rgba(202, 138, 4, 0.42);
                transform: scale(1.03);
              }
            }
            @keyframes mtcpl-signout-spin {
              to { transform: rotate(360deg); }
            }
            @keyframes mtcpl-signout-wave {
              0%, 100% { transform: rotate(0deg); }
              25% { transform: rotate(-18deg); }
              75% { transform: rotate(18deg); }
            }
            @keyframes mtcpl-signout-check-draw {
              from { stroke-dashoffset: 60; }
              to   { stroke-dashoffset: 0; }
            }
          `,
        }}
      />

      {/* Heading — flips copy on phase change */}
      <h2
        style={{
          fontSize: 22,
          fontWeight: 800,
          color: "#fff",
          letterSpacing: "-0.01em",
          margin: 0,
          textAlign: "center",
          animation: "mtcpl-signout-rise 0.34s 0.04s ease-out both",
        }}
      >
        {phase === "done" ? "Session ended" : "Signing you out"}
      </h2>

      {/* The focal box — gold gradient with pulsing aura. Hosts
          either the spinner (signing) or the check mark (done). */}
      <div
        key={phase}
        style={{
          position: "relative",
          width: 104,
          height: 104,
          borderRadius: 24,
          background:
            phase === "done"
              ? "linear-gradient(135deg, #16a34a 0%, #15803d 100%)"
              : "linear-gradient(135deg, #d4a017 0%, #a16207 50%, #78350f 100%)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          animation:
            phase === "done"
              ? "mtcpl-signout-pop 0.48s cubic-bezier(0.34, 1.56, 0.64, 1) both"
              : "mtcpl-signout-pop 0.48s cubic-bezier(0.34, 1.56, 0.64, 1) both, mtcpl-signout-glow 1.8s ease-in-out 0.5s infinite",
          boxShadow:
            phase === "done"
              ? "0 0 32px 8px rgba(22,163,74,0.45)"
              : undefined,
        }}
      >
        {phase === "done" ? (
          // Animated SVG check — strokes itself in.
          <svg
            width="52"
            height="52"
            viewBox="0 0 52 52"
            aria-hidden
            style={{ display: "block" }}
          >
            <polyline
              points="12,28 22,38 40,16"
              fill="none"
              stroke="#fff"
              strokeWidth="5"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{
                strokeDasharray: 60,
                strokeDashoffset: 60,
                animation: "mtcpl-signout-check-draw 0.45s 0.15s ease-out forwards",
              }}
            />
          </svg>
        ) : (
          // Spinning ring + a tiny waving hand on top — calm farewell
          <>
            <span
              aria-hidden
              style={{
                position: "absolute",
                display: "block",
                width: 64,
                height: 64,
                border: "4px solid rgba(255, 255, 255, 0.85)",
                borderTopColor: "transparent",
                borderRadius: "50%",
                animation: "mtcpl-signout-spin 0.9s linear infinite",
              }}
            />
            <span
              aria-hidden
              style={{
                position: "relative",
                fontSize: 30,
                lineHeight: 1,
                transformOrigin: "70% 70%",
                animation: "mtcpl-signout-wave 1.4s ease-in-out infinite",
              }}
            >
              👋
            </span>
          </>
        )}
      </div>

      {/* Caption — flips with phase */}
      <p
        key={`cap-${phase}`}
        style={{
          fontSize: 12.5,
          color: "rgba(255,255,255,0.78)",
          margin: 0,
          letterSpacing: "0.05em",
          textTransform: "uppercase",
          fontWeight: 700,
          animation: "mtcpl-signout-rise 0.34s 0.10s ease-out both",
        }}
      >
        {phase === "done" ? "See you soon" : "Securing your session…"}
      </p>
    </div>
  );
}
