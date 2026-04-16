"use client";

import { useState } from "react";
import { createVendorAction, updateVendorAction } from "../actions";

type Machine = {
  id?: string;
  machine_code: string;
  operator_name?: string;
  is_active?: boolean;
  _delete?: boolean;
};

export function VendorForm({
  initial,
  onCancel,
}: {
  initial?: {
    id?: string;
    name?: string;
    vendor_type?: "CNC" | "Manual" | "Outsource";
    is_active?: boolean;
    machines?: Machine[];
  };
  onCancel?: () => void;
}) {
  const editing = !!initial?.id;
  const [name, setName] = useState(initial?.name ?? "");
  const [vendorType, setVendorType] = useState<"CNC" | "Manual" | "Outsource">(initial?.vendor_type ?? "Manual");
  const [isActive, setIsActive] = useState(initial?.is_active ?? true);
  const [machines, setMachines] = useState<Machine[]>(initial?.machines ?? []);

  function addMachine() {
    setMachines((prev) => [...prev, { machine_code: "", operator_name: "", is_active: true }]);
  }

  function updateMachine(idx: number, patch: Partial<Machine>) {
    setMachines((prev) => prev.map((m, i) => (i === idx ? { ...m, ...patch } : m)));
  }

  function removeMachine(idx: number) {
    setMachines((prev) => {
      const m = prev[idx];
      if (m.id) {
        // Existing machine: mark for deletion, don't remove from array
        return prev.map((item, i) => (i === idx ? { ...item, _delete: true } : item));
      }
      // New unsaved machine: just remove
      return prev.filter((_, i) => i !== idx);
    });
  }

  const visibleMachines = machines.filter((m) => !m._delete);

  return (
    <form action={editing ? updateVendorAction : createVendorAction} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {editing && <input type="hidden" name="vendor_id" value={initial?.id} />}
      <input type="hidden" name="machines_json" value={JSON.stringify(machines)} />

      <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
          Vendor name
        </span>
        <input
          type="text"
          name="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          placeholder="e.g. Mohit Carving Works"
          style={{ padding: "8px 12px", fontSize: 13, border: "1px solid var(--border)", borderRadius: 6, background: "var(--bg)", color: "var(--text)" }}
        />
      </label>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
            Type
          </span>
          <select
            name="vendor_type"
            value={vendorType}
            onChange={(e) => setVendorType(e.target.value as "CNC" | "Manual" | "Outsource")}
            style={{ padding: "8px 12px", fontSize: 13, border: "1px solid var(--border)", borderRadius: 6, background: "var(--bg)", color: "var(--text)" }}
          >
            <option value="Manual">Manual (in-house carver)</option>
            <option value="CNC">CNC (machine operator)</option>
            <option value="Outsource">Outsource / Jobwork</option>
          </select>
        </label>

        {editing && (
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
              Status
            </span>
            <select
              name="is_active"
              value={String(isActive)}
              onChange={(e) => setIsActive(e.target.value === "true")}
              style={{ padding: "8px 12px", fontSize: 13, border: "1px solid var(--border)", borderRadius: 6, background: "var(--bg)", color: "var(--text)" }}
            >
              <option value="true">Active</option>
              <option value="false">Inactive</option>
            </select>
          </label>
        )}
      </div>

      {/* CNC machine sub-form */}
      {vendorType === "CNC" && (
        <div style={{ background: "var(--surface-alt)", border: "1px solid var(--border)", borderRadius: 8, padding: "12px 14px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text)" }}>
                CNC Machines ({visibleMachines.length})
              </div>
              <div style={{ fontSize: 11, color: "var(--muted)" }}>
                Register each CNC machine under this vendor
              </div>
            </div>
            <button
              type="button"
              onClick={addMachine}
              style={{
                fontSize: 12, fontWeight: 700, padding: "5px 12px",
                border: "1px solid var(--border)", borderRadius: 6,
                background: "var(--bg)", color: "var(--gold-dark)", cursor: "pointer",
              }}
            >
              + Add machine
            </button>
          </div>

          {visibleMachines.length === 0 ? (
            <div style={{ fontSize: 11, color: "var(--muted-light)", padding: "8px 0" }}>
              No machines yet — click &ldquo;+ Add machine&rdquo; to register one.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {machines.map((m, idx) => {
                if (m._delete) return null;
                return (
                  <div key={idx} style={{ display: "flex", alignItems: "flex-end", gap: 8, padding: "8px 10px", background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 6 }}>
                    <label style={{ display: "flex", flexDirection: "column", gap: 3, flex: "0 0 140px" }}>
                      <span style={{ fontSize: 10, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Machine code</span>
                      <input
                        type="text"
                        placeholder="e.g. CNC-01"
                        value={m.machine_code}
                        onChange={(e) => updateMachine(idx, { machine_code: e.target.value })}
                        style={{ fontSize: 12, padding: "5px 9px", border: "1px solid var(--border)", borderRadius: 5, background: "var(--surface)", color: "var(--text)", width: "100%" }}
                      />
                    </label>
                    <label style={{ display: "flex", flexDirection: "column", gap: 3, flex: 1 }}>
                      <span style={{ fontSize: 10, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Operator <span style={{ fontWeight: 400 }}>(optional)</span></span>
                      <input
                        type="text"
                        placeholder="Operator name"
                        value={m.operator_name ?? ""}
                        onChange={(e) => updateMachine(idx, { operator_name: e.target.value })}
                        style={{ fontSize: 12, padding: "5px 9px", border: "1px solid var(--border)", borderRadius: 5, background: "var(--surface)", color: "var(--text)", width: "100%" }}
                      />
                    </label>
                    <label style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                      <span style={{ fontSize: 10, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Status</span>
                      <select
                        value={String(m.is_active ?? true)}
                        onChange={(e) => updateMachine(idx, { is_active: e.target.value === "true" })}
                        style={{ fontSize: 12, padding: "5px 7px", border: "1px solid var(--border)", borderRadius: 5, background: "var(--surface)", color: "var(--text)" }}
                      >
                        <option value="true">Active</option>
                        <option value="false">Inactive</option>
                      </select>
                    </label>
                    <button
                      type="button"
                      onClick={() => removeMachine(idx)}
                      style={{ fontSize: 13, padding: "5px 10px", border: "1px solid #fca5a5", borderRadius: 5, background: "#fef2f2", color: "#dc2626", cursor: "pointer", marginBottom: 1 }}
                    >
                      ×
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      <div style={{ display: "flex", gap: 8 }}>
        <button
          type="submit"
          className="primary-button"
          style={{ flex: 1 }}
        >
          {editing ? "Save changes" : "Create vendor"}
        </button>
        {onCancel && (
          <button type="button" className="ghost-button" onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}
