"use client";

/**
 * Phase 4 carving-job control bar — receipt / tag / transfer / manual.
 *
 * Three pieces of interactive UI for the job detail page:
 *
 * 1. Tag work type — small inline editor for the carving head to
 *    re-tag a job's requires_machine_type after the initial assign
 *    (e.g. realised mid-flight that the design needs a lathe).
 *
 * 2. Transfer to another vendor — a center-peek modal that switches
 *    the vendor on a carving_items row. Auto-unloads the current
 *    machine if the job was already loaded.
 *
 * 3. Receipt acknowledge button — green ✅ for CNC jobs that haven't
 *    yet been received at the vendor's shade.
 *
 * Manual-vendor action panel — Mark started / Mark complete — is
 * rendered as plain server-side forms in the detail page itself
 * (no client state needed), so it doesn't live here.
 *
 * Marked "use client" because the transfer modal manages local state
 * (which vendor is picked, the reason text) and inline event
 * handlers — adding those to a server component would crash the page
 * (we've been bitten by that before).
 */

import { useEffect, useRef, useState } from "react";
import {
  acknowledgeReceiptAction,
  transferCarvingJobAction,
  updateRequiresMachineTypeAction,
  updateCarvingSidesAction,
} from "../actions";

type Vendor = { id: string; name: string; vendor_type: string };

