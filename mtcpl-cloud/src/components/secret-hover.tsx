"use client";

/**
 * SecretHover (Daksh, Aug 2026) — hover anything, type the code, go.
 *
 * Same gesture as SecretDot (accounts/vendors/[id]/secret-dot.tsx), but
 * wrapped around real content instead of a 3px dot: put it around a word
 * that is already on the page and the door leaves no mark at all. Used
 * on "Royalty" in the Royalty Summary heading to reach the by-vendor
 * browser, which used to be an obvious card anyone could see.
 *
 * The logic is deliberately duplicated rather than shared with
 * SecretDot: that dot is the only way into vendor private data, and it
 * is not worth risking a working lock to save twenty lines. If a third
 * caller ever appears, merge them then.
 *
 * Typing is ignored while an input/textarea has focus, so the code can
 * never be swallowed — or triggered — by someone filling a form.
 */

import { useEffect, useRef, type ReactNode } from "react";

export function SecretHover({
  code = "aadesh",
  onUnlock,
  children,
  style,
}: {
  code?: string;
  onUnlock: () => void;
  children: ReactNode;
  style?: React.CSSProperties;
}) {
  const hovering = useRef(false);
  const buf = useRef("");
  const lastTs = useRef(0);
  const cb = useRef(onUnlock);
  cb.current = onUnlock;

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!hovering.current) return;
      if (e.key.length !== 1 || e.ctrlKey || e.metaKey || e.altKey) return;
      const el = document.activeElement as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
      const now = Date.now();
      // Letters more than 1.5s apart start a new attempt, so ordinary
      // typing near the word can't accumulate into the code by accident.
      if (now - lastTs.current > 1500) buf.current = "";
      lastTs.current = now;
      buf.current = (buf.current + e.key.toLowerCase()).slice(-16);
      if (buf.current.endsWith(code)) {
        buf.current = "";
        cb.current();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [code]);

  return (
    <span
      onMouseEnter={() => { hovering.current = true; }}
      onMouseLeave={() => { hovering.current = false; buf.current = ""; }}
      // No pointer change, no underline, no title — it has to look like
      // the text it is wrapping, or it isn't hidden.
      style={style}
    >
      {children}
    </span>
  );
}
