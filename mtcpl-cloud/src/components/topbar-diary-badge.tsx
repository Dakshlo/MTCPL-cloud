"use client";

// Topbar "Work Diary" pill (mig 185) — sits next to the Tasks pill for EVERY
// user. Badge = your open register entries (created by you or you're included).
// Click → small dropdown of your open items (most urgent first, overdue red),
// each deep-links to /diary?open=<id>; footer opens the full diary / new entry.

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

export type DiaryBadgeItem = { id: string; activity: string; due: string; overdue: boolean };

const fmtDue = (d: string) => (d ? new Date(`${d.slice(0, 10)}T00:00:00+05:30`).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short" }) : "—");

export function TopbarDiaryBadge({ count, items }: { count: number; items: DiaryBadgeItem[] }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const hasOverdue = items.some((it) => it.overdue);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (wrapRef.current && e.target instanceof Node && wrapRef.current.contains(e.target)) return;
      setOpen(false);
    }
    function onEsc(e: KeyboardEvent) { if (e.key === "Escape") setOpen(false); }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onEsc);
    return () => { document.removeEventListener("mousedown", onDocClick); document.removeEventListener("keydown", onEsc); };
  }, [open]);

  return (
    <div ref={wrapRef} style={{ position: "relative", display: "inline-block" }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        title={count ? `${count} open in your Work Diary` : "Work Diary"}
        aria-expanded={open}
        style={{
          display: "inline-flex", alignItems: "center", gap: 7, padding: "5px 12px 5px 10px",
          background: "var(--bg)", color: "var(--text)", border: "1px solid var(--border)",
          borderRadius: 999, cursor: "pointer", fontSize: 12, fontWeight: 700, whiteSpace: "nowrap", position: "relative",
        }}
      >
        <span aria-hidden style={{ fontSize: 14, lineHeight: 1 }}>📒</span>
        <span>Work Diary</span>
        <span style={{ fontSize: 11, fontFamily: "ui-monospace, monospace", fontWeight: 800, padding: "1px 8px", borderRadius: 999, background: count ? "var(--gold)" : "var(--border)", color: count ? "#fff" : "var(--muted)", minWidth: 18, textAlign: "center" }}>{count}</span>
        {hasOverdue && <span aria-hidden style={{ position: "absolute", top: -3, right: -3, width: 9, height: 9, borderRadius: "50%", background: "#dc2626", border: "1.5px solid var(--surface, #fff)" }} />}
      </button>

      {open && (
        <div style={{
          position: "absolute", top: "calc(100% + 8px)", right: 0, minWidth: 300, maxWidth: 340, padding: 8,
          background: "rgba(255,255,255,0.82)", backdropFilter: "blur(22px) saturate(180%)", WebkitBackdropFilter: "blur(22px) saturate(180%)",
          border: "1px solid rgba(255,255,255,0.55)", borderRadius: 14, zIndex: 200,
          boxShadow: "0 12px 40px rgba(15,23,42,0.18), 0 0 0 1px rgba(15,23,42,0.04)",
          maxHeight: "calc(100vh - 84px)", overflowY: "auto", overscrollBehavior: "contain",
        }}>
          <div style={{ padding: "8px 12px 6px", fontSize: 10, fontWeight: 800, color: "rgba(15,23,42,0.55)", textTransform: "uppercase", letterSpacing: "0.1em", display: "flex", justifyContent: "space-between" }}>
            <span>Your open work</span>
            <span style={{ fontFamily: "ui-monospace, monospace", color: count ? "var(--gold-dark)" : "rgba(15,23,42,0.45)" }}>{count}</span>
          </div>
          {items.length === 0 ? (
            <div style={{ padding: "12px 12px 14px", fontSize: 12.5, color: "rgba(15,23,42,0.55)" }}>Nothing open — all clear. ✅</div>
          ) : (
            items.map((it) => (
              <Link key={it.id} href={`/diary?open=${it.id}`} onClick={() => setOpen(false)} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", borderRadius: 10, textDecoration: "none", color: "var(--text)" }}
                onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(201,161,74,0.10)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
              >
                <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.activity}</span>
                <span style={{ flexShrink: 0, fontSize: 10.5, fontWeight: 800, fontFamily: "ui-monospace, monospace", color: it.overdue ? "#b91c1c" : "rgba(15,23,42,0.55)" }}>{it.overdue ? "⚠ " : ""}{fmtDue(it.due)}</span>
              </Link>
            ))
          )}
          <div style={{ display: "flex", gap: 6, padding: "8px 6px 4px", borderTop: "1px solid rgba(15,23,42,0.08)", marginTop: 4 }}>
            <Link href="/diary" onClick={() => setOpen(false)} style={{ flex: 1, textAlign: "center", fontSize: 12, fontWeight: 800, padding: "8px 10px", borderRadius: 9, textDecoration: "none", color: "var(--text)", background: "rgba(15,23,42,0.06)" }}>Open Work Diary →</Link>
            <Link href="/diary?new=1" onClick={() => setOpen(false)} style={{ flex: 1, textAlign: "center", fontSize: 12, fontWeight: 800, padding: "8px 10px", borderRadius: 9, textDecoration: "none", color: "#fff", background: "var(--gold-dark)" }}>＋ New entry</Link>
          </div>
        </div>
      )}
    </div>
  );
}
