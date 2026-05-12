"use client";

/**
 * Assign-to-vendor — Phase 4 (CNC ops + Manual + work-type tagging).
 *
 * Carving head:
 *   1. Picks a work type — Flat panel (default, goes to multi-head)
 *      or 🌀 Lathe (cylindrical, goes to lathe). The pick filters and
 *      sorts the vendor list so the vendor whose machines best match
 *      bubbles up.
 *   2. Picks a vendor from the live list. Each row shows the type
 *      breakdown: "2 multi-head free · 1 lathe free · 4 queued".
 *      Manual vendors show as "🪚 Manual carver".
 *   3. After picking a CNC vendor, sees a grid of THAT vendor's
 *      machines colour-coded by status. Manual vendors show a
 *      compact "no machines tracked" panel instead.
 *   4. Marks urgency, optionally enters a rough estimated time
 *      (days + hours since carving runs span hours to multi-day).
 *
 * Renders as a center-peek modal (matches the dashboard ID-lookup +
 * settings PeekSection style) — feels native on big monitors and
 * fits on tablets that the carving head walks around with.
 */

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { assignCarvingJobAction } from "./actions";

type Machine = {
  id: string;
  machine_code: string;
  status: "idle" | "carving" | "maintenance" | "inactive";
  /** Migration 021: 'single_head' | 'multi_head_2' | 'lathe'. */
  machine_type?: "single_head" | "multi_head_2" | "lathe";
};

type Vendor = {
  id: string;
  name: string;
  vendor_type: "CNC" | "Manual";
  machines: Machine[];
  live?: {
    free: number;
    busy: number;
    maintenance: number;
    total: number;
    queued: number;
  };
};

type Slab = {
  id: string;
  label: string | null;
  temple: string;
  stone: string | null;
  length_ft: number;
  width_ft: number;
  thickness_ft: number;
};

type WorkType = "flat" | "lathe";

const MACHINE_TINT: Record<Machine["status"], { bg: string; border: string; fg: string; label: string }> = {
  idle: { bg: "rgba(22,163,74,0.1)", border: "rgba(22,163,74,0.4)", fg: "#15803d", label: "FREE" },
  carving: { bg: "rgba(37,99,235,0.08)", border: "rgba(37,99,235,0.4)", fg: "#1d4ed8", label: "RUNNING" },
  maintenance: { bg: "rgba(220,38,38,0.08)", border: "rgba(220,38,38,0.4)", fg: "#b91c1c", label: "DOWN" },
  inactive: { bg: "var(--surface-alt)", border: "var(--border)", fg: "var(--muted)", label: "OFF" },
};

// Compute per-vendor machine type breakdown. Multi-head + legacy
// single-head are merged into the "CNC" bucket (Daksh: include both
// in CNC only). Lathe is its own bucket.
function vendorTypeBreakdown(v: Vendor) {
  const out = {
    multiFree: 0,
    multiBusy: 0,
    multiTotal: 0,
    latheFree: 0,
    latheBusy: 0,
    latheTotal: 0,
  };
  for (const m of v.machines) {
    if (!m) continue;
    if (m.machine_type === "lathe") {
      out.latheTotal += 1;
      if (m.status === "idle") out.latheFree += 1;
      else if (m.status === "carving") out.latheBusy += 1;
    } else {
      // multi_head_2 + legacy single_head → "CNC" bucket. The fleet
      // has no real single-head machines today, but the type stays
      // in the schema as legacy.
      out.multiTotal += 1;
      if (m.status === "idle") out.multiFree += 1;
      else if (m.status === "carving") out.multiBusy += 1;
    }
  }
  return out;
}

// Rule-based recommender: score each vendor against the work type
// + current free/queue state and pick the winner. Stays simple +
// deterministic + explainable. Replaces "AI for this" — for a
// math-heavy capacity check, rules beat LLMs every time.
//
// Scoring:
//   +100 if vendor has ≥1 free machine of the matching type RIGHT NOW
//   +50  if vendor has the matching type at all (will queue but can do it)
//    -∞  if vendor doesn't have the matching type (eliminated)
//   +5  per extra free matching machine (more headroom)
//   -5  per slab currently queued (= ~30min wait estimate)
//
// Tie-breaker: alphabetical, so the same input always picks the
// same vendor.
function recommendVendor(
  vendors: Vendor[],
  workType: WorkType,
): { vendorId: string | null; reason: string } {
  let best: { id: string; score: number; reason: string } | null = null;
  for (const v of vendors) {
    if (v.vendor_type !== "CNC") continue; // recommender is CNC-only
    const br = vendorTypeBreakdown(v);
    const free = workType === "lathe" ? br.latheFree : br.multiFree;
    const total = workType === "lathe" ? br.latheTotal : br.multiTotal;
    if (total === 0) continue; // no matching machine in fleet
    const queued = v.live?.queued ?? 0;
    let score = (free > 0 ? 100 : 50) + free * 5 - queued * 5;
    const reason =
      free > 0
        ? `${free} free ${workType === "lathe" ? "lathe" : "CNC"}${queued > 0 ? ` · ${queued} pending` : ""}`
        : `will queue · ${queued} ahead`;
    if (!best || score > best.score || (score === best.score && v.name < (vendors.find((x) => x.id === best!.id)?.name ?? ""))) {
      best = { id: v.id, score, reason };
    }
  }
  return best ? { vendorId: best.id, reason: best.reason } : { vendorId: null, reason: "" };
}

