"use client";

/**
 * Edit-slabs modal for a provisional dispatch (center peek).
 *
 * Two clear panels: what's CURRENTLY on the dispatch (remove side) and
 * what's AVAILABLE to add from the same temple (with a search box, since
 * a temple can have many ready slabs). Tracking is React state —
 * addIds/removeIds → editDispatchSlabsAction applies the diff atomically.
 */

import { useMemo, useState, type CSSProperties } from "react";
import { editDispatchSlabsAction } from "./actions";
import type { ReadySlab } from "./dispatch-client";
import { SlabComponentDetail } from "@/components/slab-component-detail";

const overlay: CSSProperties = {
  position: "fixed", inset: 0, zIndex: 1500, background: "rgba(15,12,6,0.6)",
  backdropFilter: "blur(3px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 14,
};
const panel: CSSProperties = {
  width: "100%", maxWidth: 940, maxHeight: "92vh", display: "flex", flexDirection: "column",
  background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 18,
  boxShadow: "0 24px 80px rgba(0,0,0,0.5)", overflow: "hidden",
};

function SlabRow({
  s, side, marked, onToggle,
}: {
  s: ReadySlab;
  side: "remove" | "add";
  marked: boolean;
  onToggle: () => void;
}) {
  const removing = side === "remove";
  return (
    <div
      onClick={onToggle}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onToggle(); } }}
      style={{
        display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", cursor: "pointer",
        borderRadius: 10, userSelect: "none",
        border: marked
          ? `1.5px solid ${removing ? "#dc2626" : "#15803d"}`
          : "1px solid var(--border)",
        background: marked
          ? removing ? "rgba(220,38,38,0.07)" : "rgba(22,163,74,0.08)"
          : "var(--surface)",
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          <code style={{ fontFamily: "ui-monospace, monospace", fontWeight: 800, fontSize: 13.5, textDecoration: removing && marked ? "line-through" : "none" }}>{s.id}</code>
          {s.priority && <span title="Urgent">⚡</span>}
          {s.isMarble && <span style={{ fontSize: 9, fontWeight: 800, color: "#b45309", background: "rgba(180,83,9,0.1)", borderRadius: 4, padding: "1px 6px" }}>MARBLE</span>}
        </div>
        <SlabComponentDetail
          section={s.component_section}
          element={s.component_element}
          label={s.label}
          description={s.description}
          additional={s.additional_description}
        />
        <div className="muted" style={{ fontSize: 11.5, fontFamily: "ui-monospace, monospace", marginTop: 1 }}>{s.dimensions} · {s.cft.toFixed(2)} CFT</div>
      </div>
      <span
        style={{
          fontSize: 12, fontWeight: 800, padding: "7px 13px", borderRadius: 8, whiteSpace: "nowrap",
          color: marked ? "#fff" : removing ? "#b91c1c" : "#15803d",
          background: marked ? (removing ? "#dc2626" : "#15803d") : "transparent",
          border: marked ? "none" : `1.5px solid ${removing ? "rgba(220,38,38,0.4)" : "rgba(22,163,74,0.4)"}`,
        }}
      >
        {removing ? (marked ? "Undo" : "✕ Remove") : (marked ? "✓ Added" : "+ Add")}
      </span>
    </div>
  );
}

