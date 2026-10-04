"use client";

/**
 * The crib board — what you see when you open /tools.
 *
 * The one number that matters on each card is how many are left, so it
 * is the biggest thing on the card and it carries the colour. Everything
 * else (name, last movement, the actions) arranges itself around it.
 *
 * Ordering is by USE, not alphabet: whatever this crib has actually been
 * touching in the last month floats to the top, so the bit somebody
 * reaches for every day is under their thumb without a search. Shortages
 * jump above everything, because a tool at zero is the only thing on
 * this page that needs a decision.
 */

import { useMemo, useOptimistic, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

import {
  KIND_VERB,
  UNDO_WINDOW_MS,
  orderForTaking,
  shortages,
  type ToolMovement,
  type ToolMovementKind,
  type ToolRow,
} from "@/lib/cnc-tool-stock";
import { createToolAction, recordMovementAction, undoMovementAction, updateToolAction } from "./actions";
import { MoveSheet, type MoveIntent } from "./move-sheet";
import { AddToolSheet } from "./add-tool-sheet";

type Vendor = { id: string; name: string };

/** What the undo toast needs to count down and call back. */
type Done = { movementId: string | null; text: string; at: number };

export function CribClient({
  vendors,
  activeVendorId,
  activeVendorName,
  tools,
  movements,
  people,
  canManage,
}: {
  vendors: Vendor[];
  activeVendorId: string;
  activeVendorName: string;
  tools: ToolRow[];
  movements: ToolMovement[];
  people: string[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [q, setQ] = useState("");
  const [intent, setIntent] = useState<MoveIntent | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [editing, setEditing] = useState<ToolRow | null>(null);
  const [done, setDone] = useState<Done | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);

  // Optimistic stock: the number on the card moves the instant the sheet
  // is confirmed, before the server round trip. On a workshop phone the
  // alternative is a second of nothing, which gets the button pressed
  // twice and the tool booked out twice.
  const [optimistic, applyOptimistic] = useOptimistic(
    tools,
    (state: ToolRow[], patch: { toolId: string; delta: number }) =>
      state.map((t) => (t.id === patch.toolId ? { ...t, stock: t.stock + patch.delta } : t)),
  );

  const short = useMemo(() => shortages(optimistic), [optimistic]);
  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const base = orderForTaking(optimistic);
    if (!needle) return base;
    return base.filter(
      (t) =>
        t.name.toLowerCase().includes(needle) ||
        (t.spec ?? "").toLowerCase().includes(needle),
    );
  }, [optimistic, q]);

  const takenToday = useMemo(() => {
    const start = new Date(); start.setHours(0, 0, 0, 0);
    return movements.filter(
      (m) => !m.undone_at && m.kind === "issue" && new Date(m.created_at).getTime() >= start.getTime(),
    ).length;
  }, [movements]);

  function run(fn: () => Promise<{ ok: true; message?: string } | { ok: false; error: string }>,
               after?: (msg?: string) => void) {
    setErr(null);
    startTransition(async () => {
      const r = await fn();
      if (!r.ok) { setErr(r.error); return; }
      after?.(r.message);
      router.refresh();
    });
  }

  function submitMove(fd: FormData) {
    const toolId = String(fd.get("tool_id"));
    const kind = String(fd.get("kind")) as ToolMovementKind;
    const qty = Number(fd.get("qty"));
    const signedGuess =
      kind === "receive" || kind === "return" ? qty
        : kind === "issue" || kind === "scrap" ? -qty
          : String(fd.get("direction")) === "down" ? -qty : qty;
    const tool = optimistic.find((t) => t.id === toolId);
    const who = String(fd.get("taken_by") ?? "");

    setIntent(null);
    startTransition(async () => {
      applyOptimistic({ toolId, delta: signedGuess });
      const r = await recordMovementAction(fd);
      if (!r.ok) { setErr(r.error); router.refresh(); return; }
      setDone({
        movementId: null, // filled by the refresh; undo falls back to the list
        at: Date.now(),
        text:
          kind === "issue"
            ? `${who} took ${qty} × ${tool?.name ?? "tool"}`
            : `${KIND_VERB[kind]} ${qty} × ${tool?.name ?? "tool"}`,
      });
      router.refresh();
    });
  }

  return (
    <section className="page-fluid tc-page allow-portrait" style={{ paddingBottom: 110 }}>
      <style>{CRIB_CSS}</style>

      {/* ── Header ───────────────────────────────────────────── */}
      <header className="tc-head">
        <div style={{ minWidth: 0 }}>
          <div className="tc-eyebrow">🧰 Tool crib</div>
          <h1 className="tc-title">{activeVendorName}</h1>
          <div className="tc-sub">
            {optimistic.length} tool{optimistic.length === 1 ? "" : "s"}
            {takenToday > 0 && <> · {takenToday} taken today</>}
            {short.length > 0 && (
              <> · <span style={{ color: "var(--danger)", fontWeight: 700 }}>{short.length} short</span></>
            )}
          </div>
        </div>

        {canManage && (
          <button type="button" className="tc-add" onClick={() => { setEditing(null); setAddOpen(true); }}>
            + Add tool
          </button>
        )}
      </header>

      {/* Crib switcher — three vendors, so pills beat a dropdown. */}
      {vendors.length > 1 && (
        <div className="tc-vendors">
          {vendors.map((v) => (
            <Link
              key={v.id}
              href={`/tools?vendor=${v.id}`}
              className={`tc-vendor ${v.id === activeVendorId ? "on" : ""}`}
            >
              {v.name}
            </Link>
          ))}
        </div>
      )}

      {err && (
        <div className="tc-err" role="alert">
          <span>⚠ {err}</span>
          <button type="button" onClick={() => setErr(null)} aria-label="Dismiss">✕</button>
        </div>
      )}

      {/* ── Shortages ────────────────────────────────────────── */}
      {short.length > 0 && (
        <div className="tc-short">
          <div className="tc-short-head">
            <span className="tc-short-dot" />
            {short.filter((t) => t.stock <= 0).length > 0
              ? `${short.filter((t) => t.stock <= 0).length} finished, ${short.filter((t) => t.stock > 0).length} running low`
              : `${short.length} tool${short.length === 1 ? "" : "s"} running low`}
          </div>
          <div className="tc-short-list">
            {short.slice(0, 6).map((t) => (
              <button
                key={t.id}
                type="button"
                className="tc-short-pill"
                data-out={t.stock <= 0 ? "1" : undefined}
                onClick={() => canManage && setIntent({ tool: t, kind: "receive" })}
                title={canManage ? "Add stock" : undefined}
              >
                <strong>{t.name}</strong>
                <span>{t.stock <= 0 ? "empty" : `${t.stock} left`}</span>
              </button>
            ))}
            {short.length > 6 && <span className="tc-short-more">+{short.length - 6} more</span>}
          </div>
        </div>
      )}

      {/* ── Search ───────────────────────────────────────────── */}
      {optimistic.length > 0 && (
        <div className="tc-search">
          <span aria-hidden>🔍</span>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={`Search ${activeVendorName}'s tools…`}
            aria-label="Search tools"
          />
          {q && <button type="button" onClick={() => setQ("")} aria-label="Clear">✕</button>}
        </div>
      )}

      {/* ── Grid ─────────────────────────────────────────────── */}
      {optimistic.length === 0 ? (
        <EmptyCrib vendorName={activeVendorName} canManage={canManage} onAdd={() => { setEditing(null); setAddOpen(true); }} />
      ) : visible.length === 0 ? (
        <div className="tc-empty-search">Nothing matches “{q}”.</div>
      ) : (
        <div className="tc-grid">
          {visible.map((t) => (
            <ToolCard
              key={t.id}
              tool={t}
              canManage={canManage}
              menuOpen={menuFor === t.id}
              onMenu={() => setMenuFor((m) => (m === t.id ? null : t.id))}
              onCloseMenu={() => setMenuFor(null)}
              onMove={(kind) => { setMenuFor(null); setIntent({ tool: t, kind }); }}
              onEdit={() => { setMenuFor(null); setEditing(t); setAddOpen(true); }}
            />
          ))}
        </div>
      )}

      {/* ── Sheets ───────────────────────────────────────────── */}
      <MoveSheet
        intent={intent}
        vendorId={activeVendorId}
        people={people}
        busy={pending}
        onClose={() => setIntent(null)}
        onSubmit={submitMove}
      />
      <AddToolSheet
        open={addOpen}
        editing={editing}
        vendorId={activeVendorId}
        vendorName={activeVendorName}
        busy={pending}
        onClose={() => { setAddOpen(false); setEditing(null); }}
        onSubmit={(fd, mode) => {
          setAddOpen(false);
          run(() => (mode === "edit" ? updateToolAction(fd) : createToolAction(fd)), (msg) =>
            setDone({ movementId: null, at: Date.now(), text: msg ?? "Saved" }),
          );
          setEditing(null);
        }}
      />

      {done && (
        <UndoToast
          done={done}
          movements={movements}
          onDismiss={() => setDone(null)}
          onUndo={(id) => {
            const fd = new FormData();
            fd.set("movement_id", id);
            setDone(null);
            run(() => undoMovementAction(fd));
          }}
        />
      )}
    </section>
  );
}

