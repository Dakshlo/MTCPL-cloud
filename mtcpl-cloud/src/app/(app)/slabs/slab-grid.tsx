"use client";

import { useEffect, useMemo, useState } from "react";
import { updateSlabAction, deleteSlabAction, bulkDeleteSlabsAction, bulkUpdateSlabsAction } from "./actions";
import { LabelSelect } from "./label-select";

const STATUSES = ["open", "planned", "cutting", "cut_done", "completed", "rejected"] as const;

type Slab = {
  id: string;
  label: string;
  description?: string | null;
  temple: string;
  stone: string | null;
  quality: string | null;
  length_ft: number;
  width_ft: number;
  thickness_ft: number;
  status: string;
  priority: boolean;
  batch_id?: string | null;
  created_at: string | null;
  updated_at: string | null;
  created_by: string | null;
};

type Temple = { id: string; name: string; code_prefix: string };
type StoneType = { id: string; name: string };

function stoneBadge(stone: string | null) {
  if (stone === "PinkStone") return "badge-pink";
  if (stone === "WhiteStone") return "badge-white-stone";
  return "badge-open";
}

function stoneLabel(stone: string | null) {
  if (!stone) return "";
  return stone.replace(/Stone$/i, "") || stone;
}

function statusBadge(status: string) {
  const m: Record<string, string> = {
    open: "badge-open",
    planned: "badge-planned",
    completed: "badge-available",
    rejected: "badge-discarded",
    cut_done: "badge-consumed",
  };
  return m[status] || "";
}

function fmtDate(iso: string | null) {
  if (!iso) return null;
  const d = new Date(iso);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  const yest = new Date(now); yest.setDate(yest.getDate() - 1);
  if (isToday) return d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
  if (d.toDateString() === yest.toDateString()) return "Yesterday";
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "2-digit" });
}