export function EditSlabsModal({
  dispatchId,
  challanLabel,
  temple,
  currentSlabs,
  availableToAdd,
  onClose,
}: {
  dispatchId: string;
  challanLabel: string;
  temple: string;
  currentSlabs: ReadySlab[];
  /** Slabs from the same temple that are status=completed and not on any dispatch */
  availableToAdd: ReadySlab[];
  onClose: () => void;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [removeIds, setRemoveIds] = useState<Set<string>>(new Set());
  const [addIds, setAddIds] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");

  function toggleRemove(id: string) {
    setRemoveIds((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }
  function toggleAdd(id: string) {
    setAddIds((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  const pendingDiff = addIds.size + removeIds.size;
  const finalSlabCount = useMemo(
    () => currentSlabs.length - removeIds.size + addIds.size,
    [currentSlabs.length, removeIds.size, addIds.size],
  );

  const filteredAvailable = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return availableToAdd;
    return availableToAdd.filter((s) => {
      const dim = s.dimensions.toLowerCase().replace(/[×x]/g, "x").replace(/\s|in/g, "");
      const hay = `${s.id} ${s.label ?? ""}`.toLowerCase();
      return q.split(/\s+/).every((tok) => hay.includes(tok) || dim.includes(tok.replace(/[×x*]/g, "x")));
    });
  }, [availableToAdd, query]);

  return (
    <div style={overlay} onMouseDown={(e) => { if (e.target === e.currentTarget && !submitting) onClose(); }}>
      <div style={panel} role="dialog" aria-modal="true" aria-label="Edit dispatch slabs">
        {/* Header */}
        <div style={{ display: "flex", alignItems: "flex-start", gap: 12, padding: "16px 20px", borderBottom: "1px solid var(--border)", flexWrap: "wrap" }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 18, fontWeight: 800 }}>📝 Edit slabs · {challanLabel}</div>
            <div className="muted" style={{ fontSize: 12.5, marginTop: 2 }}>🏛 {temple} · provisional — changes saved atomically.</div>
          </div>
          <button type="button" onClick={onClose} disabled={submitting} aria-label="Close" style={{ marginLeft: "auto", background: "none", border: "none", fontSize: 24, cursor: "pointer", color: "var(--muted)" }}>×</button>
        </div>

        {/* Two panels */}
        <div style={{ flex: 1, minHeight: 0, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 0 }}>
          {/* Current */}
          <div style={{ display: "flex", flexDirection: "column", minHeight: 0, borderRight: "1px solid var(--border)" }}>
            <div style={{ padding: "11px 16px", background: "rgba(217,119,6,0.07)", borderBottom: "1px solid var(--border)", fontWeight: 800, fontSize: 13, color: "#b45309" }}>
              On this dispatch · {currentSlabs.length - removeIds.size} slab{currentSlabs.length - removeIds.size === 1 ? "" : "s"}
            </div>
            <div style={{ flex: 1, overflowY: "auto", padding: "10px 14px", display: "flex", flexDirection: "column", gap: 8 }}>
              {currentSlabs.length === 0 ? (
                <div className="muted" style={{ padding: "24px 8px", fontSize: 13, textAlign: "center" }}>No slabs on this dispatch.</div>
              ) : (
                currentSlabs.map((s) => <SlabRow key={s.id} s={s} side="remove" marked={removeIds.has(s.id)} onToggle={() => toggleRemove(s.id)} />)
              )}
            </div>
          </div>

          {/* Available */}
          <div style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
            <div style={{ padding: "9px 14px", background: "rgba(22,163,74,0.07)", borderBottom: "1px solid var(--border)" }}>
              <div style={{ fontWeight: 800, fontSize: 13, color: "#15803d", marginBottom: 7 }}>Available · same temple ({filteredAvailable.length})</div>
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="🔍 Search code / label / size…"
                style={{ width: "100%", padding: "8px 12px", fontSize: 13, border: "1px solid var(--border)", borderRadius: 8, background: "var(--bg)", color: "var(--text)" }}
              />
            </div>
            <div style={{ flex: 1, overflowY: "auto", padding: "10px 14px", display: "flex", flexDirection: "column", gap: 8 }}>
              {filteredAvailable.length === 0 ? (
                <div className="muted" style={{ padding: "24px 8px", fontSize: 13, textAlign: "center" }}>
                  {availableToAdd.length === 0 ? "No other completed slabs for this temple." : `No slab matches “${query}”.`}
                </div>
              ) : (
                filteredAvailable.map((s) => <SlabRow key={s.id} s={s} side="add" marked={addIds.has(s.id)} onToggle={() => toggleAdd(s.id)} />)
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 20px", borderTop: "1px solid var(--border)", flexWrap: "wrap" }}>
          <div style={{ fontSize: 13, flex: "1 1 240px", minWidth: 0 }}>
            {pendingDiff === 0 ? (
              <span className="muted">No changes yet — tap slabs to add or remove.</span>
            ) : (
              <>
                <strong style={{ color: "#b45309" }}>{addIds.size} to add · {removeIds.size} to remove</strong>
                <span className="muted"> · final: {finalSlabCount} slab{finalSlabCount !== 1 ? "s" : ""}</span>
                {finalSlabCount === 0 && <div style={{ color: "#b91c1c", marginTop: 3, fontWeight: 700 }}>⚠ Saving with 0 slabs auto-cancels the dispatch.</div>}
              </>
            )}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" onClick={onClose} disabled={submitting} className="ghost-button" style={{ fontSize: 13.5 }}>Cancel</button>
            <form
              action={(fd) => {
                setSubmitting(true);
                fd.set("id", dispatchId);
                fd.set("add_slab_ids", JSON.stringify([...addIds]));
                fd.set("remove_slab_ids", JSON.stringify([...removeIds]));
                return editDispatchSlabsAction(fd);
              }}
              style={{ display: "inline" }}
            >
              <button type="submit" disabled={submitting || pendingDiff === 0} className="primary-button" style={{ fontSize: 14, padding: "10px 20px", opacity: pendingDiff === 0 ? 0.5 : 1 }}>
                {submitting ? "Saving…" : "Save changes"}
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
