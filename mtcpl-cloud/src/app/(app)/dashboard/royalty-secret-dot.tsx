"use client";

/**
 * Secret entry to the cross-vendor Royalty Summary (Daksh, Jul 2026).
 *
 * Replaces the old clickable orange dot. It is NOT a link — clicking does
 * nothing. To open it you must HOVER the dot and TYPE the code "aadesh"; that
 * navigates to /accounts/royalty-summary, whose own passphrase window (125500)
 * is the actual gate. Floor tablets with no keyboard can LONG-PRESS the dot.
 * The dot is deliberately tiny and unlabelled so it reads as a stray speck.
 *
 * Hover is detected with a global `mouseover` listener keyed on the
 * data-royalty-dot attribute — the same proven mechanism as
 * LedgerSecretTrigger — rather than React's onMouseEnter, which is flakier.
 *
 * Mounted only for owner / developer (the page gates it that way), so the
 * listener never exists for anyone else.
 */

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

const CODE = "aadesh";
const DEST = "/accounts/royalty-summary";

export function RoyaltySecretDot() {
  const router = useRouter();
  const hovering = useRef(false);
  const buf = useRef("");
  const lastTs = useRef(0);
  // Tiny "unlocked" flash so the person knows the gesture registered before
  // the navigation — otherwise a silent code feels broken.
  const [flash, setFlash] = useState(false);

  useEffect(() => {
    function go() {
      buf.current = "";
      setFlash(true);
      setTimeout(() => router.push(DEST), 180);
    }
    function isDot(t: EventTarget | null) {
      const el = t as HTMLElement | null;
      return !!(el && typeof el.closest === "function" && el.closest("[data-royalty-dot]"));
    }
    function onOver(e: MouseEvent) { hovering.current = isDot(e.target); }
    function onKey(e: KeyboardEvent) {
      if (!hovering.current) return;
      if (e.key.length !== 1 || e.ctrlKey || e.metaKey || e.altKey) return;
      const el = document.activeElement as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
      const now = Date.now();
      if (now - lastTs.current > 1500) buf.current = "";
      lastTs.current = now;
      buf.current = (buf.current + e.key.toLowerCase()).slice(-16);
      if (buf.current.endsWith(CODE)) go();
    }
    // Touch (tablets have no hardware keyboard): long-press the dot.
    let pressTimer: ReturnType<typeof setTimeout> | null = null;
    const clearPress = () => { if (pressTimer != null) { clearTimeout(pressTimer); pressTimer = null; } };
    function onTouchStart(e: TouchEvent) {
      if (!isDot(e.target)) return;
      clearPress();
      pressTimer = setTimeout(go, 900);
    }
    document.addEventListener("mouseover", onOver);
    document.addEventListener("keydown", onKey);
    document.addEventListener("touchstart", onTouchStart, { passive: true });
    document.addEventListener("touchend", clearPress);
    document.addEventListener("touchmove", clearPress);
    document.addEventListener("touchcancel", clearPress);
    return () => {
      clearPress();
      document.removeEventListener("mouseover", onOver);
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("touchstart", onTouchStart);
      document.removeEventListener("touchend", clearPress);
      document.removeEventListener("touchmove", clearPress);
      document.removeEventListener("touchcancel", clearPress);
    };
  }, [router]);

  return (
    <span
      data-royalty-dot="1"
      aria-hidden
      style={{
        display: "inline-block",
        width: 6,
        height: 6,
        borderRadius: "50%",
        background: flash ? "#16a34a" : "#d97706",
        opacity: flash ? 0.9 : 0.3,
        transition: "opacity .15s, background .15s",
        cursor: "default",
      }}
    />
  );
}
