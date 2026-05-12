"use client";

/**
 * Bulk assign — pick up to 4 slabs in the Unassigned tab, hit
 * "Assign N selected", land here. One vendor, one set of params
 * (urgency / work-type / ETA / note) applied to every slab in the
 * selection. Behind the scenes each row gets the same `batch_id`
 * so the downstream cockpit + transfer UI can colour-group them
 * as "these came together".
 *
 * Built as a separate component from the single-slab AssignModal
 * so the existing flow stays untouched. Reuses the same visual
 * pattern (center peek, dark backdrop, vendor radio list with
 * type breakdown).
 *
 * Marked "use client" because of inline event handlers + local
 * state for vendor / urgency / work-type pickers.
 */

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { assignCarvingJobsBatchAction } from "./actions";
import { SlabThumb } from "@/components/slab-thumb";
import type { StoneTypeDef } from "@/lib/stone-utils";

type Machine = {
  id: string;
  machine_code: string;
  status: "idle" | "carving" | "maintenance" | "inactive";
  machine_type?: "single_head" | "multi_head_2" | "lathe";
};

type Vendor = {
  id: string;
  name: string;
  vendor_type: "CNC" | "Manual";
  machines: Machine[];
  live?: { free: number; busy: number; maintenance: number; total: number; queued: number };
};

export type BulkAssignSlab = {
  id: string;
  label: string | null;
  temple: string;
  stone: string | null;
  length_ft: number;
  width_ft: number;
  thickness_ft: number;
};

type WorkType = "flat" | "lathe";

// Same colour map the single-slab AssignModal uses for its machine
// grid — kept in sync visually so a vendor's cockpit-preview looks
// identical whether the carving head opens single or bulk assign.
const MACHINE_TINT: Record<
  Machine["status"],
  { bg: string; border: string; fg: string; label: string }
> = {
  idle: { bg: "rgba(22,163,74,0.1)", border: "rgba(22,163,74,0.4)", fg: "#15803d", label: "FREE" },
  carving: { bg: "rgba(37,99,235,0.08)", border: "rgba(37,99,235,0.4)", fg: "#1d4ed8", label: "RUNNING" },
  maintenance: { bg: "rgba(220,38,38,0.08)", border: "rgba(220,38,38,0.4)", fg: "#b91c1c", label: "DOWN" },
  inactive: { bg: "var(--surface-alt)", border: "var(--border)", fg: "var(--muted)", label: "OFF" },
};

// Same rule-based recommender as the single-slab AssignModal. Kept
// in sync visually (✨ BEST FIT chip + auto-select) so the workflow
// reads identical whether assigning one slab or a batch.
function recommendVendor(
  vendors: Vendor[],
  workType: WorkType,
): { vendorId: string | null; reason: string } {
  let best: { id: string; name: string; score: number; reason: string } | null = null;
  for (const v of vendors) {
    if (v.vendor_type !== "CNC") continue;
    const br = typeBreakdown(v);
    const free = workType === "lathe" ? br.latheFree : br.multiFree;
    const total = workType === "lathe" ? br.latheTotal : br.multiTotal;
    if (total === 0) continue;
    const queued = v.live?.queued ?? 0;
    const score = (free > 0 ? 100 : 50) + free * 5 - queued * 5;
    const reason =
      free > 0
        ? `${free} free ${workType === "lathe" ? "lathe" : "CNC"}${queued > 0 ? ` · ${queued} pending` : ""}`
        : `will go to stock pending · ${queued} ahead`;
    if (!best || score > best.score || (score === best.score && v.name < best.name)) {
      best = { id: v.id, name: v.name, score, reason };
    }
  }
  return best ? { vendorId: best.id, reason: best.reason } : { vendorId: null, reason: "" };
}

function typeBreakdown(v: Vendor) {
  const out = { multiFree: 0, multiTotal: 0, latheFree: 0, latheTotal: 0 };
  for (const m of v.machines) {
    if (m.machine_type === "lathe") {
      out.latheTotal += 1;
      if (m.status === "idle") out.latheFree += 1;
    } else {
      out.multiTotal += 1;
      if (m.status === "idle") out.multiFree += 1;
    }
  }
  return out;
}

