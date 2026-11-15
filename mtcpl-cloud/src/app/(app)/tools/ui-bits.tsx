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

export type Done = {
  text: string;
  at: number;
  /** Did this action WRITE A MOVEMENT? Only then may the toast offer
   *  Undo — see the note on `latest` below. Everything else (a tool
   *  renamed, a tool deleted, a man taken off a list) gets a plain
   *  confirmation with a close button. */
  undoable?: boolean;
};

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
  //
  // Which is only true when the action wrote one. Daksh, Nov 2026 —
  // caught while testing Delete: the toast after a delete offered
  // Undo, and "the freshest live movement" was then a stock line from
  // last month that had nothing to do with it. One press would have
  // silently changed the count on a different tool. The same was true
  // of the toast after an edit. So the caller now has to say.
  const latest = movements.find((m) => !m.undone_at) ?? null;
  const canUndoNow = done.undoable === true && left > 0 && latest != null;
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
  /* Was #4f46e5. An indigo belonging to no palette in this app — it
     ran the tally bars, the QR mark and the vendor group's edge, and
     it was a good part of why the module read as a toy next to the
     warm paper and gold everywhere else. */
  --tc-blue:var(--gold-dark);
}

/* ── page head ─────────────────────────────────────────────── */
/*
   Nov 2026 — this module used to open on a saturated orange-to-pink
   gradient banner carrying a 28px white title, an emoji tile and three
   translucent score tiles. The men using it said it felt like a game
   rather than a tool. They were right: nothing else in this app looks
   like that. The house style is a 20px heading on paper, an 8px radius
   and a gold accent, and the store now obeys it.

   The three score tiles are gone rather than restyled. Two of them
   counted rows that were listed directly underneath, and a number you
   can reach by counting what is already on screen is decoration. What
   is left of them is one sentence under the heading.
*/
.tc-head {
  display:flex; align-items:flex-start; justify-content:space-between;
  gap:16px; flex-wrap:wrap; margin-bottom:16px;
  padding-bottom:14px; border-bottom:1px solid var(--border);
}
.tc-head-id { min-width:0; }
.tc-title { font-size:20px; font-weight:700; letter-spacing:-.01em; margin:0; color:var(--text); }
.tc-sub { font-size:13px; color:var(--muted); margin-top:4px; line-height:1.5; }
.tc-sub b { font-weight:700; color:var(--text); font-variant-numeric:tabular-nums; }
.tc-sub .tc-warn { color:var(--warning); font-weight:700; }
.tc-sub .tc-outw { color:var(--danger); font-weight:700; }
.tc-sub button { border:none; background:none; padding:0; font:inherit; color:inherit;
  cursor:pointer; text-decoration:underline; text-underline-offset:2px; }

