"use client";

/**
 * Generic full-screen loading overlay.
 *
 * Drop-in replacement for the MTCPL FinanceLoadingOverlay — same
 * API (`<LoadingOverlay show={pending} label="Saving…" />`), but
 * renders a plain spinning circle instead of an MTCPL logo. No
 * branding, no images, just CSS keyframes.
 *
 * Usage:
 *   import { LoadingOverlay } from "@/components/loading-overlay";
 *   const [pending, startTransition] = useTransition();
 *   return (
 *     <>
 *       <LoadingOverlay show={pending} label="Saving party…" />
 *       <form>...</form>
 *     </>
 *   );
 *
 * Renders position:fixed; inset:0; z-index:9999 so it floats above
 * every modal / slide-over / dropdown.
 *
 * Auto-no-op when show=false — safe to mount unconditionally.
 */

export function LoadingOverlay({
  show,
  label,
}: {
  show: boolean;
  /** Optional one-line message under the spinner. Keep short. */
  label?: string;
}) {
  if (!show) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(15, 23, 42, 0.55)",
        backdropFilter: "blur(6px)",
        WebkitBackdropFilter: "blur(6px)",
        zIndex: 9999,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 18,
        animation: "loading-overlay-fade-in 0.18s ease-out",
      }}
    >
      <style>{`
        @keyframes loading-overlay-fade-in {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
        @keyframes loading-overlay-spin {
          to { transform: rotate(360deg); }
        }
      `}</style>

      {/* Spinning ring — pure CSS. The "head" of the spinner is the
          top arc rendered in a contrasting colour; the rest of the
          ring is muted so the eye tracks the rotation cleanly. */}
      <div
        aria-hidden="true"
        style={{
          width: 64,
          height: 64,
          borderRadius: "50%",
          border: "5px solid rgba(255, 255, 255, 0.18)",
          borderTopColor: "#fff",
          animation: "loading-overlay-spin 0.9s linear infinite",
          boxShadow: "0 4px 14px rgba(0, 0, 0, 0.25)",
        }}
      />

      <div
        style={{
          color: "#fff",
          fontSize: 13,
          fontWeight: 700,
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          textShadow: "0 2px 8px rgba(0, 0, 0, 0.4)",
          textAlign: "center",
        }}
      >
        {label ?? "Processing…"}
      </div>
    </div>
  );
}
