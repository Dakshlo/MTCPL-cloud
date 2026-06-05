"use client";

/**
 * Print button with a tap/hold split:
 *   • Single tap    → COMPACT print. Adds body.print-compact, which
 *                     hides the middle Layer-by-Layer + Primary Slab
 *                     Cutting Guide sections (see @media print CSS in
 *                     page.tsx). Result: a 2-page document — first
 *                     page (block info, utilisation, layout) + last
 *                     page (slabs-to-cut tick sheet + manual entry).
 *                     This is what the cutter floor actually uses.
 *   • Hold ≥800 ms  → FULL print. Keeps everything (the original
 *                     multi-page layout with all per-slab guides).
 *
 * Visual: a hold timer fills the right edge of the button as you
 * press; release before it fills = compact, after = full. A small
 * caption under the icon hints at the behaviour the first time the
 * page loads.
 *
 * Why this UX, not two separate buttons: cutters print dozens of
 * these a day, want the lightest-friction default (compact), and
 * the full version is occasional. Hiding the rare option behind a
 * deliberate hold keeps the button bar uncluttered.
 */

import { useEffect, useRef, useState } from "react";

const HOLD_MS = 800;

export function PrintBtn() {
  const timerRef = useRef<number | null>(null);
  const tickRef = useRef<number | null>(null);
  const startedAtRef = useRef<number>(0);
  const [progress, setProgress] = useState(0); // 0..1
  const [holding, setHolding] = useState(false);

  // Stop the hold animation + timer.
  function clearHold() {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (tickRef.current !== null) {
      window.cancelAnimationFrame(tickRef.current);
      tickRef.current = null;
    }
    setProgress(0);
    setHolding(false);
  }

  // Animate the progress bar.
  function tick() {
    const elapsed = performance.now() - startedAtRef.current;
    const pct = Math.min(1, elapsed / HOLD_MS);
    setProgress(pct);
    if (pct < 1) {
      tickRef.current = window.requestAnimationFrame(tick);
    }
  }

  function doFullPrint() {
    // FULL — no class, the original multi-page document.
    document.body.classList.remove("print-compact");
    // Defer to next tick so the click event finishes first.
    window.setTimeout(() => window.print(), 0);
  }

  function doCompactPrint() {
    document.body.classList.add("print-compact");
    const cleanup = () => {
      document.body.classList.remove("print-compact");
      window.removeEventListener("afterprint", cleanup);
    };
    window.addEventListener("afterprint", cleanup);
    // Safety: if afterprint never fires (some mobile browsers don't),
    // strip the class after 30s so subsequent page nav isn't affected.
    window.setTimeout(cleanup, 30_000);
    window.setTimeout(() => window.print(), 0);
  }

  function onPointerDown(e: React.PointerEvent<HTMLButtonElement>) {
    // Only react to primary / touch pointer.
    if (e.button !== 0 && e.pointerType === "mouse") return;
    e.currentTarget.setPointerCapture(e.pointerId);
    setHolding(true);
    startedAtRef.current = performance.now();
    tickRef.current = window.requestAnimationFrame(tick);
    timerRef.current = window.setTimeout(() => {
      // Hold threshold reached → FULL print.
      clearHold();
      doFullPrint();
    }, HOLD_MS);
  }

  function onPointerUp(e: React.PointerEvent<HTMLButtonElement>) {
    // If the long-press timer is still pending, this was a tap →
    // COMPACT print. (If it had fired, timerRef.current is already
    // null and full print was already triggered.)
    const wasTap = timerRef.current !== null;
    clearHold();
    if (wasTap) doCompactPrint();
    e.currentTarget.releasePointerCapture(e.pointerId);
  }

  function onPointerCancel() {
    clearHold();
  }

  // Belt-and-suspenders: if the user navigates away while holding,
  // clear the timer so it doesn't fire after unmount.
  useEffect(() => () => clearHold(), []);

  const label = holding
    ? progress >= 1
      ? "Releasing full…"
      : `Hold for FULL print…`
    : "🖨 Print";

  return (
    <div style={{ display: "inline-flex", flexDirection: "column", alignItems: "stretch", gap: 3 }}>
      <button
        type="button"
        className="print-action-btn"
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onPointerLeave={onPointerCancel}
        title="Tap: print 2-page summary  ·  Hold 1 s: print full multi-page"
        style={{
          position: "relative",
          overflow: "hidden",
          // Slight visual nudge while holding so it feels alive.
          transform: holding ? "scale(0.985)" : undefined,
          transition: "transform 0.08s ease-out",
        }}
      >
        {/* Progress fill — left-to-right while the user is holding. */}
        {holding && (
          <span
            aria-hidden
            style={{
              position: "absolute",
              left: 0,
              top: 0,
              bottom: 0,
              width: `${progress * 100}%`,
              background: "rgba(255,255,255,0.28)",
              pointerEvents: "none",
              transition: "background 0.15s",
            }}
          />
        )}
        <span style={{ position: "relative" }}>{label}</span>
      </button>
      <span
        style={{
          fontSize: 10,
          color: "rgba(255,255,255,0.55)",
          textAlign: "center",
          fontWeight: 600,
          letterSpacing: "0.02em",
        }}
      >
        tap → 2 pages · hold → full
      </span>
    </div>
  );
}