export function SlabGrid({
  slabs,
  temples,
  stoneTypes = [],
  canEdit,
  profilesMap = {},
  labels = [],
}: {
  slabs: Slab[];
  temples: Temple[];
  stoneTypes?: StoneType[];
  canEdit: boolean;
  profilesMap?: Record<string, string>;
  labels?: string[];
}) {
  // Single-slab edit drawer (unchanged behaviour)
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = slabs.find((s) => s.id === selectedId) ?? null;

  // Batch multi-select state: activeBatch tells us which batch the user is
  // currently selecting from. While non-null, only cards of that batch show
  // checkboxes; clicking other cards does nothing (to prevent accidental
  // cross-batch actions).
  const [activeBatch, setActiveBatch] = useState<string | null>(null);
  const [selectedBatchIds, setSelectedBatchIds] = useState<Set<string>>(new Set());
  const [bulkEditOpen, setBulkEditOpen] = useState(false);

  // Temple-level collapse. Default = ALL collapsed for a quick overview,
  // then auto-EXPAND any temple whose newest slab was added in the last
  // 10 minutes so the just-added entry is immediately visible.
  const [collapsedTemples, setCollapsedTemples] = useState<Record<string, boolean>>(() => {
    const RECENT_MS = 10 * 60 * 1000;
    const now = Date.now();
    const out: Record<string, boolean> = {};
    for (const s of slabs) {
      if (!(s.temple in out)) out[s.temple] = true;
    }
    for (const s of slabs) {
      if (!s.created_at) continue;
      const age = now - new Date(s.created_at).getTime();
      if (age >= 0 && age < RECENT_MS) {
        out[s.temple] = false;
      }
    }
    return out;
  });
  function toggleTempleCollapse(temple: string) {
    setCollapsedTemples(prev => ({ ...prev, [temple]: !prev[temple] }));
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setSelectedId(null);
        if (bulkEditOpen) setBulkEditOpen(false);
        else if (activeBatch) {
          setActiveBatch(null);
          setSelectedBatchIds(new Set());
        }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [activeBatch, bulkEditOpen]);

  // Count siblings per batch_id so we only expose multi-select when > 1.
  const batchSize = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of slabs) {
      if (!s.batch_id) continue;
      m.set(s.batch_id, (m.get(s.batch_id) ?? 0) + 1);
    }
    return m;
  }, [slabs]);

  // Group by temple (existing behaviour)
  const grouped: Array<{ temple: string; slabs: Slab[]; latestAt: string }> = [];
  const templeMap = new Map<string, Slab[]>();
  for (const s of slabs) {
    const list = templeMap.get(s.temple) ?? [];
    list.push(s);
    templeMap.set(s.temple, list);
  }
  for (const [temple, list] of templeMap) {
    const sorted = [...list].sort((a, b) => {
      if (a.priority !== b.priority) return a.priority ? -1 : 1;
      return (b.created_at ?? "") > (a.created_at ?? "") ? 1 : -1;
    });
    const latestAt = list.reduce((max, s) => (s.created_at ?? "") > max ? (s.created_at ?? "") : max, "");
    grouped.push({ temple, slabs: sorted, latestAt });
  }
  grouped.sort((a, b) => (b.latestAt > a.latestAt ? 1 : -1));

  // Slabs currently highlighted for bulk ops
  const bulkRows = activeBatch ? slabs.filter((s) => selectedBatchIds.has(s.id)) : [];
  // Bulk editing uses the first selected slab as the form's default values
  const bulkSeed = bulkRows[0] ?? null;

  function enterBatchMode(batchId: string) {
    setActiveBatch(batchId);
    // Start with none selected — user ticks the ones they want.
    setSelectedBatchIds(new Set());
    setSelectedId(null);
  }
  function cancelBatchMode() {
    setActiveBatch(null);
    setSelectedBatchIds(new Set());
    setBulkEditOpen(false);
  }
  function toggleInBatch(id: string) {
    setSelectedBatchIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function selectAllInBatch(batchId: string) {
    const all = slabs.filter((s) => s.batch_id === batchId).map((s) => s.id);
    setSelectedBatchIds(new Set(all));
  }

  return (
    <>
      <div style={{ display: "flex", flexDirection: "column", gap: 24, paddingBottom: activeBatch ? 80 : 0 }}>
        {grouped.map(({ temple, slabs: groupSlabs, latestAt }) => {
          const priorityCount = groupSlabs.filter((s) => s.priority).length;
          const latestLabel = latestAt ? fmtDate(latestAt) : null;
          const isCollapsed = collapsedTemples[temple] ?? false;

          return (
            <div key={temple}>
              {/* Temple group header — click to collapse/expand */}
              <button
                type="button"
                onClick={() => toggleTempleCollapse(temple)}
                aria-expanded={!isCollapsed}
                style={{
                  width: "100%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "8px 0",
                  borderBottom: "2px solid var(--border)",
                  marginBottom: isCollapsed ? 0 : 12,
                  background: "transparent",
                  border: 0,
                  borderBottomWidth: 2,
                  borderBottomStyle: "solid",
                  borderBottomColor: "var(--border)",
                  cursor: "pointer",
                  textAlign: "left",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ fontWeight: 700, fontSize: 14, color: "var(--text)" }}>{temple}</span>
                  {priorityCount > 0 && (
                    <span style={{
                      fontSize: 11, fontWeight: 700, color: "#DC2626",
                      background: "rgba(220,38,38,0.10)", padding: "2px 8px", borderRadius: 10,
                    }}>
                      ⚡ {priorityCount} urgent
                    </span>
                  )}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  {latestLabel && (
                    <span style={{ fontSize: 11, color: "var(--muted)" }}>
                      Last added: <strong style={{ color: "var(--text)" }}>{latestLabel}</strong>
                    </span>
                  )}
                  <span style={{ fontSize: 12, color: "var(--muted)", fontWeight: 600 }}>
                    {groupSlabs.length} {groupSlabs.length === 1 ? "size" : "sizes"}
                  </span>
                  <span style={{
                    fontSize: 11, color: "var(--muted)",
                    display: "inline-flex", alignItems: "center", gap: 5,
                  }}>
                    {isCollapsed ? "Show" : "Hide"}
                    <span style={{ fontSize: 10 }}>{isCollapsed ? "▶" : "▼"}</span>
                  </span>
                </div>
              </button>

              {/* Cards for this temple — hidden when collapsed */}
              {!isCollapsed && (
              <div className="slab-card-grid">
                {groupSlabs.map((slab) => {
                  const cft = ((Number(slab.length_ft) * Number(slab.width_ft) * Number(slab.thickness_ft)) / 1728).toFixed(2);
                  const isSelected = selectedId === slab.id;
                  const isNotOpen = slab.status !== "open";
                  const inBatch = slab.batch_id && (batchSize.get(slab.batch_id) ?? 0) > 1;
                  const thisBatchActive = activeBatch && slab.batch_id === activeBatch;
                  const otherBatchActive = activeBatch && slab.batch_id !== activeBatch;
                  const isTicked = selectedBatchIds.has(slab.id);

                  function handleCardClick() {
                    if (activeBatch) {
                      // In batch mode: only cards of that batch respond
                      if (thisBatchActive) toggleInBatch(slab.id);
                      return;
                    }
                    setSelectedId(isSelected ? null : slab.id);
                  }

                  return (
                    <div
                      key={slab.id}
                      data-slab-id={slab.id}
                      className={`slab-card${slab.priority ? " slab-card-priority" : ""}${isSelected && !activeBatch ? " slab-card-active" : ""}`}
                      style={{
                        ...(isNotOpen ? { filter: "grayscale(0.85)", opacity: 0.6 } : {}),
                        ...(thisBatchActive ? { boxShadow: isTicked ? "0 0 0 2px var(--gold)" : "0 0 0 1px var(--gold-dark)" } : {}),
                        ...(otherBatchActive ? { opacity: 0.35, pointerEvents: "none" as const } : {}),
                        cursor: activeBatch && !thisBatchActive ? "not-allowed" : "pointer",
                      }}
                      onClick={handleCardClick}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          handleCardClick();
                        }
                      }}
                    >
                      {slab.priority && <div className="slab-priority-bar" />}
                      <div className="slab-card-top">
                        <code className="slab-card-code">{slab.id}</code>
                        {slab.priority && <span className="slab-priority-dot">⚡</span>}
                        {/* Batch indicator / multi-select checkbox */}
                        {thisBatchActive ? (
                          <input
                            type="checkbox"
                            checked={isTicked}
                            readOnly
                            style={{ marginLeft: "auto", width: 16, height: 16, cursor: "pointer" }}
                          />
                        ) : inBatch && canEdit ? (
                          <button
                            type="button"
                            title="Multi-select this batch to edit or delete together"
                            onClick={(e) => { e.stopPropagation(); enterBatchMode(slab.batch_id!); }}
                            style={{
                              marginLeft: "auto",
                              fontSize: 10, fontWeight: 700,
                              padding: "2px 7px", borderRadius: 10,
                              background: "rgba(184,115,51,0.12)", color: "var(--gold-dark)",
                              border: "1px solid rgba(184,115,51,0.25)",
                              cursor: "pointer", whiteSpace: "nowrap",
                            }}
                          >
                            Batch ×{batchSize.get(slab.batch_id!)}
                          </button>
                        ) : null}
                      </div>
                      <div className="slab-card-label">{slab.label}</div>
                      {slab.description && (
                        <div className="muted" style={{ fontSize: 11, marginTop: 1, fontStyle: "italic" }}>
                          {slab.description}
                        </div>
                      )}
                      <div className="slab-card-dims">
                        {Number(slab.length_ft)}" × {Number(slab.width_ft)}" × {Number(slab.thickness_ft)}"
                      </div>
                      <div className="slab-card-footer">
                        {slab.stone && <span className={`role-pill ${stoneBadge(slab.stone)}`}>{stoneLabel(slab.stone)}</span>}
                        {slab.quality && (
                          <span className={`role-pill ${slab.quality === "A" ? "badge-available" : "badge-reserved"}`}>
                            Grade {slab.quality}
                          </span>
                        )}
                        <span className={`role-pill ${statusBadge(slab.status)}`}>{slab.status}</span>
                        <span className="slab-card-area">{cft} CFT</span>
                      </div>
                      <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>
                        {slab.created_at && <>Added {fmtDate(slab.created_at)}</>}
                        {slab.created_by && (
                          <> · <span style={{ color: "var(--gold-dark)", fontWeight: 600 }}>by {profilesMap[slab.created_by] ?? "Unknown"}</span></>
                        )}
                        {slab.status === "cut_done" && slab.updated_at && (
                          <> · Cut {fmtDate(slab.updated_at)}</>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
              )}
            </div>
          );
        })}
      </div>

      {/* ── Floating batch action bar ───────────────────────────── */}
      {activeBatch && (
        <div style={{
          position: "fixed", left: 0, right: 0, bottom: 0, zIndex: 40,
          background: "var(--surface)", borderTop: "2px solid var(--gold)",
          padding: "10px 20px",
          boxShadow: "0 -4px 12px rgba(0,0,0,0.08)",
          display: "flex", alignItems: "center", justifyContent: "space-between",
          flexWrap: "wrap", gap: 10,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text)" }}>
              Batch select mode
            </span>
            <span style={{ fontSize: 12, color: "var(--muted)" }}>
              {selectedBatchIds.size} of {batchSize.get(activeBatch) ?? 0} selected in this batch
            </span>
            <button
              type="button"
              onClick={() => selectAllInBatch(activeBatch)}
              className="ghost-button"
              style={{ fontSize: 12, padding: "4px 10px" }}
            >
              Select all in batch
            </button>
            <button
              type="button"
              onClick={() => setSelectedBatchIds(new Set())}
              className="ghost-button"
              style={{ fontSize: 12, padding: "4px 10px" }}
              disabled={selectedBatchIds.size === 0}
            >
              Clear
            </button>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button
              type="button"
              onClick={() => setBulkEditOpen(true)}
              className="ghost-button"
              disabled={selectedBatchIds.size === 0}
              style={{ fontSize: 12, padding: "5px 14px" }}
            >
              Edit {selectedBatchIds.size > 0 ? `(${selectedBatchIds.size})` : ""}
            </button>
            <form
              action={bulkDeleteSlabsAction}
              onSubmit={(e) => {
                const n = selectedBatchIds.size;
                if (!confirm(`Delete ${n} slab${n === 1 ? "" : "s"}? This cannot be undone.`)) e.preventDefault();
              }}
              style={{ display: "inline" }}
            >
              <input type="hidden" name="batch_id" value={activeBatch} />
              <input type="hidden" name="ids" value={JSON.stringify([...selectedBatchIds])} />
              <button
                type="submit"
                className="ghost-button danger-ghost"
                disabled={selectedBatchIds.size === 0}
                style={{ fontSize: 12, padding: "5px 14px" }}
              >
                Delete {selectedBatchIds.size > 0 ? `(${selectedBatchIds.size})` : ""}
              </button>
            </form>
            <button
              type="button"
              onClick={cancelBatchMode}
              className="ghost-button"
              style={{ fontSize: 12, padding: "5px 14px" }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* ── Bulk edit drawer ────────────────────────────────────── */}
      {bulkEditOpen && bulkSeed && activeBatch && selectedBatchIds.size > 0 && (
        <>
          <div className="drawer-backdrop" onClick={() => setBulkEditOpen(false)} />
          <div className="edit-drawer">
            <div className="drawer-header">
              <div>
                <div className="drawer-title">Edit {selectedBatchIds.size} Slab{selectedBatchIds.size === 1 ? "" : "s"}</div>
                <code className="drawer-subtitle">{[...selectedBatchIds].slice(0, 3).join(", ")}{selectedBatchIds.size > 3 ? `, +${selectedBatchIds.size - 3}` : ""}</code>
                <p className="muted" style={{ fontSize: 11, marginTop: 6, marginBottom: 0 }}>
                  All selected slabs in this batch will be updated to the values below.
                </p>
              </div>
              <button className="drawer-close" onClick={() => setBulkEditOpen(false)}>✕</button>
            </div>

            <div className="drawer-body">
              <form action={bulkUpdateSlabsAction} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                <input type="hidden" name="batch_id" value={activeBatch} />
                <input type="hidden" name="ids" value={JSON.stringify([...selectedBatchIds])} />

                <label className="stack">
                  <span>Label</span>
                  <LabelSelect labels={labels} name="label" defaultValue={bulkSeed.label} />
                </label>

                <label className="stack">
                  <span>Description</span>
                  <input name="description" defaultValue={bulkSeed.description ?? ""} placeholder="Type description" />
                </label>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <label className="stack">
                    <span>Temple</span>
                    <select name="temple" defaultValue={bulkSeed.temple}>
                      {temples.map((t) => <option key={t.id} value={t.name}>{t.name}</option>)}
                    </select>
                  </label>
                  <label className="stack">
                    <span>Stone</span>
                    <select name="stone" defaultValue={bulkSeed.stone ?? ""}>
                      <option value="">— Not specified —</option>
                      {stoneTypes.length > 0
                        ? stoneTypes.map((st) => <option key={st.id} value={st.name}>{st.name}</option>)
                        : <>
                            <option value="PinkStone">PinkStone</option>
                            <option value="WhiteStone">WhiteStone</option>
                          </>}
                    </select>
                  </label>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
                  <label className="stack">
                    <span>Length (in)</span>
                    <input name="length_in" type="number" min="0" step="0.5" defaultValue={String(bulkSeed.length_ft)} />
                  </label>
                  <label className="stack">
                    <span>Width (in)</span>
                    <input name="width_in" type="number" min="0" step="0.5" defaultValue={String(bulkSeed.width_ft)} />
                  </label>
                  <label className="stack">
                    <span>Thickness (in)</span>
                    <input name="thickness_in" type="number" min="0" step="0.25" defaultValue={String(bulkSeed.thickness_ft)} />
                  </label>
                </div>

                <label className="stack">
                  <span>Quality Grade</span>
                  <select name="quality" defaultValue={bulkSeed.quality ?? ""}>
                    <option value="">Both / Unspecified</option>
                    <option value="A">Grade A</option>
                    <option value="B">Grade B</option>
                  </select>
                </label>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <label className="stack">
                    <span>Status</span>
                    <select name="status" defaultValue={bulkSeed.status}>
                      {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </label>
                  <label className="stack">
                    <span>Priority</span>
                    <select name="priority" defaultValue={String(bulkSeed.priority)}>
                      <option value="false">Normal</option>
                      <option value="true">⚡ Priority</option>
                    </select>
                  </label>
                </div>

                <button className="primary-button" type="submit">
                  Apply to {selectedBatchIds.size} slab{selectedBatchIds.size === 1 ? "" : "s"}
                </button>
              </form>
            </div>
          </div>
        </>
      )}

      {/* ── Single-slab edit drawer (unchanged layout, now with Description field) ── */}
      {selected && canEdit && !activeBatch && (
        <>
          <div className="drawer-backdrop" onClick={() => setSelectedId(null)} />
          <div className="edit-drawer">
            <div className="drawer-header">
              <div>
                <div className="drawer-title">Edit Slab</div>
                <code className="drawer-subtitle">{selected.id}</code>
              </div>
              <button className="drawer-close" onClick={() => setSelectedId(null)}>✕</button>
            </div>

            <div className="drawer-body">
              <form action={updateSlabAction} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                <input name="id" type="hidden" value={selected.id} />

                <label className="stack">
                  <span>Label</span>
                  <LabelSelect labels={labels} name="label" defaultValue={selected.label} />
                </label>

                <label className="stack">
                  <span>Description</span>
                  <input name="description" defaultValue={selected.description ?? ""} placeholder="Type description" />
                </label>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <label className="stack">
                    <span>Temple</span>
                    <select name="temple" defaultValue={selected.temple}>
                      {temples.map((t) => <option key={t.id} value={t.name}>{t.name}</option>)}
                    </select>
                  </label>
                  <label className="stack">
                    <span>Stone</span>
                    <select name="stone" defaultValue={selected.stone ?? ""}>
                      <option value="">— Not specified —</option>
                      {stoneTypes.length > 0
                        ? stoneTypes.map((st) => <option key={st.id} value={st.name}>{st.name}</option>)
                        : <>
                            <option value="PinkStone">PinkStone</option>
                            <option value="WhiteStone">WhiteStone</option>
                          </>}
                    </select>
                  </label>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
                  <label className="stack">
                    <span>Length (in)</span>
                    <input name="length_in" type="number" min="0" step="0.5" defaultValue={String(selected.length_ft)} />
                  </label>
                  <label className="stack">
                    <span>Width (in)</span>
                    <input name="width_in" type="number" min="0" step="0.5" defaultValue={String(selected.width_ft)} />
                  </label>
                  <label className="stack">
                    <span>Thickness (in)</span>
                    <input name="thickness_in" type="number" min="0" step="0.25" defaultValue={String(selected.thickness_ft)} />
                  </label>
                </div>

                <label className="stack">
                  <span>Quality Grade</span>
                  <select name="quality" defaultValue={selected.quality ?? ""}>
                    <option value="">Both / Unspecified</option>
                    <option value="A">Grade A</option>
                    <option value="B">Grade B</option>
                  </select>
                </label>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <label className="stack">
                    <span>Status</span>
                    <select name="status" defaultValue={selected.status}>
                      {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </label>
                  <label className="stack">
                    <span>Priority</span>
                    <select name="priority" defaultValue={String(selected.priority)}>
                      <option value="false">Normal</option>
                      <option value="true">⚡ Priority</option>
                    </select>
                  </label>
                </div>

                <button className="primary-button" type="submit">Save Changes</button>
              </form>

              <div className="drawer-divider" />

              <div className="drawer-danger-zone">
                <p className="drawer-danger-label">Danger Zone</p>
                <form action={deleteSlabAction} onSubmit={(e) => { if (!confirm(`Delete slab ${selected.id}? This cannot be undone.`)) e.preventDefault(); }}>
                  <input name="id" type="hidden" value={selected.id} />
                  <button className="ghost-button danger-ghost" type="submit">Delete Slab</button>
                </form>
              </div>
            </div>
          </div>
        </>
      )}
    </>
  );
}
