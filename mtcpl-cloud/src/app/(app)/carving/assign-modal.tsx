"use client";

import { useState } from "react";
import { assignCarvingJobAction } from "./actions";

type Vendor = {
  id: string;
  name: string;
  vendor_type: "CNC" | "Manual";
  machines?: Array<{ id: string; machine_code: string }>;
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
  const [machineId, setMachineId] = useState<string>("");
  const [deadlineDays, setDeadlineDays] = useState(7);
  const [note, setNote] = useState("");

  const selectedVendor = vendors.find((v) => v.id === vendorId);
  const showMachinePicker = selectedVendor?.vendor_type === "CNC" && (selectedVendor.machines?.length ?? 0) > 0;

  return (
    <>
      <div className="drawer-backdrop" onClick={onClose} />
      <div className="edit-drawer" style={{ maxWidth: 460 }}>
        <div className="drawer-header">
          <div>
            <div className="drawer-title">Assign to Vendor</div>
            <code className="drawer-subtitle">{slab.id}</code>
            <p className="muted" style={{ margin: "4px 0 0", fontSize: 12 }}>
              {slab.temple} · {slab.label} · {slab.length_ft}×{slab.width_ft}×{slab.thickness_ft}&Prime;
            </p>
          </div>
          <button className="drawer-close" onClick={onClose}>✕</button>
        </div>

        <div className="drawer-body">
          <form action={assignCarvingJobAction} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <input type="hidden" name="slab_id" value={slab.id} />

            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                Vendor
              </span>
              <select
                name="vendor_id"
                value={vendorId}
                onChange={(e) => { setVendorId(e.target.value); setMachineId(""); }}
                required
                style={{ padding: "8px 12px", fontSize: 13, border: "1px solid var(--border)", borderRadius: 6, background: "var(--bg)", color: "var(--text)" }}
              >
                <option value="">— pick a vendor —</option>
                {vendors.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name} ({v.vendor_type})
                  </option>
                ))}
              </select>
            </label>

            {showMachinePicker && (
              <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                  CNC Machine (optional)
                </span>
                <select
                  name="cnc_machine_id"
                  value={machineId}
                  onChange={(e) => setMachineId(e.target.value)}
                  style={{ padding: "8px 12px", fontSize: 13, border: "1px solid var(--border)", borderRadius: 6, background: "var(--bg)", color: "var(--text)" }}
                >
                  <option value="">— vendor allocates internally —</option>
                  {selectedVendor!.machines!.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.machine_code}
                    </option>
                  ))}
                </select>
              </label>
            )}

            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                Deadline
              </span>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input
                  type="number"
                  name="deadline_days"
                  min="1"
                  max="90"
                  value={deadlineDays}
                  onChange={(e) => setDeadlineDays(Number(e.target.value))}
                  style={{ width: 80, padding: "8px 12px", fontSize: 13, border: "1px solid var(--border)", borderRadius: 6, background: "var(--bg)", color: "var(--text)" }}
                />
                <span className="muted" style={{ fontSize: 12 }}>
                  days from today ·{" "}
                  {new Date(Date.now() + deadlineDays * 24 * 3600 * 1000).toLocaleDateString("en-IN", {
                    day: "numeric", month: "short", year: "numeric",
                  })}
                </span>
              </div>
            </label>

            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                Note (optional)
              </span>
              <textarea
                name="note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={3}
                placeholder="Design details, urgency, anything the vendor should know"
                style={{ padding: "8px 12px", fontSize: 13, border: "1px solid var(--border)", borderRadius: 6, background: "var(--bg)", color: "var(--text)", resize: "vertical", fontFamily: "inherit" }}
              />
            </label>

            <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
              <button type="submit" className="primary-button" disabled={!vendorId} style={{ flex: 1 }}>
                Assign Job
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
