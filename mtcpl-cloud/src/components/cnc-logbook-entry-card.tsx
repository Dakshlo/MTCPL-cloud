"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Dashboard entry tile for the CNC screens (mig 215 carving routes).
 * Owner/developer only — gated at the call site in dashboard/page.tsx.
 *
 * Oct 2026, Daksh's dad: he wanted a CNC productivity ranking and asked
 * that it NOT be buried — "don't put that new thing too inside, keep it
 * on the surface so easily accessible. Maybe that CNC Logbook, when we
 * press it will give 2 options like Various Costing."
 *
 * So this card behaves exactly like VariousCostingEntryCard: it reads as
 * a normal tile until Open is pressed, then the face splits into
 * Logbook and Productivity, and reverts if left alone for 5 seconds.
 * The countdown hairline makes the revert look deliberate rather than
 * like the UI twitching by itself.
 */

const IDLE_MS = 5000;

export function CncLogbookEntryCard() {
  const [open, setOpen] = useState(false);
  // Bumped on every interaction: re-arms the timer AND restarts the
  // countdown hairline (it keys the element, so React remounts it).
  const [tick, setTick] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clear = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

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

  return (
    <div
      onMouseEnter={open ? poke : undefined}
      onMouseLeave={open ? poke : undefined}
      onFocusCapture={open ? poke : undefined}
      style={{
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        gap: 12,
        height: "100%",
        minHeight: 150,
        background: "linear-gradient(135deg, #172554 0%, #2563eb 100%)",
        borderRadius: 12,
        padding: "22px 26px",
        boxShadow: "0 4px 16px rgba(23,37,84,0.20)",
        position: "relative",
        overflow: "hidden",
      }}
    >
      <CncCardStyles />

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
        <div
          style={{
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            color: "#bfdbfe",
            marginBottom: 6,
          }}
        >
          🗺️ Carving routes
        </div>
        <div style={{ fontSize: 22, fontWeight: 700, color: "#fff", letterSpacing: "-0.2px" }}>
          CNC
        </div>
      </div>

      {open ? (
        <div style={{ position: "relative" }}>
          <div className="cnc-split">
            <Link href="/carving/plan" className="cnc-half cnc-half--l">
              <span className="cnc-ico" aria-hidden>🗺️</span>
              <span>Logbook</span>
            </Link>
            <span className="cnc-divider" aria-hidden />
            <Link href="/carving/productivity" className="cnc-half cnc-half--r">
              <span className="cnc-ico" aria-hidden>🏆</span>
              <span>Productivity</span>
            </Link>
          </div>
          <span key={tick} className="cnc-countdown" aria-hidden />
        </div>
      ) : (
        <button type="button" className="cnc-open" onClick={() => setOpen(true)}>
          Open →
        </button>
      )}
    </div>
  );
}

function CncCardStyles() {
  return (
    <style>{`
      /* Both faces are pinned to the same 40px so opening the card
       * cannot nudge its height, and with it the dashboard row. */
      .cnc-open {
        position: relative;
        align-self: flex-start;
        display: inline-flex;
        align-items: center;
        box-sizing: border-box;
        height: 40px;
        padding: 0 18px;
        background: #fff;
        color: #1e3a8a;
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
      .cnc-open:hover {
        transform: translateY(-1px);
        box-shadow: 0 5px 14px rgba(10,20,55,0.32);
      }
      .cnc-open:active { transform: translateY(0); }

      .cnc-split {
        position: relative;
        display: grid;
        grid-template-columns: 1fr auto 1fr;
        align-items: stretch;
        box-sizing: border-box;
        height: 40px;
        background: #fff;
        border-radius: 8px;
        overflow: hidden;
        box-shadow: 0 5px 14px rgba(10,20,55,0.28);
      }
      .cnc-half {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 7px;
        min-width: 0;
        padding: 0 10px;
        color: #1e3a8a;
        font-size: 13px;
        font-weight: 700;
        letter-spacing: 0.02em;
        white-space: nowrap;
        text-decoration: none;
        transition: background .12s ease;
      }
      .cnc-half:hover        { background: #dbeafe; }
      .cnc-half:focus-visible{ background: #dbeafe; outline: 2px solid #1e3a8a; outline-offset: -2px; }
      .cnc-ico { font-size: 14px; line-height: 1; }
      .cnc-divider { width: 1px; background: rgba(30,58,138,0.16); }

      .cnc-half--l { animation: cncInL .26s cubic-bezier(.22,1,.36,1) both; }
      .cnc-half--r { animation: cncInR .26s cubic-bezier(.22,1,.36,1) both; }
      .cnc-divider { animation: cncDiv .26s cubic-bezier(.22,1,.36,1) both; }
      @keyframes cncInL { from { opacity: 0; transform: translateX(-14%); } to { opacity: 1; transform: none; } }
      @keyframes cncInR { from { opacity: 0; transform: translateX( 14%); } to { opacity: 1; transform: none; } }
      @keyframes cncDiv { from { transform: scaleY(0); } to { transform: scaleY(1); } }

      .cnc-countdown {
        position: absolute;
        left: 0;
        bottom: -5px;
        height: 2px;
        border-radius: 2px;
        background: rgba(255,255,255,0.75);
        animation: cncCount ${IDLE_MS}ms linear both;
      }
      @keyframes cncCount { from { width: 100%; } to { width: 0%; } }

      @media (prefers-reduced-motion: reduce) {
        .cnc-half--l, .cnc-half--r, .cnc-divider, .cnc-countdown { animation: none; }
        .cnc-countdown { display: none; }
      }
    `}</style>
  );
}
