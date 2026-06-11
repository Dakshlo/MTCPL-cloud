"use client";

// Temple View — client tree. Pick a temple, drill the component tree
// (Section › … › Element), each node shows a stage progress bar + counts.
// Leaf nodes expand to the slab list. Read-only.

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { TempleCardBrowser } from "./temple-card-browser";
import {
  STAGE_META, STAGE_ORDER, bucketOf, stoneLabel, calcCft,
  type StageBucket, type ComponentImage, type TempleSlabCard, type TempleTreeNode, type TempleTree,
} from "./temple-shared";

// Re-export the types page.tsx imports from here.
export type { StageBucket, ComponentImage, TempleSlabCard, TempleTreeNode, TempleTree };

const STATUS_LABEL: Record<string, string> = {
  open: "Open", planned: "Planned", cutting: "Cutting", cut_done: "Cut done",
  carving_assigned: "Carving assigned", carving_in_progress: "Carving", completed: "Completed",
  dispatched: "Dispatched", rejected: "Rejected",
};

// One slab card — mirrors the Ready Sizes card fields (code, dims, CFT,
// stone, quality, priority) in a compact stage-coloured card.
function SlabCard({ s }: { s: TempleSlabCard }) {
  const bucket = bucketOf(s.status);
  const color = STAGE_META[bucket].color;
  const cft = calcCft(s.l, s.w, s.t);
  return (
    <div
      title={STATUS_LABEL[s.status] ?? s.status}
      style={{
        border: `1px solid var(--border)`,
        borderLeft: `4px solid ${color}`,
        borderRadius: 10,
        background: "var(--surface)",
        padding: "8px 10px",
        display: "flex",
        flexDirection: "column",
        gap: 3,
        minWidth: 0,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <code style={{ fontFamily: "ui-monospace, monospace", fontWeight: 800, fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.id}</code>
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
      </div>
    </div>
  );
}

function StageBar({ counts, total }: { counts: Record<StageBucket, number>; total: number }) {
  if (total === 0) return null;
  return (
    <div style={{ display: "flex", height: 10, borderRadius: 999, overflow: "hidden", background: "var(--surface-alt, rgba(0,0,0,0.05))", minWidth: 120 }}>
      {STAGE_ORDER.map((s) => {
        const n = counts[s];
        if (!n) return null;
        return <div key={s} title={`${STAGE_META[s].label}: ${n}`} style={{ width: `${(n / total) * 100}%`, background: STAGE_META[s].color }} />;
      })}
    </div>
  );
}

function CountChips({ counts }: { counts: Record<StageBucket, number> }) {
  return (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
      {STAGE_ORDER.filter((s) => counts[s] > 0).map((s) => (
        <span key={s} style={{ fontSize: 10.5, fontWeight: 800, color: "#fff", background: STAGE_META[s].color, borderRadius: 999, padding: "1px 7px", whiteSpace: "nowrap" }}>
          {counts[s]} {STAGE_META[s].label}
        </span>
      ))}
    </div>
  );
}

function TreeNode({ node, depth, imagesByNode, openMode }: { node: TempleTreeNode; depth: number; imagesByNode: Record<string, ComponentImage[]>; openMode: "default" | "all" | "none" }) {
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
    <div style={{ marginLeft: depth === 0 ? 0 : 16, borderLeft: depth > 0 ? "2px solid var(--border)" : "none", paddingLeft: depth > 0 ? 6 : 0 }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: depth === 0 ? "11px 12px" : "7px 10px",
          background: bg,
          border: depth <= 1 ? "1px solid var(--border)" : "none",
          borderRadius: 10,
          cursor: "pointer",
          textAlign: "left",
          color: "var(--text)",
        }}
      >
        <span style={{ fontSize: 11, color: "var(--muted)", width: 12, flexShrink: 0 }}>{open ? "▼" : "▶"}</span>
        <span style={{ fontWeight: depth === 0 ? 800 : 700, fontSize: depth === 0 ? 14.5 : depth === 1 ? 13 : 12.5, flex: "0 1 auto", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {isLeaf ? "🔹 " : depth === 0 ? "📂 " : "📁 "}{node.name}
        </span>
        {images.length > 0 && <span title={`${images.length} photo(s)`} style={{ fontSize: 11, flexShrink: 0 }}>📷</span>}
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 12, fontWeight: 800, color: pct === 100 ? STAGE_META.done.color : "var(--muted)", flexShrink: 0, whiteSpace: "nowrap" }}>
          {done}/{node.total} · {pct}%
        </span>
        <span style={{ width: 120, flexShrink: 0 }}><StageBar counts={node.counts} total={node.total} /></span>
      </button>

      {open && (
        <div style={{ marginTop: 5, display: "flex", flexDirection: "column", gap: 5 }}>
          {!isLeaf && node.children.map((c) => <TreeNode key={c.id} node={c} depth={depth + 1} imagesByNode={imagesByNode} openMode={openMode} />)}
          {isLeaf && (
            <div style={{ marginLeft: 22, marginBottom: 8 }}>
              <div style={{ marginBottom: 8 }}><CountChips counts={node.counts} /></div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 8 }}>
                {node.slabs.map((s) => <SlabCard key={s.id} s={s} />)}
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
  done: "Finished — completed or dispatched.",
  rejected: "Rejected during a cutting or carving quality check — not usable, kept on record only.",
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

export function TempleViewClient({ trees, imagesByNode, canManageImages, categoryStruct }: { trees: TempleTree[]; imagesByNode: Record<string, ComponentImage[]>; canManageImages: boolean; categoryStruct: Record<string, Record<string, string[]>> }) {
  const [selected, setSelected] = useState<string>(trees[0]?.temple ?? "");
  const [q, setQ] = useState("");
  // Component browsing: filter within the selected temple + expand/collapse all.
  const [nodeQ, setNodeQ] = useState("");
  const [openMode, setOpenMode] = useState<"default" | "all" | "none">("default");
  const [treeKey, setTreeKey] = useState(0);
  // View modes: list (default) or immersive fullscreen cards; plus a
  // hide-menu toggle for a bigger list page.
  const [cardMode, setCardMode] = useState(false);
  const [menuHidden, setMenuHidden] = useState(false);
  // Collapse the app sidebar (body class from globals.css) whenever the menu
  // is hidden OR we're in fullscreen cards mode. Cleaned up on unmount.
  useEffect(() => {
    if (typeof document === "undefined") return;
    const hide = menuHidden || cardMode;
    document.body.classList.toggle("vendor-cockpit-fullscreen", hide);
    return () => document.body.classList.remove("vendor-cockpit-fullscreen");
  }, [menuHidden, cardMode]);

  const filteredTemples = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return trees;
    return trees.filter((t) => t.temple.toLowerCase().includes(needle));
  }, [q, trees]);

  const current = trees.find((t) => t.temple === selected) ?? filteredTemples[0] ?? trees[0];

  // Roots filtered by the component search box (keeps a branch if any
  // descendant name matches).
  const nq = nodeQ.trim().toLowerCase();
  const visibleRoots = current
    ? current.roots.map((r) => filterNode(r, nq)).filter((x): x is TempleTreeNode => x !== null)
    : [];

  if (trees.length === 0) {
    return <div className="banner">No slabs yet. Import slabs (and run ✨ Auto-categorize) to see them organised here.</div>;
  }

  // Immersive fullscreen card browser.
  if (cardMode) {
    return (
      <TempleCardBrowser
        trees={trees}
        imagesByNode={imagesByNode}
        canManageImages={canManageImages}
        categoryStruct={categoryStruct}
        onExit={() => setCardMode(false)}
      />
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
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
          {filteredTemples.map((t) => {
            const active = current?.temple === t.temple;
            return (
              <button
                key={t.temple}
                type="button"
                onClick={() => setSelected(t.temple)}
                style={{
                  display: "flex", flexDirection: "column", gap: 4, alignItems: "stretch",
                  padding: "8px 11px", borderRadius: 10, cursor: "pointer", textAlign: "left",
                  border: `1px solid ${active ? "var(--gold-dark)" : "var(--border)"}`,
                  background: active ? "var(--surface)" : "transparent",
                }}
              >
                <span style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline" }}>
                  <span style={{ fontWeight: 800, fontSize: 12.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.temple}</span>
                  <span style={{ fontSize: 11.5, fontWeight: 800, color: "var(--muted)", flexShrink: 0 }}>{t.counts.done}/{t.total}</span>
                </span>
                <StageBar counts={t.counts} total={t.total} />
              </button>
            );
          })}
        </div>
      </div>

      {/* Selected temple tree */}
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {current ? (
          <>
            {/* Big header: temple, overall progress %, full-width bar */}
            <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: "14px 16px", display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                <div style={{ fontSize: 19, fontWeight: 800 }}>🏛 {current.temple}</div>
                <div style={{ fontSize: 14, fontWeight: 800 }}>
                  <span style={{ color: STAGE_META.done.color }}>{current.counts.done}</span>
                  <span style={{ color: "var(--muted)" }}> of {current.total} done · {current.total > 0 ? Math.round((current.counts.done / current.total) * 100) : 0}%</span>
                </div>
              </div>
              <div style={{ height: 14 }}><StageBar counts={current.counts} total={current.total} /></div>
              <CountChips counts={current.counts} />
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
            </div>

            <div key={treeKey} style={{ display: "flex", flexDirection: "column", gap: 7 }}>
              {visibleRoots.length === 0 ? (
                <div className="muted" style={{ fontSize: 13, padding: "10px 2px" }}>No components match “{nodeQ}”.</div>
              ) : (
                visibleRoots.map((r) => <TreeNode key={r.id} node={r} depth={0} imagesByNode={imagesByNode} openMode={nodeQ ? "all" : openMode} />)
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