export function CarvingJobControls({
  jobId,
  currentVendorId,
  currentVendorName,
  vendorType,
  status,
  cncMachineId,
  requiresMachineType,
  carvingSides,
  receivedAtVendorAt,
  vendors,
  canManage,
}: {
  jobId: string;
  currentVendorId: string;
  currentVendorName: string;
  vendorType: string;
  status: string;
  cncMachineId: string | null;
  requiresMachineType: string | null;
  /** Mig 088 — current carved sides (1 or 2). */
  carvingSides: number;
  receivedAtVendorAt: string | null;
  vendors: Vendor[];
  /** True for carving_head / owner / developer. Hides the controls
   *  from the few non-management roles that might land on this page. */
  canManage: boolean;
}) {
  const [transferOpen, setTransferOpen] = useState(false);
  const [tagEditing, setTagEditing] = useState(false);
  const [sidesEditing, setSidesEditing] = useState(false);

  const isCnc = vendorType === "CNC";
  const isLockedDone = ["completed", "dispatched", "rejected"].includes(status);
  // Mig 088 — sides editable while in the active loop or just approved
  // (matches updateCarvingSidesAction's allowed states).
  const canShowSidesEditor =
    canManage &&
    ["carving_assigned", "carving_in_progress", "carving_on_hold", "completed"].includes(status);
  const canShowReceipt =
    canManage && isCnc && status === "carving_assigned" && !receivedAtVendorAt;
  // Daksh June 2026 — work-type (Flat panel / Lathe) routing is disabled.
  // Loading is no longer gated by work type (a slab can go on any
  // machine — CNC or lathe), so the per-job "Re-tag work type" control is
  // hidden. The editor JSX is kept below (just gated off) so it can be
  // restored by putting the role/status condition back here:
  //   canManage && isCnc && (status === "carving_assigned" ||
  //   status === "carving_in_progress") && !cncMachineId
  const canShowTagEditor = false;
  // Mig 098 — Outsource has no transfer-between-vendors flow on this page;
  // owner recalls from the Work Orders page instead. CNC keeps transfer.
  const canShowTransfer = canManage && !isLockedDone && vendorType !== "Outsource";

  if (!canManage) return null;

  return (
    <>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {/* Receipt acknowledgement (CNC only, before load) */}
        {canShowReceipt && (
          <form action={acknowledgeReceiptAction}>
            <input type="hidden" name="carving_item_id" value={jobId} />
            <input type="hidden" name="redirect_to" value={`/carving/${jobId}`} />
            <button
              type="submit"
              className="primary-button"
              style={{
                fontSize: 13,
                padding: "10px 16px",
                fontWeight: 700,
                background: "#16a34a",
                width: "100%",
              }}
            >
              ✅ Mark received at {currentVendorName}
            </button>
          </form>
        )}

        {/* Work-type re-tag (CNC only, while not loaded) */}
        {canShowTagEditor && (
          <div
            style={{
              padding: "10px 12px",
              background: "var(--surface-alt)",
              border: "1px dashed var(--border)",
              borderRadius: 8,
            }}
          >
            {!tagEditing ? (
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                <div style={{ fontSize: 12, color: "var(--muted)" }}>
                  Work type:{" "}
                  <strong style={{ color: requiresMachineType === "lathe" ? "#7c3aed" : "var(--text)" }}>
                    {requiresMachineType === "lathe" ? "🌀 Lathe (cylindrical)" : "📐 Flat panel"}
                  </strong>
                </div>
                <button
                  type="button"
                  className="ghost-button"
                  style={{ fontSize: 11, padding: "4px 10px" }}
                  onClick={() => setTagEditing(true)}
                >
                  Re-tag
                </button>
              </div>
            ) : (
              <form action={updateRequiresMachineTypeAction} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <input type="hidden" name="carving_item_id" value={jobId} />
                <input type="hidden" name="redirect_to" value={`/carving/${jobId}`} />
                <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <span style={{ fontSize: 10, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                    New work type
                  </span>
                  <select
                    name="requires_machine_type"
                    defaultValue={requiresMachineType ?? ""}
                    style={{ fontSize: 12, padding: "6px 10px", border: "1px solid var(--border)", borderRadius: 6, background: "var(--bg)", color: "var(--text)" }}
                  >
                    <option value="">📐 Flat panel (default)</option>
                    <option value="lathe">🌀 Lathe (cylindrical)</option>
                  </select>
                </label>
                <div style={{ display: "flex", gap: 6 }}>
                  <button type="submit" className="primary-button" style={{ fontSize: 12, padding: "6px 14px", flex: 1 }}>
                    Save
                  </button>
                  <button type="button" className="ghost-button" style={{ fontSize: 12, padding: "6px 14px" }} onClick={() => setTagEditing(false)}>
                    Cancel
                  </button>
                </div>
              </form>
            )}
          </div>
        )}

        {/* Mig 088 — carved sides editor (1 ↔ 2). Staff fallback to fix
            a wrong single/double choice; output counts ×2 for 2 sides. */}
        {canShowSidesEditor && (
          <div
            style={{
              padding: "10px 12px",
              background: "var(--surface-alt)",
              border: "1px dashed var(--border)",
              borderRadius: 8,
            }}
          >
            {!sidesEditing ? (
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                <div style={{ fontSize: 12, color: "var(--muted)" }}>
                  Carved sides:{" "}
                  <strong style={{ color: carvingSides === 2 ? "#0f766e" : "var(--text)" }}>
                    {carvingSides === 2 ? "2 sides (×2 output)" : "1 side"}
                  </strong>
                </div>
                <button
                  type="button"
                  className="ghost-button"
                  style={{ fontSize: 11, padding: "4px 10px" }}
                  onClick={() => setSidesEditing(true)}
                >
                  Change
                </button>
              </div>
            ) : (
              <form action={updateCarvingSidesAction} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <input type="hidden" name="carving_item_id" value={jobId} />
                <input type="hidden" name="redirect_to" value={`/carving/${jobId}`} />
                <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <span style={{ fontSize: 10, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                    Carved sides
                  </span>
                  <select
                    name="carving_sides"
                    defaultValue={carvingSides === 2 ? "2" : "1"}
                    style={{ fontSize: 12, padding: "6px 10px", border: "1px solid var(--border)", borderRadius: 6, background: "var(--bg)", color: "var(--text)" }}
                  >
                    <option value="1">1 side</option>
                    <option value="2">2 sides (×2 output)</option>
                  </select>
                </label>
                <div style={{ display: "flex", gap: 6 }}>
                  <button type="submit" className="primary-button" style={{ fontSize: 12, padding: "6px 14px", flex: 1 }}>
                    Save
                  </button>
                  <button type="button" className="ghost-button" style={{ fontSize: 12, padding: "6px 14px" }} onClick={() => setSidesEditing(false)}>
                    Cancel
                  </button>
                </div>
              </form>
            )}
          </div>
        )}

        {/* Transfer button */}
        {canShowTransfer && (
          <button
            type="button"
            className="ghost-button"
            style={{ fontSize: 12, padding: "8px 12px", textAlign: "left" }}
            onClick={() => setTransferOpen(true)}
          >
            ↔ Transfer to another vendor
          </button>
        )}
      </div>

      {transferOpen && (
        <TransferModal
          jobId={jobId}
          currentVendorId={currentVendorId}
          currentVendorName={currentVendorName}
          cncMachineLoaded={!!cncMachineId}
          vendors={vendors.filter((v) => v.id !== currentVendorId)}
          onClose={() => setTransferOpen(false)}
        />
      )}
    </>
  );
}

function TransferModal({
  jobId,
  currentVendorId: _currentVendorId,
  currentVendorName,
  cncMachineLoaded,
  vendors,
  onClose,
}: {
  jobId: string;
  currentVendorId: string;
  currentVendorName: string;
  cncMachineLoaded: boolean;
  vendors: Vendor[];
  onClose: () => void;
}) {
  const [newVendorId, setNewVendorId] = useState("");
  const [reason, setReason] = useState("");
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

  const canSubmit = !!newVendorId && reason.trim().length >= 8;

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
        paddingTop: "8vh",
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
          maxWidth: 540,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
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
            <h2 style={{ margin: 0, fontSize: 16 }}>Transfer to another vendor</h2>
            <p className="muted" style={{ fontSize: 12, margin: "4px 0 0" }}>
              Currently with <strong>{currentVendorName}</strong>
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{ fontSize: 18, border: "none", background: "transparent", cursor: "pointer", color: "var(--muted)", padding: 4 }}
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <form action={transferCarvingJobAction} style={{ padding: 18, display: "flex", flexDirection: "column", gap: 14 }}>
          <input type="hidden" name="carving_item_id" value={jobId} />
          <input type="hidden" name="redirect_to" value={`/carving/${jobId}`} />

          {cncMachineLoaded && (
            <div
              style={{
                fontSize: 12,
                color: "#92400e",
                background: "rgba(180,115,51,0.08)",
                border: "1px solid rgba(180,115,51,0.3)",
                borderRadius: 6,
                padding: "8px 12px",
              }}
            >
              ⚠ This slab is currently loaded on a CNC machine. The transfer
              will <strong>auto-unload</strong> it from the current machine.
              The receiving vendor will need to load it again on one of theirs.
            </div>
          )}

          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
              New vendor
            </span>
            <select
              name="new_vendor_id"
              value={newVendorId}
              onChange={(e) => setNewVendorId(e.target.value)}
              required
              style={{ fontSize: 13, padding: "8px 12px", border: "1px solid var(--border)", borderRadius: 6, background: "var(--bg)", color: "var(--text)" }}
            >
              <option value="">Pick a vendor…</option>
              {vendors.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name} ({v.vendor_type})
                </option>
              ))}
            </select>
          </label>

          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
              Reason (required, min 8 chars)
            </span>
            <textarea
              name="reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}

              style={{ padding: "8px 12px", fontSize: 13, border: "1px solid var(--border)", borderRadius: 6, background: "var(--bg)", color: "var(--text)", resize: "vertical", fontFamily: "inherit" }}
            />
            <span style={{ fontSize: 10, color: "var(--muted-light)" }}>
              Logged on the job event timeline for the audit trail.
            </span>
          </label>

          <div style={{ display: "flex", gap: 8 }}>
            <button type="submit" className="primary-button" disabled={!canSubmit} style={{ flex: 1 }}>
              Transfer →
            </button>
            <button type="button" className="ghost-button" onClick={onClose}>
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
