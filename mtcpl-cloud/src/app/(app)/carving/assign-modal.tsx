"use client";

/**
 * Assign-to-vendor — Phase 3 (CNC ops), center-peek dialog.
 *
 * Carving head:
 *   1. Picks a CNC vendor from the live list (each row shows
 *      "X/Y free · Z queued").
 *   2. After picking, sees a grid of THAT vendor's machines colour-
 *      coded by status — gives them an at-a-glance read on which
 *      machines will pick this slab up vs whether it'll go to a
 *      queue. (They don't pick the machine; the vendor does.)
 *   3. Marks urgency, optionally enters a rough estimated time
 *      (days + hours since carving runs span hours to multi-day).
 *
 * Renders as a center-peek modal (matches the dashboard ID-lookup +
 * settings PeekSection style) — feels native on big monitors and
 * fits on tablets that the carving head walks around with.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { assignCarvingJobAction } from "./actions";

type Machine = {
  id: string;
  machine_code: string;
  status: "idle" | "carving" | "maintenance" | "inactive";
  /** Migration 021: 'single_head' | 'multi_head_2' | 'lathe'. Decides
   *  the small type pill on each machine tile in the picker. */
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

const MACHINE_TINT: Record<Machine["status"], { bg: string; border: string; fg: string; label: string }> = {
  idle: { bg: "rgba(22,163,74,0.1)", border: "rgba(22,163,74,0.4)", fg: "#15803d", label: "FREE" },
  carving: { bg: "rgba(37,99,235,0.08)", border: "rgba(37,99,235,0.4)", fg: "#1d4ed8", label: "CARVING" },
  maintenance: { bg: "rgba(220,38,38,0.08)", border: "rgba(220,38,38,0.4)", fg: "#b91c1c", label: "MAINT" },
  inactive: { bg: "var(--surface-alt)", border: "var(--border)", fg: "var(--muted)", label: "OFF" },
};

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

  // Sort vendors so ones with idle capacity bubble to the top —
  // carving head can scan and grab a free vendor fast.
  const sortedVendors = useMemo(() => {
    return [...vendors].sort((a, b) => {
      const aFree = a.live?.free ?? 0;
      const bFree = b.live?.free ?? 0;
      if (aFree !== bFree) return bFree - aFree;
      const aQ = a.live?.queued ?? 0;
      const bQ = b.live?.queued ?? 0;
      if (aQ !== bQ) return aQ - bQ;
      return a.name.localeCompare(b.name);
    });
  }, [vendors]);

  // Compute total minutes from days + hours inputs.
  // Note: `name="estimated_minutes"` on a hidden input feeds the
  // server action — that field continues to take minutes so the DB
  // stores a single normalised unit.
  const totalMinutes = (Number(days) || 0) * 60 * 24 + (Number(hours) || 0) * 60;

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

            {/* Vendor list */}
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <Label>CNC vendor</Label>
              {sortedVendors.length === 0 ? (
                <div className="muted" style={{ padding: 12, fontSize: 13 }}>
                  No active CNC vendors. Add one in <strong>Manage Vendors</strong>.
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {sortedVendors.map((v) => {
                    const live = v.live;
                    const free = live?.free ?? 0;
                    const total = live?.total ?? 0;
                    const queued = live?.queued ?? 0;
                    const busy = live?.busy ?? 0;
                    const maint = live?.maintenance ?? 0;
                    const isSelected = v.id === vendorId;
                    const hasFree = free > 0;
                    return (
                      <label
                        key={v.id}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          gap: 10,
                          padding: "10px 12px",
                          background: isSelected ? "rgba(180,115,51,0.08)" : "var(--surface)",
                          border: `1.5px solid ${isSelected ? "var(--gold-dark)" : "var(--border)"}`,
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
                          </div>
                          <div
                            style={{
                              fontSize: 11,
                              color: "var(--muted)",
                              fontFamily: "ui-monospace, monospace",
                              marginTop: 2,
                            }}
                          >
                            {total} machine{total !== 1 ? "s" : ""}
                            {busy > 0 && ` · ${busy} carving`}
                            {maint > 0 && ` · ${maint} maint`}
                            {queued > 0 && ` · ${queued} in queue`}
                          </div>
                        </div>
                        <div
                          style={{
                            padding: "4px 10px",
                            borderRadius: 999,
                            background: hasFree
                              ? "rgba(22,163,74,0.12)"
                              : "rgba(217,119,6,0.12)",
                            color: hasFree ? "#15803d" : "#b45309",
                            fontWeight: 700,
                            fontSize: 12,
                            fontFamily: "ui-monospace, monospace",
                            whiteSpace: "nowrap",
                            flexShrink: 0,
                          }}
                        >
                          {free}/{total} free
                        </div>
                      </label>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Per-machine breakdown for the selected vendor */}
            {selectedVendor && (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 8,
                  padding: 10,
                  background: "var(--surface-alt)",
                  border: "1px dashed var(--border)",
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
                  {selectedVendor.name}&apos;s machines
                </div>
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
                      return (
                        <div
                          key={m.id}
                          style={{
                            padding: "6px 10px",
                            background: tint.bg,
                            border: `1.5px solid ${tint.border}`,
                            borderRadius: 6,
                            fontFamily: "ui-monospace, monospace",
                            display: "flex",
                            flexDirection: "column",
                            alignItems: "flex-start",
                            gap: 2,
                          }}
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
                {(selectedVendor.live?.free ?? 0) === 0 && (
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
                    All of {selectedVendor.name}&apos;s machines are busy or in
                    maintenance. The slab will go to their queue and load when
                    a machine frees up.
                  </div>
                )}
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
                The vendor will set a tighter estimate when they actually load
                the slab onto a machine. Leave 0 if unsure.
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