export function BulkAssignModal({
  slabs,
  vendors,
  stoneTypes,
  onClose,
}: {
  slabs: BulkAssignSlab[];
  vendors: Vendor[];
  stoneTypes: StoneTypeDef[];
  onClose: () => void;
}) {
  const [vendorId, setVendorId] = useState("");
  const [workType, setWorkType] = useState<WorkType>("flat");
  const [urgency, setUrgency] = useState<"normal" | "urgent">("normal");
  const [days, setDays] = useState("");
  const [hours, setHours] = useState("");
  const [note, setNote] = useState("");
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const selectedVendor = vendors.find((v) => v.id === vendorId);
  const isManual = selectedVendor?.vendor_type === "Manual";

  // Rule-based recommendation. Auto-selects the winner on mount +
  // whenever work-type flips. User can override by clicking another
  // vendor row.
  const recommendation = useMemo(
    () => recommendVendor(vendors, workType),
    [vendors, workType],
  );
  useEffect(() => {
    if (recommendation.vendorId) setVendorId(recommendation.vendorId);
  }, [recommendation.vendorId]);

  const sortedVendors = useMemo(() => {
    return [...vendors].sort((a, b) => {
      if (a.vendor_type !== b.vendor_type) return a.vendor_type === "Manual" ? 1 : -1;
      if (a.vendor_type === "Manual" && b.vendor_type === "Manual") {
        return a.name.localeCompare(b.name);
      }
      const ab = typeBreakdown(a);
      const bb = typeBreakdown(b);
      const aFree = workType === "lathe" ? ab.latheFree : ab.multiFree;
      const bFree = workType === "lathe" ? bb.latheFree : bb.multiFree;
      if (aFree !== bFree) return bFree - aFree;
      return a.name.localeCompare(b.name);
    });
  }, [vendors, workType]);

  const totalMinutes = (Number(days) || 0) * 60 * 24 + (Number(hours) || 0) * 60;
  const requiresMachineType = workType === "lathe" ? "lathe" : "";

  // Detect mirror-pairs in the selection — same label + L×W×T means
  // these slabs are pair-eligible, which gives the carving head
  // confidence that the batch can run on a 2-head together.
  const pairHint = useMemo(() => {
    if (slabs.length < 2) return null;
    const first = slabs[0];
    const allMatch = slabs.every(
      (s) =>
        (s.label ?? "") === (first.label ?? "") &&
        s.length_ft === first.length_ft &&
        s.width_ft === first.width_ft &&
        s.thickness_ft === first.thickness_ft,
    );
    return allMatch ? "All identical — can run as 2-head pairs" : null;
  }, [slabs]);

  return (
    <div
      onMouseDown={(e) => {
        if (dialogRef.current && !dialogRef.current.contains(e.target as Node)) {
          onClose();
        }
      }}
      style={{
        position: "fixed",
        top: 0,
        left: "var(--content-left)",
        right: 0,
        bottom: 0,
        background: "rgba(15, 12, 6, 0.55)",
        backdropFilter: "blur(2px)",
        // 1100 so we float ABOVE the temple peek modal (1000) when
        // the user bulk-selects from inside the peek then submits.
        zIndex: 1100,
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        paddingTop: "6vh",
        paddingLeft: 12,
        paddingRight: 12,
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        style={{
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: 12,
          boxShadow: "0 18px 60px rgba(0,0,0,0.45)",
          width: "100%",
          maxWidth: 760,
          maxHeight: "88vh",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: "14px 18px",
            borderBottom: "1px solid var(--border)",
            background: "var(--bg)",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            gap: 12,
          }}
        >
          <div style={{ minWidth: 0, flex: 1 }}>
            <h2 style={{ margin: 0, fontSize: 17 }}>
              📦 Assign {slabs.length} slab{slabs.length !== 1 ? "s" : ""} as a batch
            </h2>
            <p className="muted" style={{ fontSize: 12, margin: "4px 0 0" }}>
              They&apos;ll share a batch tag — vendor + runner see them grouped
              by colour, easy to pair up on a 2-head.
            </p>
            {pairHint && (
              <p
                style={{
                  fontSize: 11,
                  margin: "6px 0 0",
                  color: "#15803d",
                  fontWeight: 700,
                }}
              >
                ✓ {pairHint}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{
              fontSize: 18,
              border: "none",
              background: "transparent",
              cursor: "pointer",
              color: "var(--muted)",
              padding: 4,
            }}
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "14px 18px 18px" }}>
          {/* Selected slab thumbnails */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))",
              gap: 6,
              marginBottom: 14,
              padding: 10,
              background: "var(--surface-alt)",
              border: "1px dashed var(--border)",
              borderRadius: 8,
            }}
          >
            {slabs.map((s) => (
              <div
                key={s.id}
                style={{
                  padding: 4,
                  background: "var(--surface)",
                  border: "1px solid var(--border)",
                  borderRadius: 6,
                  display: "flex",
                  flexDirection: "column",
                  gap: 4,
                }}
              >
                <SlabThumb
                  stone={s.stone}
                  l={Number(s.length_ft)}
                  w={Number(s.width_ft)}
                  t={Number(s.thickness_ft)}
                  stoneTypes={stoneTypes}
                  size={60}
                  height={60}
                />
                <div
                  style={{
                    fontFamily: "ui-monospace, monospace",
                    fontWeight: 700,
                    fontSize: 11,
                    color: "var(--text)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                  title={s.id}
                >
                  {s.id}
                </div>
                <div style={{ fontSize: 9, color: "var(--muted)", fontFamily: "ui-monospace, monospace" }}>
                  {s.length_ft}×{s.width_ft}×{s.thickness_ft}″
                </div>
              </div>
            ))}
          </div>

          <form
            action={assignCarvingJobsBatchAction}
            style={{ display: "flex", flexDirection: "column", gap: 16 }}
          >
            <input type="hidden" name="slab_ids" value={JSON.stringify(slabs.map((s) => s.id))} />
            <input type="hidden" name="requires_machine_type" value={requiresMachineType} />

            {/* Work type */}
            {!isManual && (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <Label>Work type (applies to all {slabs.length} slabs)</Label>
                <div style={{ display: "flex", gap: 8 }}>
                  <button
                    type="button"
                    onClick={() => setWorkType("flat")}
                    style={{
                      flex: 1,
                      padding: "10px 14px",
                      fontSize: 13,
                      fontWeight: 600,
                      border: `1.5px solid ${workType === "flat" ? "var(--gold-dark)" : "var(--border)"}`,
                      background: workType === "flat" ? "rgba(180,115,51,0.08)" : "var(--surface)",
                      color: "var(--text)",
                      borderRadius: 8,
                      cursor: "pointer",
                    }}
                  >
                    📐 Flat panel
                  </button>
                  <button
                    type="button"
                    onClick={() => setWorkType("lathe")}
                    style={{
                      flex: 1,
                      padding: "10px 14px",
                      fontSize: 13,
                      fontWeight: 700,
                      border: `1.5px solid ${workType === "lathe" ? "#7c3aed" : "var(--border)"}`,
                      background: workType === "lathe" ? "rgba(124,58,237,0.08)" : "var(--surface)",
                      color: workType === "lathe" ? "#5b21b6" : "var(--text)",
                      borderRadius: 8,
                      cursor: "pointer",
                    }}
                  >
                    🌀 Lathe (cylindrical)
                  </button>
                </div>
              </div>
            )}

            {/* Vendor list */}
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <Label>Vendor</Label>
              {sortedVendors.length === 0 ? (
                <div className="muted" style={{ padding: 12, fontSize: 13 }}>
                  No active vendors.
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {sortedVendors.some((v) => v.vendor_type === "CNC") && (
                    <SectionHeader label="🏭 CNC Vendors" />
                  )}
                  {sortedVendors.map((v, idx) => {
                    const isSelected = v.id === vendorId;
                    const isVendorManual = v.vendor_type === "Manual";
                    const prev = idx > 0 ? sortedVendors[idx - 1] : null;
                    const showManualHeader =
                      isVendorManual && (!prev || prev.vendor_type !== "Manual");
                    const manualHeader = showManualHeader ? (
                      <SectionHeader
                        key={`__manual-${v.id}`}
                        label="🪚 Manual Carvers"
                        accent="#92400e"
                        topMargin={prev ? 10 : 0}
                      />
                    ) : null;

                    if (isVendorManual) {
                      return (
                        <Fragment key={v.id}>
                          {manualHeader}
                          <VendorRow
                            v={v}
                            isSelected={isSelected}
                            isManual
                            onSelect={() => setVendorId(v.id)}
                            workType={workType}
                          />
                        </Fragment>
                      );
                    }
                    return (
                      <VendorRow
                        key={v.id}
                        v={v}
                        isSelected={isSelected}
                        onSelect={() => setVendorId(v.id)}
                        workType={workType}
                        isRecommended={recommendation.vendorId === v.id}
                        recommendationReason={recommendation.reason}
                      />
                    );
                  })}
                </div>
              )}
            </div>

            {/* Prominent cockpit panel for the selected CNC vendor —
                same big-box pattern as the single-slab AssignModal.
                Shows stock pending + free/busy stat tiles + the
                full machine grid below. */}
            {selectedVendor && selectedVendor.vendor_type === "CNC" && (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 12,
                  padding: "14px 16px",
                  background: "linear-gradient(180deg, rgba(180,115,51,0.06) 0%, var(--surface-alt) 100%)",
                  border: "2px solid var(--gold-dark)",
                  borderRadius: 10,
                  boxShadow: "0 2px 12px rgba(180,115,51,0.10)",
                }}
              >
                <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
                  <span
                    style={{
                      fontSize: 14,
                      fontWeight: 800,
                      color: "var(--gold-dark)",
                      letterSpacing: "0.02em",
                    }}
                  >
                    🏭 {selectedVendor.name}&apos;s cockpit
                  </span>
                </div>
                {/* Live stat tiles */}
                {(() => {
                  const br = typeBreakdown(selectedVendor);
                  const stockPending = selectedVendor.live?.queued ?? 0;
                  const busy = selectedVendor.live?.busy ?? 0;
                  const maint = selectedVendor.live?.maintenance ?? 0;
                  return (
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))",
                        gap: 8,
                      }}
                    >
                      <CockpitStat label="Stock pending" value={stockPending} fg="#b45309" />
                      <CockpitStat
                        label={workType === "lathe" ? "Lathes free" : "CNC free"}
                        value={workType === "lathe" ? br.latheFree : br.multiFree}
                        fg="#15803d"
                      />
                      <CockpitStat label="Carving now" value={busy} fg="#1d4ed8" />
                      <CockpitStat label="Down" value={maint} fg="#b91c1c" />
                    </div>
                  );
                })()}
                {selectedVendor.machines.length === 0 ? (
                  <div style={{ fontSize: 12, color: "var(--muted)" }}>
                    No machines configured for this vendor yet.
                  </div>
                ) : (
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(auto-fill, minmax(110px, 1fr))",
                      gap: 6,
                    }}
                  >
                    {selectedVendor.machines.map((m) => {
                      const tint = MACHINE_TINT[m.status];
                      const typeLabel =
                        m.machine_type === "multi_head_2"
                          ? "2× HEAD"
                          : m.machine_type === "lathe"
                            ? "LATHE"
                            : null;
                      const matchesWorkType =
                        workType === "lathe"
                          ? m.machine_type === "lathe"
                          : m.machine_type !== "lathe";
                      return (
                        <div
                          key={m.id}
                          style={{
                            padding: "6px 10px",
                            background: tint.bg,
                            border: `1.5px solid ${matchesWorkType ? tint.border : "var(--border)"}`,
                            borderRadius: 6,
                            fontFamily: "ui-monospace, monospace",
                            display: "flex",
                            flexDirection: "column",
                            alignItems: "flex-start",
                            gap: 2,
                            opacity: matchesWorkType ? 1 : 0.45,
                          }}
                          title={
                            !matchesWorkType
                              ? `Wrong machine type for ${workType === "lathe" ? "lathe" : "flat-panel"} work`
                              : undefined
                          }
                        >
                          <div style={{ display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap" }}>
                            <span style={{ fontSize: 12, fontWeight: 700, color: "var(--text)" }}>
                              {m.machine_code}
                            </span>
                            {typeLabel && (
                              <span
                                style={{
                                  fontSize: 8,
                                  fontWeight: 800,
                                  padding: "0px 5px",
                                  borderRadius: 3,
                                  background:
                                    m.machine_type === "lathe"
                                      ? "rgba(124,58,237,0.15)"
                                      : "rgba(180,115,51,0.18)",
                                  color: m.machine_type === "lathe" ? "#7c3aed" : "#b45309",
                                  letterSpacing: "0.06em",
                                }}
                              >
                                {typeLabel}
                              </span>
                            )}
                          </div>
                          <span
                            style={{
                              fontSize: 9,
                              fontWeight: 700,
                              color: tint.fg,
                              letterSpacing: "0.05em",
                            }}
                          >
                            {tint.label}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
                {(() => {
                  const br = typeBreakdown(selectedVendor);
                  const focusedFree = workType === "lathe" ? br.latheFree : br.multiFree;
                  if (focusedFree > 0) return null;
                  return (
                    <div
                      style={{
                        fontSize: 11,
                        color: "#b45309",
                        background: "rgba(217,119,6,0.06)",
                        padding: "6px 10px",
                        borderRadius: 6,
                        border: "1px solid rgba(217,119,6,0.25)",
                      }}
                    >
                      No free {workType === "lathe" ? "lathe" : "multi-head"} machines right
                      now at {selectedVendor.name}. The batch will go into stock pending and
                      load when one frees up.
                    </div>
                  );
                })()}
              </div>
            )}

            {/* Urgency */}
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <Label>Urgency</Label>
              <input type="hidden" name="urgency" value={urgency} />
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  type="button"
                  onClick={() => setUrgency("normal")}
                  style={{
                    flex: 1,
                    padding: "10px 14px",
                    fontSize: 13,
                    fontWeight: 600,
                    border: `1.5px solid ${urgency === "normal" ? "var(--gold-dark)" : "var(--border)"}`,
                    background: urgency === "normal" ? "rgba(180,115,51,0.08)" : "var(--surface)",
                    color: "var(--text)",
                    borderRadius: 8,
                    cursor: "pointer",
                  }}
                >
                  Normal
                </button>
                <button
                  type="button"
                  onClick={() => setUrgency("urgent")}
                  style={{
                    flex: 1,
                    padding: "10px 14px",
                    fontSize: 13,
                    fontWeight: 700,
                    border: `1.5px solid ${urgency === "urgent" ? "#dc2626" : "var(--border)"}`,
                    background: urgency === "urgent" ? "rgba(220,38,38,0.08)" : "var(--surface)",
                    color: urgency === "urgent" ? "#991b1b" : "var(--text)",
                    borderRadius: 8,
                    cursor: "pointer",
                  }}
                >
                  ⚡ Urgent
                </button>
              </div>
            </div>

            {/* ETA */}
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <Label>Rough estimated time (carving head&apos;s guess)</Label>
              <input type="hidden" name="estimated_minutes" value={totalMinutes || ""} />
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input
                  type="number"
                  min="0"
                  max="30"
                  value={days}
                  onChange={(e) => setDays(e.target.value)}
                  placeholder="0"
                  style={{ width: 80, padding: "8px 10px", fontSize: 13, border: "1px solid var(--border)", borderRadius: 6, background: "var(--bg)", color: "var(--text)" }}
                />
                <span style={{ fontSize: 12, color: "var(--muted)" }}>days</span>
                <input
                  type="number"
                  min="0"
                  max="23"
                  value={hours}
                  onChange={(e) => setHours(e.target.value)}
                  placeholder="0"
                  style={{ width: 80, padding: "8px 10px", fontSize: 13, border: "1px solid var(--border)", borderRadius: 6, background: "var(--bg)", color: "var(--text)" }}
                />
                <span style={{ fontSize: 12, color: "var(--muted)" }}>hours</span>
              </div>
              <span style={{ fontSize: 11, color: "var(--muted-light)" }}>
                Applies to every slab in the batch. The vendor will set tighter
                estimates per slab when loading.
              </span>
            </div>

            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <Label>Note (optional)</Label>
              <textarea
                name="note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={2}
                placeholder="Design details, urgency reason, anything the vendor should know"
                style={{ padding: "8px 12px", fontSize: 13, border: "1px solid var(--border)", borderRadius: 6, background: "var(--bg)", color: "var(--text)", resize: "vertical", fontFamily: "inherit" }}
              />
            </label>

            <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
              <button
                type="submit"
                className="primary-button"
                disabled={!vendorId}
                style={{ flex: 1, fontSize: 14, padding: "12px 16px", fontWeight: 700 }}
              >
                📦 Assign {slabs.length} slab{slabs.length !== 1 ? "s" : ""}
              </button>
              <button type="button" className="ghost-button" onClick={onClose}>
                Cancel
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

function VendorRow({
  v,
  isSelected,
  isManual,
  onSelect,
  workType,
  isRecommended,
  recommendationReason,
}: {
  v: Vendor;
  isSelected: boolean;
  isManual?: boolean;
  onSelect: () => void;
  workType: WorkType;
  isRecommended?: boolean;
  recommendationReason?: string;
}) {
  const queued = v.live?.queued ?? 0;
  if (isManual) {
    return (
      <label
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "10px 12px",
          background: isSelected ? "rgba(120,53,15,0.10)" : "rgba(120,53,15,0.04)",
          border: `1.5px solid ${isSelected ? "#92400e" : "rgba(120,53,15,0.25)"}`,
          borderRadius: 8,
          cursor: "pointer",
        }}
      >
        <input
          type="radio"
          name="vendor_id"
          value={v.id}
          checked={isSelected}
          onChange={onSelect}
          style={{ cursor: "pointer", flexShrink: 0 }}
        />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 13, color: "var(--text)" }}>
            {v.name}
            <span
              style={{
                marginLeft: 8,
                fontSize: 10,
                fontWeight: 700,
                padding: "1px 6px",
                borderRadius: 4,
                background: "rgba(120,53,15,0.12)",
                color: "#78350f",
              }}
            >
              🪚 MANUAL
            </span>
          </div>
          {queued > 0 && (
            <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>
              {queued} stock pending
            </div>
          )}
        </div>
      </label>
    );
  }
  const br = typeBreakdown(v);
  const hasTypeInFleet = (workType === "lathe" ? br.latheTotal : br.multiTotal) > 0;
  return (
    <label
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "12px 14px",
        background: isSelected
          ? "rgba(180,115,51,0.10)"
          : isRecommended
            ? "rgba(22,163,74,0.05)"
            : "var(--surface)",
        border: `2px solid ${
          isSelected
            ? "var(--gold-dark)"
            : isRecommended
              ? "rgba(22,163,74,0.4)"
              : "var(--border)"
        }`,
        borderRadius: 8,
        cursor: "pointer",
        opacity: hasTypeInFleet ? 1 : 0.5,
      }}
    >
      <input
        type="radio"
        name="vendor_id"
        value={v.id}
        checked={isSelected}
        onChange={onSelect}
        style={{ cursor: "pointer", flexShrink: 0 }}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span style={{ fontWeight: 800, fontSize: 15, color: "var(--text)", letterSpacing: "0.02em" }}>
            {v.name}
          </span>
          {isRecommended && (
            <span
              style={{
                fontSize: 10,
                fontWeight: 800,
                padding: "2px 8px",
                borderRadius: 999,
                background: "#16a34a",
                color: "#fff",
                letterSpacing: "0.06em",
              }}
              title={`Best fit: ${recommendationReason}`}
            >
              ✨ BEST FIT
            </span>
          )}
        </div>
        <div style={{ fontSize: 12, color: "var(--muted)", fontFamily: "ui-monospace, monospace", marginTop: 4, fontWeight: 600 }}>
          🏭 {br.multiTotal} CNC · {br.latheTotal} Lathe
        </div>
      </div>
    </label>
  );
}

