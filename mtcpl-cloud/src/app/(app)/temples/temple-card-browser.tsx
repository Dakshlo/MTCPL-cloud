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

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { deleteTempleComponentImageAction } from "./actions";
import { MoveSlabModal, NodeImageUploader } from "./temple-node-modals";
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
  trees, imagesByNode, canManageImages, templeCats, onExit,
}: {
  trees: TempleTree[];
  imagesByNode: Record<string, ComponentImage[]>;
  canManageImages: boolean;
  templeCats: TempleCats;
  onExit: () => void;
}) {
  const router = useRouter();
  // temple === null → fullscreen temple picker (the landing screen).
  const [temple, setTemple] = useState<string | null>(null);
  const [path, setPath] = useState<TempleTreeNode[]>([]);
  const [lightbox, setLightbox] = useState<{ images: ComponentImage[]; index: number } | null>(null);
  // Mig 128 — move-slab + per-node image-upload modals.
  // moveSlabs holds 1 (single tap) OR many (multi-select) slabs to move.
  const [moveSlabs, setMoveSlabs] = useState<TempleSlabCard[] | null>(null);
  const [uploadNode, setUploadNode] = useState<{ path: string; label: string } | null>(null);
  // Mig 128 follow-on — multi-select inside the current leaf. Press-and-hold
  // a slab card for ~0.6s to enter select mode, then tap to pick several (all
  // in the SAME leaf), and move them together.
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  function exitSelect() { setSelectMode(false); setSelectedIds(new Set()); }

  const tree = temple ? trees.find((t) => t.temple === temple) ?? null : null;
  const currentNode = path[path.length - 1] ?? null;
  const children = currentNode ? currentNode.children : (tree?.roots ?? []);
  const isLeaf = currentNode != null && currentNode.children.length === 0;
  const cats = temple ? (templeCats[temple] ?? { cat1: [], cat2: [], labels: [] }) : { cat1: [], cat2: [], labels: [] };

  function goUp() {
    if (path.length > 0) setPath((p) => p.slice(0, -1));
    else if (temple) setTemple(null);
    else onExit();
  }

  // Esc = up one level (or close the lightbox first). Skips inputs/dialogs
  // so the Add-image modal keeps its own Esc behaviour.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // A modal (move / upload) owns Escape while it's open.
      if (e.key === "Escape" && (moveSlabs || uploadNode)) {
        e.preventDefault();
        setMoveSlabs(null);
        setUploadNode(null);
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
  }, [lightbox, path.length, temple, moveSlabs, uploadNode, selectMode]);

  // Leaving a leaf (drill in/out or switch temple) drops the selection — it
  // only ever applies to slabs in the leaf you're looking at.
  useEffect(() => { exitSelect(); }, [temple, path]);

  // First image anywhere under a temple → its landing-card cover.
  function templeCover(t: string): ComponentImage | null {
    for (const [k, imgs] of Object.entries(imagesByNode)) {
      if (k.startsWith(`${t}/`) && imgs.length > 0) return imgs[0];
    }
    return null;
  }

  // Re-keys the grid per level so the stagger entrance replays on drill.
  const levelKey = `${temple ?? "@temples"}/${path.map((p) => p.name).join("/")}`;

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 1500, background: "var(--bg)", display: "flex", flexDirection: "column" }}>
      <style>{`
        @keyframes tcIn { from { opacity: 0; transform: translateY(16px) scale(.97); } to { opacity: 1; transform: none; } }
        @keyframes tcFade { from { opacity: 0; } to { opacity: 1; } }
        @keyframes tcZoom { from { opacity: 0; transform: scale(.92); } to { opacity: 1; transform: none; } }
        .tc-card { opacity: 0; animation: tcIn .38s cubic-bezier(.2,.7,.3,1) forwards; transition: transform .16s ease, box-shadow .16s ease, border-color .16s ease; }
        .tc-card:hover { transform: translateY(-5px); box-shadow: 0 16px 40px rgba(0,0,0,.16); border-color: var(--gold-dark) !important; }
        .tc-card:active { transform: translateY(-1px) scale(.99); }
      `}</style>

      {/* ── Top bar ── */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "11px 18px", borderBottom: "1px solid var(--border)", background: "var(--surface)", flexWrap: "wrap" }}>
        <button type="button" onClick={goUp} title="Esc" style={{ fontSize: 13, fontWeight: 800, padding: "8px 14px", borderRadius: 9, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)", cursor: "pointer" }}>
          ← Back
        </button>
        {/* Breadcrumb */}
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", fontSize: 13, minWidth: 0 }}>
          <button type="button" onClick={() => { setTemple(null); setPath([]); }} style={crumbStyle(!temple)}>🏛 Temples</button>
          {temple && (
            <>
              <span style={{ color: "var(--muted)" }}>›</span>
              <button type="button" onClick={() => setPath([])} style={crumbStyle(path.length === 0)}>{temple}</button>
            </>
          )}
          {path.map((n, i) => (
            <span key={n.id} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <span style={{ color: "var(--muted)" }}>›</span>
              <button type="button" onClick={() => setPath((p) => p.slice(0, i + 1))} style={crumbStyle(i === path.length - 1)}>{n.name}</button>
            </span>
          ))}
        </div>
        <span style={{ flex: 1 }} />
        <span className="muted" style={{ fontSize: 11.5, whiteSpace: "nowrap" }}>Esc = back</span>
        {/* Contextual photo upload — adds to the node you're currently in
            (Category / Label / Description). Cat-1 cards have their own ＋
            button at the temple root. */}
        {canManageImages && temple && currentNode && (
          <button
            type="button"
            onClick={() => setUploadNode({ path: currentNode.id, label: currentNode.name })}
            title={`Add a photo to ${currentNode.name}`}
            style={{ fontSize: 12.5, fontWeight: 800, padding: "8px 13px", borderRadius: 9, border: "1px solid var(--gold-dark)", background: "var(--surface)", color: "var(--gold-dark)", cursor: "pointer", whiteSpace: "nowrap" }}
          >
            📷 Add photo here
          </button>
        )}
        <button type="button" onClick={onExit} style={{ fontSize: 13, fontWeight: 800, padding: "8px 14px", borderRadius: 9, border: "none", background: "var(--gold-dark)", color: "#fff", cursor: "pointer" }}>✕ Exit</button>
      </div>

      {/* ── Body ── */}
      <div key={levelKey} style={{ flex: 1, overflowY: "auto", padding: "20px 22px 40px" }}>
        {!temple ? (
          /* ── Temple picker landing ── */
          <>
            <div style={{ fontSize: 20, fontWeight: 800, marginBottom: 16, animation: "tcFade .3s ease" }}>Choose a temple</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(250px, 1fr))", gap: 18 }}>
              {trees.map((t, i) => {
                const pct = t.total > 0 ? Math.round((t.counts.done / t.total) * 100) : 0;
                const cover = templeCover(t.temple);
                return (
                  <button key={t.temple} type="button" className="tc-card" onClick={() => setTemple(t.temple)} style={{ ...cardShell, animationDelay: `${Math.min(i * 40, 480)}ms` }}>
                    <div style={{ position: "relative", height: 130, background: cover ? "#0f172a" : "linear-gradient(135deg, #92400e22, #b8733344)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                      {cover ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={cover.url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                      ) : (
                        <span style={{ fontSize: 46, opacity: 0.45 }}>🏛</span>
                      )}
                      <div style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg, transparent 50%, rgba(0,0,0,0.45))" }} />
                      <div style={{ position: "absolute", top: 10, right: 10 }}><Ring pct={pct} onImage /></div>
                    </div>
                    <div style={{ padding: "12px 14px", display: "flex", flexDirection: "column", gap: 8 }}>
                      <div style={{ fontWeight: 800, fontSize: 14.5, lineHeight: 1.25 }}>{t.temple}</div>
                      <MiniBar counts={t.counts} total={t.total} />
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11.5, fontWeight: 700 }}>
                        <span style={{ color: STAGE_META.done.color }}>{t.counts.done}/{t.total} done</span>
                        <span style={{ color: "var(--muted)" }}>{t.roots.length} categor{t.roots.length === 1 ? "y" : "ies"} →</span>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </>
        ) : isLeaf ? (
          /* ── Leaf: the actual slabs ── */
          <SlabCardsGrid
            node={currentNode!}
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
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(235px, 1fr))", gap: 16 }}>
            {children.map((c, i) => {
              const imgs = imagesByNode[c.id] ?? [];
              const cover = imgs[0];
              const pct = c.total > 0 ? Math.round((c.counts.done / c.total) * 100) : 0;
              const depth = path.length;
              const icon = depth === 0 ? "📂" : depth === 1 ? "📁" : depth === 2 ? "🏷️" : "📄";
              return (
                <div key={c.id} className="tc-card" style={{ ...cardShell, animationDelay: `${Math.min(i * 35, 420)}ms`, cursor: "pointer", position: "relative" }} onClick={() => setPath((p) => [...p, c])} role="button" tabIndex={0}
                  onKeyDown={(e) => { if (e.key === "Enter") setPath((p) => [...p, c]); }}>
                  <div style={{ position: "relative", height: 148, background: cover ? "#0f172a" : `linear-gradient(135deg, ${STAGE_META.cutting.color}18, ${STAGE_META.carving.color}22)`, display: "flex", alignItems: "center", justifyContent: "center" }}>
                    {cover ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={cover.url} alt={c.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                    ) : (
                      <span style={{ fontSize: 46, opacity: 0.45 }}>{icon}</span>
                    )}
                    <div style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg, transparent 55%, rgba(0,0,0,0.4))" }} />
                    <div style={{ position: "absolute", top: 10, right: 10 }}><Ring pct={pct} onImage /></div>
                    {canManageImages && (
                      <button
                        type="button"
                        title={`Add a photo to ${c.name}`}
                        onClick={(e) => { e.stopPropagation(); setUploadNode({ path: c.id, label: c.name }); }}
                        style={{ position: "absolute", top: 10, left: 10, fontSize: 13, fontWeight: 800, color: "#fff", background: "rgba(0,0,0,0.5)", border: "1px solid rgba(255,255,255,0.4)", borderRadius: 999, width: 30, height: 30, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", backdropFilter: "blur(3px)" }}
                      >
                        📷
                      </button>
                    )}
                    {imgs.length > 0 && (
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

      {/* Mig 128 — attach a photo to the current / picked node (any level). */}
      {uploadNode && temple && (
        <NodeImageUploader
          temple={temple}
          nodePath={uploadNode.path}
          nodeLabel={uploadNode.label}
          onClose={() => setUploadNode(null)}
          onUploaded={() => { setUploadNode(null); router.refresh(); }}
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
  node, images, canSelect, selectMode, selectedIds, onSingleMove, onEnterSelect, onToggle, onViewImages,
}: {
  node: TempleTreeNode;
  images: ComponentImage[];
  canSelect: boolean;
  selectMode: boolean;
  selectedIds: Set<string>;
  onSingleMove: (s: TempleSlabCard) => void;
  onEnterSelect: (s: TempleSlabCard) => void;
  onToggle: (id: string) => void;
  onViewImages: (imgs: ComponentImage[], index: number) => void;
}) {
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
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: canSelect ? 8 : 14, animation: "tcFade .3s ease" }}>
        {STAGE_ORDER.filter((s) => node.counts[s] > 0).map((s) => (
          <span key={s} style={{ fontSize: 11.5, fontWeight: 800, color: "#fff", background: STAGE_META[s].color, borderRadius: 999, padding: "3px 11px" }}>{node.counts[s]} {STAGE_META[s].label}</span>
        ))}
      </div>
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
