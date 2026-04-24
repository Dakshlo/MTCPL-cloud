"use client";

/**
 * Edit-slabs modal for a provisional dispatch.
 *
 * Senior clicks "Edit Slabs" on a provisional row → this drawer opens
 * showing two lists side-by-side:
 *   - Current slabs in this dispatch (each has a ✕ Remove button)
 *   - Available ready slabs for the same temple (each has a + Add button)
 *
 * Tracking is pure React state — addIds/removeIds. Submitting the form
 * sends the computed diff to `editDispatchSlabsAction` which atomically
 * updates dispatch_logs + slab_requirements.status + carving_items.status.
 * Closing without submitting discards the pending changes.
 */

import { useMemo, useState } from "react";
import { editDispatchSlabsAction } from "./actions";
import type { ReadySlab } from "./dispatch-client";

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

  function toggleRemove(id: string) {
    setRemoveIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAdd(id: string) {
    setAddIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const pendingDiff = addIds.size + removeIds.size;

  // Computed summary — slab count after applying the diff
  const finalSlabCount = useMemo(() => {
    return currentSlabs.length - removeIds.size + addIds.size;
  }, [currentSlabs.length, removeIds.size, addIds.size]);

  return (
    <>
      <div className="drawer-backdrop" onClick={submitting ? undefined : onClose} />
      <div
        className="edit-drawer"
        style={{ maxWidth: 720 }}
        role="dialog"
        aria-modal="true"
        aria-label="Edit Dispatch Slabs"
      >
        <div className="drawer-header">
          <div>
            <div className="drawer-title">📝 Edit Slabs · {challanLabel}</div>
            <p className="muted" style={{ margin: "4px 0 0", fontSize: 12 }}>
              🏛 {temple} · Dispatch is provisional. Changes saved atomically.
            </p>
          </div>
          <button className="drawer-close" onClick={onClose} disabled={submitting}>
            ✕
          </button>
        </div>

        <div className="drawer-body">
          <form
            action={(fd) => {
              setSubmitting(true);
              fd.set("id", dispatchId);
              fd.set("add_slab_ids", JSON.stringify([...addIds]));
              fd.set("remove_slab_ids", JSON.stringify([...removeIds]));
              return editDispatchSlabsAction(fd);
            }}
          >
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
              {/* ── Current slabs (remove side) ──────────────────────────── */}
              <div
                style={{
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                  overflow: "hidden",
                  background: "var(--surface)",
                }}
              >
                <div
                  style={{
                    padding: "8px 12px",
                    background: "rgba(217,119,6,0.08)",
                    borderBottom: "1px solid var(--border)",
                    fontWeight: 700,
                    fontSize: 12,
                    color: "#D97706",
                  }}
                >
                  Currently on this dispatch ({currentSlabs.length - removeIds.size})
                </div>
                <div style={{ maxHeight: 360, overflowY: "auto" }}>
                  {currentSlabs.length === 0 ? (
                    <div className="muted" style={{ padding: 14, fontSize: 12, textAlign: "center" }}>
                      No slabs on this dispatch.
                    </div>
                  ) : (
                    currentSlabs.map((s) => {
                      const marked = removeIds.has(s.id);
                      return (
                        <div
                          key={s.id}
                          style={{
                            padding: "8px 12px",
                            borderBottom: "1px solid var(--border-light)",
                            display: "flex",
                            alignItems: "center",
                            gap: 10,
                            background: marked ? "rgba(220,38,38,0.06)" : "transparent",
                            opacity: marked ? 0.6 : 1,
                          }}
                        >
                          <div style={{ flex: 1, minWidth: 0, fontSize: 12 }}>
                            <div
                              style={{
                                fontFamily: "ui-monospace, monospace",
                                fontWeight: 600,
                                textDecoration: marked ? "line-through" : "none",
                              }}
                            >
                              {s.id}
                            </div>
                            <div className="muted" style={{ fontSize: 11 }}>
                              {s.label ?? "—"} · {s.dimensions} · {s.cft.toFixed(2)} CFT
                              {s.isMarble ? " 🗿" : ""}
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => toggleRemove(s.id)}
                            className="ghost-button"
                            style={{
                              fontSize: 11,
                              padding: "3px 10px",
                              color: marked ? "var(--muted)" : "var(--danger)",
                              borderColor: marked ? "var(--border)" : "rgba(220,38,38,0.3)",
                            }}
                          >
                            {marked ? "Undo" : "✕ Remove"}
                          </button>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

              {/* ── Available to add ─────────────────────────────────────── */}
              <div
                style={{
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                  overflow: "hidden",
                  background: "var(--surface)",
                }}
              >
                <div
                  style={{
                    padding: "8px 12px",
                    background: "rgba(22,163,74,0.08)",
                    borderBottom: "1px solid var(--border)",
                    fontWeight: 700,
                    fontSize: 12,
                    color: "#15803d",
                  }}
                >
                  Available ({availableToAdd.length}) · same temple
                </div>
                <div style={{ maxHeight: 360, overflowY: "auto" }}>
                  {availableToAdd.length === 0 ? (
                    <div className="muted" style={{ padding: 14, fontSize: 12, textAlign: "center" }}>
                      No other completed slabs for this temple.
                    </div>
                  ) : (
                    availableToAdd.map((s) => {
                      const marked = addIds.has(s.id);
                      return (
                        <div
                          key={s.id}
                          style={{
                            padding: "8px 12px",
                            borderBottom: "1px solid var(--border-light)",
                            display: "flex",
                            alignItems: "center",
                            gap: 10,
                            background: marked ? "rgba(22,163,74,0.08)" : "transparent",
                          }}
                        >
                          <div style={{ flex: 1, minWidth: 0, fontSize: 12 }}>
                            <div
                              style={{
                                fontFamily: "ui-monospace, monospace",
                                fontWeight: 600,
                              }}
                            >
                              {s.id}
                              {s.priority && " ⚡"}
                            </div>
                            <div className="muted" style={{ fontSize: 11 }}>
                              {s.label ?? "—"} · {s.dimensions} · {s.cft.toFixed(2)} CFT
                              {s.isMarble ? " 🗿" : ""}
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => toggleAdd(s.id)}
                            className={marked ? "primary-button" : "ghost-button"}
                            style={{ fontSize: 11, padding: "3px 10px" }}
                          >
                            {marked ? "✓ Added" : "+ Add"}
                          </button>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            </div>

            {/* ── Summary + actions ─────────────────────────────────────── */}
            <div
              style={{
                marginTop: 14,
                padding: "10px 12px",
                background: pendingDiff > 0 ? "rgba(217,119,6,0.08)" : "var(--surface-alt)",
                border: `1px solid ${pendingDiff > 0 ? "rgba(217,119,6,0.3)" : "var(--border)"}`,
                borderRadius: 8,
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                flexWrap: "wrap",
                gap: 10,
                fontSize: 12,
              }}
            >
              <div>
                {pendingDiff === 0 ? (
                  <span className="muted">No changes yet — select slabs to add or remove.</span>
                ) : (
                  <>
                    <strong style={{ color: "#D97706" }}>
                      {addIds.size} to add · {removeIds.size} to remove
                    </strong>
                    <span className="muted"> · final: {finalSlabCount} slab{finalSlabCount !== 1 ? "s" : ""}</span>
                    {finalSlabCount === 0 && (
                      <div style={{ color: "var(--danger)", marginTop: 4 }}>
                        ⚠ Saving will leave 0 slabs — the dispatch will be auto-cancelled.
                      </div>
                    )}
                  </>
                )}
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                <button
                  type="button"
                  onClick={onClose}
                  disabled={submitting}
                  className="ghost-button"
                  style={{ fontSize: 12, padding: "6px 14px" }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting || pendingDiff === 0}
                  className="primary-button"
                  style={{ fontSize: 12, padding: "6px 14px", opacity: pendingDiff === 0 ? 0.5 : 1 }}
                >
                  {submitting ? "Saving…" : "Save Changes"}
                </button>
              </div>
            </div>
          </form>
        </div>
      </div>
    </>
  );
}