export function AssignModal({
  slab,
  vendors,
  onClose,
}: {
  slab: Slab;
  vendors: Vendor[];
  onClose: () => void;
}) {
  const [vendorId, setVendorId] = useState<string>("");
  const [workType, setWorkType] = useState<WorkType>("flat");
  const [urgency, setUrgency] = useState<"normal" | "urgent">("normal");
  const [days, setDays] = useState<string>("");
  const [hours, setHours] = useState<string>("");
  const [note, setNote] = useState("");
  const dialogRef = useRef<HTMLDivElement>(null);

  // Esc closes
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

  // Rule-based recommendation. Re-runs whenever work-type or the
  // vendor fleet changes. Powers the ✨ Best fit badge on one
  // vendor row + auto-selects that vendor when the modal opens.
  const recommendation = useMemo(
    () => recommendVendor(vendors, workType),
    [vendors, workType],
  );

  // Auto-select the recommended vendor on mount + whenever the
  // work-type flips. The user can override by clicking another row.
  useEffect(() => {
    if (recommendation.vendorId) {
      setVendorId(recommendation.vendorId);
    }
  }, [recommendation.vendorId]);

  // Sort vendors so the right machine type bubbles up. Manual
  // vendors always sit at the bottom (capacity-irrelevant). For
  // CNC vendors, when 🌀 Lathe is selected, prioritise free lathes;
  // otherwise prioritise free multi-heads. Within each tier, vendors
  // with shorter queues sort ahead.
  const sortedVendors = useMemo(() => {
    return [...vendors].sort((a, b) => {
      // Manual vendors last (they don't have machines to match)
      if (a.vendor_type !== b.vendor_type) {
        return a.vendor_type === "Manual" ? 1 : -1;
      }
      if (a.vendor_type === "Manual" && b.vendor_type === "Manual") {
        return a.name.localeCompare(b.name);
      }
      const aBreak = vendorTypeBreakdown(a);
      const bBreak = vendorTypeBreakdown(b);
      const aFree = workType === "lathe" ? aBreak.latheFree : aBreak.multiFree;
      const bFree = workType === "lathe" ? bBreak.latheFree : bBreak.multiFree;
      if (aFree !== bFree) return bFree - aFree;
      // Tier 2: have-the-type-at-all (capacity 0 right now) ahead of
      // vendors that don't have that type in the fleet at all.
      const aHasType = workType === "lathe" ? aBreak.latheTotal : aBreak.multiTotal;
      const bHasType = workType === "lathe" ? bBreak.latheTotal : bBreak.multiTotal;
      if (aHasType !== bHasType) return bHasType - aHasType;
      const aQ = a.live?.queued ?? 0;
      const bQ = b.live?.queued ?? 0;
      if (aQ !== bQ) return aQ - bQ;
      return a.name.localeCompare(b.name);
    });
  }, [vendors, workType]);

  // Compute total minutes from days + hours inputs.
  const totalMinutes = (Number(days) || 0) * 60 * 24 + (Number(hours) || 0) * 60;

  // Map workType → requires_machine_type form value. Flat panel is
  // the default and stores NULL on the server side (empty string).
  const requiresMachineType = workType === "lathe" ? "lathe" : "";

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
        zIndex: 1000,
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
          maxWidth: 720,
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
            <h2 style={{ margin: 0, fontSize: 17 }}>Assign carving job</h2>
            <p className="muted" style={{ fontSize: 12, margin: "4px 0 0" }}>
              <code style={{ fontFamily: "ui-monospace, monospace", fontWeight: 700 }}>{slab.id}</code>
              {" · "}
              {slab.temple} · {slab.label} · {slab.length_ft}×{slab.width_ft}×{slab.thickness_ft}&Prime;
            </p>
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
          <form action={assignCarvingJobAction} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <input type="hidden" name="slab_id" value={slab.id} />
            <input type="hidden" name="requires_machine_type" value={requiresMachineType} />

            {/* Work type picker — drives vendor sort + load-time
                validation. Hidden when the selected vendor is Manual
                (they don't have machine types to match). */}
            {!isManual && (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <Label>Work type</Label>
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
                    title="Flat panel work — must go on a 2-head CNC machine. Default."
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
                    title="Cylindrical work — must go on a lathe."
                  >
                    🌀 Lathe (cylindrical)
                  </button>
                </div>
              </div>
            )}

            {/* Vendor list — partitioned: CNC vendors first (with
                their capacity breakdown), then a divider, then Manual
                carvers (no machines to show, simpler row). The
                section headers make the two paths visually distinct
                so the carving head can't accidentally pick the wrong
                workflow. */}
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <Label>Vendor</Label>
              {sortedVendors.length === 0 ? (
                <div className="muted" style={{ padding: 12, fontSize: 13 }}>
                  No active vendors. Add one in <strong>Manage Vendors</strong>.
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {/* CNC section header (only when there's at least one CNC) */}
                  {sortedVendors.some((v) => v.vendor_type === "CNC") && (
                    <SectionHeader
                      label="🏭 CNC Vendors"
                      hint="Tracked machines · transfer runner delivers slabs"
                    />
                  )}
                  {sortedVendors.map((v, idx) => {
                    const isSelected = v.id === vendorId;
                    const isVendorManual = v.vendor_type === "Manual";
                    const queued = v.live?.queued ?? 0;
                    // Insert the Manual section header right BEFORE
                    // the first Manual vendor in the sorted list.
                    const prev = idx > 0 ? sortedVendors[idx - 1] : null;
                    const showManualHeader =
                      isVendorManual && (!prev || prev.vendor_type !== "Manual");
                    const manualHeaderNode = showManualHeader ? (
                      <SectionHeader
                        key={`__manual-header-${v.id}`}
                        label="🪚 Manual Carvers"
                        hint="No machines · head fires Mark started / Mark complete"
                        accent="#92400e"
                        topMargin={prev ? 10 : 0}
                      />
                    ) : null;

                    // Manual vendor row — compact, no machine counts.
                    if (isVendorManual) {
                      return (
                        <Fragment key={v.id}>
                          {manualHeaderNode}
                          <label
                          style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            gap: 10,
                            padding: "10px 12px",
                            background: isSelected ? "rgba(120,53,15,0.10)" : "rgba(120,53,15,0.04)",
                            border: `1.5px solid ${isSelected ? "#92400e" : "rgba(120,53,15,0.25)"}`,
                            borderRadius: 8,
                            cursor: "pointer",
                            transition: "border-color 0.12s, background 0.12s",
                          }}
                        >
                          <input
                            type="radio"
                            name="vendor_id"
                            value={v.id}
                            checked={isSelected}
                            onChange={() => setVendorId(v.id)}
                            style={{ cursor: "pointer", flexShrink: 0 }}
                          />
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div
                              style={{
                                fontWeight: 700,
                                fontSize: 13,
                                color: "var(--text)",
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                whiteSpace: "nowrap",
                              }}
                            >
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
                                  letterSpacing: "0.05em",
                                }}
                              >
                                🪚 MANUAL
                              </span>
                            </div>
                            <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>
                              No machines tracked · head fires Mark started / Mark complete
                            </div>
                          </div>
                          {queued > 0 && (
                            <div
                              style={{
                                padding: "4px 10px",
                                borderRadius: 999,
                                background: "rgba(180,115,51,0.12)",
                                color: "#92400e",
                                fontWeight: 700,
                                fontSize: 12,
                                fontFamily: "ui-monospace, monospace",
                                whiteSpace: "nowrap",
                                flexShrink: 0,
                              }}
                            >
                              {queued} stock pending
                            </div>
                          )}
                          </label>
                        </Fragment>
                      );
                    }

                    // CNC vendor row — simplified per Daksh:
                    // just name + fleet inventory totals (no
                    // free/busy details — that's in the cockpit
                    // panel below when this row is selected).
                    const br = vendorTypeBreakdown(v);
                    const hasTypeInFleet =
                      (workType === "lathe" ? br.latheTotal : br.multiTotal) > 0;
                    // ✨ Best Fit chip stays visible even when the
                    // user selects this vendor — Daksh noticed the
                    // badge disappearing on click felt confusing
                    // (looked like they lost the recommendation).
                    // Now the badge persists so you can see "yes,
                    // you picked the recommended one".
                    const isRecommended = recommendation.vendorId === v.id;
                    return (
                      <label
                        key={v.id}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
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
                          transition: "border-color 0.12s, background 0.12s",
                        }}
                      >
                        <input
                          type="radio"
                          name="vendor_id"
                          value={v.id}
                          checked={isSelected}
                          onChange={() => setVendorId(v.id)}
                          style={{ cursor: "pointer", flexShrink: 0 }}
                        />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 8,
                              flexWrap: "wrap",
                            }}
                          >
                            <span
                              style={{
                                fontWeight: 800,
                                fontSize: 15,
                                color: "var(--text)",
                                letterSpacing: "0.02em",
                              }}
                            >
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
                                title={`Best fit: ${recommendation.reason}`}
                              >
                                ✨ BEST FIT
                              </span>
                            )}
                          </div>
                          {/* Fleet inventory — total machines per
                              type. No free/busy here; that lives in
                              the cockpit panel below when selected. */}
                          <div
                            style={{
                              fontSize: 12,
                              color: "var(--muted)",
                              fontFamily: "ui-monospace, monospace",
                              marginTop: 4,
                              fontWeight: 600,
                            }}
                          >
                            🏭 {br.multiTotal} CNC · {br.latheTotal} Lathe
                          </div>
                          {!hasTypeInFleet && (
                            <div
                              style={{
                                fontSize: 10,
                                color: "#b45309",
                                marginTop: 4,
                                fontStyle: "italic",
                              }}
                            >
                              No {workType === "lathe" ? "lathe" : "CNC"} in this vendor&apos;s fleet
                            </div>
                          )}
                          {isRecommended && (
                            <div
                              style={{
                                fontSize: 10,
                                color: "#15803d",
                                marginTop: 4,
                                fontWeight: 600,
                              }}
                            >
                              {recommendation.reason}
                            </div>
                          )}
                        </div>
                      </label>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Cockpit panel — only renders for the picked CNC
                vendor. Made bigger + more prominent per Daksh: this
                is where the carving head reads the live state
                before committing. Headline shows stock pending +
                free/busy counts; grid shows every machine. */}
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
                {/* Live stats — stock pending + free/busy/maintenance.
                    Same numbers the actual /vendor cockpit shows, in
                    a tighter row. */}
                {(() => {
                  const br = vendorTypeBreakdown(selectedVendor);
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
                  const br = vendorTypeBreakdown(selectedVendor);
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
                      No free {workType === "lathe" ? "lathe" : "CNC"} machines right
                      now at {selectedVendor.name}. The slab will go into stock
                      pending and load when one frees up.
                    </div>
                  );
                })()}
              </div>
            )}

            {/* Manual-vendor empty-state panel */}
            {selectedVendor && isManual && (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 6,
                  padding: 12,
                  background: "rgba(180,115,51,0.06)",
                  border: "1px dashed rgba(180,115,51,0.3)",
                  borderRadius: 8,
                }}
              >
                <div
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    color: "var(--muted)",
                    textTransform: "uppercase",
                    letterSpacing: "0.06em",
                  }}
                >
                  Manual vendor — no machines tracked
                </div>
                <div style={{ fontSize: 12, color: "var(--text)", lineHeight: 1.45 }}>
                  Manual carvers don&apos;t use the system. After assigning,
                  the carving head will fire <strong>▶ Mark started</strong>{" "}
                  and <strong>🎯 Mark complete</strong> on their behalf from
                  the job detail page.
                </div>
              </div>
            )}

            {/* Urgency picker */}
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

            {/* Estimated time — days + hours */}
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
                {isManual
                  ? "Manual carvers don't update the system; this is your guess for tracking."
                  : "The vendor will set a tighter estimate when they load the slab. Leave 0 if unsure."}
              </span>
            </div>

            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <Label>Note (optional)</Label>
              <textarea
                name="note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={3}
                placeholder="Design details, urgency reason, anything the vendor should know"
                style={{ padding: "8px 12px", fontSize: 13, border: "1px solid var(--border)", borderRadius: 6, background: "var(--bg)", color: "var(--text)", resize: "vertical", fontFamily: "inherit" }}
              />
            </label>

            <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
              <button
                type="submit"
                className="primary-button"
                disabled={!vendorId}
                style={{ flex: 1 }}
              >
                Assign &amp; queue
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

// Compact stat tile for the cockpit panel — used to show stock
// pending count + free / carving / down counts inline.
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

// Section header that visually partitions CNC and Manual vendors in
// the picker. The Manual header uses an amber accent + thin top-rule
// so the divide between the two vendor types is unmistakable.
function SectionHeader({
  label,
  hint,
  accent,
  topMargin,
}: {
  label: string;
  hint?: string;
  accent?: string;
  topMargin?: number;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "baseline",
        gap: 8,
        marginTop: topMargin ?? 0,
        paddingTop: topMargin && topMargin > 0 ? 10 : 0,
        borderTop: topMargin && topMargin > 0 ? "1px dashed var(--border)" : "none",
      }}
    >
      <span
        style={{
          fontSize: 11,
          fontWeight: 800,
          letterSpacing: "0.07em",
          color: accent ?? "var(--gold-dark)",
          textTransform: "uppercase",
        }}
      >
        {label}
      </span>
      {hint && (
        <span style={{ fontSize: 10, color: "var(--muted-light)" }}>{hint}</span>
      )}
    </div>
  );
}
