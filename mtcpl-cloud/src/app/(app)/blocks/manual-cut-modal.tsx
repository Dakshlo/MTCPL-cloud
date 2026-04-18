"use client";

import { useState } from "react";
import { manualCutBlockAction } from "./actions";
import { yardLabel } from "@/lib/yards";

type OpenSlab = {
  id: string;
  label?: string | null;
  temple?: string | null;
  stone?: string | null;
  quality?: string | null;
  length_ft: number;
  width_ft: number;
  thickness_ft: number;
  priority?: boolean;
};

type Block = {
  id: string;
  stone: string;
  yard: number;
  length_ft: number;
  width_ft: number;
  height_ft: number;
};

type RemainderEntry = { l: string; w: string; h: string };

export function ManualCutModal({
  block,
  openSlabs,
  onClose,
}: {
  block: Block;
  openSlabs: OpenSlab[];
  onClose: () => void;
}) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState("");
  const [templeFilter, setTempleFilter] = useState("all");
  const [remainders, setRemainders] = useState<RemainderEntry[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggleSlab(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function addRemainder() {
    setRemainders((prev) => [...prev, { l: "", w: "", h: "" }]);
  }

  function removeRemainder(index: number) {
    setRemainders((prev) => prev.filter((_, i) => i !== index));
  }

  function updateRemainder(index: number, field: "l" | "w" | "h", value: string) {
    setRemainders((prev) =>
      prev.map((r, i) => (i === index ? { ...r, [field]: value } : r))
    );
  }

  const validRemainders = remainders
    .map((r, i) => ({
      id: `${block.id}-R${i + 1}`,
      l: parseFloat(r.l) || 0,
      w: parseFloat(r.w) || 0,
      h: parseFloat(r.h) || 0,
    }))
    .filter((r) => r.l > 0 && r.w > 0 && r.h > 0);

  const temples = Array.from(new Set(openSlabs.map((s) => s.temple ?? "").filter(Boolean))).sort();

  const filteredSlabs = openSlabs.filter((s) => {
    if (templeFilter !== "all" && s.temple !== templeFilter) return false;
    if (!filter) return true;
    const q = filter.toLowerCase();
    return (
      s.id.toLowerCase().includes(q) ||
      (s.temple ?? "").toLowerCase().includes(q) ||
      (s.label ?? "").toLowerCase().includes(q)
    );
  });

  const slabIdsList = [...selectedIds];
  const remaindersJson = JSON.stringify(validRemainders);
  const hasValidRemainders = validRemainders.length > 0;

  async function handleSubmit(restock: boolean) {
    if (selectedIds.size === 0) {
      setError("Select at least one slab to mark as cut.");
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const formData = new FormData();
      formData.set("block_id", block.id);
      formData.set("stone", block.stone);
      formData.set("yard", String(block.yard));
      formData.set("slab_ids", JSON.stringify(slabIdsList));
      formData.set("remainders_json", remaindersJson);
      formData.set("restock", restock ? "yes" : "no");
      await manualCutBlockAction(formData);
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
      setSubmitting(false);
    }
  }

  return (
    <>
      <div className="drawer-backdrop" onClick={onClose} />
      <div
        className="edit-drawer"
        style={{ maxWidth: 520 }}
        role="dialog"
        aria-modal="true"
        aria-label="Manual Cut Entry"
      >
        <div className="drawer-header">
          <div>
            <div className="drawer-title">✂ Manual Cut Entry</div>
            <code className="drawer-subtitle">{block.id}</code>
            <p className="muted" style={{ margin: "4px 0 0", fontSize: 12 }}>
              {block.stone} · {yardLabel(block.yard)} · {block.length_ft} × {block.width_ft} × {block.height_ft} in
            </p>
          </div>
          <button className="drawer-close" onClick={onClose}>✕</button>
        </div>

        <div className="drawer-body">
          {error && (
            <div style={{ padding: "10px 14px", background: "#fef2f2", border: "1px solid #fca5a5", borderRadius: 6, marginBottom: 14, fontSize: 13, color: "#dc2626" }}>
              {error}
            </div>
          )}

          {/* Slab selection */}
          <div style={{ marginBottom: 16 }}>
            <p style={{ fontSize: 12, fontWeight: 700, margin: "0 0 8px", color: "var(--text)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
              Select slabs that were cut
              {selectedIds.size > 0 && (
                <span className="role-pill badge-available" style={{ fontSize: 10, marginLeft: 8, textTransform: "none", letterSpacing: 0 }}>
                  {selectedIds.size} selected
                </span>
              )}
            </p>

            {openSlabs.length === 0 ? (
              <p className="muted" style={{ fontSize: 13 }}>
                No open {block.stone} slab requirements found. Add slab requirements first.
              </p>
            ) : (
              <>
                <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 8 }}>
                  <input
                    type="text"
                    placeholder="Filter by ID, temple, label…"
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                    style={{
                      width: "100%",
                      boxSizing: "border-box",
                      fontSize: 13,
                      border: "1px solid var(--border)",
                      borderRadius: 5,
                      padding: "7px 10px",
                      background: "var(--bg)",
                      color: "var(--text)",
                      outline: "none",
                    }}
                  />
                  {temples.length > 1 && (
                    <select
                      value={templeFilter}
                      onChange={(e) => setTempleFilter(e.target.value)}
                      style={{
                        width: "100%",
                        boxSizing: "border-box",
                        fontSize: 13,
                        border: "1px solid var(--border)",
                        borderRadius: 5,
                        padding: "7px 8px",
                        background: "var(--bg)",
                        color: "var(--text)",
                      }}
                    >
                      <option value="all">All temples</option>
                      {temples.map((t) => (
                        <option key={t} value={t}>{t}</option>
                      ))}
                    </select>
                  )}
                </div>

                <div style={{ maxHeight: 260, overflowY: "auto", display: "flex", flexDirection: "column", gap: 5, border: "1px solid var(--border)", borderRadius: 6, padding: "8px 10px", background: "var(--surface)" }}>
                  {filteredSlabs.length === 0 ? (
                    <p className="muted" style={{ fontSize: 12 }}>No matching slabs.</p>
                  ) : (
                    filteredSlabs.map((slab) => (
                      <label
                        key={slab.id}
                        style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 13 }}
                      >
                        <input
                          type="checkbox"
                          checked={selectedIds.has(slab.id)}
                          onChange={() => toggleSlab(slab.id)}
                          style={{ width: 15, height: 15, cursor: "pointer" }}
                        />
                        <code style={{ fontSize: 12, fontWeight: 600 }}>{slab.id}</code>
                        {slab.priority && <span style={{ fontSize: 10 }}>⚡</span>}
                        {slab.temple && (
                          <span className="muted" style={{ fontSize: 11 }}>
                            {slab.temple}{slab.label && slab.label !== slab.temple ? ` · ${slab.label}` : ""}
                          </span>
                        )}
                        <span className="muted" style={{ fontSize: 11 }}>
                          {slab.length_ft}×{slab.width_ft}×{slab.thickness_ft} in
                        </span>
                        {slab.quality && (
                          <span className={`role-pill ${slab.quality === "A" ? "badge-available" : "badge-reserved"}`} style={{ fontSize: 9, marginLeft: "auto" }}>
                            {slab.quality}
                          </span>
                        )}
                      </label>
                    ))
                  )}
                </div>
              </>
            )}
          </div>

          {/* Remainder pieces */}
          <div style={{ marginBottom: 16 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: remainders.length ? 8 : 0 }}>
              <p style={{ fontSize: 12, fontWeight: 700, margin: 0, color: "var(--text)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                Remaining block pieces{remainders.length > 0 ? ` (${validRemainders.length} valid)` : ""}
              </p>
              <button
                type="button"
                className="ghost-button"
                style={{ fontSize: 12, padding: "2px 10px" }}
                onClick={addRemainder}
              >
                + Add piece
              </button>
            </div>

            {remainders.length === 0 && (
              <p className="muted" style={{ fontSize: 12, marginTop: 6 }}>
                No remaining pieces — click &ldquo;+ Add piece&rdquo; for each leftover block.
              </p>
            )}

            {remainders.map((r, i) => {
              const pieceId = `${block.id}-R${i + 1}`;
              const isValid = parseFloat(r.l) > 0 && parseFloat(r.w) > 0 && parseFloat(r.h) > 0;
              return (
                <div
                  key={i}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    marginBottom: 8,
                    flexWrap: "wrap",
                    padding: "8px 10px",
                    background: "var(--surface)",
                    border: `1px solid ${isValid ? "var(--border)" : "var(--border-light)"}`,
                    borderRadius: 6,
                  }}
                >
                  <code style={{ fontSize: 12, fontWeight: 700, minWidth: 80, color: "var(--accent)" }}>
                    {pieceId}
                  </code>
                  <input type="number" min="0" step="0.1" placeholder="L in" value={r.l}
                    onChange={(e) => updateRemainder(i, "l", e.target.value)} style={{ width: 68, fontSize: 13 }} />
                  <span className="muted" style={{ fontSize: 11 }}>×</span>
                  <input type="number" min="0" step="0.1" placeholder="W in" value={r.w}
                    onChange={(e) => updateRemainder(i, "w", e.target.value)} style={{ width: 68, fontSize: 13 }} />
                  <span className="muted" style={{ fontSize: 11 }}>×</span>
                  <input type="number" min="0" step="0.1" placeholder="H in" value={r.h}
                    onChange={(e) => updateRemainder(i, "h", e.target.value)} style={{ width: 68, fontSize: 13 }} />
                  <span className="muted" style={{ fontSize: 11 }}>in</span>
                  {isValid && (
                    <span className="role-pill badge-available" style={{ fontSize: 10 }}>
                      {block.stone} · Reused
                    </span>
                  )}
                  <button type="button" className="ghost-button danger-ghost"
                    style={{ fontSize: 12, padding: "1px 8px", marginLeft: "auto" }}
                    onClick={() => removeRemainder(i)}>×</button>
                </div>
              );
            })}

            {hasValidRemainders && (
              <p className="muted" style={{ fontSize: 11, marginTop: 4 }}>
                {validRemainders.length} piece{validRemainders.length > 1 ? "s" : ""} will be added to Blocks inventory when you click &ldquo;Cut &amp; Restock&rdquo;.
              </p>
            )}
          </div>

          {/* Action buttons */}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {hasValidRemainders ? (
              <>
                <button
                  className="primary-button"
                  disabled={submitting || selectedIds.size === 0}
                  onClick={() => handleSubmit(true)}
                >
                  {submitting ? "Saving…" : `Cut & Restock (${validRemainders.length} piece${validRemainders.length > 1 ? "s" : ""})`}
                </button>
                <button
                  className="secondary-button"
                  disabled={submitting || selectedIds.size === 0}
                  onClick={() => handleSubmit(false)}
                >
                  Cut & Discard
                </button>
              </>
            ) : (
              <button
                className="primary-button"
                disabled={submitting || selectedIds.size === 0}
                onClick={() => handleSubmit(false)}
              >
                {submitting ? "Saving…" : "Record Cut"}
              </button>
            )}
            <button
              className="ghost-button"
              disabled={submitting}
              onClick={onClose}
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
