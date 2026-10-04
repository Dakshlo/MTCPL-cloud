"use client";

/**
 * Pieces shared by the two tool-store screens (master and vendor).
 *
 * Kept in one module rather than duplicated, because the undo toast and
 * the stock colours are the two things that MUST behave identically on
 * both — a vendor and the owner looking at the same tool should never
 * see a different colour or a different undo window.
 */

import { useRef, useState } from "react";

import { UNDO_WINDOW_MS, type ToolMovement } from "@/lib/cnc-tool-stock";

export type Done = { text: string; at: number };

// ── Undo toast ─────────────────────────────────────────────────────

/**
 * The replacement for an approval queue.
 *
 * Counts down the real window from lib/cnc-tool-stock. The undo itself
 * is re-checked on the SERVER — this is a convenience, not a
 * permission, and it has been tested by backdating a row so the button
 * was still showing when the server refused.
 */
export function UndoToast({
  done, movements, onUndo, onDismiss,
}: {
  done: Done;
  movements: ToolMovement[];
  onUndo: (movementId: string) => void;
  onDismiss: () => void;
}) {
  const [, force] = useState(0);
  const timer = useRef<number | null>(null);
  if (timer.current == null && typeof window !== "undefined") {
    timer.current = window.setInterval(() => force((n) => n + 1), 1000);
  }
  const left = Math.max(0, UNDO_WINDOW_MS - (Date.now() - done.at));
  if (left <= 0 && timer.current) { clearInterval(timer.current); timer.current = null; }

  // The freshest live movement is the one just written; the server
  // refresh hands it back with its real id.
  const latest = movements.find((m) => !m.undone_at) ?? null;
  const canUndoNow = left > 0 && latest != null;
  const mm = Math.floor(left / 60000);
  const ss = Math.floor((left % 60000) / 1000);

  return (
    <div className="tc-toast" role="status">
      <span className="tc-toast-tick">✓</span>
      <span className="tc-toast-text">{done.text}</span>
      {canUndoNow ? (
        <button type="button" className="tc-toast-undo" onClick={() => onUndo(latest.id)}>
          Undo <span>{mm}:{String(ss).padStart(2, "0")}</span>
        </button>
      ) : (
        <button type="button" className="tc-toast-close" onClick={onDismiss} aria-label="Dismiss">✕</button>
      )}
    </div>
  );
}

// ── Formatting ─────────────────────────────────────────────────────

export function describe(m: ToolMovement): string {
  if (m.kind === "issue") return `${m.taken_by ?? "Someone"} took ${Math.abs(m.delta)}`;
  if (m.kind === "return") return `${m.taken_by ?? "Someone"} returned ${m.delta}`;
  if (m.kind === "receive") return `Added ${m.delta}`;
  if (m.kind === "scrap") return `Scrapped ${Math.abs(m.delta)}`;
  return `Count fixed by ${m.delta > 0 ? "+" : ""}${m.delta}`;
}

export function ago(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return d === 1 ? "yesterday" : `${d}d ago`;
}

// ── Styles ─────────────────────────────────────────────────────────

