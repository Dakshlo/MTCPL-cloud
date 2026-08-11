"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Mig 060 — Dashboard entry tile for the Various Costing reports.
 * Visually a sibling of AskAiEntryCard + BlockJourneyEntryCard so
 * the row of cards stays aligned.
 *
 * Aug 2026 (Daksh): "just Various Costing card like other, Open
 * button — when pressed that same card gets split into 2, left side
 * CNC and right side Cutter, there they can get to that page. And if
 * after open no action after 5 second it will back to normal."
 *
 * So the card reads exactly like its neighbours until you press Open,
 * then the face splits down the middle into the two reports. This
 * replaces the old /reports/various-costing landing page, which was a
 * whole page load whose only content was these same two choices (that
 * route now redirects to /dashboard).
 *
 * The countdown restarts on any interaction with the card, so it only
 * closes once you've actually left it alone — and a hairline under
 * the split shows the time running down, so the revert doesn't feel
 * like the UI twitching by itself.
 *
 * `canCnc` / `canCutter` hide an option the user can't open. With only
 * one of them, there's nothing to choose between, so the card skips
 * the split and Open goes straight to that report. Both report pages
 * still enforce their own gate (canViewCncCosts / canViewCutterCosts)
 * — this is only about what we offer, never the security boundary.
 */

const IDLE_MS = 5000;

export function VariousCostingEntryCard({
  canCnc = true,
  canCutter = true,
}: {
  canCnc?: boolean;
  canCutter?: boolean;
}) {
  const [open, setOpen] = useState(false);
  // Bumped on every interaction: re-arms the timer AND restarts the
  // countdown hairline (it keys the element, so React remounts it and
  // the CSS animation plays from 0 again).
  const [tick, setTick] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clear = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  // Arm/re-arm whenever the card opens or the user pokes it.
  useEffect(() => {
    if (!open) {
      clear();
      return;
    }
    clear();
    timer.current = setTimeout(() => setOpen(false), IDLE_MS);
    return clear; // also covers unmount
  }, [open, tick, clear]);

  const poke = useCallback(() => setTick((t) => t + 1), []);

  const bothAvailable = canCnc && canCutter;

  return (
    <div
      onMouseEnter={open ? poke : undefined}
      onMouseLeave={open ? poke : undefined}
      onFocusCapture={open ? poke : undefined}
      style={{
        // Uniform dashboard card — see ask-ai-entry-card for the shape.
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        gap: 12,
        height: "100%",
        minHeight: 150,
        background: "linear-gradient(135deg, #0c4a6e 0%, #0ea5e9 100%)",
        borderRadius: 12,
        padding: "22px 26px",
        boxShadow: "0 4px 16px rgba(12,74,110,0.18)",
        position: "relative",
        overflow: "hidden",
      }}
    >
      <VcCardStyles />

      {/* Decorative accent — same shape pattern as the AI card */}
      <div
        aria-hidden
        style={{
          position: "absolute",
          top: -30,
          right: -30,
          width: 140,
          height: 140,
          borderRadius: "50%",
          background: "radial-gradient(circle, rgba(255,255,255,0.18) 0%, rgba(255,255,255,0) 70%)",
          pointerEvents: "none",
        }}
      />

      <div style={{ position: "relative", minWidth: 0 }}>
        <div style={{
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: "0.1em",
          textTransform: "uppercase",
          color: "#bae6fd",
          marginBottom: 6,
        }}>
          📊 Reports
        </div>
        <div style={{ fontSize: 22, fontWeight: 700, color: "#fff", letterSpacing: "-0.2px" }}>
          Various Costing
        </div>
      </div>

      {open && bothAvailable ? (
        <div style={{ position: "relative" }}>
          <div className="vcc-split">
            <Link href="/reports/various-costing/cnc" className="vcc-half vcc-half--l">
              <span className="vcc-ico" aria-hidden>🛠</span>
              <span>CNC</span>
            </Link>
            <span className="vcc-divider" aria-hidden />
            <Link href="/reports/various-costing/cutter" className="vcc-half vcc-half--r">
              <span className="vcc-ico" aria-hidden>✂</span>
              <span>Cutter</span>
            </Link>
          </div>
          {/* Restarts whenever `tick` changes — see the comment above. */}
          <span key={tick} className="vcc-countdown" aria-hidden />
        </div>
      ) : bothAvailable ? (
        <button type="button" className="vcc-open" onClick={() => setOpen(true)}>
          Open →
        </button>
      ) : (
        // Only one report available — nothing to choose, so go direct.
        <Link
          href={canCnc ? "/reports/various-costing/cnc" : "/reports/various-costing/cutter"}
          className="vcc-open"
        >
          Open →
        </Link>
      )}
    </div>
  );
}

