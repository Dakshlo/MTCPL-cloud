"use client";

/**
 * The keeper screen's undo toast, its date words, and its styles.
 *
 * Oct 2026 — the palette is doing a job, not decorating. Daksh: "make
 * UI really colourful, this way it's good to use." A shelf is read at a
 * glance from a few feet away, so the level is a COLOUR first (green
 * plenty / amber low / red empty) and a number second, and the same
 * three colours mean the same three things on the cupboard QR.
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
.tc-page {
  --tc-ok:#16a34a; --tc-ok-bg:rgba(22,163,74,.10);
  --tc-low:#d97706; --tc-low-bg:rgba(217,119,6,.12);
  --tc-out:#dc2626; --tc-out-bg:rgba(220,38,38,.10);
  --tc-blue:#4f46e5;
}

/* ── hero ──────────────────────────────────────────────────── */
.tc-hero {
  background:linear-gradient(135deg,#f59e0b 0%,#ea580c 55%,#db2777 100%);
  border-radius:22px; padding:20px 22px 18px; margin-bottom:16px; color:#fff;
  box-shadow:0 10px 30px rgba(234,88,12,.26);
}
.tc-hero-row { display:flex; align-items:center; gap:16px; flex-wrap:wrap; }
.tc-hero-id { display:flex; align-items:center; gap:13px; min-width:0; }
.tc-hero-icon { width:48px; height:48px; flex:0 0 auto; border-radius:16px; font-size:24px;
  display:grid; place-items:center; background:rgba(255,255,255,.2); }
.tc-eyebrow { font-size:11px; font-weight:800; letter-spacing:.1em;
  text-transform:uppercase; color:rgba(255,255,255,.78); }
.tc-title { font-size:28px; font-weight:800; letter-spacing:-.025em; margin:1px 0 0; color:#fff; }
.tc-hero-actions { margin-left:auto; display:flex; gap:9px; flex-wrap:wrap; }
.tc-btn { display:inline-flex; align-items:center; gap:7px; padding:11px 17px; font-size:13.5px;
  font-weight:800; border-radius:13px; text-decoration:none; white-space:nowrap; cursor:pointer;
  border:none; font-family:inherit; }
.tc-btn-ghost { background:rgba(255,255,255,.18); color:#fff; }
.tc-btn-ghost:hover { background:rgba(255,255,255,.28); }
.tc-btn-solid { background:#fff; color:#c2410c; box-shadow:0 4px 14px rgba(0,0,0,.14); }
.tc-btn-solid:hover { transform:translateY(-1px); }

.tc-stats { display:grid; grid-template-columns:repeat(3,1fr); gap:10px; margin-top:16px; }
.tc-stat { border-radius:15px; padding:12px 14px; background:rgba(255,255,255,.16);
  border:1px solid rgba(255,255,255,.22); }
.tc-stat b { display:block; font-size:26px; font-weight:800; line-height:1.05; }
.tc-stat span { display:block; font-size:11px; font-weight:700; letter-spacing:.04em;
  text-transform:uppercase; color:rgba(255,255,255,.82); margin-top:3px; }
.tc-stat[data-tone="red"]   { background:rgba(127,29,29,.42); border-color:rgba(255,255,255,.4); }
.tc-stat[data-tone="amber"] { background:rgba(180,83,9,.34); }
.tc-stat[data-tone="grey"]  { background:rgba(255,255,255,.1); }

/* ── how it works ──────────────────────────────────────────── */
.tc-how { display:grid; grid-template-columns:repeat(3,1fr); gap:10px; margin-bottom:18px; }
.tc-how-step { position:relative; min-width:0; padding:13px 15px 13px 42px; border-radius:15px;
  background:var(--surface); border:1px solid var(--border); }
.tc-how-step::before { content:attr(data-n); position:absolute; left:13px; top:13px;
  width:21px; height:21px; border-radius:50%; display:grid; place-items:center;
  font-size:11px; font-weight:800; color:#fff; background:var(--tc-blue); }
.tc-how-step:nth-child(2)::before { background:#0891b2; }
.tc-how-step:nth-child(3)::before { background:var(--tc-ok); }
.tc-how-step strong { display:block; font-size:13.5px; font-weight:800; color:var(--text); }
.tc-how-step span { display:block; font-size:12px; color:var(--muted); line-height:1.5; margin-top:2px; }

/* ── messages ──────────────────────────────────────────────── */
.tc-err { display:flex; gap:12px; align-items:center; justify-content:space-between;
  padding:12px 16px; border-radius:12px; margin-bottom:14px; font-size:13.5px; font-weight:700;
  background:var(--tc-out-bg); color:var(--tc-out); border:1px solid rgba(220,38,38,.3); }
.tc-err button { border:none; background:none; color:inherit; cursor:pointer; font-size:14px; }

.tc-short { border:1px solid rgba(217,119,6,.35); border-left:5px solid var(--tc-low);
  border-radius:15px; background:var(--tc-low-bg); padding:13px 16px; margin-bottom:16px; }
.tc-short-head { display:flex; align-items:center; gap:9px; font-size:13.5px; font-weight:800;
  color:var(--tc-low); }
.tc-short-dot { width:9px; height:9px; border-radius:50%; background:var(--tc-low);
  box-shadow:0 0 0 4px rgba(217,119,6,.2); }
.tc-short-list { display:flex; gap:8px; flex-wrap:wrap; margin-top:11px; align-items:center; }
.tc-short-pill { display:inline-flex; align-items:baseline; gap:7px; padding:7px 13px;
  border-radius:999px; cursor:pointer; font:inherit; background:var(--surface);
  border:1.5px solid rgba(217,119,6,.45); color:var(--text); }
.tc-short-pill strong { font-size:12.5px; font-weight:800; }
.tc-short-pill span { font-size:11px; font-weight:700; color:var(--tc-low); }
.tc-short-pill[data-out] { border-color:var(--tc-out); }
.tc-short-pill[data-out] span { color:var(--tc-out); }
.tc-short-more { font-size:12px; font-weight:700; color:var(--muted); }

/* ── tabs + search ─────────────────────────────────────────── */
.tc-tabs { display:inline-flex; gap:4px; padding:4px; border-radius:14px;
  background:var(--surface-alt); border:1px solid var(--border); margin-bottom:14px; }
.tc-tabs button { padding:9px 18px; font-size:13.5px; font-weight:800; border-radius:11px;
  border:none; background:none; color:var(--muted); cursor:pointer; font-family:inherit; }
.tc-tabs button.on { background:linear-gradient(135deg,#f59e0b,#ea580c); color:#fff;
  box-shadow:0 3px 10px rgba(234,88,12,.3); }
.tc-tabs i { font-style:normal; font-size:11px; font-weight:800; margin-left:6px; opacity:.85; }

.tc-search { display:flex; align-items:center; gap:10px; padding:0 15px; margin-bottom:15px;
  background:var(--surface); border:1.5px solid var(--border); border-radius:14px; }
.tc-search input { flex:1; min-width:0; border:none; outline:none; background:none;
  font:inherit; font-size:14.5px; padding:13px 0; color:var(--text); }
.tc-search button { background:none; border:none; color:var(--muted); cursor:pointer; font-size:14px; }

.tc-filter { display:inline-flex; gap:6px; align-items:center; margin-bottom:12px;
  padding:8px 14px; border-radius:999px; font:inherit; font-size:12.5px; font-weight:800;
  cursor:pointer; background:var(--gold-subtle); color:var(--gold-dark);
  border:1.5px solid var(--gold); }
.tc-filter span { font-weight:700; opacity:.8; }

/* ── tool cards ────────────────────────────────────────────── */
.tc-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(248px,1fr)); gap:14px; }
.tc-card { position:relative; display:flex; flex-direction:column; padding:16px 16px 14px;
  border-radius:18px; background:var(--surface); border:1px solid var(--border);
  box-shadow:0 2px 10px rgba(20,20,30,.05); overflow:hidden;
  transition:transform .12s ease, box-shadow .12s ease; }
.tc-card:hover { transform:translateY(-2px); box-shadow:0 10px 24px rgba(20,20,30,.1); }
.tc-card-band { position:absolute; inset:0 0 auto 0; height:5px; }
.tc-card[data-level="ok"]  .tc-card-band { background:linear-gradient(90deg,#22c55e,#16a34a); }
.tc-card[data-level="low"] .tc-card-band { background:linear-gradient(90deg,#fbbf24,#d97706); }
.tc-card[data-level="out"] .tc-card-band { background:linear-gradient(90deg,#f87171,#dc2626); }
.tc-card-top { display:flex; gap:11px; align-items:center; margin-top:4px; }
.tc-thumb { width:52px; height:52px; flex:0 0 auto; border-radius:14px; overflow:hidden;
  background:var(--surface-alt); border:1px solid var(--border);
  display:grid; place-items:center; }
.tc-thumb img { width:100%; height:100%; object-fit:cover; display:block; }
.tc-thumb[data-empty] span { font-size:21px; font-weight:800; }
.tc-card[data-level="ok"]  .tc-thumb[data-empty] { background:var(--tc-ok-bg);  color:var(--tc-ok); }
.tc-card[data-level="low"] .tc-thumb[data-empty] { background:var(--tc-low-bg); color:var(--tc-low); }
.tc-card[data-level="out"] .tc-thumb[data-empty] { background:var(--tc-out-bg); color:var(--tc-out); }
.tc-name { font-size:16.5px; font-weight:800; margin:0; color:var(--text);
  overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.tc-spec { font-size:12px; color:var(--muted); margin-top:2px; }
.tc-dots { width:30px; height:30px; border-radius:9px; border:1px solid var(--border);
  background:var(--surface); color:var(--muted); cursor:pointer; font-size:15px; line-height:1; }
.tc-menu-scrim { position:fixed; inset:0; z-index:40; }
.tc-menu { position:absolute; right:0; top:34px; z-index:41; min-width:198px; padding:6px;
  border-radius:13px; background:var(--surface); border:1px solid var(--border);
  box-shadow:0 14px 34px rgba(0,0,0,.2); }
.tc-menu button { display:block; width:100%; text-align:left; padding:10px 12px; font:inherit;
  font-size:13px; font-weight:700; border:none; background:none; color:var(--text);
  border-radius:9px; cursor:pointer; }
.tc-menu button:hover { background:var(--surface-alt); }
.tc-menu-sep { height:1px; background:var(--border); margin:5px 2px; }

.tc-stockline { display:flex; align-items:center; gap:10px; margin:14px 0 9px; }
.tc-stock { display:flex; align-items:baseline; gap:5px; }
.tc-stock-n { font-size:38px; font-weight:800; line-height:1; letter-spacing:-.03em; }
.tc-stock-u { font-size:12px; font-weight:700; color:var(--muted); text-transform:uppercase;
  letter-spacing:.06em; }
.tc-card[data-level="ok"]  .tc-stock-n { color:var(--tc-ok); }
.tc-card[data-level="low"] .tc-stock-n { color:var(--tc-low); }
.tc-card[data-level="out"] .tc-stock-n { color:var(--tc-out); }
.tc-chip { margin-left:auto; font-size:10.5px; font-weight:800; letter-spacing:.04em;
  text-transform:uppercase; padding:5px 10px; border-radius:999px; }
.tc-card[data-level="ok"]  .tc-chip { background:var(--tc-ok-bg);  color:var(--tc-ok); }
.tc-card[data-level="low"] .tc-chip { background:var(--tc-low-bg); color:var(--tc-low); }
.tc-card[data-level="out"] .tc-chip { background:var(--tc-out-bg); color:var(--tc-out); }

.tc-bar { height:7px; border-radius:99px; background:var(--surface-alt); overflow:hidden; }
.tc-bar i { display:block; height:100%; border-radius:99px; }
.tc-card[data-level="ok"]  .tc-bar i { background:linear-gradient(90deg,#4ade80,#16a34a); }
.tc-card[data-level="low"] .tc-bar i { background:linear-gradient(90deg,#fcd34d,#d97706); }
.tc-card[data-level="out"] .tc-bar i { background:var(--tc-out); }
.tc-last { font-size:11.5px; color:var(--muted); margin-top:9px; min-height:16px; }
.tc-addstock { margin-top:12px; width:100%; padding:11px; border-radius:12px; border:none;
  font:inherit; font-size:13.5px; font-weight:800; cursor:pointer; color:#fff;
  background:linear-gradient(135deg,#f59e0b,#ea580c); box-shadow:0 4px 12px rgba(234,88,12,.26); }
.tc-addstock:hover { transform:translateY(-1px); }

/* ── empties ───────────────────────────────────────────────── */
.tc-empty { text-align:center; padding:46px 22px; border-radius:20px;
  background:var(--surface); border:2px dashed var(--border); }
.tc-empty-icon { font-size:48px; margin-bottom:12px; }
.tc-empty h2 { font-size:19px; font-weight:800; margin:0 0 8px; }
.tc-empty p { font-size:13.5px; color:var(--muted); line-height:1.65; max-width:50ch;
  margin:0 auto 18px; }
.tc-empty button { padding:13px 24px; font-size:14px; font-weight:800; border-radius:13px;
  border:none; color:#fff; cursor:pointer;
  background:linear-gradient(135deg,#f59e0b,#ea580c); }
.tc-empty-search { padding:34px 18px; text-align:center; font-size:13.5px; color:var(--muted);
  border:1px dashed var(--border); border-radius:15px; }

/* ── register ──────────────────────────────────────────────── */
.tc-reg { display:flex; flex-direction:column; gap:8px; }
.tc-reg-row { display:flex; align-items:center; gap:13px; padding:12px 15px; border-radius:14px;
  background:var(--surface); border:1px solid var(--border); }
.tc-reg-row[data-void] { opacity:.5; text-decoration:line-through; }
.tc-reg-delta { flex:0 0 auto; min-width:52px; text-align:center; padding:7px 10px;
  border-radius:11px; font-size:15px; font-weight:800;
  background:var(--tc-out-bg); color:var(--tc-out); }
.tc-reg-delta[data-up] { background:var(--tc-ok-bg); color:var(--tc-ok); }
.tc-reg-main { min-width:0; flex:1; }
.tc-reg-title { font-size:14px; font-weight:800; color:var(--text); display:flex;
  align-items:center; gap:8px; flex-wrap:wrap; }
.tc-reg-kind { font-size:10px; font-weight:800; letter-spacing:.05em; text-transform:uppercase;
  padding:3px 8px; border-radius:999px; background:var(--surface-alt); color:var(--muted); }
.tc-reg-kind[data-kind="issue"]   { background:var(--tc-out-bg); color:var(--tc-out); }
.tc-reg-kind[data-kind="receive"] { background:var(--tc-ok-bg);  color:var(--tc-ok); }
.tc-reg-sub { font-size:12px; color:var(--muted); margin-top:2px; }
.tc-reg-qr { margin-left:5px; font-size:11px; color:var(--tc-blue); }

/* ── sheets ────────────────────────────────────────────────── */
.tc-seg { display:flex; gap:4px; padding:4px; border-radius:13px; margin-bottom:16px;
  background:var(--surface-alt); border:1px solid var(--border); }
.tc-seg button { flex:1; padding:10px 8px; font:inherit; font-size:12.5px; font-weight:800;
  border:none; background:none; color:var(--muted); border-radius:10px; cursor:pointer; }
.tc-seg button.on { background:var(--surface); color:var(--text);
  box-shadow:0 2px 8px rgba(0,0,0,.1); }

.tc-steps { display:flex; align-items:center; gap:12px; margin-bottom:12px; }
.tc-steps button { width:62px; height:62px; flex:0 0 auto; border-radius:19px; font-size:28px;
  font-weight:700; cursor:pointer; line-height:1; color:#ea580c;
  background:var(--surface); border:2px solid var(--border); }
.tc-steps button:disabled { opacity:.35; cursor:not-allowed; }
.tc-steps-n { flex:1; display:flex; flex-direction:column; align-items:center; justify-content:center;
  padding:10px; border-radius:19px; color:#fff;
  background:linear-gradient(135deg,#f59e0b,#ea580c); box-shadow:0 8px 20px rgba(234,88,12,.3); }
.tc-steps-n b { font-size:36px; font-weight:800; line-height:1; }
.tc-steps-n i { font-style:normal; font-size:10.5px; font-weight:700; letter-spacing:.08em;
  text-transform:uppercase; opacity:.9; margin-top:3px; }
.tc-quick { display:flex; gap:7px; margin-bottom:16px; }
.tc-quick button { flex:1; padding:9px 0; font:inherit; font-size:13px; font-weight:800;
  border-radius:11px; cursor:pointer; background:var(--surface);
  border:1.5px solid var(--border); color:var(--text); }
.tc-quick button.on { border-color:#ea580c; background:rgba(234,88,12,.1); color:#c2410c; }

.tc-field { display:block; margin-bottom:14px; }
.tc-field span { display:block; font-size:10.5px; font-weight:800; letter-spacing:.07em;
  text-transform:uppercase; color:var(--muted); margin-bottom:5px; }
.tc-field input { width:100%; box-sizing:border-box; min-height:46px; padding:0 13px;
  font:inherit; font-size:14.5px; border-radius:12px; background:var(--surface);
  border:1.5px solid var(--border); color:var(--text); outline:none; }
.tc-field input:focus { border-color:#ea580c; box-shadow:0 0 0 3px rgba(234,88,12,.14); }
.tc-sheet-go { width:100%; padding:15px; border-radius:15px; border:none; font:inherit;
  font-size:15.5px; font-weight:800; color:#fff; cursor:pointer;
  background:linear-gradient(135deg,#f59e0b,#ea580c); box-shadow:0 8px 20px rgba(234,88,12,.3); }
.tc-sheet-go:disabled { background:var(--border); color:var(--muted); box-shadow:none;
  cursor:not-allowed; }
.tc-sheet-fine { font-size:11.5px; color:var(--muted); line-height:1.55; margin:4px 0 0; }

/* ── undo toast ────────────────────────────────────────────── */
.tc-toast { position:fixed; left:50%; bottom:22px; transform:translateX(-50%); z-index:60;
  display:flex; align-items:center; gap:12px; padding:12px 16px; border-radius:15px;
  background:#15181d; color:#fff; box-shadow:0 14px 36px rgba(0,0,0,.34);
  font-size:13.5px; font-weight:700; max-width:calc(100vw - 32px); }
.tc-toast-tick { width:24px; height:24px; flex:0 0 auto; border-radius:50%; display:grid;
  place-items:center; font-size:13px; background:#16a34a; }
.tc-toast-text { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.tc-toast-undo { border:none; border-radius:10px; padding:8px 13px; font:inherit; font-size:12.5px;
  font-weight:800; cursor:pointer; background:rgba(255,255,255,.16); color:#fff; white-space:nowrap; }
.tc-toast-undo span { opacity:.7; margin-left:5px; font-variant-numeric:tabular-nums; }
.tc-toast-close { border:none; background:none; color:rgba(255,255,255,.6); font-size:14px;
  cursor:pointer; }

@media (max-width:760px) {
  .tc-hero { padding:17px 17px 15px; border-radius:18px; }
  .tc-title { font-size:23px; }
  .tc-hero-actions { margin-left:0; width:100%; }
  .tc-btn { flex:1; justify-content:center; }
  .tc-stats { grid-template-columns:1fr; gap:8px; }
  .tc-stat { display:flex; align-items:baseline; gap:9px; }
  .tc-stat b { font-size:21px; }
  .tc-stat span { margin-top:0; }
  .tc-how { grid-template-columns:1fr; }
  .tc-grid { grid-template-columns:1fr; }
}
`;