.tc-hero-actions { display:flex; gap:8px; flex-wrap:wrap; }
.tc-btn {
  display:inline-flex; align-items:center; gap:7px; padding:8px 14px; font-size:13px;
  font-weight:600; border-radius:var(--radius); text-decoration:none; white-space:nowrap;
  cursor:pointer; font-family:inherit; border:1px solid var(--border);
  background:var(--surface); color:var(--text);
  transition:background .12s ease, border-color .12s ease;
}
.tc-btn:hover { background:var(--surface-alt); border-color:var(--muted-light); }
.tc-btn-ghost { /* same as the default now — kept so markup need not change */ }
.tc-btn-solid { background:var(--gold); border-color:var(--gold); color:#fff; }
.tc-btn-solid:hover { background:var(--gold-dark); border-color:var(--gold-dark); }

/* ── messages ──────────────────────────────────────────────── */
.tc-err { display:flex; gap:12px; align-items:center; justify-content:space-between;
  padding:10px 14px; border-radius:var(--radius); margin-bottom:14px; font-size:13px;
  font-weight:600; background:var(--danger-bg); color:var(--danger);
  border:1px solid rgba(220,38,38,.25); }
.tc-err button { border:none; background:none; color:inherit; cursor:pointer; font-size:14px; }

/* ── tabs + search ─────────────────────────────────────────── */
.tc-tabs { display:inline-flex; gap:2px; padding:3px; border-radius:var(--radius);
  background:var(--surface-alt); border:1px solid var(--border); margin-bottom:14px; }
.tc-tabs button { padding:7px 16px; font-size:13px; font-weight:600;
  border-radius:var(--radius-sm); border:none; background:none; color:var(--muted);
  cursor:pointer; font-family:inherit; }
.tc-tabs button:hover { color:var(--text); }
.tc-tabs button.on { background:var(--surface); color:var(--text);
  box-shadow:0 1px 2px rgba(45,36,16,.09); }
.tc-tabs i { font-style:normal; font-size:11px; font-weight:600; margin-left:6px;
  opacity:.7; font-variant-numeric:tabular-nums; }

.tc-search { display:flex; align-items:center; gap:9px; padding:0 12px; margin-bottom:12px;
  background:var(--surface); border:1px solid var(--border); border-radius:var(--radius); }
.tc-search input { flex:1; min-width:0; border:none; outline:none; background:none;
  font:inherit; font-size:13.5px; padding:9px 0; color:var(--text); }
.tc-search > span { color:var(--muted-light); font-size:12px; }
.tc-search button { background:none; border:none; color:var(--muted); cursor:pointer;
  font-size:13px; }

.tc-filter { display:inline-flex; gap:6px; align-items:center; margin-bottom:12px;
  padding:6px 12px; border-radius:999px; font:inherit; font-size:12.5px; font-weight:600;
  cursor:pointer; background:var(--gold-subtle); color:var(--gold-dark);
  border:1px solid var(--gold-border); }

/* ── the shelf, as a list ──────────────────────────────────── */
/*
   Cards became rows in Nov 2026, and the reason is in the names. The
   shelf holds DSZ 10.4.50-160, DSZ 12.4.60-180, DSZ 12.6.120-180 — part
   codes that differ only in their digits. A grid of big cards set those
   far apart, in a proportional font, each behind a coloured circle
   showing the same letter D. Nobody can tell those apart at a glance,
   and telling them apart is the only thing anybody does on this screen.

   A list in a monospaced, tabular font stacks the digits in a column
   where the eye compares them for free. The quantities line up in their
   own column for the same reason.

   One status device, not five. The old card carried a coloured top
   band, a coloured avatar, a coloured 38px number, a coloured chip AND
   a progress bar — all saying the same thing. The bar is gone
   altogether: its denominator was max(warn line × 3, stock), an
   invented maximum no tool actually has, so it was decoration drawn in
   the shape of data. What is left is a thin left edge and a quiet
   badge.

   Note there is no hover transform any more. That is a bonus: a
   transform makes an element the containing block for fixed-position
   descendants, which is what made the ⋯ menu awkward to place.
*/
.tc-grid { display:flex; flex-direction:column;
  border:1px solid var(--border); border-radius:var(--radius);
  background:var(--surface); box-shadow:var(--shadow); }

.tc-card {
  position:relative; display:grid; align-items:center; gap:12px;
  grid-template-columns:auto minmax(0,1fr) auto auto auto;
  padding:10px 14px; background:var(--surface);
  border-bottom:1px solid var(--border-light);
  border-left:3px solid transparent;
  border-radius:0;
}
.tc-card:first-child { border-top-left-radius:var(--radius); border-top-right-radius:var(--radius); }
.tc-card:last-child  { border-bottom:none;
  border-bottom-left-radius:var(--radius); border-bottom-right-radius:var(--radius); }
/* Holding a row must not also hand the phone's own text selection a
   reason to wake up. Without these, a long press selects the part code,
   throws up the magnifier and the Copy / Share bar, and the sheet opens
   underneath it — both at once, which is what Daksh hit.

   -webkit-touch-callout stops iOS's callout; user-select stops the
   selection itself on everything else. Both are needed: they are
   different mechanisms, and only the second one exists on Android.

   The cost is that the code in the row can no longer be selected to
   copy. It still can in the sheet the press opens, which is where
   somebody reading a code out would be looking anyway. */
.tc-card {
  cursor:pointer;
  -webkit-tap-highlight-color:transparent;
  -webkit-touch-callout:none;
  -webkit-user-select:none;
  user-select:none;
}
.tc-card:hover { background:var(--surface-alt); }
/* Something has to happen the instant a thumb lands, or the hold feels
   like a dead screen for half a second. */
.tc-card:active { background:var(--bg); }
.tc-card[data-level="low"] { border-left-color:var(--warning); }
.tc-card[data-level="out"] { border-left-color:var(--danger); }

.tc-thumb { width:38px; height:38px; flex:0 0 auto; border-radius:var(--radius-sm);
  overflow:hidden; background:var(--surface-alt); border:1px solid var(--border);
  display:grid; place-items:center; }
.tc-thumb img { width:100%; height:100%; object-fit:cover; display:block; }
/* No photo: a quiet empty frame, not a big coloured letter — six of
   the seven codes on this shelf begin with D, so the letter was colour
   and nothing else.

   And when NOTHING in the list has a picture, which is the shelf as it
   actually stands today, the column goes entirely. A row of identical
   empty frames is worse than no column: it costs width, draws the eye
   first, and says nothing. It comes back by itself the day somebody
   photographs a tool. */
.tc-thumb[data-empty] { background:var(--bg); border-style:dashed; }
.tc-grid[data-photos="0"] .tc-thumb { display:none; }
.tc-grid[data-photos="0"] .tc-card { grid-template-columns:minmax(0,1fr) auto auto auto; }
@media (max-width: 720px) {
  .tc-grid[data-photos="0"] .tc-card { grid-template-columns:minmax(0,1fr) auto; }
  .tc-grid[data-photos="0"] .tc-chip { grid-column:1 / 2; }
  .tc-grid[data-photos="0"] .tc-rowacts { grid-column:2 / 3; }
}

.tc-name { font-size:13.5px; font-weight:600; margin:0; color:var(--text);
  font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
  font-variant-numeric:tabular-nums; letter-spacing:-.01em;
  overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.tc-spec { font-size:11.5px; color:var(--muted); margin-top:2px;
  overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }

.tc-stockline { display:flex; align-items:baseline; gap:4px; justify-content:flex-end; }
.tc-stock { display:flex; align-items:baseline; gap:4px; }
.tc-stock-n { font-size:17px; font-weight:700; line-height:1.1; color:var(--text);
  font-variant-numeric:tabular-nums; min-width:2.5ch; text-align:right; }
.tc-stock-u { font-size:11px; font-weight:500; color:var(--muted); }
.tc-card[data-level="low"] .tc-stock-n { color:var(--warning); }
.tc-card[data-level="out"] .tc-stock-n { color:var(--danger); }

.tc-chip { font-size:10.5px; font-weight:600; padding:3px 8px; border-radius:999px;
  white-space:nowrap; background:var(--bg); color:var(--muted);
  border:1px solid var(--border); }
.tc-card[data-level="ok"]  .tc-chip { background:rgba(22,163,74,.08); color:#16A34A;
  border-color:rgba(22,163,74,.22); }
.tc-card[data-level="low"] .tc-chip { background:rgba(217,119,6,.08); color:#B45309;
  border-color:rgba(217,119,6,.26); }
.tc-card[data-level="out"] .tc-chip { background:rgba(220,38,38,.08); color:#DC2626;
  border-color:rgba(220,38,38,.24); }

.tc-last { font-size:11.5px; color:var(--muted); white-space:nowrap; }

.tc-rowacts { display:flex; align-items:center; gap:6px; }
.tc-addstock { padding:6px 11px; border-radius:var(--radius); font:inherit; font-size:12.5px;
  font-weight:600; cursor:pointer; color:var(--gold-dark); background:var(--gold-subtle);
  border:1px solid var(--gold-border); white-space:nowrap; }
.tc-addstock:hover { background:var(--gold); border-color:var(--gold); color:#fff; }

.tc-dots { width:28px; height:28px; border-radius:var(--radius-sm);
  border:1px solid var(--border); background:var(--surface); color:var(--muted);
  cursor:pointer; font-size:14px; line-height:1; flex:0 0 auto; }
.tc-dots:hover { background:var(--surface-alt); color:var(--text); }
.tc-menu-scrim { position:fixed; inset:0; z-index:40; }
.tc-menu { position:absolute; right:0; top:32px; z-index:41; min-width:206px; padding:5px;
  border-radius:var(--radius); background:var(--surface); border:1px solid var(--border);
  box-shadow:var(--shadow-md, 0 12px 28px rgba(45,36,16,.16)); }
/* Opens upwards for a row near the bottom of the window. */
.tc-menu[data-up] { top:auto; bottom:32px; }
.tc-menu button { display:block; width:100%; text-align:left; padding:8px 11px; font:inherit;
  font-size:13px; font-weight:500; border:none; background:none; color:var(--text);
  border-radius:var(--radius-sm); cursor:pointer; }
.tc-menu button:hover { background:var(--surface-alt); }
.tc-menu-sep { height:1px; background:var(--border); margin:4px 2px; }
.tc-menu button.tc-menu-danger { color:var(--danger); }
.tc-menu button.tc-menu-danger:hover { background:var(--danger-bg); }
.tc-menu-why { padding:7px 11px 5px; font-size:11.5px; line-height:1.45; color:var(--muted); }
.tc-menu-ask { padding:7px 11px 5px; }
.tc-menu-ask > span { display:block; font-size:12px; font-weight:600; color:var(--text);
  line-height:1.45; margin-bottom:8px; }
.tc-menu-ask > div { display:flex; gap:6px; }
.tc-menu button.tc-menu-yes { width:auto; padding:6px 10px; font-size:12px;
  background:var(--danger); color:#fff; font-weight:600; }
.tc-menu button.tc-menu-no { width:auto; padding:6px 10px; font-size:12px;
  background:var(--surface-alt); color:var(--muted); font-weight:600; }

/* A phone has no room for five columns. The thing you came to read —
   the code and how many are left — keeps the first line; the badge and
   the buttons drop to a second. The thumbnail grows rather than
   shrinks, because on a phone the picture is how the tool is
   recognised. */
@media (max-width: 720px) {
  /* The row's buttons are GONE on a phone. A 12px "Add stock" beside a
     28px "⋯" in a 44px row put two of the most-used controls in the
     module below the 44px both Apple and Google ask for, and they were
     being pressed with a glove on. Press the row instead: everything
     for that tool opens in a sheet with 56px targets.

     On a desktop they stay — a mouse hits a 28px button every time and
     one click beats two. */
  .tc-rowacts { display:none; }
  .tc-card { grid-template-columns:auto minmax(0,1fr) auto; padding:13px 12px; row-gap:7px;
    min-height:62px; }
  .tc-thumb { width:46px; height:46px; }
  .tc-chip { grid-column:2 / 3; justify-self:start; }
  .tc-spec { white-space:normal; }
}

/* Same reason as the cupboard: a press that cannot select the row
   selects the page around it instead. On a touch screen the whole
   module stops being selectable; a desktop keeps selection, because
   there a drag IS a selection and nobody is holding anything. */
@media (hover: none) and (pointer: coarse) {
  .tc-page { -webkit-touch-callout:none; -webkit-user-select:none; user-select:none; }
  .tc-page input, .tc-page textarea, .tc-page select, .tc-page [contenteditable] {
    -webkit-user-select:text; user-select:text; -webkit-touch-callout:default;
  }
}

/* How to work the list, said once, where it is needed. A gesture
   nobody can see is a feature only its author uses. */
.tc-howto { display:none; }
@media (max-width: 720px) {
  .tc-howto { display:block; margin:0 0 10px; font-size:11.5px; line-height:1.5;
    color:var(--muted); }
  .tc-howto b { font-weight:600; color:var(--text); }
}

/* ── empties ───────────────────────────────────────────────── */
.tc-empty { text-align:center; padding:40px 22px; border-radius:var(--radius);
  background:var(--surface); border:1px dashed var(--border); }
.tc-empty-icon { display:none; }
.tc-empty h2 { font-size:17px; font-weight:700; margin:0 0 8px; color:var(--text); }
.tc-empty p { font-size:13.5px; color:var(--muted); line-height:1.65; max-width:52ch;
  margin:0 auto 18px; }
.tc-empty button { padding:9px 18px; font-size:13px; font-weight:600;
  border-radius:var(--radius); border:1px solid var(--gold); color:#fff; cursor:pointer;
  background:var(--gold); font-family:inherit; }
.tc-empty button:hover { background:var(--gold-dark); border-color:var(--gold-dark); }
.tc-empty-search { padding:30px 18px; text-align:center; font-size:13.5px; color:var(--muted);
  border:1px dashed var(--border); border-radius:var(--radius); }

/* ── register ──────────────────────────────────────────────── */
.tc-reg { display:flex; flex-direction:column; gap:8px; }
.tc-reg-row { display:flex; align-items:center; gap:13px; padding:12px 15px; border-radius:8px;
  background:var(--surface); border:1px solid var(--border); }
.tc-reg-row[data-void] { opacity:.5; text-decoration:line-through; }
.tc-reg-delta { flex:0 0 auto; min-width:52px; text-align:center; padding:7px 10px;
  border-radius:6px; font-size:15px; font-weight:700;
  background:var(--tc-out-bg); color:var(--tc-out); }
.tc-reg-delta[data-up] { background:var(--tc-ok-bg); color:var(--tc-ok); }
.tc-reg-main { min-width:0; flex:1; }
.tc-reg-title { font-size:14px; font-weight:700; color:var(--text); display:flex;
  align-items:center; gap:8px; flex-wrap:wrap; }
.tc-reg-kind { font-size:10px; font-weight:700; letter-spacing:.05em; text-transform:uppercase;
  padding:3px 8px; border-radius:999px; background:var(--surface-alt); color:var(--muted); }
.tc-reg-kind[data-kind="issue"]   { background:var(--tc-out-bg); color:var(--tc-out); }
.tc-reg-kind[data-kind="receive"] { background:var(--tc-ok-bg);  color:var(--tc-ok); }
.tc-reg-sub { font-size:12px; color:var(--muted); margin-top:2px; }
.tc-reg-qr { margin-left:5px; font-size:11px; color:var(--tc-blue); }
/* "his man" — the taker works under the company in the heading above. */
.tc-reg-op { margin-left:6px; font-size:9.5px; font-weight:700; letter-spacing:.05em;
  text-transform:uppercase; padding:2px 6px; border-radius:999px;
  background:var(--surface-alt); color:var(--muted); }

/* ── register, company by company (mig 234) ────────────────── */
/* ── the thumb-reach button (phone only) ───────────────────── */
.tc-fab { display:none; }
@media (max-width: 760px) {
  .tc-fab {
    position:fixed; left:50%; transform:translateX(-50%);
    bottom:calc(16px + env(safe-area-inset-bottom)); z-index:45;
    display:flex; align-items:center; gap:8px; cursor:pointer;
    /* Smaller and quieter than it was. Daksh asked for a bottom-centre
       button and it stays, but it was a 15px-tall gold lozenge floating
       over the list — the single most app-like thing left on the page
       once the banner went. It only has to be reachable, not loud. */
    padding:10px 18px; border:1px solid var(--gold-dark); border-radius:999px;
    font:inherit; font-size:13.5px; font-weight:600; color:#fff; white-space:nowrap;
    background:var(--gold);
    box-shadow:0 3px 10px rgba(45,36,16,.18);
  }
  .tc-fab span { font-size:15px; line-height:1; }
  .tc-fab:active { transform:translateX(-50%) scale(.97); }
  /* Clearance so the last card is never under it. */
  .tc-page { padding-bottom:84px !important; }
}

/* ── which month ───────────────────────────────────────────── */
.tc-period { display:flex; align-items:center; justify-content:space-between;
  gap:12px; flex-wrap:wrap; margin-bottom:14px; padding:10px 12px;
  border-radius:8px; background:var(--surface); border:1px solid var(--border); }
.tc-period-nav { display:flex; align-items:center; gap:4px; }
.tc-period-nav strong { min-width:168px; text-align:center; font-size:15.5px;
  font-weight:700; letter-spacing:-.01em; }
.tc-period-nav button { width:32px; height:32px; border-radius:6px; cursor:pointer;
  font:inherit; font-size:16px; line-height:1;
  border:1px solid var(--border); background:var(--surface-alt); color:var(--text); }
.tc-period-nav button:disabled { opacity:.35; cursor:not-allowed; }
.tc-period-right { display:flex; align-items:center; gap:10px; flex-wrap:wrap; }
.tc-period-sum { font-size:12.5px; color:var(--muted); font-weight:700; }
.tc-period-sum b { font-size:17px; font-weight:700; color:var(--text);
  font-variant-numeric:tabular-nums; margin-right:3px; }
.tc-period-all { padding:7px 13px; border-radius:999px; cursor:pointer; font:inherit;
  font-size:12px; font-weight:700; border:1px solid var(--border);
  background:var(--surface-alt); color:var(--muted); }
.tc-period-all.on { background:var(--tc-blue); border-color:var(--tc-blue); color:#fff; }
.tc-period-note { margin:-6px 0 12px; font-size:11.5px; color:var(--muted); font-style:italic; }
.tc-period-jump { border:none; background:none; padding:0; cursor:pointer; font:inherit;
  font-size:inherit; font-weight:700; color:var(--tc-blue); text-decoration:underline; }

/* ── the sums ──────────────────────────────────────────────── */
.tc-rg-sums { display:grid; grid-template-columns:1fr 1fr; gap:18px; padding:13px 15px; }
.tc-tally { min-width:0; display:flex; flex-direction:column; gap:6px; }
.tc-tally-head { font-size:10px; font-weight:700; letter-spacing:.08em;
  text-transform:uppercase; color:var(--muted); margin-bottom:2px; }
.tc-tally-row { display:grid; grid-template-columns:minmax(0,1fr) 64px 34px;
  align-items:center; gap:9px; }
/* The same part codes as the shelf, so the same treatment: monospaced
   and tabular, because the only hard part is telling 12.4.60 from
   12.6.120 at a glance. */
.tc-tally-name { font-size:12.5px; font-weight:600; color:var(--text);
  font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
  font-variant-numeric:tabular-nums; letter-spacing:-.01em;
  overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.tc-tally-bar { height:7px; border-radius:8px; background:var(--surface-alt);
  overflow:hidden; }
.tc-tally-bar i { display:block; height:100%; border-radius:8px; background:var(--tc-blue); }
.tc-tally-qty { font-size:14px; font-weight:700; text-align:right;
  font-variant-numeric:tabular-nums; color:var(--text); }
.tc-reggroup[data-kind="__store"] .tc-tally-bar i { background:var(--tc-ok); }

.tc-rg-lines { width:100%; text-align:left; cursor:pointer; font:inherit;
  font-size:11.5px; font-weight:700; letter-spacing:.03em; color:var(--muted);
  padding:9px 15px; border:none; border-top:1px solid var(--border);
  background:var(--surface-alt); }
.tc-rg-lines:hover { color:var(--text); }

@media (max-width: 760px) {
  .tc-rg-sums { grid-template-columns:1fr; gap:14px; }
  .tc-period-nav strong { min-width:120px; font-size:14px; }
}

.tc-reggroups { display:flex; flex-direction:column; gap:14px; }
.tc-reggroup { border:1px solid var(--border); border-radius:8px; overflow:hidden;
  background:var(--surface); }
/* These used to carry a coloured left edge each — indigo for a vendor,
   green for the store, grey for the office. Colour there implied a
   status that does not exist: a company is not good or bad, it is just
   whose men took the tools. The heading already names it. */
.tc-reggroup[data-kind="vendor"],
.tc-reggroup[data-kind="__store"],
.tc-reggroup[data-kind="__office"] { border-left:1px solid var(--border); }
.tc-rg-head { display:flex; align-items:center; gap:10px; flex-wrap:wrap;
  padding:12px 15px; background:var(--surface-alt); border-bottom:1px solid var(--border); }
.tc-rg-title { display:flex; align-items:center; gap:8px; min-width:0; flex:1;
  padding:0; border:none; background:none; font:inherit; cursor:pointer; text-align:left; }
.tc-rg-caret { font-size:11px; color:var(--muted); flex:0 0 auto; }
.tc-rg-name { font-size:15px; font-weight:700; letter-spacing:-.01em; color:var(--text);
  overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.tc-rg-facts { display:flex; align-items:center; gap:7px; flex-wrap:wrap; flex:0 0 auto; }
.tc-rg-took { font-size:11.5px; font-weight:700; color:var(--muted); }
.tc-rg-took b { font-size:14px; font-weight:700; color:var(--text);
  font-variant-numeric:tabular-nums; }
.tc-rg-count { font-size:11px; font-weight:700; color:var(--muted);
  padding:3px 9px; border-radius:999px; background:var(--surface); border:1px solid var(--border); }
.tc-rg-team { font-size:11px; font-weight:700; padding:4px 10px; border-radius:999px;
  cursor:pointer; font-family:inherit;
  background:var(--surface); border:1px solid var(--border); color:var(--text); }
.tc-rg-team:hover { background:var(--tc-ok-bg); border-color:var(--tc-ok); color:var(--tc-ok); }
.tc-rg-roster { display:flex; flex-direction:column; gap:1px; padding:10px 15px;
  background:var(--surface-alt); border-bottom:1px solid var(--border); }
.tc-rg-man { display:flex; align-items:center; gap:10px; padding:7px 0; }
.tc-rg-man + .tc-rg-man { border-top:1px dashed var(--border); }
.tc-rg-man-name { font-size:13px; font-weight:700; color:var(--text); }
.tc-rg-man-phone { font-size:11.5px; color:var(--muted); flex:1; }
.tc-rg-man-x { width:26px; height:26px; flex:0 0 auto; border-radius:6px; cursor:pointer;
  border:1px solid var(--border); background:var(--surface); color:var(--muted); font-size:11px; }
.tc-rg-man-ask { display:flex; gap:6px; }
.tc-rg-man-yes { padding:5px 10px; border-radius:6px; border:none; cursor:pointer; font:inherit;
  font-size:11.5px; font-weight:700; background:var(--tc-out); color:#fff; }
.tc-rg-man-no { padding:5px 10px; border-radius:6px; cursor:pointer; font:inherit;
  font-size:11.5px; font-weight:700; background:var(--surface); color:var(--muted);
  border:1px solid var(--border); }
.tc-rg-nothing { padding:16px 15px; font-size:12.5px; font-style:italic; color:var(--muted); }
.tc-reggroup .tc-reg { padding:11px; gap:7px; }
.tc-reggroup .tc-reg-row { border-color:var(--border-light, var(--border)); }

@media (max-width: 640px) {
  .tc-rg-head { gap:7px; }
  .tc-rg-name { font-size:14px; }
}

/* ── sheets ────────────────────────────────────────────────── */
.tc-seg { display:flex; gap:4px; padding:4px; border-radius:8px; margin-bottom:16px;
  background:var(--surface-alt); border:1px solid var(--border); }
.tc-seg button { flex:1; padding:10px 8px; font:inherit; font-size:12.5px; font-weight:700;
  border:none; background:none; color:var(--muted); border-radius:6px; cursor:pointer; }
.tc-seg button.on { background:var(--surface); color:var(--text);
  box-shadow:0 2px 8px rgba(0,0,0,.1); }

/* ── how many ──────────────────────────────────────────────── */
/*
   This used to be a 62px minus, a 62px plus and a solid gold slab
   holding a figure you could not type into. It was the most game-like
   thing in the module and the slowest: a bill says 24, and 24 was
   reachable only by pressing 25 and then minus.

   It is a number field now, with the keypad on a phone, and the − and +
   left in at a sane size for nudging by one. The quick chips stay —
   they are genuinely the fastest way to a round box count.
*/
.tc-steps { display:flex; align-items:stretch; gap:8px; margin-bottom:10px; }
.tc-steps button { width:52px; flex:0 0 auto; border-radius:var(--radius); font-size:20px;
  font-weight:600; cursor:pointer; line-height:1; color:var(--gold-dark);
  background:var(--surface); border:1px solid var(--border); }
.tc-steps button:hover:not(:disabled) { background:var(--surface-alt); border-color:var(--gold); }
.tc-steps button:disabled { opacity:.35; cursor:not-allowed; }
.tc-steps-n { flex:1; display:flex; align-items:baseline; justify-content:center; gap:7px;
  padding:10px 12px; border-radius:var(--radius); cursor:text;
  background:var(--surface); border:1px solid var(--border); }
.tc-steps-n:focus-within { border-color:var(--gold); box-shadow:0 0 0 3px var(--gold-subtle); }
.tc-steps-n input { width:100%; min-width:0; border:none; outline:none; background:none;
  font:inherit; font-size:26px; font-weight:700; line-height:1.15; text-align:right;
  color:var(--text); font-variant-numeric:tabular-nums; padding:0; }
.tc-steps-n i { font-style:normal; font-size:12px; font-weight:600; color:var(--muted);
  flex:0 0 auto; }

.tc-quick { display:flex; gap:7px; margin-bottom:16px; }
.tc-quick button { flex:1; padding:9px 0; font:inherit; font-size:13px; font-weight:700;
  border-radius:6px; cursor:pointer; background:var(--surface);
  border:1.5px solid var(--border); color:var(--text); }
.tc-quick button.on { border-color:var(--gold); background:var(--gold-subtle);
  color:var(--gold-dark); }

.tc-field { display:block; margin-bottom:14px; }
.tc-field span { display:block; font-size:10.5px; font-weight:700; letter-spacing:.07em;
  text-transform:uppercase; color:var(--muted); margin-bottom:5px; }
.tc-field input { width:100%; box-sizing:border-box; min-height:46px; padding:0 13px;
  font:inherit; font-size:14.5px; border-radius:8px; background:var(--surface);
  border:1.5px solid var(--border); color:var(--text); outline:none; }
.tc-field input:focus { border-color:var(--gold);
  box-shadow:0 0 0 3px var(--gold-subtle); }
.tc-sheet-go { width:100%; padding:15px; border-radius:8px; border:none; font:inherit;
  font-size:14.5px; font-weight:600; color:#fff; cursor:pointer;
  background:var(--gold); }
.tc-sheet-go:disabled { background:var(--border); color:var(--muted); box-shadow:none;
  cursor:not-allowed; }
.tc-sheet-fine { font-size:11.5px; color:var(--muted); line-height:1.55; margin:4px 0 0; }

/* ── undo toast ────────────────────────────────────────────── */
.tc-toast { position:fixed; left:50%; bottom:22px; transform:translateX(-50%); z-index:60;
  display:flex; align-items:center; gap:12px; padding:12px 16px; border-radius:8px;
  background:#15181d; color:#fff; box-shadow:0 14px 36px rgba(0,0,0,.34);
  font-size:13.5px; font-weight:700; max-width:calc(100vw - 32px); }
.tc-toast-tick { width:24px; height:24px; flex:0 0 auto; border-radius:50%; display:grid;
  place-items:center; font-size:13px; background:#16a34a; }
.tc-toast-text { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.tc-toast-undo { border:none; border-radius:6px; padding:8px 13px; font:inherit; font-size:12.5px;
  font-weight:700; cursor:pointer; background:rgba(255,255,255,.16); color:#fff; white-space:nowrap; }
.tc-toast-undo span { opacity:.7; margin-left:5px; font-variant-numeric:tabular-nums; }
.tc-toast-close { border:none; background:none; color:rgba(255,255,255,.6); font-size:14px;
  cursor:pointer; }

@media (max-width:760px) {
  .tc-hero { padding:17px 17px 15px; border-radius:8px; }
  .tc-title { font-size:23px; }
  .tc-hero-actions { margin-left:0; width:100%; }
  .tc-btn { flex:1; justify-content:center; }
  .tc-stats { grid-template-columns:1fr; gap:8px; }
  .tc-stat { display:flex; align-items:baseline; gap:9px; }
  .tc-stat b { font-size:21px; }
  .tc-stat span { margin-top:0; }
  .tc-grid { grid-template-columns:1fr; }
}
`;