function VcCardStyles() {
  return (
    <style>{`
      /* Closed face — matches the other dashboard cards' Open button.
       * Both faces are pinned to the same 40px so opening the card
       * can't nudge its height (and with it the whole dashboard row). */
      .vcc-open {
        position: relative;
        align-self: flex-start;
        display: inline-flex;
        align-items: center;
        box-sizing: border-box;
        height: 40px;
        padding: 0 18px;
        background: #fff;
        color: #0c4a6e;
        border: none;
        border-radius: 8px;
        font: inherit;
        font-size: 13px;
        font-weight: 700;
        letter-spacing: 0.02em;
        white-space: nowrap;
        text-decoration: none;
        cursor: pointer;
        transition: transform .12s cubic-bezier(.22,1,.36,1), box-shadow .12s ease;
      }
      .vcc-open:hover {
        transform: translateY(-1px);
        box-shadow: 0 5px 14px rgba(3,26,45,0.32);
      }
      .vcc-open:active { transform: translateY(0); }

      /* Split face — the card's own width, halved. */
      .vcc-split {
        position: relative;
        display: grid;
        grid-template-columns: 1fr auto 1fr;
        align-items: stretch;
        box-sizing: border-box;
        height: 40px;
        background: #fff;
        border-radius: 8px;
        overflow: hidden;
        box-shadow: 0 5px 14px rgba(3,26,45,0.28);
      }
      .vcc-half {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 7px;
        min-width: 0;
        padding: 0 10px;
        color: #0c4a6e;
        font-size: 13px;
        font-weight: 700;
        letter-spacing: 0.02em;
        white-space: nowrap;
        text-decoration: none;
        transition: background .12s ease;
      }
      .vcc-half:hover        { background: #e0f2fe; }
      .vcc-half:focus-visible{ background: #e0f2fe; outline: 2px solid #0c4a6e; outline-offset: -2px; }
      .vcc-ico { font-size: 14px; line-height: 1; }
      .vcc-divider { width: 1px; background: rgba(12,74,110,0.16); }

      /* The halves arrive from their own outer edge, so the button
       * reads as splitting apart rather than being replaced. */
      .vcc-half--l { animation: vccInL .26s cubic-bezier(.22,1,.36,1) both; }
      .vcc-half--r { animation: vccInR .26s cubic-bezier(.22,1,.36,1) both; }
      .vcc-divider { animation: vccDiv .26s cubic-bezier(.22,1,.36,1) both; }
      @keyframes vccInL { from { opacity: 0; transform: translateX(-14%); } to { opacity: 1; transform: none; } }
      @keyframes vccInR { from { opacity: 0; transform: translateX( 14%); } to { opacity: 1; transform: none; } }
      @keyframes vccDiv { from { transform: scaleY(0); } to { transform: scaleY(1); } }

      /* Idle countdown — one-shot, only while the card is split. */
      .vcc-countdown {
        position: absolute;
        left: 0;
        bottom: -5px;
        height: 2px;
        border-radius: 2px;
        background: rgba(255,255,255,0.75);
        animation: vccCount ${IDLE_MS}ms linear both;
      }
      @keyframes vccCount { from { width: 100%; } to { width: 0%; } }

      @media (prefers-reduced-motion: reduce) {
        .vcc-half--l, .vcc-half--r, .vcc-divider, .vcc-countdown { animation: none; }
        .vcc-countdown { display: none; }
      }
    `}</style>
  );
}
