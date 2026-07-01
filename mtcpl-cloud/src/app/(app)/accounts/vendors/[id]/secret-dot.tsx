"use client";

/**
 * SecretDot (Daksh) — the tiny black dot that gates the private royalty data.
 * It no longer reveals on a plain click; you must HOVER it and type the secret
 * code ("aadesh"), or LONG-PRESS it on a touch device (so the floor tablets can
 * still reach it). Calls onUnlock when the code matches. Nothing on screen hints
 * that it's interactive.
 */

import { useEffect, useRef } from "react";

export function SecretDot({ code = "aadesh", onUnlock, title }: { code?: string; onUnlock: () => void; title?: string }) {
  const hovering = useRef(false);
  const buf = useRef("");
  const lastTs = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cb = useRef(onUnlock);
  cb.current = onUnlock;

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

  function clearPress() { if (timer.current) { clearTimeout(timer.current); timer.current = null; } }

  return (
    <span
      onMouseEnter={() => { hovering.current = true; }}
      onMouseLeave={() => { hovering.current = false; buf.current = ""; }}
      onTouchStart={() => { clearPress(); timer.current = setTimeout(() => cb.current(), 800); }}
      onTouchEnd={clearPress}
      onTouchMove={clearPress}
      onTouchCancel={clearPress}
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
