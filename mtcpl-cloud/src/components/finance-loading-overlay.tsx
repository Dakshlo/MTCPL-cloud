"use client";

/**
 * Migration 053 follow-on — HDFC-style branded loading overlay.
 *
 * Daksh wanted the same vibe HDFC NetBanking gives when you hit an
 * important button: a backdrop dim + a spinning company logo, so
 * the action feels deliberate and professional rather than a flat
 * disabled button. Reserved for Finance department actions where
 * something material is happening (money moves, an audit ticks off,
 * a vendor record is created).
 *
 * Usage — in any finance form:
 *
 *   import { FinanceLoadingOverlay } from "@/components/finance-loading-overlay";
 *   const [pending, startTransition] = useTransition();
 *   ...
 *   return (
 *     <>
 *       <FinanceLoadingOverlay show={pending} label="Saving vendor…" />
 *       <form>...</form>
 *     </>
 *   );
 *
 * Renders as `position: fixed; inset: 0; z-index: 9999;` so it
 * floats above every modal / slide-over / dropdown without
 * special parenting.
 *
 * Auto-no-op when `show={false}` — safe to mount unconditionally
 * inside any client component.
 */

import Image from "next/image";

export function FinanceLoadingOverlay({
  show,
  label,
}: {
  show: boolean;
  /** Optional one-line message under the spinner. Reads as
   *  context — "Marking paid…", "Confirming batch…", "Sending
   *  email…", etc. Keep short (under 30 chars). */
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
        animation: "mtcpl-fade-in 0.18s ease-out",
        // Prevent the overlay from absorbing pointer events on the
        // page underneath — we DO want it to absorb (block user
        // interaction while the action runs). No pointer-events:none.
      }}
    >
      <style>{`
        @keyframes mtcpl-fade-in {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes mtcpl-spin {
          to { transform: rotate(360deg); }
        }
        @keyframes mtcpl-pulse {
          0%, 100% { transform: scale(1); }
          50%      { transform: scale(1.04); }
        }
      `}</style>

      {/* Logo container — adds the gold glow + ring. Image inside
          spins; container pulses subtly to feel alive. */}
      <div
        style={{
          width: 96,
          height: 96,
          borderRadius: "50%",
          background: "rgba(255, 255, 255, 0.95)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          boxShadow:
            "0 0 0 6px rgba(201, 161, 74, 0.22), 0 0 40px rgba(201, 161, 74, 0.4), 0 8px 24px rgba(0, 0, 0, 0.3)",
          animation: "mtcpl-pulse 1.6s ease-in-out infinite",
        }}
      >
        <Image
          src="/MTCPL-Final-logo-2 copy 2.png"
          alt="MTCPL"
          width={64}
          height={64}
          priority
          unoptimized
          style={{
            objectFit: "contain",
            animation: "mtcpl-spin 1.4s linear infinite",
          }}
        />
      </div>

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
      <div
        style={{
          color: "rgba(255, 255, 255, 0.7)",
          fontSize: 11,
          fontWeight: 500,
          letterSpacing: "0.03em",
        }}
      >
        Mateshwari Temple Construction Pvt Ltd
      </div>
    </div>
  );
}
