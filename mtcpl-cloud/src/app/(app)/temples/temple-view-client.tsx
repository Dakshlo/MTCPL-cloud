"use client";

// Temple View — client tree. Pick a temple, drill the component tree
// (Section › … › Element), each node shows a stage progress bar + counts.
// Leaf nodes expand to the slab list. Read-only.

import { useEffect, useMemo, useRef, useState, useTransition, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { isParkotaTemple } from "@/lib/parkota-access";
import { TempleCardBrowser } from "./temple-card-browser";
import { decideCancelledSlabAction } from "../slabs/cancel-actions";
import {
  STAGE_META, STAGE_ORDER, bucketOf, stoneLabel, calcCft,
  type StageBucket, type ComponentImage, type TempleSlabCard, type TempleTreeNode, type TempleTree, type TempleCats,
} from "./temple-shared";

// Re-export the types page.tsx imports from here.
export type { StageBucket, ComponentImage, TempleSlabCard, TempleTreeNode, TempleTree, TempleCats };

const STATUS_LABEL: Record<string, string> = {
  open: "Open", planned: "Planned", cutting: "Cutting", cut_done: "Cut done",
  carving_assigned: "Carving assigned", carving_in_progress: "Carving", completed: "Completed",
  dispatched: "Dispatched", rejected: "Rejected", cancelled: "Cancelled",
};

// One slab card — mirrors the Ready Sizes card fields (code, dims, CFT,
// stone, quality, priority) in a compact stage-coloured card.
// Mig 132 — a CANCELLED slab card carries the replace / no-replace
// decision buttons until resolved; a replacement slab shows a
// "needs to cut" chip.
function SlabCard({ s, delay = 0, canDecide = false }: { s: TempleSlabCard; delay?: number; canDecide?: boolean }) {
  const router = useRouter();
  const [busy, startBusy] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const bucket = bucketOf(s.status);
  const color = STAGE_META[bucket].color;
  const cft = calcCft(s.l, s.w, s.t);
  const isCancelled = s.status === "cancelled";
  const needsDecision = isCancelled && !s.cancelResolution;

  function decide(choice: "no_replacement" | "create_new") {
    if (busy) return;
    if (choice === "create_new" && !confirm(`Create a NEW slab identical to ${s.id} (new code, status Open — goes through cutting again)?`)) return;
    if (choice === "no_replacement" && !confirm(`Close ${s.id} with NO replacement slab?`)) return;
    setErr(null);
    const fd = new FormData();
    fd.set("slab_id", s.id);
    fd.set("choice", choice);
    startBusy(async () => {
      try {
        const res = await decideCancelledSlabAction(fd);
        if (!res.ok) {
          setErr(res.error);
          return;
        }
        router.refresh();
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
      }
    });
  }

  return (
    <div
      id={`tv-slab-${s.id}`}
      title={STATUS_LABEL[s.status] ?? s.status}
      className="tv-anim tv-slab"
      style={{
        animationDelay: `${delay}ms`,
        border: isCancelled ? "1.5px solid rgba(127,29,29,0.55)" : `1px solid var(--border)`,
        borderLeft: `4px solid ${color}`,
        borderRadius: 10,
        background: isCancelled ? "rgba(127,29,29,0.06)" : "var(--surface)",
        padding: "8px 10px",
        display: "flex",
        flexDirection: "column",
        gap: 3,
        minWidth: 0,
      }}
    >
      {/* flexWrap + a non-shrinking code = the slab code is NEVER clipped; a
          long status badge wraps to its own line instead of ellipsizing it. */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
        <code style={{ fontFamily: "ui-monospace, monospace", fontWeight: 800, fontSize: 12, whiteSpace: "nowrap", flexShrink: 0 }}>{s.id}</code>
        {s.priority && <span style={{ fontSize: 12 }}>⚡</span>}
        <span style={{ marginLeft: "auto", fontSize: 9.5, fontWeight: 800, color: "#fff", background: color, borderRadius: 999, padding: "1px 7px", textTransform: "uppercase", whiteSpace: "nowrap" }}>
          {STAGE_META[bucket].label}
        </span>
      </div>
      <div style={{ fontFamily: "ui-monospace, monospace", fontSize: 11.5, color: "var(--text)" }}>
        {s.l}&quot; × {s.w}&quot; × {s.t}&quot; <span className="muted">· {cft.toFixed(2)} CFT</span>
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {s.stone && <span style={{ fontSize: 10, fontWeight: 700, color: "var(--muted)" }}>🗿 {stoneLabel(s.stone)}</span>}
        {s.quality && <span style={{ fontSize: 10, fontWeight: 700, color: s.quality === "A" ? "#15803d" : "#b45309" }}>Grade {s.quality}</span>}
        {/* Mig 132 — this slab is the replacement of a cancelled one. */}
        {s.replacementOf && (
          <span title={`Replacement of cancelled ${s.replacementOf}`} style={{ fontSize: 9.5, fontWeight: 800, color: "#92400e", background: "rgba(180,83,9,0.12)", border: "1px solid rgba(180,83,9,0.35)", borderRadius: 999, padding: "1px 7px", whiteSpace: "nowrap" }}>
            🪨 new — needs to cut
          </span>
        )}
      </div>

      {/* Mig 132 — cancelled-slab block: reason + decision / outcome. */}
      {isCancelled && (
        <div style={{ display: "flex", flexDirection: "column", gap: 5, marginTop: 3, borderTop: "1px dashed rgba(127,29,29,0.4)", paddingTop: 5 }}>
          {s.cancelReason && (
            <div style={{ fontSize: 10.5, color: "#7f1d1d", lineHeight: 1.4 }}>📝 {s.cancelReason}</div>
          )}
          {needsDecision ? (
            <>
              <div style={{ fontSize: 10.5, fontWeight: 800, color: "#7f1d1d" }}>
                ❌ Cancelled — create a new slab in its place?
              </div>
              {err && <div style={{ fontSize: 10.5, color: "#b91c1c", fontWeight: 700 }}>⚠ {err}</div>}
              {canDecide && (
                <div style={{ display: "flex", gap: 6 }}>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => decide("create_new")}
                    style={{ flex: 1, fontSize: 11, fontWeight: 800, padding: "7px 8px", borderRadius: 7, border: "none", background: busy ? "var(--border)" : "#15803d", color: "#fff", cursor: busy ? "wait" : "pointer" }}
                  >
                    ➕ Create new
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => decide("no_replacement")}
                    style={{ flex: 1, fontSize: 11, fontWeight: 800, padding: "7px 8px", borderRadius: 7, border: "1.5px solid rgba(127,29,29,0.45)", background: "transparent", color: "#7f1d1d", cursor: busy ? "wait" : "pointer" }}
                  >
                    No need of new
                  </button>
                </div>
              )}
            </>
          ) : (
            <div style={{ fontSize: 10.5, fontWeight: 800, color: "#7f1d1d" }}>
              {s.cancelResolution === "replaced"
                ? <>✓ Replaced by <code style={{ fontFamily: "ui-monospace, monospace" }}>{s.replacementSlabId}</code></>
                : "✓ Closed — no replacement needed"}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function StageBar({ counts, total, animate = true }: { counts: Record<StageBucket, number>; total: number; animate?: boolean }) {
  if (total === 0) return null;
  return (
    <div className={animate ? "tv-bar" : undefined} style={{ display: "flex", height: 10, borderRadius: 999, overflow: "hidden", background: "var(--surface-alt, rgba(0,0,0,0.05))", minWidth: 120 }}>
      {STAGE_ORDER.map((s) => {
        const n = counts[s];
        if (!n) return null;
        return <div key={s} title={`${STAGE_META[s].label}: ${n}`} style={{ width: `${(n / total) * 100}%`, background: STAGE_META[s].color }} />;
      })}
    </div>
  );
}

/** Compact SVG progress ring for the temple header (% done at a glance). */
function HeaderRing({ pct, size = 54 }: { pct: number; size?: number }) {
  const stroke = 5;
  const r = (size - stroke * 2) / 2;
  const c = 2 * Math.PI * r;
  const filled = Math.max(0, Math.min(100, pct)) / 100 * c;
  return (
    <div style={{ position: "relative", width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ display: "block" }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(148,163,184,0.25)" strokeWidth={stroke} />
        <circle
          cx={size / 2} cy={size / 2} r={r} fill="none"
          stroke={STAGE_META.done.color} strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={`${filled} ${c}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          style={{ transition: "stroke-dasharray .7s cubic-bezier(.2,.7,.3,1)" }}
        />
      </svg>
      <span style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: size * 0.26, fontWeight: 900 }}>{pct}%</span>
    </div>
  );
}

function CountChips({ counts, onPick, active = null }: { counts: Record<StageBucket, number>; onPick?: (s: StageBucket) => void; active?: StageBucket | null }) {
  const clickable = !!onPick;
  return (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
      {STAGE_ORDER.filter((s) => counts[s] > 0).map((s) => {
        const isActive = active === s;
        const dim = active != null && !isActive;
        return (
          <button
            key={s}
            type="button"
            onClick={clickable ? () => onPick!(s) : undefined}
            title={clickable ? (isActive ? "Showing only this — click to show all" : `Show only ${STAGE_META[s].label} slabs`) : undefined}
            style={{
              fontSize: 10.5, fontWeight: 800, color: "#fff", background: STAGE_META[s].color,
              borderRadius: 999, padding: "2px 9px", whiteSpace: "nowrap", border: "none",
              cursor: clickable ? "pointer" : "default",
              opacity: dim ? 0.38 : 1,
              boxShadow: isActive ? "0 0 0 2px var(--text)" : "none",
              transition: "opacity .15s ease, box-shadow .15s ease",
            }}
          >
            {counts[s]} {STAGE_META[s].label}{isActive ? "  ✕" : ""}
          </button>
        );
      })}
    </div>
  );
}

function TreeNode({ node, depth, idx = 0, imagesByNode, openMode, canDecide = false }: { node: TempleTreeNode; depth: number; idx?: number; imagesByNode: Record<string, ComponentImage[]>; openMode: "default" | "all" | "none"; canDecide?: boolean }) {
  const isLeaf = node.children.length === 0;
  // Initial open state from the current expand mode (the parent remounts the
  // tree when the mode changes, so this initializer re-runs).
  const [open, setOpen] = useState(openMode === "all" ? true : openMode === "none" ? false : depth < 1);
  const done = node.counts.done;
  const images = imagesByNode[node.id] ?? [];
  const pct = node.total > 0 ? Math.round((done / node.total) * 100) : 0;
  // Visual hierarchy: Category-1 = bold card; deeper = lighter, indented.
  const bg = depth === 0 ? "var(--surface)" : depth === 1 ? "var(--surface-alt, rgba(0,0,0,0.02))" : "transparent";
  return (
    <div className="tv-anim" style={{ animationDelay: `${Math.min(idx * 35, 350)}ms`, marginLeft: depth === 0 ? 0 : 16, borderLeft: depth > 0 ? "2px solid var(--border)" : "none", paddingLeft: depth > 0 ? 6 : 0 }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="tv-row"
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: depth === 0 ? "11px 12px" : "7px 10px",
          background: bg,
          border: depth <= 1 ? "1px solid var(--border)" : "1px solid transparent",
          borderRadius: 10,
          cursor: "pointer",
          textAlign: "left",
          color: "var(--text)",
        }}
      >
        <span className={`tv-caret${open ? " open" : ""}`} style={{ fontSize: 11, color: open ? "var(--gold-dark)" : "var(--muted)", width: 12, flexShrink: 0 }}>▶</span>
        <span style={{ fontWeight: depth === 0 ? 800 : 700, fontSize: depth === 0 ? 14.5 : depth === 1 ? 13 : 12.5, flex: "0 1 auto", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {isLeaf ? "🔹 " : depth === 0 ? "📂 " : "📁 "}{node.name}
        </span>
        {images.length > 0 && <span title={`${images.length} photo(s) — open 🖼 Cards view to see them`} style={{ fontSize: 11, flexShrink: 0 }}>📷</span>}
        <span style={{ flex: 1 }} />
        {pct === 100 && <span style={{ fontSize: 12, flexShrink: 0 }}>✅</span>}
        <span style={{ fontSize: 12, fontWeight: 800, color: pct === 100 ? STAGE_META.done.color : "var(--muted)", flexShrink: 0, whiteSpace: "nowrap" }}>
          {done}/{node.total} · {pct}%
        </span>
        <span style={{ width: 120, flexShrink: 0 }}><StageBar counts={node.counts} total={node.total} animate={false} /></span>
      </button>

      {open && (
        <div style={{ marginTop: 5, display: "flex", flexDirection: "column", gap: 5 }}>
          {!isLeaf && node.children.map((c, i) => <TreeNode key={c.id} node={c} depth={depth + 1} idx={i} imagesByNode={imagesByNode} openMode={openMode} canDecide={canDecide} />)}
          {isLeaf && (
            <div style={{ marginLeft: 22, marginBottom: 8 }}>
              <div className="tv-anim" style={{ marginBottom: 8 }}><CountChips counts={node.counts} /></div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 8 }}>
                {node.slabs.map((s, i) => <SlabCard key={s.id} s={s} delay={Math.min(i * 18, 300)} canDecide={canDecide} />)}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Stage legend — explains every colour, including what "Rejected" means.
const STAGE_HELP: Record<StageBucket, string> = {
  pending: "Not started yet (open / planned).",
  cutting: "Actively being cut.",
  cut_done: "Cut and ready to assign to carving (not yet sent to a vendor).",
  carving: "Out for carving (CNC / vendor).",
  ready_dispatch: "Carving done & approved — staged in the Dispatch Station, not shipped yet.",
  done: "Dispatched — shipped out (the real done).",
  rejected: "Rejected during a cutting or carving quality check — not usable, kept on record only.",
  cancelled: "Broken / unusable — cancel approved by the owner. Decide here whether to create a replacement slab.",
};
function StageLegend() {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 12, padding: "10px 14px", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10 }}>
      {STAGE_ORDER.map((s) => (
        <span key={s} title={STAGE_HELP[s]} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11.5, color: "var(--muted)", cursor: "help" }}>
          <span style={{ width: 11, height: 11, borderRadius: 3, background: STAGE_META[s].color, flexShrink: 0 }} />
          <strong style={{ color: "var(--text)" }}>{STAGE_META[s].label}</strong>
          {s === "rejected" && <span style={{ fontSize: 10.5 }}>= failed quality check</span>}
        </span>
      ))}
    </div>
  );
}

export function TempleViewClient({ trees, imagesByNode, canManageImages, canEditCategories = false, templeCats, cancelAlerts = [], canOpenParkota = false }: { trees: TempleTree[]; imagesByNode: Record<string, ComponentImage[]>; canManageImages: boolean; canEditCategories?: boolean; templeCats: TempleCats; cancelAlerts?: Array<{ slabId: string; temple: string }>; canOpenParkota?: boolean }) {
  const [selected, setSelected] = useState<string>(trees[0]?.temple ?? "");
  const [q, setQ] = useState("");
  // Mig 132 — the replace / no-replace decision uses the same write
  // circle as image management (owner / dev / heads / senior).
  const canDecide = canManageImages;
  // Component browsing: filter within the selected temple + expand/collapse all.
  const [nodeQ, setNodeQ] = useState("");
  const [openMode, setOpenMode] = useState<"default" | "all" | "none">("default");
  const [treeKey, setTreeKey] = useState(0);
  // Click a stage chip to show ONLY that stage's slabs (toggle off to clear).
  const [stageFilter, setStageFilter] = useState<StageBucket | null>(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { setStageFilter(null); }, [selected]);

  // ── Parkota tracker entry point (mig 207) ────────────────────────────
  // The Baba Mastnath card doubles as the door to the parkota pillar board.
  // Deliberately a 2-second press rather than a button: the tracker is a
  // separate full-screen tool, so nobody should land in it from a stray tap
  // while browsing temples — and the card keeps behaving normally on a tap.
  const HOLD_MS = 2000;
  const [holdTemple, setHoldTemple] = useState<string | null>(null);
  const [holdPct, setHoldPct] = useState(0);
  const [askParkota, setAskParkota] = useState(false);
  const [mounted, setMounted] = useState(false);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const holdRaf = useRef<number | null>(null);
  const holdFired = useRef(false);
  const holdFrom = useRef<{ x: number; y: number } | null>(null);
  useEffect(() => setMounted(true), []);

  function cancelHold() {
    if (holdTimer.current) { clearTimeout(holdTimer.current); holdTimer.current = null; }
    if (holdRaf.current !== null) { cancelAnimationFrame(holdRaf.current); holdRaf.current = null; }
    holdFrom.current = null;
    setHoldTemple(null);
    setHoldPct(0);
  }
  useEffect(() => cancelHold, []);

  function startHold(temple: string, x: number, y: number) {
    holdFired.current = false;
    holdFrom.current = { x, y };
    setHoldTemple(temple);
    setHoldPct(0);
    const t0 = performance.now();
    const tick = () => {
      const p = Math.min(1, (performance.now() - t0) / HOLD_MS);
      setHoldPct(p);
      if (p < 1) holdRaf.current = requestAnimationFrame(tick);
    };
    holdRaf.current = requestAnimationFrame(tick);
    holdTimer.current = setTimeout(() => {
      holdFired.current = true;   // suppress the click that follows the release
      cancelHold();
      setAskParkota(true);
      try { navigator.vibrate?.(35); } catch { /* not supported — fine */ }
    }, HOLD_MS);
  }

  // A press that turns into a scroll must not count as a hold.
  function moveHold(x: number, y: number) {
    const from = holdFrom.current;
    if (!from) return;
    if (Math.abs(x - from.x) > 12 || Math.abs(y - from.y) > 12) cancelHold();
  }
  // View modes: list (default) or immersive fullscreen cards; plus a
  // hide-menu toggle for a bigger list page.
  const [cardMode, setCardMode] = useState(false);
  const [menuHidden, setMenuHidden] = useState(false);
  // Survive a full page reload in fullscreen cards mode (restore runs once on
  // mount, after hydration; the card browser restores the temple/leaf itself).
  useEffect(() => {
    try { if (sessionStorage.getItem("mtcpl_tv_cardmode") === "1") setCardMode(true); } catch { /* ignore */ }
  }, []);
  useEffect(() => {
    try { sessionStorage.setItem("mtcpl_tv_cardmode", cardMode ? "1" : "0"); } catch { /* ignore */ }
  }, [cardMode]);
  // Collapse the app sidebar (body class from globals.css) whenever the menu
  // is hidden OR we're in fullscreen cards mode. Cleaned up on unmount.
  useEffect(() => {
    if (typeof document === "undefined") return;
    const hide = menuHidden || cardMode;
    document.body.classList.toggle("vendor-cockpit-fullscreen", hide);
    return () => document.body.classList.remove("vendor-cockpit-fullscreen");
  }, [menuHidden, cardMode]);

  // Mig 132 — jump from the cancel alert to the exact slab in the tree:
  // select its temple, expand everything, then scroll the card into view.
  function jumpToSlab(slabId: string, temple: string) {
    setCardMode(false);
    setSelected(temple);
    setNodeQ("");
    setOpenMode("all");
    setTreeKey((k) => k + 1);
    // Wait for the remount, then scroll + flash the card.
    setTimeout(() => {
      const el = document.getElementById(`tv-slab-${slabId}`);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        el.style.transition = "box-shadow .25s ease";
        el.style.boxShadow = "0 0 0 3px rgba(185,28,28,0.6)";
        setTimeout(() => { el.style.boxShadow = ""; }, 1800);
      }
    }, 120);
  }

  const filteredTemples = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return trees;
    return trees.filter((t) => t.temple.toLowerCase().includes(needle));
  }, [q, trees]);

  const current = trees.find((t) => t.temple === selected) ?? filteredTemples[0] ?? trees[0];

  // Roots filtered by the component search box (keeps a branch if any
  // descendant name matches).
  const nq = nodeQ.trim().toLowerCase();
  let visibleRoots = current
    ? current.roots.map((r) => filterNode(r, nq)).filter((x): x is TempleTreeNode => x !== null)
    : [];
  if (stageFilter) {
    visibleRoots = visibleRoots.map((r) => filterNodeByStage(r, stageFilter)).filter((x): x is TempleTreeNode => x !== null);
  }

  if (trees.length === 0) {
    return <div className="banner">No slabs yet. Import slabs (with Category 1 / 2 / Label filled) to see them organised here.</div>;
  }

  // Immersive fullscreen card browser.
  if (cardMode) {
    return (
      <TempleCardBrowser
        trees={trees}
        imagesByNode={imagesByNode}
        canManageImages={canManageImages}
        canEditCategories={canEditCategories}
        templeCats={templeCats}
        onExit={() => setCardMode(false)}
      />
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {/* Motion polish — cascade entrance, rotating carets, bar fill, hover
          lift. Pure CSS; replays when the temple / tree key changes. */}
      <style>{`
        @keyframes tvIn { from { opacity: 0; transform: translateY(9px); } to { opacity: 1; transform: none; } }
        @keyframes tvBarIn { from { transform: scaleX(0); } to { transform: scaleX(1); } }
        .tv-anim { opacity: 0; animation: tvIn .34s cubic-bezier(.2,.7,.3,1) forwards; }
        .tv-bar { transform-origin: left; animation: tvBarIn .65s cubic-bezier(.2,.7,.3,1); }
        .tv-caret { display: inline-block; transition: transform .18s ease, color .18s ease; }
        .tv-caret.open { transform: rotate(90deg); }
        .tv-row { transition: background .15s ease, border-color .15s ease; }
        .tv-row:hover { background: rgba(184,115,51,0.07) !important; border-color: var(--gold-dark) !important; }
        .tv-slab { transition: transform .15s ease, box-shadow .15s ease; }
        .tv-slab:hover { transform: translateY(-3px); box-shadow: 0 10px 22px rgba(0,0,0,.12); }
        .tv-temple { transition: transform .15s ease, border-color .15s ease, background .15s ease; }
        .tv-temple:hover { transform: translateX(3px); border-color: var(--gold-dark) !important; }
      `}</style>
      {/* Mig 132 — cancelled-slab alert. Lists every cancelled slab still
          awaiting the replace / no-replace decision; tap one to jump to it
          in the tree. */}
      {cancelAlerts.length > 0 && (
        <div className="mtcpl-blink" style={{ background: "rgba(127,29,29,0.07)", border: "1.5px solid rgba(127,29,29,0.45)", borderRadius: 12, padding: "11px 14px", display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ fontSize: 13.5, fontWeight: 800, color: "#7f1d1d" }}>
            🚫 {cancelAlerts.length} cancelled slab{cancelAlerts.length === 1 ? "" : "s"} need a decision — create a replacement or close it out
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {cancelAlerts.map((a) => (
              <button
                key={a.slabId}
                type="button"
                onClick={() => jumpToSlab(a.slabId, a.temple)}
                style={{ fontSize: 12, fontWeight: 800, padding: "6px 12px", borderRadius: 999, border: "1.5px solid rgba(127,29,29,0.5)", background: "var(--surface)", color: "#7f1d1d", cursor: "pointer", whiteSpace: "nowrap" }}
                title={`Jump to ${a.slabId} in ${a.temple}`}
              >
                <code style={{ fontFamily: "ui-monospace, monospace" }}>{a.slabId}</code> · 🏛 {a.temple} →
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Parkota confirm — portalled to <body> so an ancestor transform can't
          break position:fixed (the temple cards animate in on mount). */}
      {askParkota && mounted && createPortal(
        <div
          role="dialog"
          aria-modal="true"
          onMouseDown={(e) => { e.stopPropagation(); if (e.target === e.currentTarget) setAskParkota(false); }}
          onKeyDown={(e) => { if (e.key === "Escape") setAskParkota(false); }}
          style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(0,0,0,0.45)", display: "grid", placeItems: "center", padding: 16 }}
        >
          <div style={{ width: "min(430px, 100%)", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 14, padding: "18px 18px 14px", boxShadow: "0 18px 50px rgba(0,0,0,0.32)" }}>
            <div style={{ fontSize: 16.5, fontWeight: 800, marginBottom: 7 }}>⛩ Open Parkota Tracker?</div>
            <div style={{ fontSize: 13, color: "var(--muted)", lineHeight: 1.55, marginBottom: 16 }}>
              The live 645-pillar board for the Baba Mastnath parkota — made / fixed status, parts and stock.
              It opens as a separate full-screen tool in a new tab, and everything you mark there is shared with the rest of the team.
            </div>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button
                type="button"
                autoFocus
                onClick={() => setAskParkota(false)}
                style={{ padding: "9px 15px", fontSize: 13, fontWeight: 700, borderRadius: 9, border: "1.5px solid var(--border)", background: "var(--bg)", color: "var(--text)", cursor: "pointer" }}
              >
                Cancel
              </button>
              <button
                type="button"
                className="primary-button"
                onClick={() => { setAskParkota(false); window.open("/parkota", "_blank", "noopener"); }}
                style={{ cursor: "pointer" }}
              >
                Open tracker →
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}

      {/* View controls */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <div style={{ display: "inline-flex", border: "1px solid var(--border)", borderRadius: 9, overflow: "hidden" }}>
          <span style={{ padding: "7px 13px", fontSize: 12.5, fontWeight: 800, background: "var(--gold-dark)", color: "#fff" }}>📋 List</span>
          <button type="button" onClick={() => setCardMode(true)} style={{ padding: "7px 13px", fontSize: 12.5, fontWeight: 800, background: "var(--surface)", color: "var(--text)", border: "none", borderLeft: "1px solid var(--border)", cursor: "pointer" }}>🖼 Cards (fullscreen)</button>
        </div>
        <button type="button" onClick={() => setMenuHidden((m) => !m)} style={{ padding: "7px 13px", fontSize: 12.5, fontWeight: 700, borderRadius: 9, border: "1px solid var(--border)", background: menuHidden ? "rgba(184,115,51,0.1)" : "var(--surface)", color: menuHidden ? "var(--gold-dark)" : "var(--text)", cursor: "pointer" }}>
          {menuHidden ? "◧ Show menu" : "◨ Hide menu (bigger)"}
        </button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 260px) minmax(0, 1fr)", gap: 16, alignItems: "start" }}>
      {/* Temple list */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8, position: "sticky", top: 8 }}>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search temples…"
          style={{ padding: "8px 11px", fontSize: 13, border: "1px solid var(--border)", borderRadius: 9, background: "var(--bg)", color: "var(--text)" }}
        />
        <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: "72vh", overflowY: "auto" }}>
          {filteredTemples.map((t, i) => {
            const active = current?.temple === t.temple;
            // Only this one temple, and only for the roles that run that site.
            const parkota = canOpenParkota && isParkotaTemple(t.temple);
            const holding = parkota && holdTemple === t.temple;
            return (
              <button
                key={t.temple}
                type="button"
                onClick={() => {
                  // The press already opened the prompt — swallow the click
                  // that the browser fires on release.
                  if (holdFired.current) { holdFired.current = false; return; }
                  setSelected(t.temple);
                }}
                {...(parkota
                  ? {
                      onPointerDown: (e: React.PointerEvent) => {
                        if (e.pointerType === "mouse" && e.button !== 0) return;
                        startHold(t.temple, e.clientX, e.clientY);
                      },
                      onPointerMove: (e: React.PointerEvent) => moveHold(e.clientX, e.clientY),
                      onPointerUp: cancelHold,
                      onPointerLeave: cancelHold,
                      onPointerCancel: cancelHold,
                      onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
                    }
                  : {})}
                className="tv-anim tv-temple"
                style={{
                  animationDelay: `${Math.min(i * 25, 300)}ms`,
                  display: "flex", flexDirection: "column", gap: 4, alignItems: "stretch",
                  padding: "8px 11px", borderRadius: 10, cursor: "pointer", textAlign: "left",
                  border: `1px solid ${active ? "var(--gold-dark)" : "var(--border)"}`,
                  borderLeft: `3px solid ${active ? "var(--gold-dark)" : "var(--border)"}`,
                  background: active ? "rgba(184,115,51,0.07)" : "transparent",
                  ...(parkota ? { position: "relative" as const, overflow: "hidden" as const, userSelect: "none" as const, WebkitUserSelect: "none" as const } : {}),
                }}
              >
                <span style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline" }}>
                  <span style={{ fontWeight: 800, fontSize: 12.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.temple}</span>
                  <span style={{ fontSize: 11.5, fontWeight: 800, color: "var(--muted)", flexShrink: 0 }}>{t.counts.done}/{t.total}</span>
                </span>
                <StageBar counts={t.counts} total={t.total} animate={false} />
                {parkota && (
                  <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: 0.2, color: "var(--gold-dark)", opacity: holding ? 1 : 0.75 }}>
                    ⛩ {holding ? "keep holding…" : "hold 2s → Parkota tracker"}
                  </span>
                )}
                {holding && (
                  <span
                    aria-hidden
                    style={{ position: "absolute", left: 0, bottom: 0, height: 3, width: `${holdPct * 100}%`, background: "var(--gold-dark)", borderRadius: 2 }}
                  />
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Selected temple tree */}
      <div key={current?.temple ?? "none"} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {current ? (
          <>
            {/* Big header: ring + temple + animated full-width stage bar.
                Sticky so the progress stays visible while scrolling the tree. */}
            <div className="tv-anim" style={{ position: "sticky", top: 8, zIndex: 5, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: "13px 16px", display: "flex", alignItems: "center", gap: 14, boxShadow: "0 4px 14px rgba(0,0,0,0.06)" }}>
              <HeaderRing pct={current.total > 0 ? Math.round((current.counts.done / current.total) * 100) : 0} />
              <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 8 }}>
                <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                  <div style={{ fontSize: 18, fontWeight: 800, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>🏛 {current.temple}</div>
                  <div style={{ fontSize: 13.5, fontWeight: 800, whiteSpace: "nowrap" }}>
                    <span style={{ color: STAGE_META.done.color }}>{current.counts.done}</span>
                    <span style={{ color: "var(--muted)" }}> of {current.total} done</span>
                  </div>
                </div>
                <div style={{ height: 14 }}><StageBar counts={current.counts} total={current.total} /></div>
                <CountChips counts={current.counts} active={stageFilter} onPick={(s) => setStageFilter((prev) => (prev === s ? null : s))} />
              </div>
            </div>

            <StageLegend />

            {/* Browse controls: search components + expand/collapse all */}
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <input
                value={nodeQ}
                onChange={(e) => setNodeQ(e.target.value)}
                placeholder="Filter components in this temple…"
                style={{ flex: "1 1 240px", padding: "8px 11px", fontSize: 13, border: "1px solid var(--border)", borderRadius: 9, background: "var(--bg)", color: "var(--text)" }}
              />
              <button type="button" onClick={() => { setOpenMode("all"); setTreeKey((k) => k + 1); }} style={ctrlBtn}>⊞ Expand all</button>
              <button type="button" onClick={() => { setOpenMode("none"); setTreeKey((k) => k + 1); }} style={ctrlBtn}>⊟ Collapse all</button>
              {stageFilter && (
                <button type="button" onClick={() => setStageFilter(null)} style={{ ...ctrlBtn, color: "#fff", background: STAGE_META[stageFilter].color, borderColor: STAGE_META[stageFilter].color }}>
                  ✕ Showing only {STAGE_META[stageFilter].label}
                </button>
              )}
            </div>

            <div key={`${treeKey}-${stageFilter ?? "_"}`} style={{ display: "flex", flexDirection: "column", gap: 7 }}>
              {visibleRoots.length === 0 ? (
                <div className="muted" style={{ fontSize: 13, padding: "10px 2px" }}>
                  {stageFilter ? `No ${STAGE_META[stageFilter].label} slabs in this temple.` : `No components match “${nodeQ}”.`}
                </div>
              ) : (
                visibleRoots.map((r, i) => <TreeNode key={r.id} node={r} depth={0} idx={i} imagesByNode={imagesByNode} openMode={(nodeQ || stageFilter) ? "all" : openMode} canDecide={canDecide} />)
              )}
            </div>
          </>
        ) : (
          <div className="banner">Pick a temple on the left.</div>
        )}
      </div>
      </div>
    </div>
  );
}

const ctrlBtn: CSSProperties = {
  fontSize: 12, fontWeight: 700, padding: "8px 12px", borderRadius: 9, cursor: "pointer",
  border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)", whiteSpace: "nowrap",
};

// Does a leaf's slab list contain a slab matching the query? Matches the
// slab code and the size (e.g. "48x36x2" or "48 36 2").
function slabMatch(node: TempleTreeNode, q: string): boolean {
  if (node.children.length > 0) return false;
  return node.slabs.some((s) =>
    s.id.toLowerCase().includes(q) ||
    `${s.l}x${s.w}x${s.t}`.includes(q) ||
    `${s.l} ${s.w} ${s.t}`.includes(q) ||
    String(s.l).includes(q) || String(s.w).includes(q) || String(s.t).includes(q),
  );
}

// Filter a node subtree — keep a node if its NAME (Category / Label /
// Description), or any descendant, or a slab under it (code / size) matches.
function filterNode(node: TempleTreeNode, q: string): TempleTreeNode | null {
  if (!q) return node;
  const selfMatch = node.name.toLowerCase().includes(q) || slabMatch(node, q);
  const kids = node.children.map((c) => filterNode(c, q)).filter((x): x is TempleTreeNode => x !== null);
  if (selfMatch || kids.length > 0) {
    return selfMatch ? node : { ...node, children: kids };
  }
  return null;
}

// Stage filter — keep only slabs in `stage`, pruning empty branches and
// recomputing counts/total bottom-up so every bar / chip / % reflects the
// filter (clicking a stage chip in the header drives this).
function zeroCounts(ref: Record<StageBucket, number>): Record<StageBucket, number> {
  const c = {} as Record<StageBucket, number>;
  for (const k of Object.keys(ref) as StageBucket[]) c[k] = 0;
  return c;
}
function filterNodeByStage(node: TempleTreeNode, stage: StageBucket): TempleTreeNode | null {
  if (node.children.length === 0) {
    const slabs = node.slabs.filter((s) => bucketOf(s.status) === stage);
    if (slabs.length === 0) return null;
    const counts = zeroCounts(node.counts);
    counts[stage] = slabs.length;
    return { ...node, slabs, counts, total: slabs.length };
  }
  const kids = node.children.map((c) => filterNodeByStage(c, stage)).filter((x): x is TempleTreeNode => x !== null);
  if (kids.length === 0) return null;
  const counts = zeroCounts(node.counts);
  let total = 0;
  for (const k of kids) {
    for (const key of Object.keys(counts) as StageBucket[]) counts[key] += k.counts[key];
    total += k.total;
  }
  return { ...node, children: kids, counts, total };
}
