"use client";

/**
 * Secret entry to the personal ledger (mig 174 — Daksh, private).
 *
 * No button, no menu item. You must HOVER a specific spot and TYPE a code, then
 * pass a password. Two spots (marked elsewhere with data-secret-spot):
 *   • "owner"  — the MTCPL-AI "+ New chat" button.  code: "home"
 *   • "office" — the Maintenance page heading.        code: "office"
 * Either one, after the password, opens /ledger (which is itself role-gated).
 *
 * Mounted in the app shell ONLY for users who have ledger access, so the
 * listener doesn't even exist for anyone else. The password is a soft second
 * gate — the real authorization is the server-side role check on /ledger.
 */

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

const SPOT_CODE: Record<string, string> = { owner: "home", office: "office" };
const PASSWORD = "125500";

export function LedgerSecretTrigger() {
  const router = useRouter();
  const hovered = useRef<string | null>(null);
  const buf = useRef("");
  const lastTs = useRef(0);
  const openedAt = useRef(0);
  const [ask, setAsk] = useState(false);
  const [pwd, setPwd] = useState("");
  const [err, setErr] = useState(false);

  useEffect(() => {
    function open() {
      openedAt.current = Date.now();
      buf.current = "";
      setPwd("");
      setErr(false);
      setAsk(true);
    }
    function spotOf(target: EventTarget | null): string | null {
      const t = target as HTMLElement | null;
      const el = t && typeof t.closest === "function" ? t.closest("[data-secret-spot]") : null;
      return el ? el.getAttribute("data-secret-spot") : null;
    }
    // Desktop: hover a spot…
    function onOver(e: MouseEvent) { hovered.current = spotOf(e.target); }
    // …then type the spot's code (ignored while a field is focused).
    function onKey(e: KeyboardEvent) {
      const code = hovered.current ? SPOT_CODE[hovered.current] : undefined;
      if (!code) return;
      if (e.key.length !== 1 || e.ctrlKey || e.metaKey || e.altKey) return;
      const el = document.activeElement as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
      const now = Date.now();
      if (now - lastTs.current > 1500) buf.current = "";
      lastTs.current = now;
      buf.current = (buf.current + e.key.toLowerCase()).slice(-16);
      if (buf.current.endsWith(code)) open();
    }
    // Touch (floor tablets have no hardware keyboard): LONG-PRESS a spot.
    let pressTimer: ReturnType<typeof setTimeout> | null = null;
    function clearPress() { if (pressTimer != null) { clearTimeout(pressTimer); pressTimer = null; } }
    function onTouchStart(e: TouchEvent) {
      if (!spotOf(e.target)) return;
      clearPress();
      pressTimer = setTimeout(open, 900);
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
  }, []);

  if (!ask) return null;

  return (
    <div
      onClick={() => { if (Date.now() - openedAt.current > 500) setAsk(false); }}
      style={{ position: "fixed", inset: 0, zIndex: 5000, background: "rgba(15,23,42,0.6)", backdropFilter: "blur(3px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}
    >
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          if (pwd === PASSWORD) { setAsk(false); router.push("/ledger"); }
          else setErr(true);
        }}
        style={{ width: "min(320px, 100%)", background: "var(--surface, #fff)", borderRadius: 14, padding: 20, boxShadow: "0 24px 60px rgba(0,0,0,0.35)" }}
      >
        <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 10, color: "var(--text)" }}>🔒 Enter password</div>
        <input
          autoFocus
          type="password"
          inputMode="numeric"
          value={pwd}
          onChange={(e) => { setPwd(e.target.value); setErr(false); }}
          style={{ width: "100%", padding: "11px 12px", borderRadius: 9, border: `1px solid ${err ? "#dc2626" : "var(--border)"}`, background: "var(--bg)", color: "var(--text)", fontSize: 18, letterSpacing: "0.25em", textAlign: "center" }}
        />
        {err && <div style={{ fontSize: 12, color: "#dc2626", marginTop: 6, fontWeight: 700 }}>Wrong password</div>}
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 14 }}>
          <button type="button" onClick={() => setAsk(false)} style={{ fontSize: 13, fontWeight: 700, padding: "9px 14px", borderRadius: 9, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)", cursor: "pointer" }}>Cancel</button>
          <button type="submit" style={{ fontSize: 13, fontWeight: 800, padding: "9px 18px", borderRadius: 9, border: "none", background: "#0f172a", color: "#fff", cursor: "pointer" }}>Open</button>
        </div>
      </form>
    </div>
  );
}
