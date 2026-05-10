"use client";

/**
 * Assign-to-vendor modal — Phase 3 (CNC ops).
 *
 * Carving head picks a CNC vendor from the live list (each row shows
 * "X/Y free · Z queued"), marks urgency, optionally enters a rough
 * estimated time. Machine selection is NOT here — the vendor (CNC
 * supervisor) decides which machine to load it on later. If all the
 * vendor's machines are busy, the slab still goes to that vendor's
 * queue and gets loaded as machines free up.
 */

import { useMemo, useState } from "react";
import { assignCarvingJobAction } from "./actions";

type Vendor = {
  id: string;
  name: string;
  vendor_type: "CNC" | "Manual";
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
  label: string;
  temple: string;
  stone: string | null;
  length_ft: number;
  width_ft: number;
  thickness_ft: number;
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
  const [hours, setHours] = useState<string>("");
  const [minutes, setMinutes] = useState<string>("");
  const [note, setNote] = useState("");

  const selectedVendor = vendors.find((v) => v.id === vendorId);

  // Sort vendors so ones with idle capacity bubble to the top —
  // carving head can scan the list and grab a free vendor fast.
  const sortedVendors = useMemo(() => {
    return [...vendors].sort((a, b) => {
      const aFree = a.live?.free ?? 0;
      const bFree = b.live?.free ?? 0;
      if (aFree !== bFree) return bFree - aFree;
      // Then by queue depth ascending (less backlog = better choice)
      const aQ = a.live?.queued ?? 0;
      const bQ = b.live?.queued ?? 0;
      if (aQ !== bQ) return aQ - bQ;
      return a.name.localeCompare(b.name);
    });
  }, [vendors]);

  const totalMinutes = (Number(hours) || 0) * 60 + (Number(minutes) || 0);

  return (
    <>
      <div className="drawer-backdrop" onClick={onClose} />
      <div className="edit-drawer" style={{ maxWidth: 520 }}>
        <div className="drawer-header">
          <div>
            <div className="drawer-title">Assign carving job</div>
            <code className="drawer-subtitle">{slab.id}</code>
            <p className="muted" style={{ margin: "4px 0 0", fontSize: 12 }}>
              {slab.temple} · {slab.label} · {slab.length_ft}×{slab.width_ft}×{slab.thickness_ft}&Prime;
            </p>
          </div>
          <button className="drawer-close" onClick={onClose}>✕</button>
        </div>

        <div className="drawer-body">
          <form action={assignCarvingJobAction} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <input type="hidden" name="slab_id" value={slab.id} />

            {/* Vendor picker — list of cards, each shows live capacity */}
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                CNC vendor
              </span>
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
              {selectedVendor && (selectedVendor.live?.free ?? 0) === 0 && (
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
                  maintenance. The slab will go to their queue and load when a
                  machine frees up.
                </div>
              )}
            </div>

            {/* Urgency picker */}
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                Urgency
              </span>
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

            {/* Estimated time — rough idea from carving head */}
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                Rough estimated time (carving head&apos;s guess)
              </span>
              <input type="hidden" name="estimated_minutes" value={totalMinutes || ""} />
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input
                  type="number"
                  min="0"
                  max="200"
                  value={hours}
                  onChange={(e) => setHours(e.target.value)}
                  placeholder="0"
                  style={{ width: 80, padding: "8px 10px", fontSize: 13, border: "1px solid var(--border)", borderRadius: 6, background: "var(--bg)", color: "var(--text)" }}
                />
                <span style={{ fontSize: 12, color: "var(--muted)" }}>hours</span>
                <input
                  type="number"
                  min="0"
                  max="59"
                  value={minutes}
                  onChange={(e) => setMinutes(e.target.value)}
                  placeholder="0"
                  style={{ width: 80, padding: "8px 10px", fontSize: 13, border: "1px solid var(--border)", borderRadius: 6, background: "var(--bg)", color: "var(--text)" }}
                />
                <span style={{ fontSize: 12, color: "var(--muted)" }}>min</span>
              </div>
              <span style={{ fontSize: 11, color: "var(--muted-light)" }}>
                The vendor will set a tighter estimate when they actually load
                the slab onto a machine. Leave 0 if unsure.
              </span>
            </div>

            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                Note (optional)
              </span>
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
    </>
  );
}
