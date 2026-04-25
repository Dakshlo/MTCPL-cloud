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
  /** Present only for marble blocks. When set, manual cut hides the
   *  remainder-pieces UI and the server skips restock creation. */
  tonnes?: number | null;
};

type RemainderEntry = { l: string; w: string; h: string };

export function ManualCutModal({
  block,
  openSlabs,
  onClose,
  isMarble = false,
}: {
  block: Block;
  openSlabs: OpenSlab[];
  onClose: () => void;
  /** When true, the remainder-pieces section is hidden. Marble blocks
   *  are brittle and don't get restocked — slabs only, rest is implicit
   *  loss. */
  isMarble?: boolean;
}) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState("");
  const [templeFilter, setTempleFilter] = useState("all");
  // Stone-match toggle: by default we narrow the slab list to slabs of
  // the same stone as the block being cut (you can't physically cut a
  // PinkStone slab from a YellowMarble block). Toggle off to override
  // for legacy data or special cases.
  const [matchStoneOnly, setMatchStoneOnly] = useState(true);
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

  // Pre-narrow by stone if the toggle is on (default). The temples list
  // is also derived AFTER stone filtering so the temple dropdown only
  // shows temples that actually have same-stone slabs.
  const stoneNarrowed = matchStoneOnly
    ? openSlabs.filter((s) => s.stone === block.stone)
    : openSlabs;

  const temples = Array.from(new Set(stoneNarrowed.map((s) => s.temple ?? "").filter(Boolean))).sort();

  const filteredSlabs = stoneNarrowed.filter((s) => {
    if (templeFilter !== "all" && s.temple !== templeFilter) return false;
    if (!filter) return true;
    const q = filter.toLowerCase();
    return (
      s.id.toLowerCase().includes(q) ||
      (s.temple ?? "").toLowerCase().includes(q) ||
      (s.label ?? "").toLowerCase().includes(q)
    );
  });

  // Bulk select / clear helpers — useful when picking many slabs at
  // once for a marble block (e.g. "all 12 slabs of UPARPITAM").
  function selectAllVisible() {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const s of filteredSlabs) next.add(s.id);
      return next;
    });
  }
  function clearAllSelections() {
    setSelectedIds(new Set());
  }

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
        style={{ maxWidth: 760 }}
        role="dialog"
        aria-modal="true"
        aria-label="Manual Cut Entry"
      >
        <div className="drawer-header">
          <div>
            <div className="drawer-title">✂ Manual Cut Entry</div>
            <code className="drawer-subtitle">{block.id}</code>
            <p className="muted" style={{ margin: "4px 0 0", fontSize: 12 }}>
              {block.stone} · {yardLabel(block.yard)}
              {isMarble && block.tonnes != null
                ? ` · ${Number(block.tonnes).toFixed(3)} T (marble)`
                : ` · ${block.length_ft} × ${block.width_ft} × ${block.height_ft} in`}
            </p>
            {isMarble && (
              <p
                className="muted"
                style={{
                  margin: "4px 0 0",
                  fontSize: 11,
                  color: "#b45309",
                  fontStyle: "italic",
                }}
              >
                Marble blocks: no remainder pieces — slabs only, the rest is implicit yield loss.
              </p>
            )}
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
                No open slab requirements found. Add slab requirements first.
              </p>
            ) : stoneNarrowed.length === 0 ? (
              <p className="muted" style={{ fontSize: 13 }}>
                No open <strong>{block.stone}</strong> slab requirements. Either add some on the
                Required Sizes page, or untick &ldquo;Match block stone only&rdquo; below to choose
                from any open slab.
              </p>
            ) : (
              <>
                {/* Filter / control row — now wider with more breathing room */}
                <div style={{ display: "flex", gap: 8, marginBottom: 10, flexWrap: "wrap", alignItems: "stretch" }}>
                  <input
                    type="text"
                    placeholder="🔍 Filter by ID, temple, label…"
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                    style={{
                      flex: "2 1 240px",
                      boxSizing: "border-box",
                      fontSize: 14,
                      border: "1px solid var(--border)",
                      borderRadius: 6,
                      padding: "9px 12px",
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
                        flex: "1 1 180px",
                        boxSizing: "border-box",
                        fontSize: 13,
                        border: "1px solid var(--border)",
                        borderRadius: 6,
                        padding: "9px 10px",
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

                {/* Stone-match toggle + bulk-select toolbar */}
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    flexWrap: "wrap",
                    gap: 10,
                    marginBottom: 8,
                    padding: "6px 10px",
                    background: "var(--surface-alt)",
                    border: "1px solid var(--border)",
                    borderRadius: 6,
                    fontSize: 12,
                  }}
                >
                  <label style={{ display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer", color: "var(--text)" }}>
                    <input
                      type="checkbox"
                      checked={matchStoneOnly}
                      onChange={(e) => setMatchStoneOnly(e.target.checked)}
                      style={{ width: 14, height: 14 }}
                    />
                    Match block stone only
                    <span className="muted" style={{ fontWeight: 400, marginLeft: 4 }}>
                      ({block.stone})
                    </span>
                  </label>
                  <div style={{ display: "flex", gap: 8 }}>
                    <span className="muted" style={{ alignSelf: "center" }}>
                      {filteredSlabs.length} visible · {selectedIds.size} selected
                    </span>
                    <button
                      type="button"
                      onClick={selectAllVisible}
                      className="ghost-button"
                      style={{ fontSize: 11, padding: "3px 10px" }}
                      disabled={filteredSlabs.length === 0}
                    >
                      Select all visible
                    </button>
                    <button
                      type="button"
                      onClick={clearAllSelections}
                      className="ghost-button"
                      style={{ fontSize: 11, padding: "3px 10px" }}
                      disabled={selectedIds.size === 0}
                    >
                      Clear
                    </button>
                  </div>
                </div>

                {/* Slab list — much taller now (480px) so users can see ~12+
                    rows without scrolling. Especially important for marble
                    where this is the primary cut path. */}
                <div
                  style={{
                    maxHeight: 480,
                    overflowY: "auto",
                    display: "flex",
                    flexDirection: "column",
                    gap: 0,
                    border: "1px solid var(--border)",
                    borderRadius: 8,
                    background: "var(--surface)",
                  }}
                >
                  {filteredSlabs.length === 0 ? (
                    <p className="muted" style={{ fontSize: 13, padding: 14, margin: 0 }}>
                      No matching slabs.
                    </p>
                  ) : (
                    filteredSlabs.map((slab, i) => {
                      const checked = selectedIds.has(slab.id);
                      return (
                        <label
                          key={slab.id}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 12,
                            cursor: "pointer",
                            fontSize: 13,
                            padding: "10px 12px",
                            borderBottom: i < filteredSlabs.length - 1 ? "1px solid var(--border-light)" : "none",
                            background: checked ? "rgba(232,197,114,0.10)" : "transparent",
                            transition: "background 0.1s",
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleSlab(slab.id)}
                            style={{ width: 17, height: 17, cursor: "pointer", flexShrink: 0 }}
                          />
                          <div style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                            <code style={{ fontSize: 13, fontWeight: 700, color: "var(--text)" }}>
                              {slab.id}
                            </code>
                            {slab.priority && <span style={{ fontSize: 12 }}>⚡</span>}
                            {slab.temple && (
                              <span className="muted" style={{ fontSize: 12 }}>
                                {slab.temple}
                                {slab.label && slab.label !== slab.temple ? ` · ${slab.label}` : ""}
                              </span>
                            )}
                            <span
                              style={{
                                fontSize: 12,
                                fontFamily: "ui-monospace, monospace",
                                color: "var(--muted)",
                                marginLeft: "auto",
                              }}
                            >
                              {slab.length_ft}×{slab.width_ft}×{slab.thickness_ft} in
                            </span>
                            {slab.quality && (
                              <span
                                className={`role-pill ${slab.quality === "A" ? "badge-available" : "badge-reserved"}`}
                                style={{ fontSize: 10 }}
                              >
                                {slab.quality}
                              </span>
                            )}
                          </div>
                        </label>
                      );
                    })
                  )}
                </div>
              </>
            )}
          </div>

          {/* Remainder pieces — hidden for marble blocks (brittle, no restock) */}
          {!isMarble && <div style={{ marginBottom: 16 }}>
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
          </div>}

          {/* Action buttons */}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {hasValidRemainders && !isMarble ? (
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
