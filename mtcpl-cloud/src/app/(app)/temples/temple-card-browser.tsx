"use client";

// Mig 123 follow-on (Daksh) — immersive fullscreen card browser.
//
// Flow: enter Cards mode → fullscreen TEMPLE picker (big cards) → pick a
// temple → its Category-1 cards (image covers, progress rings) → drill
// Category 2 → Label → Description → slab cards. Breadcrumb + Esc to go
// back up at every level. Component photos show ONLY here; clicking the
// photo (🔍) opens a lightbox with ←/→ keyboard navigation.
//
// The polish: staggered card entrance, hover lift, progress rings,
// gradient covers — gallery/finder feel rather than a database page.

import { useEffect, useRef, useState, useTransition, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { deleteTempleComponentImageAction, saveSlabRemarkAction } from "./actions";
import { MoveSlabModal, RenameNodeModal, NodeImageUploader } from "./temple-node-modals";
import {
  STAGE_META, STAGE_ORDER, bucketOf, calcCft, stoneLabel,
  type StageBucket, type TempleTree, type TempleTreeNode, type TempleSlabCard, type ComponentImage, type TempleCats,
} from "./temple-shared";

// ── tiny shared bits ─────────────────────────────────────────────────

function MiniBar({ counts, total, track = "rgba(0,0,0,0.08)" }: { counts: Record<StageBucket, number>; total: number; track?: string }) {
  if (total === 0) return null;
  return (
    <div style={{ display: "flex", height: 8, borderRadius: 999, overflow: "hidden", background: track }}>
      {STAGE_ORDER.map((s) => counts[s] ? <div key={s} title={`${STAGE_META[s].label}: ${counts[s]}`} style={{ width: `${(counts[s] / total) * 100}%`, background: STAGE_META[s].color }} /> : null)}
    </div>
  );
}

/** Present-stage count chips for the current node — shown at the top of every
 *  intermediate card level (Category 1/2 · Label · Description), mirroring the
 *  slab-level chips. Only the stages that actually occur appear, each coloured,
 *  labelled and numbered — so the colours stay self-explanatory without a full
 *  static legend (and no chip for a stage that isn't present here). */
function StageCountChips({ counts, total }: { counts: Record<StageBucket, number>; total: number }) {
  const present = STAGE_ORDER.filter((s) => counts[s] > 0);
  if (present.length === 0) return null;
  return (
    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, marginBottom: 16, animation: "tcFade .3s ease" }}>
      {present.map((s) => (
        <span key={s} style={{ fontSize: 11.5, fontWeight: 800, color: "#fff", background: STAGE_META[s].color, borderRadius: 999, padding: "3px 11px" }}>{counts[s]} {STAGE_META[s].label}</span>
      ))}
      <span style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)" }}>· {total} total</span>
    </div>
  );
}

/** Small segmented toggle button (Cards | Table view switch). */
function ViewToggleBtn({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: "5px 13px", fontSize: 12, fontWeight: 800, borderRadius: 7,
        border: "1px solid var(--border)", cursor: active ? "default" : "pointer",
        background: active ? "var(--gold-dark)" : "var(--bg)", color: active ? "#fff" : "var(--text)",
      }}
    >
      {label}
    </button>
  );
}