// ── Tool card ──────────────────────────────────────────────────────

function ToolCard({
  tool, canManage, menuOpen, onMenu, onCloseMenu, onMove, onEdit,
}: {
  tool: ToolRow;
  canManage: boolean;
  menuOpen: boolean;
  onMenu: () => void;
  onCloseMenu: () => void;
  onMove: (k: ToolMovementKind) => void;
  onEdit: () => void;
}) {
  const level = tool.stock <= 0 ? "out" : tool.stock <= tool.lowLine ? "low" : "ok";
  // The bar is stock against three times the warning line — a scale that
  // means something per tool, instead of a percentage of a maximum no
  // tool actually has.
  const full = Math.max(tool.lowLine * 3, tool.stock, 1);
  const pct = Math.max(tool.stock > 0 ? 4 : 0, Math.min(100, (tool.stock / full) * 100));

  return (
    <article className="tc-card" data-level={level}>
      <div className="tc-card-top">
        <div style={{ minWidth: 0, flex: 1 }}>
          <h2 className="tc-name" title={tool.name}>{tool.name}</h2>
          {tool.spec && <div className="tc-spec">{tool.spec}</div>}
        </div>
        {canManage && (
          <div style={{ position: "relative", flex: "0 0 auto" }}>
            <button type="button" className="tc-dots" onClick={onMenu} aria-label="More">⋯</button>
            {menuOpen && (
              <>
                <div className="tc-menu-scrim" onClick={onCloseMenu} />
                <div className="tc-menu" role="menu">
                  <button type="button" onClick={() => onMove("receive")}>➕ Add stock</button>
                  <button type="button" onClick={() => onMove("return")}>↩ Return</button>
                  <button type="button" onClick={() => onMove("scrap")}>🗑 Scrap</button>
                  <button type="button" onClick={() => onMove("adjust")}>⚖ Fix count</button>
                  <div className="tc-menu-sep" />
                  <button type="button" onClick={onEdit}>✎ Edit tool</button>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      <div className="tc-stock">
        <span className="tc-stock-n">{tool.stock}</span>
        <span className="tc-stock-u">{tool.unit}</span>
      </div>

      <div className="tc-bar" aria-hidden>
        <i style={{ width: `${pct}%` }} />
      </div>

      <div className="tc-last">
        {level === "out"
          ? <span className="tc-flag">Empty — nothing left</span>
          : level === "low"
            ? <span className="tc-flag">Low — warns at {tool.lowLine}</span>
            : tool.lastMovement
              ? <>{describe(tool.lastMovement)} · {ago(tool.lastMovement.created_at)}</>
              : <>Nothing taken yet</>}
      </div>

      <div className="tc-actions">
        <button type="button" className="tc-take" disabled={tool.stock <= 0} onClick={() => onMove("issue")}>
          {tool.stock <= 0 ? "Nothing to take" : "Take out"}
        </button>
        <Link href={`/tools/${tool.id}`} className="tc-hist" title="Register for this tool">
          Register
        </Link>
      </div>
    </article>
  );
}

// ── Undo toast ─────────────────────────────────────────────────────

/**
 * The replacement for an approval queue.
 *
 * It counts down the real window from lib/cnc-tool-stock, and the undo
 * itself is re-checked on the server — this is a convenience, not a
 * permission.
 */
function UndoToast({
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
  if (left <= 0) {
    if (timer.current) { clearInterval(timer.current); timer.current = null; }
  }

  // The freshest live movement is the one just written; the server
  // refresh hands it back with its real id.
  const latest = movements.find((m) => !m.undone_at) ?? null;
  const canUndo = left > 0 && latest != null;
  const mm = Math.floor(left / 60000);
  const ss = Math.floor((left % 60000) / 1000);

  return (
    <div className="tc-toast" role="status">
      <span className="tc-toast-tick">✓</span>
      <span className="tc-toast-text">{done.text}</span>
      {canUndo ? (
        <button type="button" className="tc-toast-undo" onClick={() => onUndo(latest.id)}>
          Undo <span>{mm}:{String(ss).padStart(2, "0")}</span>
        </button>
      ) : (
        <button type="button" className="tc-toast-close" onClick={onDismiss} aria-label="Dismiss">✕</button>
      )}
    </div>
  );
}

// ── Empty state ────────────────────────────────────────────────────

function EmptyCrib({
  vendorName, canManage, onAdd,
}: { vendorName: string; canManage: boolean; onAdd: () => void }) {
  return (
    <div className="tc-empty">
      <div className="tc-empty-icon">🧰</div>
      <h2>{vendorName}&apos;s crib is empty</h2>
      <p>
        There is no fixed list of tools — you build it. Add the first one the way the men say it,
        like <strong>450mm tool</strong>, and put the stock you have in hand against it.
      </p>
      {canManage && (
        <button type="button" onClick={onAdd}>+ Add the first tool</button>
      )}
    </div>
  );
}

// ── Helpers ────────────────────────────────────────────────────────

function describe(m: ToolMovement): string {
  if (m.kind === "issue") return `${m.taken_by ?? "Someone"} took ${Math.abs(m.delta)}`;
  if (m.kind === "return") return `${m.taken_by ?? "Someone"} returned ${m.delta}`;
  if (m.kind === "receive") return `Added ${m.delta}`;
  if (m.kind === "scrap") return `Scrapped ${Math.abs(m.delta)}`;
  return `Count fixed by ${m.delta > 0 ? "+" : ""}${m.delta}`;
}

function ago(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return d === 1 ? "yesterday" : `${d}d ago`;
}

const CRIB_CSS = `
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

.tc-vendors { display:flex; gap:8px; flex-wrap:wrap; margin-bottom:16px; }
.tc-vendor {
  padding:9px 18px; font-size:13.5px; font-weight:700; border-radius:999px; text-decoration:none;
  border:1.5px solid var(--border); background:var(--surface); color:var(--muted);
}
.tc-vendor.on { border-color:var(--gold-dark); background:var(--gold); color:#fff; }

.tc-err {
  display:flex; gap:12px; align-items:center; justify-content:space-between;
  padding:12px 16px; border-radius:11px; margin-bottom:14px; font-size:13.5px; font-weight:700;
  background:var(--danger-bg); color:var(--danger);
}
.tc-err button { border:none; background:none; color:inherit; cursor:pointer; font-size:14px; }

.tc-short {
  border:1px solid var(--danger); border-left-width:4px; border-radius:13px;
  background:var(--danger-bg); padding:13px 16px; margin-bottom:16px;
}
.tc-short-head { display:flex; align-items:center; gap:9px; font-size:13.5px; font-weight:800; color:var(--danger); }
.tc-short-dot { width:9px; height:9px; border-radius:50%; background:var(--danger); animation:tc-pulse 1.9s ease-in-out infinite; }
@keyframes tc-pulse { 0%,100%{opacity:1} 50%{opacity:.35} }
.tc-short-list { display:flex; flex-wrap:wrap; gap:8px; margin-top:10px; align-items:center; }
.tc-short-pill {
  display:flex; align-items:baseline; gap:7px; padding:7px 13px; border-radius:999px; cursor:pointer;
  border:1px solid var(--border); background:var(--surface); font-size:12.5px; color:var(--text);
}
.tc-short-pill strong { font-weight:800; }
.tc-short-pill span { color:var(--muted); }
.tc-short-pill[data-out] span { color:var(--danger); font-weight:700; }
.tc-short-more { font-size:12px; color:var(--danger); font-weight:700; }

.tc-search {
  display:flex; align-items:center; gap:10px; padding:0 14px; margin-bottom:16px;
  border:1px solid var(--border); border-radius:13px; background:var(--surface);
}
.tc-search input {
  flex:1; border:none; background:transparent; outline:none; color:var(--text);
  font-size:15px; padding:14px 0;
}
.tc-search button { border:none; background:none; color:var(--muted); cursor:pointer; font-size:13px; }

.tc-grid { display:grid; grid-template-columns:repeat(auto-fill, minmax(260px, 1fr)); gap:14px; }

.tc-card {
  border:1px solid var(--border); border-radius:16px; background:var(--surface);
  padding:16px 17px 14px; display:flex; flex-direction:column;
  transition:transform .12s ease, box-shadow .12s ease, border-color .12s ease;
  position:relative;
}
@media (hover:hover) { .tc-card:hover { transform:translateY(-2px); box-shadow:0 10px 26px rgba(45,36,16,.1); } }
.tc-card[data-level="low"] { border-color:var(--warning); }
.tc-card[data-level="out"] { border-color:var(--danger); background:linear-gradient(180deg, var(--danger-bg) 0%, var(--surface) 42%); }

.tc-card-top { display:flex; gap:10px; align-items:flex-start; }
.tc-name { font-size:15.5px; font-weight:800; color:var(--text); margin:0; line-height:1.25; overflow-wrap:anywhere; }
.tc-spec { font-size:12px; color:var(--muted); margin-top:2px; }
.tc-dots { width:30px; height:30px; border-radius:9px; border:1px solid var(--border); background:var(--surface-alt); color:var(--muted); cursor:pointer; font-size:15px; line-height:1; }

.tc-menu-scrim { position:fixed; inset:0; z-index:40; }
.tc-menu {
  position:absolute; right:0; top:34px; z-index:41; min-width:168px; padding:6px;
  background:var(--surface); border:1px solid var(--border); border-radius:12px;
  box-shadow:0 14px 34px rgba(0,0,0,.2);
}
.tc-menu button {
  display:block; width:100%; text-align:left; padding:10px 12px; font-size:13.5px; font-weight:600;
  border:none; background:none; color:var(--text); cursor:pointer; border-radius:8px;
}
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
.tc-take {
  flex:1; padding:12px 14px; font-size:14px; font-weight:800; border-radius:11px; border:none;
  cursor:pointer; color:#fff; background:linear-gradient(135deg, var(--gold) 0%, var(--gold-dark) 100%);
}
.tc-take:disabled { background:var(--border); color:var(--muted); cursor:not-allowed; }
.tc-hist {
  padding:12px 14px; font-size:13px; font-weight:700; border-radius:11px; text-decoration:none;
  border:1px solid var(--border); background:var(--surface); color:var(--muted); white-space:nowrap;
}

.tc-empty { text-align:center; padding:52px 24px; border:1px dashed var(--border); border-radius:16px; background:var(--surface); }
.tc-empty-icon { font-size:46px; }
.tc-empty h2 { font-size:19px; font-weight:800; margin:12px 0 8px; color:var(--text); }
.tc-empty p { font-size:14px; color:var(--muted); max-width:430px; margin:0 auto; line-height:1.6; }
.tc-empty button {
  margin-top:20px; padding:13px 24px; font-size:14.5px; font-weight:800; border-radius:12px; border:none;
  color:#fff; cursor:pointer; background:linear-gradient(135deg, var(--gold) 0%, var(--gold-dark) 100%);
}
.tc-empty-search { padding:36px; text-align:center; color:var(--muted); font-size:14px; }

.tc-toast {
  position:fixed; left:50%; transform:translateX(-50%);
  bottom:calc(18px + env(safe-area-inset-bottom, 0px)); z-index:1100;
  display:flex; align-items:center; gap:12px; max-width:min(540px, calc(100vw - 24px));
  padding:12px 14px 12px 16px; border-radius:14px;
  background:#1b1710; color:#fff; box-shadow:0 14px 40px rgba(0,0,0,.4);
  animation:tc-rise .22s ease-out;
}
@keyframes tc-rise { from { opacity:0; transform:translate(-50%, 14px); } to { opacity:1; transform:translate(-50%, 0); } }
.tc-toast-tick { color:#4ade80; font-weight:800; }
.tc-toast-text { font-size:13.5px; font-weight:600; flex:1; min-width:0; }
.tc-toast-undo {
  display:flex; align-items:center; gap:7px; padding:9px 15px; border-radius:10px; cursor:pointer;
  border:1px solid rgba(255,255,255,.26); background:rgba(255,255,255,.1); color:#fff;
  font-size:13px; font-weight:800; white-space:nowrap;
}
.tc-toast-undo span { font-family:ui-monospace, monospace; font-weight:600; opacity:.7; font-size:12px; }
.tc-toast-close { border:none; background:none; color:rgba(255,255,255,.6); cursor:pointer; font-size:14px; }

@media (max-width:560px) {
  .tc-title { font-size:25px; }
  .tc-add { margin-left:0; width:100%; }
  .tc-grid { grid-template-columns:1fr; }
}
`;
