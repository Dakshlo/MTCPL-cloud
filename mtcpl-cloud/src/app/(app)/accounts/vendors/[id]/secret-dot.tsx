"use client";

/**
 * SecretDot (Daksh) — the tiny black dot that gates private royalty data.
 *
 * DESKTOP: hover the dot and type the secret code ("aadesh").
 *
 * TABLET: only the royalty-PROGRAM dot is reachable, and via a TAP PATTERN —
 * tap twice just ABOVE the dot, then twice just BELOW it (passive listener, so
 * it never blocks other taps). The net-reveal dots pass touchPattern={false},
 * so they have NO touch access at all (not needed on the floor tablets).
 *
 * A plain click never opens anything.
 */

import { useEffect, useRef } from "react";

export function SecretDot({
  code = "aadesh",
  onUnlock,
  title,
  touchPattern = false,
}: {
  code?: string;
  onUnlock: () => void;
  title?: string;
  /** Enable the tablet tap-pattern (above×2, below×2). Off = desktop-only. */
  touchPattern?: boolean;
}) {
  const hovering = useRef(false);
  const buf = useRef("");
  const lastTs = useRef(0);
  const dotRef = useRef<HTMLSpanElement>(null);
  const seq = useRef<Array<"above" | "below">>([]);
  const seqTs = useRef(0);
  const cb = useRef(onUnlock);
  cb.current = onUnlock;

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

  // Tablet — tap pattern: 2 taps above the dot, then 2 below. Passive listener
  // (never preventDefault), so it just observes taps near the dot.
  useEffect(() => {
    if (!touchPattern) return;
    function onTouch(e: TouchEvent) {
      const dot = dotRef.current;
      const t = e.changedTouches[0];
      if (!dot || !t) return;
      const r = dot.getBoundingClientRect();
      const dx = t.clientX - (r.left + r.width / 2);
      const dy = t.clientY - (r.top + r.height / 2);
      if (Math.abs(dx) > 80) return; // not roughly over the dot
      let zone: "above" | "below" | null = null;
      if (dy <= -8 && dy >= -90) zone = "above";
      else if (dy >= 8 && dy <= 90) zone = "below";
      if (!zone) return;
      const now = Date.now();
      if (now - seqTs.current > 3000) seq.current = [];
      seqTs.current = now;
      seq.current.push(zone);
      if (seq.current.length > 4) seq.current = seq.current.slice(-4);
      if (seq.current.join(",") === "above,above,below,below") {
        seq.current = [];
        cb.current();
      }
    }
    document.addEventListener("touchstart", onTouch, { passive: true });
    return () => document.removeEventListener("touchstart", onTouch);
  }, [touchPattern]);

  return (
    <span
      ref={dotRef}
      onMouseEnter={() => { hovering.current = true; }}
      onMouseLeave={() => { hovering.current = false; buf.current = ""; }}
      // Swallow clicks so a stray tap doesn't toggle a parent <summary>/row.
      onClick={(e) => { e.stopPropagation(); e.preventDefault(); }}
      onMouseDown={(e) => e.stopPropagation()}
      title={title}
      aria-hidden
      style={{ display: "inline-flex", width: 14, height: 14, alignItems: "center", justifyContent: "center", cursor: "default" }}
    >
      <span style={{ display: "inline-block", width: 3, height: 3, borderRadius: "50%", background: "#000" }} />
    </span>
  );
}
