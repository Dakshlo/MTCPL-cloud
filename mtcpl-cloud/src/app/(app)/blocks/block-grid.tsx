"use client";

import { useEffect, useState } from "react";
import { BlockCardPreview } from "@/components/stone-previews";
import { updateBlockAction, deleteBlockAction } from "./actions";
import { VendorSelect } from "./vendor-select";
import { stoneDisplayName } from "@/lib/stone-utils";
import type { StoneTypeDef } from "@/lib/stone-utils";
import { ManualCutModal } from "./manual-cut-modal";
import { FACILITIES, YARDS_BY_FACILITY, facilityLabel, facilityOfYard, yardLabel, yardShortLabel, type Facility } from "@/lib/yards";
import { blockStatusLabel, blockStatusBadge, isReusedBlock } from "@/lib/blocks";
import { cftEquivFromTonnes, type StoneCategory } from "@/lib/stone-categories";

type StoneType = StoneTypeDef;
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
const FALLBACK_STONES: StoneType[] = [
  { name: "PinkStone",  color_top: "#EDCFC2", color_front: "#C87A60", color_side: "#DDA88A" },
  { name: "WhiteStone", color_top: "#E8E6DC", color_front: "#B8B6AC", color_side: "#D0CEC4" },
];
const STATUSES = ["available", "reserved", "consumed", "discarded"] as const;

function calcCft(l: number, w: number, h: number) {
  return ((l * w * h) / 1728).toFixed(2);
}

// Labels used in the edit drawer's Status dropdown (raw status values).
// The card pill uses blockStatusLabel() which also factors in category so
// Reused remainders read as "Used" instead of "Fresh".
const STATUS_LABELS: Record<string, string> = {
  available: "Available",
  reserved: "In Progress",
  consumed: "Consumed",
  discarded: "Deleted",
};

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

type Block = {
  id: string;
  stone: string;
  yard: number;
  category: string | null;
  length_ft: number | null;
  width_ft: number | null;
  height_ft: number | null;
  tonnes?: number | string | null;
  truck_entry_id?: string | null;
  status: string;
  quality: string | null;
  truck_no: string | null;
  vendor_name: string | null;
  bill_no: string | null;
  created_at: string | null;
  created_by: string | null;
};

