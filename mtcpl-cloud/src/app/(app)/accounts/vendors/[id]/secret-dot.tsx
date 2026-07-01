"use client";

/**
 * SecretDot (Daksh) — the tiny black dot that gates private royalty data.
 *
 * DESKTOP: hover the dot and type the secret code ("aadesh") → onUnlock.
 *
 * TABLET (royalty-program dot only): a multi-element TAP SEQUENCE handled by the
 * owner (PrivateNotesModal) — the dot reports each tap via onTap, which the modal
 * folds into "double-tap the vendor name → 2 taps on TDS → 2 taps on the dot".
 *
 * A plain click never opens anything on its own.
 */

import { useEffect, useRef } from "react";

export function SecretDot({
  code = "aadesh",
  onUnlock,
  title,
  onTap,
}: {
  code?: string;
  onUnlock: () => void;
  title?: string;
  /** Fires on each tap/click of the dot — used as the final step of a sequence. */
  onTap?: () => void;
}) {
  const hovering = useRef(false);
  const buf = useRef("");
  const lastTs = useRef(0);
  const cb = useRef(onUnlock);
  cb.current = onUnlock;
  const tapCb = useRef(onTap);
  tapCb.current = onTap;

  // Desktop — hover the dot, type the code.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!hovering.current) return;
      if (e.key.length !== 1 || e.ctrlKey || e.metaKey || e.altKey) return;
      const el = document.activeElement as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
      const now = Date.now();
      if (now - lastTs.current > 1500) buf.current = "";
      lastTs.current = now;
      buf.current = (buf.current + e.key.toLowerCase()).slice(-16);
      if (buf.current.endsWith(code)) { buf.current = ""; cb.current(); }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [code]);

  return (
    <span
      onMouseEnter={() => { hovering.current = true; }}
      onMouseLeave={() => { hovering.current = false; buf.current = ""; }}
      // Swallow the click (so it doesn't toggle a parent <summary>/row) but report
      // the tap so it can count as a step in the tablet unlock sequence.
      onClick={(e) => { e.stopPropagation(); e.preventDefault(); tapCb.current?.(); }}
      onMouseDown={(e) => e.stopPropagation()}
      title={title}
      aria-hidden
      style={{ display: "inline-flex", width: 14, height: 14, alignItems: "center", justifyContent: "center", cursor: "default" }}
    >
      <span style={{ display: "inline-block", width: 3, height: 3, borderRadius: "50%", background: "#000" }} />
    </span>
  );
}