export const TOOLS_CSS = `
.tc-page { --tc-ok: var(--success); --tc-low: var(--warning); --tc-out: var(--danger); }

.tc-head { display:flex; align-items:flex-start; gap:14px; flex-wrap:wrap; margin-bottom:14px; }
.tc-eyebrow { font-size:11px; font-weight:800; letter-spacing:.09em; text-transform:uppercase; color:var(--muted); }
.tc-title { font-size:30px; font-weight:800; letter-spacing:-.025em; margin:2px 0 0; color:var(--text); }
.tc-sub { font-size:13px; color:var(--muted); margin-top:3px; }
.tc-add {
  margin-left:auto; padding:12px 20px; font-size:14px; font-weight:800; border-radius:12px;
  border:none; color:#fff; cursor:pointer; white-space:nowrap;
  background:linear-gradient(135deg, var(--gold) 0%, var(--gold-dark) 100%);
  box-shadow:0 4px 14px rgba(166,123,40,.28);
}

.tc-vendors { display:flex; gap:8px; flex-wrap:wrap; margin-bottom:16px; align-items:center; }
.tc-vendors-label { font-size:11px; font-weight:800; letter-spacing:.07em; text-transform:uppercase; color:var(--muted); margin-right:2px; }
.tc-vendor {
  display:inline-flex; align-items:center; gap:7px;
  padding:9px 16px; font-size:13.5px; font-weight:700; border-radius:999px; text-decoration:none;
  border:1.5px solid var(--border); background:var(--surface); color:var(--text);
}
.tc-vendor i { font-style:normal; font-size:11.5px; font-weight:800; color:var(--gold-dark); background:var(--gold-subtle); padding:2px 7px; border-radius:999px; }
.tc-vendor.on { border-color:var(--gold-dark); background:var(--gold); color:#fff; }

.tc-err { display:flex; gap:12px; align-items:center; justify-content:space-between;
  padding:12px 16px; border-radius:11px; margin-bottom:14px; font-size:13.5px; font-weight:700;
  background:var(--danger-bg); color:var(--danger); }
.tc-err button { border:none; background:none; color:inherit; cursor:pointer; font-size:14px; }

.tc-short { border:1px solid var(--danger); border-left-width:4px; border-radius:13px;
  background:var(--danger-bg); padding:13px 16px; margin-bottom:16px; }
.tc-short-head { display:flex; align-items:center; gap:9px; font-size:13.5px; font-weight:800; color:var(--danger); }
.tc-short-dot { width:9px; height:9px; border-radius:50%; background:var(--danger); animation:tc-pulse 1.9s ease-in-out infinite; }
@keyframes tc-pulse { 0%,100%{opacity:1} 50%{opacity:.35} }
.tc-short-list { display:flex; flex-wrap:wrap; gap:8px; margin-top:10px; align-items:center; }
.tc-short-pill { display:flex; align-items:baseline; gap:7px; padding:7px 13px; border-radius:999px; cursor:pointer;
  border:1px solid var(--border); background:var(--surface); font-size:12.5px; color:var(--text); }
.tc-short-pill strong { font-weight:800; }
.tc-short-pill span { color:var(--muted); }
.tc-short-pill[data-out] span { color:var(--danger); font-weight:700; }
.tc-short-more { font-size:12px; color:var(--danger); font-weight:700; }

.tc-tabs { display:inline-flex; gap:4px; padding:4px; border-radius:12px; background:var(--bg);
  border:1px solid var(--border); margin-bottom:16px; }
.tc-tabs button { display:inline-flex; align-items:center; gap:7px; padding:9px 18px; font-size:13.5px; font-weight:800;
  border:none; border-radius:9px; background:transparent; color:var(--muted); cursor:pointer; }
.tc-tabs button.on { background:var(--gold); color:#fff; }
.tc-tabs i { font-style:normal; font-size:11px; opacity:.8; }

.tc-search { display:flex; align-items:center; gap:10px; padding:0 14px; margin-bottom:16px;
  border:1px solid var(--border); border-radius:13px; background:var(--surface); }
.tc-search input { flex:1; border:none; background:transparent; outline:none; color:var(--text); font-size:15px; padding:14px 0; }
.tc-search button { border:none; background:none; color:var(--muted); cursor:pointer; font-size:13px; }

.tc-grid { display:grid; grid-template-columns:repeat(auto-fill, minmax(260px, 1fr)); gap:14px; }

.tc-card { border:1px solid var(--border); border-radius:16px; background:var(--surface);
  padding:16px 17px 14px; display:flex; flex-direction:column;
  transition:transform .12s ease, box-shadow .12s ease, border-color .12s ease; position:relative; }
@media (hover:hover) { .tc-card:hover { transform:translateY(-2px); box-shadow:0 10px 26px rgba(45,36,16,.1); } }
.tc-card[data-level="low"] { border-color:var(--warning); }
.tc-card[data-level="out"] { border-color:var(--danger); background:linear-gradient(180deg, var(--danger-bg) 0%, var(--surface) 42%); }

.tc-card-top { display:flex; gap:10px; align-items:flex-start; }
.tc-name { font-size:15.5px; font-weight:800; color:var(--text); margin:0; line-height:1.25; overflow-wrap:anywhere; }
.tc-spec { font-size:12px; color:var(--muted); margin-top:2px; }
.tc-dots { width:30px; height:30px; border-radius:9px; border:1px solid var(--border); background:var(--surface-alt); color:var(--muted); cursor:pointer; font-size:15px; line-height:1; }

.tc-menu-scrim { position:fixed; inset:0; z-index:40; }
.tc-menu { position:absolute; right:0; top:34px; z-index:41; min-width:186px; padding:6px;
  background:var(--surface); border:1px solid var(--border); border-radius:12px; box-shadow:0 14px 34px rgba(0,0,0,.2); }
.tc-menu button { display:block; width:100%; text-align:left; padding:10px 12px; font-size:13.5px; font-weight:600;
  border:none; background:none; color:var(--text); cursor:pointer; border-radius:8px; }
.tc-menu button:hover { background:var(--surface-alt); }
.tc-menu-sep { height:1px; background:var(--border-light); margin:5px 0; }

.tc-stock { display:flex; align-items:baseline; gap:7px; margin:14px 0 0; }
.tc-stock-n { font-size:42px; font-weight:800; letter-spacing:-.035em; line-height:1; font-family:ui-monospace, monospace; color:var(--tc-ok); }
.tc-card[data-level="low"] .tc-stock-n { color:var(--tc-low); }
.tc-card[data-level="out"] .tc-stock-n { color:var(--tc-out); }
.tc-stock-u { font-size:13px; font-weight:700; color:var(--muted); }

.tc-bar { height:5px; border-radius:3px; background:var(--border-light); margin:11px 0 10px; overflow:hidden; }
.tc-bar i { display:block; height:100%; border-radius:3px; background:var(--tc-ok); transition:width .25s ease; }
.tc-card[data-level="low"] .tc-bar i { background:var(--tc-low); }
.tc-card[data-level="out"] .tc-bar i { background:var(--tc-out); }

.tc-last { font-size:12px; color:var(--muted); min-height:17px; line-height:1.4; }
.tc-flag { font-weight:700; }
.tc-card[data-level="low"] .tc-flag { color:var(--warning); }
.tc-card[data-level="out"] .tc-flag { color:var(--danger); }

.tc-actions { display:flex; gap:8px; margin-top:13px; }
.tc-take { flex:1; padding:12px 14px; font-size:14px; font-weight:800; border-radius:11px; border:none;
  cursor:pointer; color:#fff; background:linear-gradient(135deg, var(--gold) 0%, var(--gold-dark) 100%); }
.tc-take:disabled { background:var(--border); color:var(--muted); cursor:not-allowed; }
.tc-take-link { flex:1; text-align:center; padding:12px 14px; font-size:13px; font-weight:700; border-radius:11px;
  text-decoration:none; border:1px solid var(--border); background:var(--surface); color:var(--muted); }

.tc-reg { border:1px solid var(--border); border-radius:14px; background:var(--surface); overflow:hidden; }
.tc-reg-row { display:flex; align-items:center; gap:14px; padding:13px 16px; border-top:1px solid var(--border-light); }
.tc-reg-row:first-child { border-top:none; }
.tc-reg-row[data-void] { opacity:.5; background:var(--surface-alt); }
.tc-reg-row[data-void] .tc-reg-title, .tc-reg-row[data-void] .tc-reg-delta { text-decoration:line-through; }
.tc-reg-delta { width:54px; text-align:right; flex:0 0 auto; font-size:17px; font-weight:800;
  font-family:ui-monospace, monospace; color:var(--danger); }
.tc-reg-delta[data-up] { color:var(--success); }
.tc-reg-main { flex:1; min-width:0; }
.tc-reg-title { font-size:13.5px; font-weight:700; color:var(--text); }
.tc-reg-kind { font-weight:600; color:var(--muted); }
.tc-reg-sub { font-size:11.5px; color:var(--muted); margin-top:2px; line-height:1.45; }

.tc-empty { text-align:center; padding:52px 24px; border:1px dashed var(--border); border-radius:16px; background:var(--surface); }
.tc-empty-icon { font-size:46px; }
.tc-empty h2 { font-size:19px; font-weight:800; margin:12px 0 8px; color:var(--text); }
.tc-empty p { font-size:14px; color:var(--muted); max-width:460px; margin:0 auto; line-height:1.6; }
.tc-empty button { margin-top:20px; padding:13px 24px; font-size:14.5px; font-weight:800; border-radius:12px; border:none;
  color:#fff; cursor:pointer; background:linear-gradient(135deg, var(--gold) 0%, var(--gold-dark) 100%); }
.tc-empty-search { padding:36px; text-align:center; color:var(--muted); font-size:14px; }

.tc-toast { position:fixed; left:50%; transform:translateX(-50%);
  bottom:calc(18px + env(safe-area-inset-bottom, 0px)); z-index:1100;
  display:flex; align-items:center; gap:12px; max-width:min(540px, calc(100vw - 24px));
  padding:12px 14px 12px 16px; border-radius:14px; background:#1b1710; color:#fff;
  box-shadow:0 14px 40px rgba(0,0,0,.4); animation:tc-rise .22s ease-out; }
@keyframes tc-rise { from { opacity:0; transform:translate(-50%, 14px); } to { opacity:1; transform:translate(-50%, 0); } }
.tc-toast-tick { color:#4ade80; font-weight:800; }
.tc-toast-text { font-size:13.5px; font-weight:600; flex:1; min-width:0; }
.tc-toast-undo { display:flex; align-items:center; gap:7px; padding:9px 15px; border-radius:10px; cursor:pointer;
  border:1px solid rgba(255,255,255,.26); background:rgba(255,255,255,.1); color:#fff; font-size:13px; font-weight:800; white-space:nowrap; }
.tc-toast-undo span { font-family:ui-monospace, monospace; font-weight:600; opacity:.7; font-size:12px; }
.tc-toast-close { border:none; background:none; color:rgba(255,255,255,.6); cursor:pointer; font-size:14px; }

/* ── Vendor screen ─────────────────────────────────────────────── */
.tcv-take {
  display:flex; align-items:center; justify-content:center; gap:12px; width:100%;
  padding:26px 20px; margin-bottom:22px; font-size:21px; font-weight:800; letter-spacing:-.01em;
  border:none; border-radius:18px; color:#fff; cursor:pointer;
  background:linear-gradient(135deg, var(--gold) 0%, var(--gold-dark) 100%);
  box-shadow:0 10px 26px rgba(166,123,40,.34);
}
.tcv-take:active { transform:translateY(1px); }
.tcv-sec { font-size:11px; font-weight:800; letter-spacing:.08em; text-transform:uppercase; color:var(--muted); margin:0 0 10px; }
.tcv-list { border:1px solid var(--border); border-radius:14px; background:var(--surface); overflow:hidden; }
.tcv-row { display:flex; align-items:center; gap:14px; padding:15px 16px; border-top:1px solid var(--border-light); }
.tcv-row:first-child { border-top:none; }
.tcv-row[data-void] { opacity:.5; }
.tcv-row[data-void] .tcv-name { text-decoration:line-through; }
.tcv-qty { flex:0 0 auto; min-width:46px; height:46px; border-radius:13px; display:grid; place-items:center;
  font-size:19px; font-weight:800; font-family:ui-monospace, monospace;
  background:var(--gold-subtle); color:var(--gold-dark); }
.tcv-row[data-kind="return"] .tcv-qty { background:var(--success-bg); color:var(--success); }
.tcv-main { flex:1; min-width:0; }
.tcv-name { font-size:15px; font-weight:800; color:var(--text); }
.tcv-meta { font-size:12px; color:var(--muted); margin-top:2px; line-height:1.45; }
.tcv-stock-link { display:flex; align-items:center; justify-content:center; gap:9px; width:100%;
  margin-top:20px; padding:15px 18px; font-size:14px; font-weight:700; border-radius:13px; text-decoration:none;
  border:1px solid var(--border); background:var(--surface); color:var(--muted); }

@media (max-width:560px) {
  .tc-title { font-size:25px; }
  .tc-add { margin-left:0; width:100%; }
  .tc-grid { grid-template-columns:1fr; }
}
`;
