"use client";

// Mig 123 follow-on (Daksh) — immersive fullscreen card browser for a
// temple. Drill Category 1 → Category 2 → Label → Description → slabs as
// big image-covered cards, with breadcrumb navigation. Images show ONLY
// here (the list view stays text). A finder/gallery-style experience.

import { useState, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { deleteTempleComponentImageAction } from "./actions";
import { AddTempleImageButton } from "./add-image-button";
import {
  STAGE_META, STAGE_ORDER, bucketOf, calcCft, stoneLabel,
  type StageBucket, type TempleTree, type TempleTreeNode, type TempleSlabCard, type ComponentImage,
} from "./temple-shared";

function MiniBar({ counts, total }: { counts: Record<StageBucket, number>; total: number }) {
  if (total === 0) return null;
  return (
    <div style={{ display: "flex", height: 8, borderRadius: 999, overflow: "hidden", background: "rgba(255,255,255,0.25)" }}>
      {STAGE_ORDER.map((s) => counts[s] ? <div key={s} style={{ width: `${(counts[s] / total) * 100}%`, background: STAGE_META[s].color }} /> : null)}
    </div>
  );
}

export function TempleCardBrowser({
  trees, imagesByNode, canManageImages, categoryStruct, initialTemple, onExit,
}: {
  trees: TempleTree[];
  imagesByNode: Record<string, ComponentImage[]>;
  canManageImages: boolean;
  categoryStruct: Record<string, Record<string, string[]>>;
  initialTemple: string;
  onExit: () => void;
}) {
  const router = useRouter();
  const [temple, setTemple] = useState(initialTemple);
  const [path, setPath] = useState<TempleTreeNode[]>([]);
  const [deleting, setDeleting] = useState<string | null>(null);

  const tree = trees.find((t) => t.temple === temple) ?? trees[0];
  const currentNode = path[path.length - 1] ?? null;
  const children = currentNode ? currentNode.children : (tree?.roots ?? []);
  const isLeaf = currentNode != null && currentNode.children.length === 0;

  function changeTemple(t: string) { setTemple(t); setPath([]); }
  function drill(n: TempleTreeNode) { setPath((p) => [...p, n]); }
  function goTo(keep: number) { setPath((p) => p.slice(0, keep)); }

  async function delImage(id: string) {
    if (deleting) return;
    setDeleting(id);
    try {
      const fd = new FormData();
      fd.set("id", id);
      await deleteTempleComponentImageAction(fd);
      router.refresh();
    } finally { setDeleting(null); }
  }

  const depth = path.length; // 0 = Category-1 level
  const icon = depth === 0 ? "📂" : depth === 1 ? "📁" : depth === 2 ? "🏷️" : "📄";

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 1500, background: "var(--bg)", display: "flex", flexDirection: "column" }}>
      <style>{`.tc-card{transition:transform .14s ease,box-shadow .14s ease}.tc-card:hover{transform:translateY(-4px);box-shadow:0 14px 32px rgba(0,0,0,.18)}`}</style>

      {/* ── Top bar ── */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 18px", borderBottom: "1px solid var(--border)", background: "var(--surface)", flexWrap: "wrap" }}>
        <button type="button" onClick={onExit} style={{ fontSize: 13, fontWeight: 800, padding: "8px 14px", borderRadius: 9, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)", cursor: "pointer" }}>✕ Exit cards view</button>
        <select value={temple} onChange={(e) => changeTemple(e.target.value)} style={{ fontSize: 13.5, fontWeight: 800, padding: "8px 10px", borderRadius: 9, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)", maxWidth: 320 }}>
          {trees.map((t) => <option key={t.temple} value={t.temple}>{t.temple}</option>)}
        </select>
        <span style={{ flex: 1 }} />
        {canManageImages && <AddTempleImageButton categoryStruct={categoryStruct} />}
      </div>

      {/* ── Breadcrumb ── */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "10px 18px", borderBottom: "1px solid var(--border)", background: "var(--surface-alt, rgba(0,0,0,0.02))", flexWrap: "wrap", fontSize: 13 }}>
        <button type="button" onClick={() => goTo(0)} style={crumbStyle(path.length === 0)}>🏛 {temple}</button>
        {path.map((n, i) => (
          <span key={n.id} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <span style={{ color: "var(--muted)" }}>›</span>
            <button type="button" onClick={() => goTo(i + 1)} style={crumbStyle(i === path.length - 1)}>{n.name}</button>
          </span>
        ))}
      </div>

      {/* ── Body ── */}
      <div style={{ flex: 1, overflowY: "auto", padding: 18 }}>
        {isLeaf ? (
          <SlabCardsGrid node={currentNode!} />
        ) : children.length === 0 ? (
          <div className="muted" style={{ fontSize: 14, padding: 20 }}>Nothing here yet.</div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(230px, 1fr))", gap: 16 }}>
            {children.map((c) => {
              const imgs = imagesByNode[c.id] ?? [];
              const cover = imgs[0];
              const pct = c.total > 0 ? Math.round((c.counts.done / c.total) * 100) : 0;
              return (
                <button
                  key={c.id}
                  type="button"
                  className="tc-card"
                  onClick={() => drill(c)}
                  style={{ display: "flex", flexDirection: "column", textAlign: "left", padding: 0, border: "1px solid var(--border)", borderRadius: 16, overflow: "hidden", background: "var(--surface)", cursor: "pointer", color: "var(--text)" }}
                >
                  {/* cover */}
                  <div style={{ position: "relative", height: 150, background: cover ? "#0f172a" : `linear-gradient(135deg, ${STAGE_META.cutting.color}22, ${STAGE_META.carving.color}22)`, display: "flex", alignItems: "center", justifyContent: "center" }}>
                    {cover ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={cover.url} alt={c.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                    ) : (
                      <span style={{ fontSize: 44, opacity: 0.5 }}>{icon}</span>
                    )}
                    {imgs.length > 1 && <span style={{ position: "absolute", top: 8, right: 8, fontSize: 10.5, fontWeight: 800, color: "#fff", background: "rgba(0,0,0,0.55)", borderRadius: 999, padding: "2px 8px" }}>📷 {imgs.length}</span>}
                    {canManageImages && cover && (
                      <button type="button" onClick={(e) => { e.stopPropagation(); delImage(cover.id); }} title="Delete this image" style={{ position: "absolute", top: 8, left: 8, width: 22, height: 22, borderRadius: 999, border: "none", background: "rgba(220,38,38,0.92)", color: "#fff", fontSize: 13, cursor: "pointer", lineHeight: "20px", padding: 0 }}>×</button>
                    )}
                    <span style={{ position: "absolute", bottom: 8, right: 8, fontSize: 12, fontWeight: 900, color: "#fff", background: pct === 100 ? STAGE_META.done.color : "rgba(0,0,0,0.6)", borderRadius: 999, padding: "2px 9px" }}>{pct}%</span>
                  </div>
                  {/* info */}
                  <div style={{ padding: "11px 13px", display: "flex", flexDirection: "column", gap: 7 }}>
                    <div style={{ fontWeight: 800, fontSize: 14.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.name}</div>
                    <MiniBar counts={c.counts} total={c.total} />
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 11.5 }}>
                      <span style={{ color: STAGE_META.done.color, fontWeight: 800 }}>{c.counts.done}/{c.total} done</span>
                      <span style={{ color: "var(--muted)", fontWeight: 700 }}>{c.children.length > 0 ? `${c.children.length} inside →` : `${c.total} slabs`}</span>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function crumbStyle(active: boolean): CSSProperties {
  return { fontSize: 12.5, fontWeight: active ? 800 : 600, padding: "5px 11px", borderRadius: 8, border: `1px solid ${active ? "var(--gold-dark)" : "var(--border)"}`, background: active ? "rgba(184,115,51,0.08)" : "var(--surface)", color: "var(--text)", cursor: "pointer", whiteSpace: "nowrap" };
}

function SlabCardsGrid({ node }: { node: TempleTreeNode }) {
  return (
    <div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
        {STAGE_ORDER.filter((s) => node.counts[s] > 0).map((s) => (
          <span key={s} style={{ fontSize: 11, fontWeight: 800, color: "#fff", background: STAGE_META[s].color, borderRadius: 999, padding: "2px 9px" }}>{node.counts[s]} {STAGE_META[s].label}</span>
        ))}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 10 }}>
        {node.slabs.map((s) => <BigSlabCard key={s.id} s={s} />)}
      </div>
    </div>
  );
}

function BigSlabCard({ s }: { s: TempleSlabCard }) {
  const bucket = bucketOf(s.status);
  const color = STAGE_META[bucket].color;
  return (
    <div style={{ border: "1px solid var(--border)", borderLeft: `5px solid ${color}`, borderRadius: 12, background: "var(--surface)", padding: "10px 12px", display: "flex", flexDirection: "column", gap: 4 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <code style={{ fontFamily: "ui-monospace, monospace", fontWeight: 800, fontSize: 12.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.id}</code>
        {s.priority && <span>⚡</span>}
        <span style={{ marginLeft: "auto", fontSize: 9.5, fontWeight: 800, color: "#fff", background: color, borderRadius: 999, padding: "1px 8px", textTransform: "uppercase", whiteSpace: "nowrap" }}>{STAGE_META[bucket].label}</span>
      </div>
      <div style={{ fontFamily: "ui-monospace, monospace", fontSize: 12 }}>{s.l}&quot; × {s.w}&quot; × {s.t}&quot; <span className="muted">· {calcCft(s.l, s.w, s.t).toFixed(2)} CFT</span></div>
      <div style={{ display: "flex", gap: 8 }}>
        {s.stone && <span style={{ fontSize: 10.5, fontWeight: 700, color: "var(--muted)" }}>🗿 {stoneLabel(s.stone)}</span>}
        {s.quality && <span style={{ fontSize: 10.5, fontWeight: 700, color: s.quality === "A" ? "#15803d" : "#b45309" }}>Grade {s.quality}</span>}
      </div>
    </div>
  );
}
