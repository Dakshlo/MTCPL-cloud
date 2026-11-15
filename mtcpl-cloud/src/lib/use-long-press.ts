"use client";

// ──────────────────────────────────────────────────────────────────
// Press and hold.
//
// Daksh, Nov 2026: "to add stock and fix count you have to press fix
// count and choose which tool — instead maybe we can long press on home
// page only."
//
// He is describing the cupboard QR, where a TAP on a tool already means
// "I am taking this one". That gesture is spoken for, so the keeper's
// jobs had been pushed behind a button that opens a menu that opens a
// list of every tool — three screens before anybody can type a number,
// and the tool was already under his thumb when he started.
//
// Hold the tool instead.
//
// ── What makes this fiddly on a real phone ────────────────────────
//
// A thumb is not a mouse. It moves while it presses, the page scrolls
// under it, and the browser fires a click afterwards whether or not you
// wanted one. So:
//
//   · a few pixels of drift are forgiven, more than that cancels —
//     otherwise nobody can scroll a list of tools without triggering
//     something
//   · any scroll anywhere cancels, because a list that fires actions
//     while it moves is unusable
//   · the click that follows a successful hold is swallowed, or a hold
//     on the QR would open the keeper sheet AND take the tool
//   · the hold fires on a timer rather than on release, so there is a
//     moment to feel — with a buzz where the device has one — instead
//     of a gesture you only discover you have made
// ──────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useRef } from "react";

/** How long is a hold. Long enough not to fire on a clumsy tap, short
 *  enough that nobody thinks the screen is dead. */
const HOLD_MS = 450;

/** Drift allowed before we call it a scroll, not a press. */
const SLOP_PX = 10;

export type LongPressHandlers = {
  onPointerDown: (e: React.PointerEvent) => void;
  onPointerMove: (e: React.PointerEvent) => void;
  onPointerUp: (e: React.PointerEvent) => void;
  onPointerCancel: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
  onClick: (e: React.MouseEvent) => void;
};

export function useLongPress(
  onLongPress: () => void,
  opts?: {
    /** Also fire on a plain tap. Right where nothing else uses the tap
     *  — the office list — and wrong on the cupboard, where a tap is
     *  already how you take a tool. */
    onClick?: () => void;
    ms?: number;
    disabled?: boolean;
  },
): LongPressHandlers {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const fired = useRef(false);

  const clear = useCallback(() => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    start.current = null;
  }, []);

  // A list that fires while it is moving is worse than no gesture.
  useEffect(() => {
    if (!timer.current) return;
    const cancel = () => clear();
    window.addEventListener("scroll", cancel, { passive: true, capture: true });
    return () => window.removeEventListener("scroll", cancel, { capture: true });
  });

  useEffect(() => clear, [clear]);

  const ms = opts?.ms ?? HOLD_MS;
  const disabled = opts?.disabled === true;
  const onClickProp = opts?.onClick;

  return {
    onPointerDown: (e) => {
      if (disabled || e.button === 2) return;
      fired.current = false;
      start.current = { x: e.clientX, y: e.clientY };
      timer.current = setTimeout(() => {
        fired.current = true;
        timer.current = null;
        // Where the phone can buzz, it buzzes: the only honest way to
        // say "that worked" before the sheet has drawn.
        try { navigator.vibrate?.(18); } catch { /* not every device */ }
        onLongPress();
      }, ms);
    },
    onPointerMove: (e) => {
      const s = start.current;
      if (!s || !timer.current) return;
      if (Math.abs(e.clientX - s.x) > SLOP_PX || Math.abs(e.clientY - s.y) > SLOP_PX) clear();
    },
    onPointerUp: () => clear(),
    onPointerCancel: () => clear(),
    // Holding on a phone pops the browser's own menu over ours.
    onContextMenu: (e) => { if (!disabled) e.preventDefault(); },
    onClick: (e) => {
      if (fired.current) {
        // Swallow the click the hold produced, or the cupboard would
        // open the keeper sheet and take the tool in one gesture.
        fired.current = false;
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      if (!disabled) onClickProp?.();
    },
  };
}