/** Animated progress ring (SVG donut) — % done at a glance. */
function Ring({ pct, size = 44, onImage = false }: { pct: number; size?: number; onImage?: boolean }) {
  const stroke = 4.5;
  const r = (size - stroke * 2) / 2;
  const c = 2 * Math.PI * r;
  const filled = Math.max(0, Math.min(100, pct)) / 100 * c;
  return (
    <div style={{ position: "relative", width: size, height: size, flexShrink: 0, borderRadius: "50%", background: onImage ? "rgba(15,23,42,0.55)" : "transparent", backdropFilter: onImage ? "blur(3px)" : undefined }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ display: "block" }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={onImage ? "rgba(255,255,255,0.3)" : "rgba(148,163,184,0.3)"} strokeWidth={stroke} />
        <circle
          cx={size / 2} cy={size / 2} r={r} fill="none"
          stroke={pct >= 100 ? STAGE_META.done.color : pct > 0 ? STAGE_META.done.color : "transparent"}
          strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={`${filled} ${c}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          style={{ transition: "stroke-dasharray .6s ease" }}
        />
      </svg>
      <span style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: size * 0.26, fontWeight: 900, color: onImage ? "#fff" : "var(--text)" }}>
        {pct}%
      </span>
    </div>
  );
}

// ── lightbox ─────────────────────────────────────────────────────────

function Lightbox({
  images, index, canManage, onClose, onNav, onDeleted,
}: {
  images: ComponentImage[]; index: number; canManage: boolean;
  onClose: () => void; onNav: (i: number) => void; onDeleted: () => void;
}) {
  const img = images[index];
  const [deleting, setDeleting] = useState(false);
  if (!img) return null;

  async function del() {
    if (deleting) return;
    setDeleting(true);
    try {
      const fd = new FormData();
      fd.set("id", img.id);
      await deleteTempleComponentImageAction(fd);
      onDeleted();
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 1700, background: "rgba(10,8,4,0.88)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 24, animation: "tcFade .18s ease" }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={img.url} alt={img.caption ?? ""} onClick={(e) => e.stopPropagation()} style={{ maxWidth: "92vw", maxHeight: "78vh", borderRadius: 14, boxShadow: "0 30px 80px rgba(0,0,0,0.6)", animation: "tcZoom .22s ease" }} />
      <div onClick={(e) => e.stopPropagation()} style={{ display: "flex", alignItems: "center", gap: 14, marginTop: 16, color: "#fff", flexWrap: "wrap", justifyContent: "center" }}>
        {images.length > 1 && (
          <button type="button" onClick={() => onNav((index - 1 + images.length) % images.length)} style={lbBtn}>←</button>
        )}
        <span style={{ fontSize: 13.5, fontWeight: 700, opacity: 0.9 }}>
          {img.caption || "Reference photo"} {images.length > 1 && <span style={{ opacity: 0.6 }}>· {index + 1}/{images.length}</span>}
        </span>
        {images.length > 1 && (
          <button type="button" onClick={() => onNav((index + 1) % images.length)} style={lbBtn}>→</button>
        )}
        {canManage && (
          <button type="button" disabled={deleting} onClick={del} style={{ ...lbBtn, background: "rgba(220,38,38,0.85)", fontSize: 12.5 }}>
            {deleting ? "Deleting…" : "🗑 Delete"}
          </button>
        )}
        <button type="button" onClick={onClose} style={{ ...lbBtn, fontSize: 12.5 }}>Esc ✕</button>
      </div>
    </div>
  );
}

const lbBtn: CSSProperties = { padding: "8px 16px", fontSize: 16, fontWeight: 800, borderRadius: 10, border: "1px solid rgba(255,255,255,0.3)", background: "rgba(255,255,255,0.12)", color: "#fff", cursor: "pointer" };

// ── main browser ─────────────────────────────────────────────────────

export function TempleCardBrowser({
  trees, imagesByNode, canManageImages, canEditCategories, templeCats, onExit,
}: {
  trees: TempleTree[];
  imagesByNode: Record<string, ComponentImage[]>;
  canManageImages: boolean;
  canEditCategories: boolean;
  templeCats: TempleCats;
  onExit: () => void;
}) {
  const router = useRouter();
  // temple === null → fullscreen temple picker (the landing screen).
  const [temple, setTemple] = useState<string | null>(null);
  // Navigation is stored as node IDS (not node objects) so it survives a
  // router.refresh(): after a move re-fetches the tree, we re-resolve the
  // live nodes from the FRESH data and the moved slabs leave this leaf.
  const [pathIds, setPathIds] = useState<string[]>([]);
  const [lightbox, setLightbox] = useState<{ images: ComponentImage[]; index: number } | null>(null);
  // Mig 128 — move-slab + per-node image-upload modals.
  // moveSlabs holds 1 (single tap) OR many (multi-select) slabs to move.
  const [moveSlabs, setMoveSlabs] = useState<TempleSlabCard[] | null>(null);
  const [uploadNode, setUploadNode] = useState<{ path: string; label: string } | null>(null);
  // Rename a tree-head node (Category 1 / 2 / Label / Description) for every
  // slab under it. segments = path below the temple; options = sibling names.
  const [renameNode, setRenameNode] = useState<{ segments: string[]; options: string[]; count: number } | null>(null);
  // Mig 128 follow-on — multi-select inside the current leaf. Press-and-hold
  // a slab card for ~0.6s to enter select mode, then tap to pick several (all
  // in the SAME leaf), and move them together.
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  // Master Excel — tick category cards down to the Label level (drill in via ▸
  // through Category 1 / Category 2 only), then export every slab under the
  // selection as one grouped Excel with highlighted category bands.
  const [exportMode, setExportMode] = useState(false);
  const [exportSel, setExportSel] = useState<Set<string>>(new Set());
  const [exportBusy, startMasterExport] = useTransition();
  function exitSelect() { setSelectMode(false); setSelectedIds(new Set()); }
  // The currently-rendered card grid (temple picker OR folder cards) — used
  // for full keyboard navigation (arrow keys move focus, Enter drills in).
  const gridRef = useRef<HTMLDivElement>(null);

  const tree = temple ? trees.find((t) => t.temple === temple) ?? null : null;
  // Re-resolve the live node objects from the fresh tree by walking pathIds.
  // If a node id is gone (e.g. the leaf emptied out after a move), the walk
  // truncates there, landing the user on the nearest surviving parent.
  const path: TempleTreeNode[] = [];
  if (tree) {
    let level: TempleTreeNode[] = tree.roots;
    for (const id of pathIds) {
      const n = level.find((x) => x.id === id);
      if (!n) break;
      path.push(n);
      level = n.children;
    }
  }
  const currentNode = path[path.length - 1] ?? null;
  const children = currentNode ? currentNode.children : (tree?.roots ?? []);
  const isLeaf = currentNode != null && currentNode.children.length === 0;
  const EMPTY_CATS = { cat1: [], cat2: [], labels: [], descriptions: [] };
  const cats = temple ? (templeCats[temple] ?? EMPTY_CATS) : EMPTY_CATS;

  // ── Master Excel helpers ──
  function toggleExportSel(id: string) {
    setExportSel((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  }
  function findNodeById(nodes: TempleTreeNode[], id: string): TempleTreeNode | null {
    for (const n of nodes) {
      if (n.id === id) return n;
      const f = findNodeById(n.children, id);
      if (f) return f;
    }
    return null;
  }
  function allSlabsUnder(node: TempleTreeNode): TempleSlabCard[] {
    return node.children.length === 0 ? node.slabs : node.children.flatMap(allSlabsUnder);
  }
  // Ordered band path for a slab — matches how page.tsx builds the tree
  // (Category 1 ›-levels › Category 2 › Label › Description › Additional).
  function slabBandPath(s: TempleSlabCard): string[] {
    const cat1 = s.section ? s.section.split(/\s*[›>]\s*/).map((x) => x.trim()).filter(Boolean) : ["Unassigned"];
    return [
      ...cat1,
      ...(s.element ? [s.element] : []),
      s.label || "— (no label)",
      ...(s.description ? [s.description] : []),
      ...(s.additional ? [s.additional] : []),
    ];
  }
  function runMasterExport() {
    if (!tree || exportBusy) return;
    // Gather slabs under every selected node, deduped by id (a parent + one of
    // its children both selected won't double-count).
    const byId = new Map<string, TempleSlabCard>();
    for (const id of exportSel) {
      const node = findNodeById(tree.roots, id);
      if (node) for (const s of allSlabsUnder(node)) byId.set(s.id, s);
    }
    const items = [...byId.values()].map((s) => {
      const b = bucketOf(s.status);
      return {
        path: slabBandPath(s),
        rank: STAGE_ORDER.indexOf(b),
        code: s.id,
        dims: `${s.l}"×${s.w}"×${s.t}" · ${calcCft(s.l, s.w, s.t).toFixed(2)} CFT`,
        stage: STAGE_META[b].label,
        color: STAGE_META[b].color,
        remark: s.remark ?? "",
      };
    });
    if (items.length === 0) return;
    // Sort by band path, then production stage, then code — the route walks
    // this order and emits group bands wherever the path changes.
    items.sort((a, b) =>
      a.path.join(" ").localeCompare(b.path.join(" ")) || a.rank - b.rank || a.code.localeCompare(b.code),
    );
    const title = `${temple ?? "Temple"} · Master Excel`;
    startMasterExport(async () => {
      try {
        const res = await fetch("/api/temples/master-excel.xlsx", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title, items }),
        });
        if (!res.ok) return;
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${(temple ?? "temple").replace(/[^\w]+/g, "-").slice(0, 50) || "temple"}-master.xlsx`;
        document.body.appendChild(a); a.click(); a.remove();
        URL.revokeObjectURL(url);
        setExportMode(false);
        setExportSel(new Set());
      } catch { /* user can retry */ }
    });
  }

  function goUp() {
    if (pathIds.length > 0) setPathIds((p) => p.slice(0, -1));
    else if (temple) setTemple(null);
    else onExit();
  }

  // Esc = up one level (or close the lightbox first). Skips inputs/dialogs
  // so the Add-image modal keeps its own Esc behaviour.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // A modal (move / rename / upload) owns Escape while it's open.
      if (e.key === "Escape" && (moveSlabs || uploadNode || renameNode)) {
        e.preventDefault();
        setMoveSlabs(null);
        setUploadNode(null);
        setRenameNode(null);
        return;
      }
      const t = e.target as HTMLElement | null;
      if (t && t.closest("input, textarea, select, [role=dialog]")) return;
      if (e.key === "Escape") {
        e.preventDefault();
        if (lightbox) setLightbox(null);
        else if (selectMode) exitSelect();
        else goUp();
      } else if (lightbox && lightbox.images.length > 1 && (e.key === "ArrowRight" || e.key === "ArrowLeft")) {
        e.preventDefault();
        const d = e.key === "ArrowRight" ? 1 : -1;
        setLightbox((lb) => lb && { ...lb, index: (lb.index + d + lb.images.length) % lb.images.length });
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lightbox, pathIds.length, temple, moveSlabs, uploadNode, renameNode, selectMode]);

  // Leaving a leaf (drill in/out or switch temple) drops the selection — it
  // only ever applies to slabs in the leaf you're looking at.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { exitSelect(); }, [temple, pathIds]);

  // Remember where you were so a full page reload reopens the SAME temple /
  // leaf instead of dumping you back to the temple list. Restore runs once on
  // mount; persist keeps the saved spot in step with navigation.
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem("mtcpl_tv_card");
      if (!raw) return;
      const saved = JSON.parse(raw) as { temple?: string; pathIds?: string[] };
      const t = saved.temple ? trees.find((x) => x.temple === saved.temple) : null;
      if (!t) return;
      setTemple(t.temple);
      const valid: string[] = [];
      let level = t.roots;
      for (const id of saved.pathIds ?? []) {
        const n = level.find((x) => x.id === id);
        if (!n) break;
        valid.push(id);
        level = n.children;
      }
      setPathIds(valid);
    } catch { /* ignore corrupt/unavailable storage */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    try {
      if (temple) sessionStorage.setItem("mtcpl_tv_card", JSON.stringify({ temple, pathIds }));
      else sessionStorage.removeItem("mtcpl_tv_card");
    } catch { /* ignore */ }
  }, [temple, pathIds]);

  // After a refresh that renamed/removed a node in the current path, the walk
  // above truncates `path` but pathIds still holds the dead tail — trim it back
  // to what actually resolved so further drilling keeps working.
  const resolvedIds = path.map((n) => n.id);
  useEffect(() => {
    if (temple && resolvedIds.length !== pathIds.length) setPathIds(resolvedIds);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolvedIds.join(""), pathIds.length, temple]);

  // ── Full keyboard navigation of the card grid ──
  // Arrow keys move focus card-to-card (2D, columns auto-detected); Enter
  // (handled natively by the focused card) drills in; Esc goes back. Disabled
  // while a modal / lightbox / select-mode owns the keyboard.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (lightbox || moveSlabs || uploadNode || renameNode || selectMode) return;
      if (e.key !== "ArrowRight" && e.key !== "ArrowLeft" && e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
      const t = e.target as HTMLElement | null;
      if (t && t.closest("input, textarea, select, [role=dialog]")) return;
      const grid = gridRef.current;
      if (!grid) return;
      const cards = Array.from(grid.children).filter((c) => (c as HTMLElement).offsetParent !== null) as HTMLElement[];
      if (cards.length === 0) return;
      e.preventDefault();
      const active = document.activeElement as HTMLElement | null;
      const cur = cards.findIndex((c) => c === active || c.contains(active));
      let next: number;
      if (cur < 0) {
        next = 0; // nothing focused yet → land on the first card
      } else {
        const top0 = cards[0].offsetTop;
        let cols = 0;
        for (const c of cards) { if (c.offsetTop === top0) cols++; else break; }
        cols = Math.max(1, cols);
        if (e.key === "ArrowRight") next = Math.min(cards.length - 1, cur + 1);
        else if (e.key === "ArrowLeft") next = Math.max(0, cur - 1);
        else if (e.key === "ArrowDown") next = Math.min(cards.length - 1, cur + cols);
        else next = Math.max(0, cur - cols);
      }
      cards[next]?.focus();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lightbox, moveSlabs, uploadNode, renameNode, selectMode]);

  // When the level changes, put keyboard focus on the first card so arrow keys
  // work right away (preventScroll + :focus-visible → mouse users see no ring).
  useEffect(() => {
    if (lightbox || moveSlabs || uploadNode || renameNode || selectMode || isLeaf) return;
    const id = window.setTimeout(() => {
      (gridRef.current?.children?.[0] as HTMLElement | undefined)?.focus({ preventScroll: true });
    }, 60);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [temple, pathIds, isLeaf]);

  // Temple landing-card cover = an image attached at the TEMPLE level only
  // (node_path === the temple). Sub-branch images no longer leak up as the
  // temple cover.
  function templeCover(t: string): ComponentImage | null {
    const imgs = imagesByNode[t];
    return imgs && imgs.length > 0 ? imgs[0] : null;
  }

  // Re-keys the grid per level so the stagger entrance replays on drill.
  const levelKey = `${temple ?? "@temples"}/${pathIds.join("|")}`;

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 1500, background: "var(--bg)", display: "flex", flexDirection: "column" }}>
      <style>{`
        @keyframes tcIn { from { opacity: 0; transform: translateY(16px) scale(.97); } to { opacity: 1; transform: none; } }
        @keyframes tcFade { from { opacity: 0; } to { opacity: 1; } }
        @keyframes tcZoom { from { opacity: 0; transform: scale(.92); } to { opacity: 1; transform: none; } }
        .tc-card { opacity: 0; animation: tcIn .38s cubic-bezier(.2,.7,.3,1) forwards; transition: transform .16s ease, box-shadow .16s ease, border-color .16s ease; }
        .tc-card:hover { transform: translateY(-5px); box-shadow: 0 16px 40px rgba(0,0,0,.16); border-color: var(--gold-dark) !important; }
        .tc-card:active { transform: translateY(-1px) scale(.99); }
        /* Keyboard focus ring (arrow-key navigation). focus-visible keeps it
           off for mouse clicks. */
        .tc-card:focus { outline: none; }
        .tc-card:focus-visible { outline: 3px solid var(--gold-dark); outline-offset: 3px; box-shadow: 0 0 0 5px rgba(184,115,51,0.20), 0 16px 40px rgba(0,0,0,.16); transform: translateY(-3px); }
      `}</style>

      {/* ── Top bar ── */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "11px 18px", borderBottom: "1px solid var(--border)", background: "var(--surface)", flexWrap: "wrap" }}>
        <button type="button" onClick={goUp} title="Esc" style={{ fontSize: 13, fontWeight: 800, padding: "8px 14px", borderRadius: 9, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)", cursor: "pointer" }}>
          ← Back
        </button>
        {/* Breadcrumb */}
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", fontSize: 13, minWidth: 0 }}>
          <button type="button" onClick={() => { setTemple(null); setPathIds([]); }} style={crumbStyle(!temple)}>🏛 Temples</button>
          {temple && (
            <>
              <span style={{ color: "var(--muted)" }}>›</span>
              <button type="button" onClick={() => setPathIds([])} style={crumbStyle(path.length === 0)}>{temple}</button>
            </>
          )}
          {path.map((n, i) => (
            <span key={n.id} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <span style={{ color: "var(--muted)" }}>›</span>
              <button type="button" onClick={() => setPathIds((p) => p.slice(0, i + 1))} style={crumbStyle(i === path.length - 1)}>{n.name}</button>
            </span>
          ))}
        </div>
        <span style={{ flex: 1 }} />
        {/* Rename / photos live on each card itself (the ✏️ and 📷 on every
            category card), so there are no duplicate buttons up here. */}
        <span className="muted" style={{ fontSize: 11.5, whiteSpace: "nowrap" }}>Esc = back</span>
        <button type="button" onClick={onExit} style={{ fontSize: 13, fontWeight: 800, padding: "8px 14px", borderRadius: 9, border: "none", background: "var(--gold-dark)", color: "#fff", cursor: "pointer" }}>✕ Exit</button>
      </div>

      {/* ── Body ── */}
      <div key={levelKey} style={{ flex: 1, overflowY: "auto", padding: "20px 22px 40px" }}>
        {/* Present-stage count chips for the current level (Category 1/2 ·
            Label · Description) — only the stages that occur, with their
            numbers, mirroring the slab-level chips. The leaf renders its own
            chips inside SlabCardsGrid, so this is intermediate-levels only. */}
        {temple && !isLeaf && (currentNode ?? tree) && (
          <StageCountChips counts={(currentNode ?? tree)!.counts} total={(currentNode ?? tree)!.total} />
        )}
        {/* Master Excel — tick category cards (Category 1 / 2 / Label only,
            not down to Description), then export all slabs under the selection
            as one hierarchically-grouped Excel. path.length: 0=Cat1, 1=Cat2,
            2=Label cards; >=3 = Description, where Master Excel is hidden. */}
        {temple && !isLeaf && children.length > 0 && path.length <= 2 && (
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
            {!exportMode ? (
              <button type="button" onClick={() => { setExportMode(true); setExportSel(new Set()); }}
                style={{ fontSize: 12.5, fontWeight: 800, padding: "7px 14px", borderRadius: 9, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)", cursor: "pointer" }}>
                📊 Master Excel
              </button>
            ) : (
              <span style={{ fontSize: 12, fontWeight: 700, color: "var(--gold-dark)" }}>
                {path.length < 2 ? (
                  <>✓ Tick cards to include · <strong>▸ open</strong> a card to pick inside it (down to label) · then <strong>Download</strong> below.</>
                ) : (
                  <>✓ Tick the labels to include · then <strong>Download</strong> below.</>
                )}
              </span>
            )}
          </div>
        )}
        {!temple ? (
          /* ── Temple picker landing ── */
          <>
            <div style={{ fontSize: 20, fontWeight: 800, marginBottom: 16, animation: "tcFade .3s ease" }}>Choose a temple <span className="muted" style={{ fontSize: 12, fontWeight: 600 }}>· arrow keys to move · Enter to open</span></div>
            <div ref={gridRef} style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(250px, 1fr))", gap: 18 }}>
              {trees.map((t, i) => {
                const pct = t.total > 0 ? Math.round((t.counts.done / t.total) * 100) : 0;
                const cover = templeCover(t.temple);
                return (
                  <div key={t.temple} className="tc-card" role="button" tabIndex={0} onClick={() => setTemple(t.temple)} onKeyDown={(e) => { if (e.key === "Enter") setTemple(t.temple); }} style={{ ...cardShell, animationDelay: `${Math.min(i * 40, 480)}ms`, cursor: "pointer", position: "relative" }}>
                    <div style={{ position: "relative", height: 130, background: cover ? "#0f172a" : "linear-gradient(135deg, #92400e22, #b8733344)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                      {cover ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={cover.url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                      ) : (
                        <span style={{ fontSize: 46, opacity: 0.45 }}>🏛</span>
                      )}
                      <div style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg, transparent 50%, rgba(0,0,0,0.45))" }} />
                      <div style={{ position: "absolute", top: 10, right: 10 }}><Ring pct={pct} onImage /></div>
                      {/* Temple-LEVEL photo (the landing cover). */}
                      {canManageImages && (
                        <button
                          type="button"
                          title={`Add / manage the temple photo for ${t.temple}`}
                          onClick={(e) => { e.stopPropagation(); setUploadNode({ path: t.temple, label: t.temple }); }}
                          style={{ position: "absolute", top: 10, left: 10, fontSize: 13, fontWeight: 800, color: "#fff", background: "rgba(0,0,0,0.5)", border: "1px solid rgba(255,255,255,0.4)", borderRadius: 999, width: 30, height: 30, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", backdropFilter: "blur(3px)" }}
                        >
                          📷
                        </button>
                      )}
                    </div>
                    <div style={{ padding: "12px 14px", display: "flex", flexDirection: "column", gap: 8 }}>
                      <div style={{ fontWeight: 800, fontSize: 14.5, lineHeight: 1.25 }}>{t.temple}</div>
                      <MiniBar counts={t.counts} total={t.total} />
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11.5, fontWeight: 700 }}>
                        <span style={{ color: STAGE_META.done.color }}>{t.counts.done}/{t.total} done</span>
                        <span style={{ color: "var(--muted)" }}>{t.roots.length} categor{t.roots.length === 1 ? "y" : "ies"} →</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        ) : isLeaf ? (
          /* ── Leaf: the actual slabs ── */
          <SlabCardsGrid
            node={currentNode!}
            title={[temple ?? "", ...path.map((n) => n.name)].filter(Boolean).join(" › ")}
            images={imagesByNode[currentNode!.id] ?? []}
            canSelect={canManageImages}
            selectMode={selectMode}
            selectedIds={selectedIds}
            onSingleMove={(s) => setMoveSlabs([s])}
            onEnterSelect={(s) => { setSelectMode(true); setSelectedIds(new Set([s.id])); }}
            onToggle={(id) => setSelectedIds((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; })}
            onViewImages={(imgs, idx) => setLightbox({ images: imgs, index: idx })}
          />
        ) : children.length === 0 ? (
          <div className="muted" style={{ fontSize: 14, padding: 20 }}>Nothing here yet.</div>
        ) : (
          /* ── Category / Label / Description cards ── */
          <div ref={gridRef} style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(235px, 1fr))", gap: 16 }}>
            {children.map((c, i) => {
              const imgs = imagesByNode[c.id] ?? [];
              const cover = imgs[0];
              const pct = c.total > 0 ? Math.round((c.counts.done / c.total) * 100) : 0;
              const depth = path.length;
              const icon = depth === 0 ? "📂" : depth === 1 ? "📁" : depth === 2 ? "🏷️" : "📄";
              return (
                <div key={c.id} className="tc-card" style={{ ...cardShell, animationDelay: `${Math.min(i * 35, 420)}ms`, cursor: "pointer", position: "relative", ...(exportMode && exportSel.has(c.id) ? { outline: "3px solid var(--gold-dark)", outlineOffset: -1 } : {}) }} onClick={exportMode ? () => toggleExportSel(c.id) : () => setPathIds((p) => [...p, c.id])} role="button" tabIndex={0}
                  onKeyDown={(e) => { if (e.key === "Enter") { if (exportMode) toggleExportSel(c.id); else setPathIds((p) => [...p, c.id]); } }}>
                  <div style={{ position: "relative", height: 148, background: cover ? "#0f172a" : `linear-gradient(135deg, ${STAGE_META.cutting.color}18, ${STAGE_META.carving.color}22)`, display: "flex", alignItems: "center", justifyContent: "center" }}>
                    {cover ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={cover.url} alt={c.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                    ) : (
                      <span style={{ fontSize: 46, opacity: 0.45 }}>{icon}</span>
                    )}
                    <div style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg, transparent 55%, rgba(0,0,0,0.4))" }} />
                    <div style={{ position: "absolute", top: 10, right: 10 }}><Ring pct={pct} onImage /></div>
                    {/* Master-Excel select mode: a tick (select whole card) + ▸ open
                        (drill in to pick deeper). Drilling stops at the Label level —
                        only Cat1 (depth 0) and Cat2 (depth 1) cards can be opened, so
                        the deepest pickable card is a Label. */}
                    {exportMode && (
                      <span style={{ position: "absolute", top: 10, left: 10, width: 28, height: 28, borderRadius: "50%", border: "2px solid #fff", background: exportSel.has(c.id) ? "var(--gold-dark)" : "rgba(0,0,0,0.45)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, fontWeight: 900, backdropFilter: "blur(2px)" }}>
                        {exportSel.has(c.id) ? "✓" : ""}
                      </span>
                    )}
                    {exportMode && c.children.length > 0 && depth < 2 && (
                      <button type="button" title={`Open ${c.name} to pick cards inside`} onClick={(e) => { e.stopPropagation(); setPathIds((p) => [...p, c.id]); }}
                        style={{ position: "absolute", bottom: 10, right: 10, fontSize: 11.5, fontWeight: 800, color: "#fff", background: "rgba(0,0,0,0.6)", border: "1px solid rgba(255,255,255,0.4)", borderRadius: 999, padding: "4px 12px", cursor: "pointer", backdropFilter: "blur(3px)" }}>
                        ▸ Open
                      </button>
                    )}
                    {!exportMode && canManageImages && (
                      <button
                        type="button"
                        title={`Add a photo to ${c.name}`}
                        onClick={(e) => { e.stopPropagation(); setUploadNode({ path: c.id, label: c.name }); }}
                        style={{ position: "absolute", top: 10, left: 10, fontSize: 13, fontWeight: 800, color: "#fff", background: "rgba(0,0,0,0.5)", border: "1px solid rgba(255,255,255,0.4)", borderRadius: 999, width: 30, height: 30, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", backdropFilter: "blur(3px)" }}
                      >
                        📷
                      </button>
                    )}
                    {!exportMode && canEditCategories && (
                      <button
                        type="button"
                        title={`Rename ${c.name}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          setRenameNode({
                            segments: [...path.map((n) => n.name), c.name],
                            options: children.map((n) => n.name).filter((n) => n !== c.name),
                            count: c.total,
                          });
                        }}
                        style={{ position: "absolute", top: 10, left: canManageImages ? 46 : 10, fontSize: 13, fontWeight: 800, color: "#fff", background: "rgba(0,0,0,0.5)", border: "1px solid rgba(255,255,255,0.4)", borderRadius: 999, width: 30, height: 30, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", backdropFilter: "blur(3px)" }}
                      >
                        ✏️
                      </button>
                    )}
                    {!exportMode && imgs.length > 0 && (
                      <button
                        type="button"
                        title="View photos"
                        onClick={(e) => { e.stopPropagation(); setLightbox({ images: imgs, index: 0 }); }}
                        style={{ position: "absolute", bottom: 10, right: 10, fontSize: 11.5, fontWeight: 800, color: "#fff", background: "rgba(0,0,0,0.55)", border: "1px solid rgba(255,255,255,0.35)", borderRadius: 999, padding: "3px 10px", cursor: "zoom-in", backdropFilter: "blur(3px)" }}
                      >
                        🔍 {imgs.length} photo{imgs.length > 1 ? "s" : ""}
                      </button>
                    )}
                  </div>
                  <div style={{ padding: "11px 13px", display: "flex", flexDirection: "column", gap: 7 }}>
                    <div style={{ fontWeight: 800, fontSize: 14, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.name}</div>
                    <MiniBar counts={c.counts} total={c.total} />
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 11.5, fontWeight: 700 }}>
                      <span style={{ color: STAGE_META.done.color }}>{c.counts.done}/{c.total} done</span>
                      <span style={{ color: "var(--muted)" }}>{c.children.length > 0 ? `${c.children.length} inside →` : `${c.total} slab${c.total === 1 ? "" : "s"} →`}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {lightbox && (
        <Lightbox
          images={lightbox.images}
          index={lightbox.index}
          canManage={canManageImages}
          onClose={() => setLightbox(null)}
          onNav={(i) => setLightbox((lb) => lb && { ...lb, index: i })}
          onDeleted={() => { setLightbox(null); router.refresh(); }}
        />
      )}

      {/* Mig 128 — move one or many slabs to a different category. */}
      {moveSlabs && temple && (
        <MoveSlabModal
          slabs={moveSlabs}
          temple={temple}
          cats={cats}
          onClose={() => setMoveSlabs(null)}
          onMoved={() => { setMoveSlabs(null); exitSelect(); router.refresh(); }}
        />
      )}

      {/* Mig 128 follow-on — rename a whole category / label / description. */}
      {renameNode && temple && (
        <RenameNodeModal
          temple={temple}
          segments={renameNode.segments}
          options={renameNode.options}
          count={renameNode.count}
          onClose={() => setRenameNode(null)}
          onDone={() => { setRenameNode(null); router.refresh(); }}
        />
      )}

      {/* Multi-select action bar — floats while picking slabs in a leaf. */}
      {selectMode && currentNode && (
        <div style={{ position: "fixed", left: "50%", bottom: 22, transform: "translateX(-50%)", zIndex: 1650, display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", borderRadius: 14, background: "var(--surface)", border: "1px solid var(--gold-dark)", boxShadow: "0 14px 44px rgba(0,0,0,0.28)", maxWidth: "calc(100vw - 28px)", flexWrap: "wrap", justifyContent: "center", animation: "tcIn .2s ease" }}>
          <span style={{ fontSize: 13.5, fontWeight: 800 }}>
            <span style={{ color: "var(--gold-dark)" }}>{selectedIds.size}</span> selected
          </span>
          <button
            type="button"
            onClick={() => {
              const all = currentNode.slabs.map((s) => s.id);
              setSelectedIds((prev) => prev.size === all.length ? new Set() : new Set(all));
            }}
            style={{ fontSize: 12.5, fontWeight: 800, padding: "8px 13px", borderRadius: 9, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)", cursor: "pointer", whiteSpace: "nowrap" }}
          >
            {selectedIds.size === currentNode.slabs.length ? "Clear all" : `Select all ${currentNode.slabs.length}`}
          </button>
          <button
            type="button"
            disabled={selectedIds.size === 0}
            onClick={() => setMoveSlabs(currentNode.slabs.filter((s) => selectedIds.has(s.id)))}
            style={{ fontSize: 13.5, fontWeight: 800, padding: "8px 16px", borderRadius: 9, border: "none", background: selectedIds.size === 0 ? "var(--border)" : "var(--gold-dark)", color: "#fff", cursor: selectedIds.size === 0 ? "not-allowed" : "pointer", whiteSpace: "nowrap" }}
          >
            ↔ Move {selectedIds.size > 0 ? selectedIds.size : ""} →
          </button>
          <button type="button" onClick={exitSelect} style={{ fontSize: 12.5, fontWeight: 800, padding: "8px 13px", borderRadius: 9, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--muted)", cursor: "pointer" }}>
            Cancel
          </button>
        </div>
      )}

      {/* Master Excel — floating bar while picking category cards across levels. */}
      {exportMode && (
        <div style={{ position: "fixed", left: "50%", bottom: 22, transform: "translateX(-50%)", zIndex: 1650, display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", borderRadius: 14, background: "var(--surface)", border: "1px solid var(--gold-dark)", boxShadow: "0 14px 44px rgba(0,0,0,0.28)", maxWidth: "calc(100vw - 28px)", flexWrap: "wrap", justifyContent: "center", animation: "tcIn .2s ease" }}>
          <span style={{ fontSize: 13.5, fontWeight: 800 }}>
            <span style={{ color: "var(--gold-dark)" }}>{exportSel.size}</span> card{exportSel.size === 1 ? "" : "s"} selected
          </span>
          <button
            type="button"
            disabled={exportSel.size === 0 || exportBusy}
            onClick={runMasterExport}
            style={{ fontSize: 13.5, fontWeight: 800, padding: "8px 16px", borderRadius: 9, border: "none", background: exportSel.size === 0 || exportBusy ? "var(--border)" : "#15803d", color: "#fff", cursor: exportSel.size === 0 || exportBusy ? "not-allowed" : "pointer", whiteSpace: "nowrap" }}
          >
            {exportBusy ? "Preparing…" : `⬇ Download Master Excel${exportSel.size > 0 ? ` (${exportSel.size})` : ""}`}
          </button>
          <button type="button" onClick={() => { setExportMode(false); setExportSel(new Set()); }} style={{ fontSize: 12.5, fontWeight: 800, padding: "8px 13px", borderRadius: 9, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--muted)", cursor: "pointer" }}>
            Cancel
          </button>
        </div>
      )}

      {/* Mig 128 — manage photos on the current / picked node (any level,
          including the TEMPLE level from the picker). View / remove / add. */}
      {uploadNode && (
        <NodeImageUploader
          temple={temple ?? uploadNode.path}
          nodePath={uploadNode.path}
          nodeLabel={uploadNode.label}
          images={imagesByNode[uploadNode.path] ?? []}
          onClose={() => setUploadNode(null)}
          onChanged={() => router.refresh()}
        />
      )}
    </div>
  );
}

const cardShell: CSSProperties = {
  display: "flex", flexDirection: "column", textAlign: "left", padding: 0,
  border: "1px solid var(--border)", borderRadius: 16, overflow: "hidden",
  background: "var(--surface)", color: "var(--text)",
};

function crumbStyle(active: boolean): CSSProperties {
  return { fontSize: 12.5, fontWeight: active ? 800 : 600, padding: "5px 11px", borderRadius: 8, border: `1px solid ${active ? "var(--gold-dark)" : "var(--border)"}`, background: active ? "rgba(184,115,51,0.08)" : "var(--surface)", color: "var(--text)", cursor: "pointer", whiteSpace: "nowrap", maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis" };
}

function SlabCardsGrid({
  node, title, images, canSelect, selectMode, selectedIds, onSingleMove, onEnterSelect, onToggle, onViewImages,
}: {
  node: TempleTreeNode;
  title: string;
  images: ComponentImage[];
  canSelect: boolean;
  selectMode: boolean;
  selectedIds: Set<string>;
  onSingleMove: (s: TempleSlabCard) => void;
  onEnterSelect: (s: TempleSlabCard) => void;
  onToggle: (id: string) => void;
  onViewImages: (imgs: ComponentImage[], index: number) => void;
}) {
  const [view, setView] = useState<"cards" | "table">("cards");
  return (
    <div>
      {/* This node's own reference photos (Description / Label / Additional). */}
      {images.length > 0 && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14, animation: "tcFade .3s ease" }}>
          {images.map((img, i) => (
            <button key={img.id} type="button" onClick={() => onViewImages(images, i)} title={img.caption ?? "View photo"} style={{ padding: 0, border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden", cursor: "zoom-in", width: 92, height: 70, background: "#0f172a" }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={img.url} alt={img.caption ?? ""} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
            </button>
          ))}
        </div>
      )}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 10, animation: "tcFade .3s ease" }}>
        {STAGE_ORDER.filter((s) => node.counts[s] > 0).map((s) => (
          <span key={s} style={{ fontSize: 11.5, fontWeight: 800, color: "#fff", background: STAGE_META[s].color, borderRadius: 999, padding: "3px 11px" }}>{node.counts[s]} {STAGE_META[s].label}</span>
        ))}
        <span style={{ flex: 1 }} />
        {/* Card ⇄ Table view toggle for this slab leaf. */}
        <div style={{ display: "flex", gap: 6 }}>
          <ViewToggleBtn active={view === "cards"} onClick={() => setView("cards")} label="▦ Cards" />
          <ViewToggleBtn active={view === "table"} onClick={() => setView("table")} label="☰ Table" />
        </div>
      </div>
      {view === "cards" ? (
        <>
          {canSelect && !selectMode && (
            <div className="muted" style={{ fontSize: 12, marginBottom: 12 }}>↔ Tap a slab to move it · <strong>press &amp; hold</strong> a slab to select several at once.</div>
          )}
          {selectMode && (
            <div style={{ fontSize: 12, fontWeight: 700, color: "var(--gold-dark)", marginBottom: 12 }}>✓ Tap slabs to select, then move them together. (Esc to cancel)</div>
          )}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(205px, 1fr))", gap: 10, paddingBottom: selectMode ? 76 : 0 }}>
            {node.slabs.map((s, i) => (
              <BigSlabCard
                key={s.id}
                s={s}
                delay={Math.min(i * 18, 360)}
                canSelect={canSelect}
                selectMode={selectMode}
                selected={selectedIds.has(s.id)}
                onSingleMove={onSingleMove}
                onEnterSelect={onEnterSelect}
                onToggle={onToggle}
              />
            ))}
          </div>
        </>
      ) : (
        <SlabTable slabs={node.slabs} canEdit={canSelect} title={title} />
      )}
    </div>
  );
}

const LONG_PRESS_MS = 600; // press-and-hold to enter multi-select

function BigSlabCard({
  s, delay, canSelect, selectMode, selected, onSingleMove, onEnterSelect, onToggle,
}: {
  s: TempleSlabCard;
  delay: number;
  canSelect: boolean;
  selectMode: boolean;
  selected: boolean;
  onSingleMove: (s: TempleSlabCard) => void;
  onEnterSelect: (s: TempleSlabCard) => void;
  onToggle: (id: string) => void;
}) {
  const bucket = bucketOf(s.status);
  const color = STAGE_META[bucket].color;
  const clickable = canSelect;

  // Long-press → enter select mode. A move beyond ~10px (scroll) or an early
  // release cancels it; a fired long-press suppresses the click that follows.
  const timer = useRef<number | null>(null);
  const firedRef = useRef(false);
  const startPos = useRef<{ x: number; y: number } | null>(null);

  function clearTimer() {
    if (timer.current != null) { window.clearTimeout(timer.current); timer.current = null; }
  }
  function onPointerDown(e: React.PointerEvent) {
    if (!canSelect || selectMode) return; // hold only matters to ENTER select mode
    firedRef.current = false;
    startPos.current = { x: e.clientX, y: e.clientY };
    clearTimer();
    timer.current = window.setTimeout(() => {
      firedRef.current = true;
      try { navigator.vibrate?.(18); } catch { /* unsupported */ }
      onEnterSelect(s);
    }, LONG_PRESS_MS);
  }
  function onPointerMove(e: React.PointerEvent) {
    if (timer.current == null || !startPos.current) return;
    const dx = e.clientX - startPos.current.x;
    const dy = e.clientY - startPos.current.y;
    if (dx * dx + dy * dy > 100) clearTimer(); // moved >10px → treat as scroll
  }
  function onClick() {
    if (firedRef.current) { firedRef.current = false; return; } // hold already handled it
    if (selectMode) onToggle(s.id);
    else if (canSelect) onSingleMove(s);
  }

  return (
    <div
      className="tc-card"
      onClick={clickable ? onClick : undefined}
      onPointerDown={clickable ? onPointerDown : undefined}
      onPointerMove={clickable ? onPointerMove : undefined}
      onPointerUp={clickable ? clearTimer : undefined}
      onPointerLeave={clickable ? clearTimer : undefined}
      onPointerCancel={clickable ? clearTimer : undefined}
      onContextMenu={clickable ? (e) => e.preventDefault() : undefined}
      role={clickable ? "button" : undefined}
      tabIndex={clickable ? 0 : undefined}
      onKeyDown={clickable ? (e) => { if (e.key === "Enter") { if (selectMode) onToggle(s.id); else onSingleMove(s); } } : undefined}
      title={clickable ? (selectMode ? "Tap to select / unselect" : "Tap to move · hold to select several") : undefined}
      style={{
        animationDelay: `${delay}ms`,
        border: `1px solid ${selected ? "var(--gold-dark)" : "var(--border)"}`,
        borderLeft: `5px solid ${color}`,
        borderRadius: 12,
        background: selected ? "rgba(184,115,51,0.12)" : "var(--surface)",
        boxShadow: selected ? "0 0 0 2px var(--gold-dark)" : undefined,
        padding: "10px 12px", display: "flex", flexDirection: "column", gap: 4,
        cursor: clickable ? "pointer" : "default", position: "relative",
        WebkitTouchCallout: "none", WebkitUserSelect: "none", userSelect: "none",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        {selectMode && (
          <span style={{ width: 18, height: 18, flexShrink: 0, borderRadius: "50%", border: `2px solid ${selected ? "var(--gold-dark)" : "var(--border)"}`, background: selected ? "var(--gold-dark)" : "transparent", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 900 }}>
            {selected ? "✓" : ""}
          </span>
        )}
        <code style={{ fontFamily: "ui-monospace, monospace", fontWeight: 800, fontSize: 12.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.id}</code>
        {s.priority && <span>⚡</span>}
        <span style={{ marginLeft: "auto", fontSize: 9.5, fontWeight: 800, color: "#fff", background: color, borderRadius: 999, padding: "1px 8px", textTransform: "uppercase", whiteSpace: "nowrap" }}>{STAGE_META[bucket].label}</span>
      </div>
      <div style={{ fontFamily: "ui-monospace, monospace", fontSize: 12 }}>{s.l}&quot; × {s.w}&quot; × {s.t}&quot; <span className="muted">· {calcCft(s.l, s.w, s.t).toFixed(2)} CFT</span></div>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        {s.stone && <span style={{ fontSize: 10.5, fontWeight: 700, color: "var(--muted)" }}>🗿 {stoneLabel(s.stone)}</span>}
        {s.quality && <span style={{ fontSize: 10.5, fontWeight: 700, color: s.quality === "A" ? "#15803d" : "#b45309" }}>Grade {s.quality}</span>}
        {clickable && !selectMode && <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--gold-dark)", fontWeight: 800 }}>↔ move</span>}
      </div>
    </div>
  );
}

// ── Table view of the slab leaf ──────────────────────────────────────
// 8 read-only columns + an editable Remark. Rows are tinted by stage
// (same colour scheme as the cards/chips/legend) and ordered pending →
// dispatched. Only the Remark is writable (gated by canEdit; the server
// action enforces the write roles too).
function SlabTable({ slabs, canEdit, title }: { slabs: TempleSlabCard[]; canEdit: boolean; title: string }) {
  const rows = [...slabs].sort(
    (a, b) => STAGE_ORDER.indexOf(bucketOf(a.status)) - STAGE_ORDER.indexOf(bucketOf(b.status)),
  );
  const [busy, startExport] = useTransition();
  function onExport() {
    const data = rows.map((s) => {
      const b = bucketOf(s.status);
      return {
        code: s.id,
        cat1: s.section || "",
        cat2: s.element || "",
        label: s.label || "",
        description: s.description || "",
        additional: s.additional || "",
        dims: `${s.l}"×${s.w}"×${s.t}" · ${calcCft(s.l, s.w, s.t).toFixed(2)} CFT`,
        stage: STAGE_META[b].label,
        color: STAGE_META[b].color,
        remark: s.remark ?? "",
      };
    });
    startExport(async () => {
      try {
        const res = await fetch("/api/temples/slab-table.xlsx", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title, rows: data }),
        });
        if (!res.ok) return;
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${(title || "slab-list").replace(/[^\w]+/g, "-").slice(0, 60) || "slab-list"}.xlsx`;
        document.body.appendChild(a); a.click(); a.remove();
        URL.revokeObjectURL(url);
      } catch { /* ignore — user can retry */ }
    });
  }
  const th: CSSProperties = {
    padding: "8px 10px", fontSize: 10.5, fontWeight: 800, color: "var(--muted)", textTransform: "uppercase",
    letterSpacing: "0.04em", textAlign: "left", whiteSpace: "nowrap", borderBottom: "1px solid var(--border)",
    position: "sticky", top: 0, background: "var(--surface)", zIndex: 1,
  };
  const td: CSSProperties = { padding: "7px 10px", fontSize: 12, color: "var(--text)", verticalAlign: "middle", borderBottom: "1px solid var(--border)" };
  return (
    <div style={{ animation: "tcFade .3s ease" }}>
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
        <button type="button" onClick={onExport} disabled={busy} title="Download this list as an Excel file (landscape, fits the page width)" style={{ fontSize: 12, fontWeight: 800, padding: "6px 14px", borderRadius: 8, border: "1px solid var(--border)", background: busy ? "var(--border)" : "#15803d", color: "#fff", cursor: busy ? "wait" : "pointer" }}>
          {busy ? "Preparing…" : "⬇ Export Excel"}
        </button>
      </div>
      <div style={{ overflowX: "auto", border: "1px solid var(--border)", borderRadius: 10 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 1000 }}>
        <thead>
          <tr>
            <th style={th}>Code</th>
            <th style={th}>Category 1</th>
            <th style={th}>Category 2</th>
            <th style={th}>Label</th>
            <th style={th}>Description</th>
            <th style={th}>Add&apos;l description</th>
            <th style={th}>Dimensions</th>
            <th style={th}>Stage</th>
            <th style={{ ...th, minWidth: 210 }}>Remark</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((s) => {
            const bucket = bucketOf(s.status);
            const color = STAGE_META[bucket].color;
            return (
              <tr key={s.id} style={{ background: `${color}14` }}>
                <td style={{ ...td, borderLeft: `4px solid ${color}`, fontFamily: "ui-monospace, monospace", fontWeight: 800, whiteSpace: "nowrap" }}>
                  {s.priority && <span title="Priority">⚡ </span>}{s.id}
                </td>
                <td style={td}>{s.section || "—"}</td>
                <td style={td}>{s.element || "—"}</td>
                <td style={td}>{s.label || "—"}</td>
                <td style={td}>{s.description || "—"}</td>
                <td style={td}>{s.additional || "—"}</td>
                <td style={{ ...td, fontFamily: "ui-monospace, monospace", whiteSpace: "nowrap" }}>
                  {s.l}&quot;×{s.w}&quot;×{s.t}&quot; <span className="muted">· {calcCft(s.l, s.w, s.t).toFixed(2)} CFT</span>
                </td>
                <td style={{ ...td, whiteSpace: "nowrap" }}>
                  <span style={{ fontSize: 10.5, fontWeight: 800, color: "#fff", background: color, borderRadius: 999, padding: "2px 9px" }}>{STAGE_META[bucket].label}</span>
                </td>
                <td style={td}><RemarkCell slabId={s.id} initial={s.remark ?? ""} canEdit={canEdit} /></td>
              </tr>
            );
          })}
        </tbody>
      </table>
      </div>
    </div>
  );
}

// Editable per-slab remark cell. Optimistic — on a successful save we move
// the baseline forward (no full-page refetch of the 30k-slab tree).
function RemarkCell({ slabId, initial, canEdit }: { slabId: string; initial: string; canEdit: boolean }) {
  const [val, setVal] = useState(initial);
  const [baseline, setBaseline] = useState(initial);
  const [saving, startSave] = useTransition();
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState(false);
  useEffect(() => { setVal(initial); setBaseline(initial); }, [initial]);

  if (!canEdit) {
    return <span style={{ fontSize: 12, color: initial ? "var(--text)" : "var(--muted)" }}>{initial || "—"}</span>;
  }
  const dirty = val.trim() !== baseline.trim();
  function save() {
    if (!dirty || saving) return;
    const fd = new FormData();
    fd.set("slab_id", slabId);
    fd.set("remark", val);
    startSave(async () => {
      const res = await saveSlabRemarkAction(fd);
      if (res.ok) { setBaseline(val); setSaved(true); setErr(false); window.setTimeout(() => setSaved(false), 1600); }
      else { setErr(true); }
    });
  }
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <input
        value={val}
        onChange={(e) => setVal(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => { if (e.key === "Enter") (e.currentTarget as HTMLInputElement).blur(); }}
        placeholder="Add remark…"
        style={{ flex: 1, minWidth: 150, padding: "5px 8px", fontSize: 12, border: "1px solid var(--border)", borderRadius: 6, background: "var(--bg)", color: "var(--text)" }}
      />
      <span style={{ fontSize: 11, width: 14, textAlign: "center", flexShrink: 0 }}>
        {saving ? "…" : err ? <span style={{ color: "#dc2626" }} title="Save failed">⚠</span> : saved ? <span style={{ color: "#15803d" }}>✓</span> : dirty ? <span style={{ color: "var(--gold-dark)" }} title="Unsaved — click away to save">●</span> : ""}
      </span>
    </div>
  );
}