export function BlockGrid({
  blocks,
  canEdit,
  vendors,
  profilesMap = {},
  stoneTypes,
  openSlabs = [],
  stoneCategoryMap = {},
}: {
  blocks: Block[];
  canEdit: boolean;
  vendors: string[];
  profilesMap?: Record<string, string>;
  stoneTypes?: StoneType[];
  openSlabs?: OpenSlab[];
  stoneCategoryMap?: Record<string, StoneCategory>;
}) {
  const stones = stoneTypes && stoneTypes.length > 0 ? stoneTypes : FALLBACK_STONES;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [manualCutOpen, setManualCutOpen] = useState(false);
  const selected = blocks.find(b => b.id === selectedId) ?? null;

  // Drawer facility/yard — synced whenever a different block is opened so the
  // picker starts on that block's actual facility and yard.
  const [drawerFacility, setDrawerFacility] = useState<Facility>("mtcpl");
  const [drawerYard, setDrawerYard] = useState<number>(1);
  useEffect(() => {
    if (selected) {
      setDrawerFacility(facilityOfYard(selected.yard));
      setDrawerYard(Number(selected.yard));
    }
  }, [selected?.id, selected?.yard]);
  function pickDrawerFacility(f: Facility) {
    if (f === drawerFacility) return;
    setDrawerFacility(f);
    setDrawerYard(YARDS_BY_FACILITY[f][0]);
  }

  // Section-level collapse per facility.
  // Default = both COLLAPSED for a clean overview, then auto-EXPAND any
  // facility whose latest block was added in the last 10 minutes so the
  // just-added block is visible without the user having to click "Show".
  const [collapsed, setCollapsed] = useState<Record<Facility, boolean>>(() => {
    const RECENT_MS = 10 * 60 * 1000;
    const now = Date.now();
    const out: Record<Facility, boolean> = { mtcpl: true, riico: true };
    for (const b of blocks) {
      if (!b.created_at) continue;
      const age = now - new Date(b.created_at).getTime();
      if (age >= 0 && age < RECENT_MS) {
        out[facilityOfYard(b.yard)] = false;
      }
    }
    return out;
  });
  function toggleCollapsed(f: Facility) {
    setCollapsed(prev => ({ ...prev, [f]: !prev[f] }));
  }

  // Group blocks by facility, remember latest-added in each group so we can
  // float the just-updated section to the top.
  const byFacility: Record<Facility, Block[]> = { mtcpl: [], riico: [] };
  const latestAt: Record<Facility, string> = { mtcpl: "", riico: "" };
  for (const b of blocks) {
    const f = facilityOfYard(b.yard);
    byFacility[f].push(b);
    if ((b.created_at ?? "") > latestAt[f]) latestAt[f] = b.created_at ?? "";
  }
  const orderedFacilities: Facility[] = [...FACILITIES].sort(
    (a, b) => (latestAt[b] > latestAt[a] ? 1 : -1),
  );

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        if (manualCutOpen) setManualCutOpen(false);
        else setSelectedId(null);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [manualCutOpen]);

  // Shared card renderer — used by both the sandstone flat grid and
  // the marble per-truck sub-grids, so the visual language stays
  // identical across both branches. Closes over `stones`, `selectedId`,
  // `setSelectedId`, `profilesMap`, `canEdit`, `stoneCategoryMap` from
  // the component scope.
  function renderBlockCard(block: Block) {
    const isMarbleBlock = stoneCategoryMap[block.stone] === "marble";
    // Marble blocks don't have meaningful L/W/H. Use a small
    // placeholder so the 3D preview still renders, but the displayed
    // volume reads as tonnes (not CFT).
    const L = Number(block.length_ft) || (isMarbleBlock ? 24 : 0);
    const W = Number(block.width_ft) || (isMarbleBlock ? 24 : 0);
    const H = Number(block.height_ft) || (isMarbleBlock ? 24 : 0);
    const cft = calcCft(L, W, H);
    const tonnesNum = block.tonnes != null ? Number(block.tonnes) : null;
    const stoneColor = stones.find((s) => s.name === block.stone)?.color_top ?? "#D8D4CC";
    const isSelected = selectedId === block.id;
    const isUnavailable = block.status !== "available";

    return (
      <div
        key={block.id}
        data-block-id={block.id}
        className={`block-card${isSelected ? " block-card-active" : ""}`}
        style={isUnavailable ? { filter: "grayscale(0.9)", opacity: 0.65 } : undefined}
        onClick={() => setSelectedId(isSelected ? null : block.id)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") setSelectedId(isSelected ? null : block.id);
        }}
      >
        <div className="block-card-preview">
          <BlockCardPreview stone={block.stone} l={L} w={W} h={H} stoneTypes={stones} />
        </div>
        <div className="block-card-info">
          <div className="block-card-code">{block.id}</div>
          <div className="block-card-badges">
            <span
              className="role-pill"
              style={{ background: stoneColor + "55", color: "#1a1a1a", border: `1px solid ${stoneColor}` }}
            >
              {stoneDisplayName(block.stone)}
            </span>
            <span className="role-pill">{yardShortLabel(block.yard)}</span>
            {isMarbleBlock && (
              <span
                className="role-pill"
                style={{
                  background: "rgba(180,83,9,0.12)",
                  color: "#b45309",
                  border: "1px solid rgba(180,83,9,0.35)",
                }}
                title="Marble — measured in tonnes, cut manually"
              >
                🗿 Marble
              </span>
            )}
            <span className={`role-pill ${blockStatusBadge(block.status, block.category)}`}>
              {isReusedBlock(block.category) && block.status === "available" ? "↻ " : ""}
              {blockStatusLabel(block.status, block.category)}
            </span>
            {block.quality && (
              <span className={`role-pill ${block.quality === "A" ? "badge-available" : "badge-reserved"}`}>
                {block.quality === "A" ? "Grade A" : "Grade B"}
              </span>
            )}
          </div>
          {isMarbleBlock && tonnesNum ? (
            <>
              <div className="block-card-dims" style={{ fontFamily: "ui-monospace, monospace" }}>
                {tonnesNum.toFixed(3)} T
              </div>
              <div className="block-card-cft" style={{ color: "var(--muted)" }}>
                ≈ {cftEquivFromTonnes(tonnesNum).toFixed(2)} CFT equiv
              </div>
            </>
          ) : (
            <>
              <div className="block-card-dims">
                {L} × {W} × {H} in
              </div>
              <div className="block-card-cft">{cft} CFT</div>
            </>
          )}
          {block.truck_entry_id && block.truck_no && (
            <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 3 }}>
              🚚 Truck {block.truck_no}
            </div>
          )}
          {block.created_at && (
            <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>
              Added {fmtDate(block.created_at)}
              {block.created_by && (
                <>
                  {" "}·{" "}
                  <span style={{ color: "var(--gold-dark)", fontWeight: 600 }}>
                    by {profilesMap[block.created_by] ?? "Unknown"}
                  </span>
                </>
              )}
            </div>
          )}
        </div>
        {canEdit && <div className="block-card-edit-hint">{isSelected ? "✕ Close" : "Edit"}</div>}
      </div>
    );
  }

  return (
    <>
      <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
        {orderedFacilities.map(f => {
          const list = byFacility[f];
          if (list.length === 0) return null;
          const isCollapsed = collapsed[f];
          return (
            <section key={f}>
              {/* Facility header — click to collapse/expand */}
              <button
                type="button"
                onClick={() => toggleCollapsed(f)}
                style={{
                  width: "100%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "10px 0",
                  borderBottom: "2px solid var(--border)",
                  marginBottom: 12,
                  background: "transparent",
                  border: 0,
                  borderBottomWidth: 2,
                  borderBottomStyle: "solid",
                  borderBottomColor: "var(--border)",
                  cursor: "pointer",
                  textAlign: "left",
                }}
                aria-expanded={!isCollapsed}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{
                    fontSize: 11, fontWeight: 700, letterSpacing: "0.05em",
                    padding: "2px 9px", borderRadius: 4,
                    background: f === "riico" ? "rgba(124,58,237,0.12)" : "rgba(184,115,51,0.12)",
                    color: f === "riico" ? "#7c3aed" : "var(--gold-dark)",
                    border: `1px solid ${f === "riico" ? "rgba(124,58,237,0.3)" : "rgba(184,115,51,0.3)"}`,
                  }}>
                    {facilityLabel(f)}
                  </span>
                  <span style={{ fontSize: 14, fontWeight: 700, color: "var(--text)" }}>
                    {list.length} block{list.length === 1 ? "" : "s"}
                  </span>
                </div>
                <span style={{
                  fontSize: 11, color: "var(--muted)",
                  display: "flex", alignItems: "center", gap: 6,
                }}>
                  {isCollapsed ? "Show" : "Hide"}
                  <span style={{ fontSize: 10 }}>{isCollapsed ? "▶" : "▼"}</span>
                </span>
              </button>

              {!isCollapsed && (() => {
                // Split this facility's blocks into sandstone (flat grid) and
                // marble-by-truck (each truck a labelled sub-section). Marble
                // blocks without a truck_entry_id (legacy / rare) fall under a
                // generic "No truck entry" bucket so nothing silently vanishes.
                const marbleGroups = new Map<string, Block[]>();
                const sandstone: Block[] = [];
                for (const b of list) {
                  const isMarble = stoneCategoryMap[b.stone] === "marble";
                  if (isMarble) {
                    const key = b.truck_entry_id ?? "__no_truck__";
                    const g = marbleGroups.get(key) ?? [];
                    g.push(b);
                    marbleGroups.set(key, g);
                  } else {
                    sandstone.push(b);
                  }
                }
                // Sort truck groups by their most-recent block's created_at
                // (newest-first) so the last-added truck surfaces at the top.
                const orderedGroups = [...marbleGroups.entries()].sort(([, a], [, b]) => {
                  const ma = a.reduce((m, x) => ((x.created_at ?? "") > m ? (x.created_at ?? "") : m), "");
                  const mb = b.reduce((m, x) => ((x.created_at ?? "") > m ? (x.created_at ?? "") : m), "");
                  return mb > ma ? 1 : mb < ma ? -1 : 0;
                });
                return (
                  <>
                    {sandstone.length > 0 && (
                      <div className="block-card-grid">
                        {sandstone.map((block) => renderBlockCard(block))}
                      </div>
                    )}
                    {orderedGroups.map(([groupKey, group]) => {
                      const sample = group[0];
                      const totalTonnes = group.reduce((sum, b) => sum + (Number(b.tonnes) || 0), 0);
                      const totalCftEquiv = cftEquivFromTonnes(totalTonnes);
                      const newest = group.reduce((m, x) => ((x.created_at ?? "") > m ? (x.created_at ?? "") : m), "");
                      const hasTruck = groupKey !== "__no_truck__";
                      return (
                        <div key={`${f}-${groupKey}`} style={{ marginBottom: 18 }}>
                          {/* Truck header strip — pulled from the denormalised
                              truck_no / vendor_name / bill_no on every block row
                              (marble-actions.ts sets these at insert time). */}
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 10,
                              flexWrap: "wrap",
                              padding: "6px 12px",
                              margin: "0 0 10px",
                              background: "rgba(184,115,51,0.06)",
                              border: "1px solid rgba(184,115,51,0.2)",
                              borderLeft: "3px solid var(--gold-dark)",
                              borderRadius: 6,
                              fontSize: 12,
                            }}
                          >
                            <span style={{ fontSize: 13 }}>🚛</span>
                            {hasTruck ? (
                              <>
                                <span style={{ fontWeight: 700, color: "var(--gold-dark)", fontFamily: "ui-monospace, monospace" }}>
                                  {sample.truck_no || "(no truck no.)"}
                                </span>
                                {sample.vendor_name && (
                                  <span style={{ color: "var(--text)", fontWeight: 600 }}>· {sample.vendor_name}</span>
                                )}
                                {sample.bill_no && (
                                  <span style={{ color: "var(--muted)" }}>· bill {sample.bill_no}</span>
                                )}
                                {newest && (
                                  <span style={{ color: "var(--muted)" }}>· {fmtDate(newest)}</span>
                                )}
                              </>
                            ) : (
                              <span style={{ fontStyle: "italic", color: "var(--muted)" }}>
                                No truck entry (legacy rows)
                              </span>
                            )}
                            <span style={{ marginLeft: "auto", color: "var(--muted)" }}>
                              <strong style={{ color: "var(--text)" }}>
                                {group.length} block{group.length === 1 ? "" : "s"}
                              </strong>
                              {totalTonnes > 0 && (
                                <>
                                  {" · "}
                                  <strong style={{ color: "var(--text)", fontFamily: "ui-monospace, monospace" }}>
                                    {totalTonnes.toFixed(3)} T
                                  </strong>
                                  <span style={{ color: "var(--muted)" }}>
                                    {" "}(≈ {totalCftEquiv.toFixed(2)} CFT equiv)
                                  </span>
                                </>
                              )}
                            </span>
                          </div>
                          <div className="block-card-grid">
                            {group.map((block) => renderBlockCard(block))}
                          </div>
                        </div>
                      );
                    })}
                  </>
                );
              })()}
            </section>
          );
        })}
      </div>

      {selected && canEdit && (
        <>
          <div className="drawer-backdrop" onClick={() => setSelectedId(null)} />
          <div className="edit-drawer">
            <div className="drawer-header">
              <div>
                <div className="drawer-title">Edit Block</div>
                <code className="drawer-subtitle">{selected.id}</code>
              </div>
              <button className="drawer-close" onClick={() => setSelectedId(null)}>✕</button>
            </div>

            <div className="drawer-body">
              <div className="drawer-preview">
                <BlockCardPreview
                  stone={selected.stone}
                  l={Number(selected.length_ft)}
                  w={Number(selected.width_ft)}
                  h={Number(selected.height_ft)}
                  stoneTypes={stones}
                />
              </div>

              <form action={updateBlockAction} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                <input name="original_id" type="hidden" value={selected.id} />

                <label className="stack">
                  <span>Block Code</span>
                  <input name="id" defaultValue={selected.id} required style={{ fontFamily: "ui-monospace, monospace", fontWeight: 600 }} />
                </label>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <label className="stack">
                    <span>Stone</span>
                    <select name="stone" defaultValue={selected.stone}>
                      {stones.map(s => <option key={s.name} value={s.name}>{s.name}</option>)}
                    </select>
                  </label>
                  <div className="stack">
                    <span>Facility</span>
                    <div className="stone-toggle">
                      {FACILITIES.map(f => (
                        <button
                          key={f}
                          type="button"
                          className={`stone-toggle-btn${drawerFacility === f ? " active-pink" : ""}`}
                          onClick={() => pickDrawerFacility(f)}
                        >
                          {facilityLabel(f)}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                <label className="stack">
                  <span>Yard</span>
                  <select name="yard" value={drawerYard} onChange={e => setDrawerYard(Number(e.target.value))}>
                    {YARDS_BY_FACILITY[drawerFacility].map(y => <option key={y} value={y}>{yardLabel(y)}</option>)}
                  </select>
                </label>

                <label className="stack">
                  <span>Status</span>
                  <select name="status" defaultValue={selected.status}>
                    {STATUSES.map(s => <option key={s} value={s}>{STATUS_LABELS[s] ?? s}</option>)}
                  </select>
                </label>

                <label className="stack">
                  <span>Quality Grade</span>
                  <select name="quality" defaultValue={selected.quality ?? ""}>
                    <option value="">Both / Unspecified</option>
                    <option value="A">Grade A</option>
                    <option value="B">Grade B</option>
                  </select>
                </label>

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
                    <span>Height (in)</span>
                    <input name="height_in" type="number" min="0" step="0.5" defaultValue={String(selected.height_ft)} />
                  </label>
                </div>

                <details style={{ marginTop: 4 }}>
                  <summary style={{ cursor: "pointer", fontSize: 12, color: "var(--muted)", padding: "4px 0", userSelect: "none" }}>
                    Logistics Info (Truck No., Vendor, Bill No.)
                  </summary>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginTop: 10 }}>
                    <label className="stack">
                      <span>Truck No.</span>
                      <input name="truck_no" defaultValue={selected.truck_no ?? ""} />
                    </label>
                    <label className="stack">
                      <span>Vendor</span>
                      <VendorSelect vendors={vendors} defaultValue={selected.vendor_name} name="vendor_name" />
                    </label>
                    <label className="stack">
                      <span>Bill No.</span>
                      <input name="bill_no" defaultValue={selected.bill_no ?? ""} />
                    </label>
                  </div>
                </details>

                <button className="primary-button" type="submit" style={{ marginTop: 4 }}>Save Changes</button>
              </form>

              {canEdit && (
                <button
                  type="button"
                  className="secondary-button"
                  style={{ marginTop: 8, width: "100%" }}
                  disabled={selected.status !== "available"}
                  onClick={() => setManualCutOpen(true)}
                  title={selected.status !== "available" ? "Only available blocks can be manually cut" : "Record what was actually cut from this block"}
                >
                  ✂ Manual Cut (skip planning)
                </button>
              )}

              <div className="drawer-divider" />

              <div className="drawer-danger-zone">
                <p className="drawer-danger-label">Danger Zone</p>
                <form action={deleteBlockAction} onSubmit={(e) => { if (!confirm(`Delete block ${selected.id}? This cannot be undone.`)) e.preventDefault(); }}>
                  <input name="delete_target_id" type="hidden" value={selected.id} />
                  <button className="ghost-button danger-ghost" type="submit">Delete Block</button>
                </form>
              </div>
            </div>
          </div>
        </>
      )}

      {selected && manualCutOpen && (
        <ManualCutModal
          block={{
            id: selected.id,
            stone: selected.stone,
            yard: selected.yard,
            length_ft: Number(selected.length_ft) || 0,
            width_ft: Number(selected.width_ft) || 0,
            height_ft: Number(selected.height_ft) || 0,
            tonnes: selected.tonnes != null ? Number(selected.tonnes) : null,
          }}
          isMarble={stoneCategoryMap[selected.stone] === "marble"}
          openSlabs={openSlabs.filter(s => s.stone === selected.stone)}
          onClose={() => setManualCutOpen(false)}
        />
      )}
    </>
  );
}
