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
  length_ft: number;
  width_ft: number;
  height_ft: number;
  status: string;
  quality: string | null;
  truck_no: string | null;
  vendor_name: string | null;
  bill_no: string | null;
  created_at: string | null;
  created_by: string | null;
};

export function BlockGrid({ blocks, canEdit, vendors, profilesMap = {}, stoneTypes, openSlabs = [] }: { blocks: Block[]; canEdit: boolean; vendors: string[]; profilesMap?: Record<string, string>; stoneTypes?: StoneType[]; openSlabs?: OpenSlab[] }) {
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

  // Section-level collapse per facility. Default = expanded.
  const [collapsed, setCollapsed] = useState<Record<Facility, boolean>>({ mtcpl: false, riico: false });
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

              {!isCollapsed && (
                <div className="block-card-grid">
                  {list.map(block => {
                    const L = Number(block.length_ft);
                    const W = Number(block.width_ft);
                    const H = Number(block.height_ft);
                    const cft = calcCft(L, W, H);
                    const stoneColor = stones.find(s => s.name === block.stone)?.color_top ?? "#D8D4CC";
                    const isSelected = selectedId === block.id;
                    const isUnavailable = block.status !== "available";

                    return (
                      <div
                        key={block.id}
                        className={`block-card${isSelected ? " block-card-active" : ""}`}
                        style={isUnavailable ? { filter: "grayscale(0.9)", opacity: 0.65 } : undefined}
                        onClick={() => setSelectedId(isSelected ? null : block.id)}
                        role="button"
                        tabIndex={0}
                        onKeyDown={e => { if (e.key === "Enter" || e.key === " ") setSelectedId(isSelected ? null : block.id); }}
                      >
                        <div className="block-card-preview">
                          <BlockCardPreview stone={block.stone} l={L} w={W} h={H} stoneTypes={stones} />
                        </div>
                        <div className="block-card-info">
                          <div className="block-card-code">{block.id}</div>
                          <div className="block-card-badges">
                            <span className="role-pill" style={{ background: stoneColor + "55", color: "#1a1a1a", border: `1px solid ${stoneColor}` }}>{stoneDisplayName(block.stone)}</span>
                            <span className="role-pill">{yardShortLabel(block.yard)}</span>
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
                          <div className="block-card-dims">{L} × {W} × {H} in</div>
                          <div className="block-card-cft">{cft} CFT</div>
                          {block.created_at && (
                            <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>
                              Added {fmtDate(block.created_at)}
                              {block.created_by && (
                                <> · <span style={{ color: "var(--gold-dark)", fontWeight: 600 }}>by {profilesMap[block.created_by] ?? "Unknown"}</span></>
                              )}
                            </div>
                          )}
                        </div>
                        {canEdit && <div className="block-card-edit-hint">{isSelected ? "✕ Close" : "Edit"}</div>}
                      </div>
                    );
                  })}
                </div>
              )}
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
                      <input name="truck_no" defaultValue={selected.truck_no ?? ""} placeholder="e.g. GJ01AB1234" />
                    </label>
                    <label className="stack">
                      <span>Vendor</span>
                      <VendorSelect vendors={vendors} defaultValue={selected.vendor_name} name="vendor_name" />
                    </label>
                    <label className="stack">
                      <span>Bill No.</span>
                      <input name="bill_no" defaultValue={selected.bill_no ?? ""} placeholder="e.g. INV-001" />
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
            length_ft: Number(selected.length_ft),
            width_ft: Number(selected.width_ft),
            height_ft: Number(selected.height_ft),
          }}
          openSlabs={openSlabs.filter(s => s.stone === selected.stone)}
          onClose={() => setManualCutOpen(false)}
        />
      )}
    </>
  );
}
