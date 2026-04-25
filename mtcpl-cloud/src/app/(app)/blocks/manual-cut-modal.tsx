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

  // Always filter by stone — you can't physically cut a PinkStone slab
  // from a YellowMarble block. No toggle: this is hard-coded correctness.
  const stoneNarrowed = openSlabs.filter((s) => s.stone === block.stone);

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

  // Group filtered slabs by temple for visual sectioning + per-temple
  // "Select all" buttons. Each group has its temple name as the key.
  const slabsByTemple = filteredSlabs.reduce<Record<string, typeof filteredSlabs>>((acc, s) => {
    const t = s.temple ?? "(no temple)";
    if (!acc[t]) acc[t] = [];
    acc[t].push(s);
    return acc;
  }, {});
  const templeGroupKeys = Object.keys(slabsByTemple).sort();

  // Per-temple bulk select. Cross-temple "select all visible" was
  // intentionally removed — too easy to fat-finger and select hundreds
  // of slabs from one click. Per-temple stays because picking "all 12
  // slabs of one temple's batch" is the actual workflow.
  function selectAllInTemple(temple: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      const list = slabsByTemple[temple] ?? [];
      // Toggle: if every slab in this temple is already selected, deselect them.
      const allSelected = list.length > 0 && list.every((s) => next.has(s.id));
      if (allSelected) {
        for (const s of list) next.delete(s.id);
      } else {
        for (const s of list) next.add(s.id);
      }
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
      {/* Center-peek modal (Notion style). Backdrop dims the underlying
       *  page; the modal sits in the middle of the viewport with rounded
       *  corners and a soft shadow. The block edit drawer behind stays
       *  open, so closing this modal returns the user to the edit drawer
       *  view ("minimize back to edit block preview"). */}
      <div
        onClick={onClose}
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0,0,0,0.65)",
          backdropFilter: "blur(3px)",
          // z-index 1000 puts us safely above the block edit drawer
          // (.edit-drawer is 201). Without this, the drawer renders ON
          // TOP of the manual-cut modal because both use position:fixed
          // and the drawer's CSS z-index outranks ours.
          zIndex: 1000,
          animation: "manual-cut-fade 0.18s ease-out",
        }}
        aria-hidden="true"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Manual Cut Entry"
        onClick={(e) => e.stopPropagation()}
        style={{
          position: "fixed",
          top: "50%",
          left: "50%",
          width: "min(92vw, 880px)",
          maxHeight: "88vh",
          background: "var(--surface)",
          color: "var(--text)",
          border: "1px solid var(--border)",
          borderRadius: 14,
          boxShadow: "0 25px 70px rgba(0,0,0,0.55)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          zIndex: 1001, // above the backdrop (1000) and the edit drawer (201)
          transform: "translate(-50%, -50%)",
          animation: "manual-cut-peek 0.22s cubic-bezier(0.16, 1, 0.3, 1)",
        }}
      >
        {/* Inline keyframes — keeps the component self-contained */}
        <style>{`
          @keyframes manual-cut-fade {
            from { opacity: 0; }
            to { opacity: 1; }
          }
          @keyframes manual-cut-peek {
            from { opacity: 0; transform: translate(-50%, -50%) scale(0.96); }
            to   { opacity: 1; transform: translate(-50%, -50%) scale(1); }
          }
        `}</style>

        {/* Header */}
        <div
          style={{
            padding: "16px 20px",
            borderBottom: "1px solid var(--border)",
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: 12,
            flexShrink: 0,
            background: "var(--surface-alt)",
          }}
        >
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 17, fontWeight: 700, color: "var(--text)" }}>
              ✂ Manual Cut Entry
            </div>
            <code style={{ fontSize: 13, color: "var(--muted)", fontFamily: "ui-monospace, monospace", fontWeight: 600 }}>
              {block.id}
            </code>
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
                Marble: no remainder pieces — slabs only, the rest is implicit yield loss.
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            style={{
              flexShrink: 0,
              background: "transparent",
              border: "none",
              fontSize: 22,
              color: "var(--muted)",
              cursor: "pointer",
              padding: 0,
              lineHeight: 1,
              width: 32,
              height: 32,
              borderRadius: 6,
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "var(--border-light)")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {/* Scrollable body */}
        <div style={{ overflowY: "auto", padding: 20, flex: 1, minHeight: 0 }}>
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
                No open <strong>{block.stone}</strong> slab requirements. Add some on the
                Required Sizes page, then come back.
              </p>
            ) : (
              <>
                {/* Selected chips — gives the user a clear running view
                 *  of which slabs they've picked, with one-click remove
                 *  per chip. Especially helpful when the user is
                 *  scrolled deep into a long list and wants to confirm
                 *  what's already chosen. */}
                {selectedIds.size > 0 && (() => {
                  const selectedById = new Map(filteredSlabs.map((s) => [s.id, s] as const));
                  // Pick from filteredSlabs order so chips display in
                  // the same order as the list. If a selected slab is
                  // filtered out (e.g. user typed a search after picking),
                  // we still want to show its chip — fall back to the
                  // raw stoneNarrowed list.
                  const fallbackById = new Map(stoneNarrowed.map((s) => [s.id, s] as const));
                  const ordered = [...selectedIds]
                    .map((id) => selectedById.get(id) ?? fallbackById.get(id))
                    .filter((s): s is NonNullable<typeof s> => Boolean(s));
                  return (
                    <div
                      style={{
                        marginBottom: 10,
                        padding: "8px 10px 10px",
                        background: "rgba(232,197,114,0.10)",
                        border: "1px solid rgba(232,197,114,0.35)",
                        borderRadius: 8,
                        maxHeight: 110,
                        overflowY: "auto",
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          fontSize: 11,
                          fontWeight: 700,
                          color: "var(--gold-dark)",
                          textTransform: "uppercase",
                          letterSpacing: "0.05em",
                          marginBottom: 6,
                        }}
                      >
                        <span>✓ {selectedIds.size} selected</span>
                        <button
                          type="button"
                          onClick={clearAllSelections}
                          style={{
                            background: "transparent",
                            border: "none",
                            color: "var(--muted)",
                            fontSize: 11,
                            fontWeight: 600,
                            textTransform: "none",
                            letterSpacing: 0,
                            cursor: "pointer",
                            padding: 0,
                          }}
                        >
                          Clear all
                        </button>
                      </div>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                        {ordered.map((s) => (
                          <span
                            key={s.id}
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 4,
                              padding: "3px 3px 3px 9px",
                              background: "var(--surface)",
                              border: "1px solid var(--gold-border)",
                              borderRadius: 4,
                              fontSize: 11,
                              fontFamily: "ui-monospace, monospace",
                              fontWeight: 600,
                              color: "var(--text)",
                            }}
                          >
                            {s.id}
                            <button
                              type="button"
                              onClick={() => toggleSlab(s.id)}
                              style={{
                                background: "transparent",
                                border: "none",
                                cursor: "pointer",
                                padding: "1px 5px",
                                fontSize: 12,
                                color: "var(--muted)",
                                lineHeight: 1,
                                borderRadius: 3,
                              }}
                              title={`Remove ${s.id}`}
                              aria-label={`Remove ${s.id} from selection`}
                              onMouseEnter={(e) => {
                                e.currentTarget.style.background = "rgba(220,38,38,0.12)";
                                e.currentTarget.style.color = "var(--danger)";
                              }}
                              onMouseLeave={(e) => {
                                e.currentTarget.style.background = "transparent";
                                e.currentTarget.style.color = "var(--muted)";
                              }}
                            >
                              ✕
                            </button>
                          </span>
                        ))}
                      </div>
                    </div>
                  );
                })()}

                {/* Filter / control row */}
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

                {/* Bulk-select toolbar */}
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
                  <span className="muted">
                    Showing <strong style={{ color: "var(--text)" }}>{filteredSlabs.length}</strong>{" "}
                    {block.stone} slab{filteredSlabs.length !== 1 ? "s" : ""}{" "}
                    {templeFilter !== "all" ? `from ${templeFilter}` : `across ${templeGroupKeys.length} temple${templeGroupKeys.length !== 1 ? "s" : ""}`}
                    {" · "}
                    <strong style={{ color: "var(--text)" }}>{selectedIds.size}</strong> selected
                  </span>
                  <div style={{ display: "flex", gap: 6 }}>
                    {/* "Select all visible" intentionally removed — too
                     *  easy to accidentally pick hundreds of slabs in one
                     *  click. Per-temple "Select all N" inside each
                     *  temple group remains; that's the safer workflow. */}
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

                {/* Slab list — temple-grouped. Each temple gets a sticky-feel
                    header with a per-temple "Select all" toggle for picking
                    a whole temple's batch in one click. */}
                <div
                  style={{
                    maxHeight: "min(56vh, 560px)",
                    overflowY: "auto",
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
                    templeGroupKeys.map((temple) => {
                      const list = slabsByTemple[temple];
                      const allSelected = list.every((s) => selectedIds.has(s.id));
                      const someSelected = !allSelected && list.some((s) => selectedIds.has(s.id));
                      return (
                        <div key={temple} style={{ borderBottom: "1px solid var(--border)" }}>
                          {/* Temple group header with per-temple select-all */}
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 10,
                              padding: "8px 12px",
                              background: "rgba(232,197,114,0.08)",
                              borderBottom: "1px solid var(--border-light)",
                              position: "sticky",
                              top: 0,
                              zIndex: 1,
                            }}
                          >
                            <span style={{ fontSize: 13 }}>🏛</span>
                            <strong style={{ fontSize: 13, color: "var(--text)", flex: 1, minWidth: 0 }}>
                              {temple}
                            </strong>
                            <span className="muted" style={{ fontSize: 11 }}>
                              {list.length} slab{list.length !== 1 ? "s" : ""}
                            </span>
                            <button
                              type="button"
                              onClick={() => selectAllInTemple(temple)}
                              className="ghost-button"
                              style={{
                                fontSize: 11,
                                padding: "3px 10px",
                                color: allSelected ? "var(--danger)" : "var(--gold-dark)",
                                borderColor: allSelected ? "rgba(220,38,38,0.3)" : "var(--gold-border)",
                              }}
                            >
                              {allSelected ? "Unselect all" : someSelected ? `Select rest (${list.length - list.filter(s => selectedIds.has(s.id)).length})` : `Select all ${list.length}`}
                            </button>
                          </div>

                          {/* Slab rows for this temple */}
                          {list.map((slab, i) => {
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
                                  padding: "10px 14px 10px 30px",
                                  borderBottom: i < list.length - 1 ? "1px solid var(--border-light)" : "none",
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
                                  {slab.label && slab.label !== slab.temple && (
                                    <span className="muted" style={{ fontSize: 12 }}>
                                      {slab.label}
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
                          })}
                        </div>
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

        </div>
        {/* Sticky footer — actions always visible regardless of scroll
         *  position. selectedIds count shown alongside so the user can
         *  see "8 selected" before pressing Record Cut. */}
        <div
          style={{
            padding: "12px 20px",
            borderTop: "1px solid var(--border)",
            background: "var(--surface-alt)",
            display: "flex",
            gap: 8,
            flexWrap: "wrap",
            alignItems: "center",
            flexShrink: 0,
          }}
        >
          <span className="muted" style={{ fontSize: 12, marginRight: "auto" }}>
            {selectedIds.size === 0 ? (
              "No slabs selected"
            ) : (
              <>
                <strong style={{ color: "var(--text)" }}>{selectedIds.size}</strong> slab
                {selectedIds.size !== 1 ? "s" : ""} selected
              </>
            )}
          </span>
          <button
            className="ghost-button"
            disabled={submitting}
            onClick={onClose}
          >
            Cancel
          </button>
          {hasValidRemainders && !isMarble ? (
            <>
              <button
                className="secondary-button"
                disabled={submitting || selectedIds.size === 0}
                onClick={() => handleSubmit(false)}
              >
                Cut &amp; Discard
              </button>
              <button
                className="primary-button"
                disabled={submitting || selectedIds.size === 0}
                onClick={() => handleSubmit(true)}
              >
                {submitting ? "Saving…" : `Cut & Restock (${validRemainders.length} piece${validRemainders.length > 1 ? "s" : ""})`}
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
        </div>
      </div>
    </>
  );
}