function CockpitStat({ label, value, fg }: { label: string; value: number; fg: string }) {
  return (
    <div
      style={{
        padding: "8px 12px",
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: 8,
        textAlign: "center",
      }}
    >
      <div
        style={{
          fontSize: 9,
          color: "var(--muted)",
          textTransform: "uppercase",
          letterSpacing: "0.06em",
          fontWeight: 700,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: 22,
          fontWeight: 800,
          color: fg,
          fontFamily: "ui-monospace, monospace",
          marginTop: 2,
        }}
      >
        {value}
      </div>
    </div>
  );
}

function SectionHeader({
  label,
  accent,
  topMargin,
}: {
  label: string;
  accent?: string;
  topMargin?: number;
}) {
  return (
    <div
      style={{
        marginTop: topMargin ?? 0,
        paddingTop: topMargin && topMargin > 0 ? 10 : 0,
        borderTop: topMargin && topMargin > 0 ? "1px dashed var(--border)" : "none",
        fontSize: 11,
        fontWeight: 800,
        letterSpacing: "0.07em",
        color: accent ?? "var(--gold-dark)",
        textTransform: "uppercase",
      }}
    >
      {label}
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <span
      style={{
        fontSize: 11,
        fontWeight: 700,
        color: "var(--muted)",
        textTransform: "uppercase",
        letterSpacing: "0.06em",
      }}
    >
      {children}
    </span>
  );
}
