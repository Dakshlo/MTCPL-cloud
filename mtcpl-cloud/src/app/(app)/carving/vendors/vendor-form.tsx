"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";
import { createVendorAction, updateVendorAction } from "../actions";

// Daksh (June 2026) — Save button with a live "Saving…" spinner.
// useFormStatus must be called from a child of the <form>, so this
// lives as its own component rendered inside VendorForm's form. The
// spinner keyframe (mtcpl-spin) is injected once near the top of the
// form below.
function SaveButton({ editing }: { editing: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      className="primary-button"
      disabled={pending}
      style={{
        flex: 1,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        opacity: pending ? 0.9 : 1,
        cursor: pending ? "wait" : "pointer",
      }}
    >
      {pending && (
        <span
          aria-hidden
          style={{
            width: 15,
            height: 15,
            borderRadius: "50%",
            border: "2px solid rgba(255,255,255,0.45)",
            borderTopColor: "#fff",
            display: "inline-block",
            animation: "mtcpl-spin 0.7s linear infinite",
          }}
        />
      )}
      {pending ? "Saving…" : editing ? "Save changes" : "Create vendor"}
    </button>
  );
}

type MachineType = "single_head" | "multi_head_2" | "lathe";

type CncAxes = 3 | 4 | 5;

type Machine = {
  id?: string;
  machine_code: string;
  operator_name?: string;
  is_active?: boolean;
  /** Migration 021 — single_head (legacy, no live machine uses it),
   *  multi_head_2 (couples two heads on identical slabs — DEFAULT),
   *  or lathe (turning machines for cylindrical work). */
  machine_type?: MachineType;
  /** Migration 079 — CNC axis subtype: 3-axis (default), 4-axis,
   *  or 5-axis. Stays NULL for Lathe (axis count doesn't apply).
   *  All three CNC axis counts share the multi_head_2 pairing
   *  logic — they're all 2-head, the cnc_axes column is just a
   *  capability facet that gates which slabs land on which
   *  machine at load time. */
  cnc_axes?: CncAxes | null;
  /** Migration 024 — per-machine workable-area envelope in inches.
   *  Empty / null → no limit. Slab beyond any cap can't load. */
  max_length_in?: number | string | null;
  max_width_in?: number | string | null;
  max_thickness_in?: number | string | null;
  _delete?: boolean;
};

const MACHINE_TYPE_LABEL: Record<MachineType, string> = {
  single_head: "Single head",
  multi_head_2: "2-head (mirrored)",
  lathe: "Lathe",
};

// User-selectable types in the picker. Single-head is legacy and
// not exposed — any legacy row with that value keeps it via the
// fallback rendering, but new rows default to multi_head_2.
const SELECTABLE_TYPES: MachineType[] = ["multi_head_2", "lathe"];

export function VendorForm({
  initial,
  onCancel,
}: {
  initial?: {
    id?: string;
    name?: string;
    vendor_type?: "CNC" | "Manual" | "Outsource";
    is_active?: boolean;
    /** Migration 025 — standard place to drop slabs for this CNC vendor. */
    dropoff_location?: string | null;
    machines?: Machine[];
  };
  onCancel?: () => void;
}) {
  const editing = !!initial?.id;
  const [name, setName] = useState(initial?.name ?? "");
  const [vendorType, setVendorType] = useState<"CNC" | "Manual" | "Outsource">(initial?.vendor_type ?? "Manual");
  const [isActive, setIsActive] = useState(initial?.is_active ?? true);
  const [dropoffLocation, setDropoffLocation] = useState(initial?.dropoff_location ?? "");
  const [machines, setMachines] = useState<Machine[]>(initial?.machines ?? []);

  function addMachine() {
    setMachines((prev) => [
      ...prev,
      {
        machine_code: "",
        operator_name: "",
        is_active: true,
        machine_type: "multi_head_2",
        // Mig 079 — new CNC machines default to 3-axis (the
        // overwhelming majority of the fleet). Lathes get NULL
        // automatically when their machine_type flips below.
        cnc_axes: 3,
        max_length_in: null,
        max_width_in: null,
        max_thickness_in: null,
      },
    ]);
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
      {/* Spinner keyframe for the SaveButton (Daksh). */}
      <style>{"@keyframes mtcpl-spin{to{transform:rotate(360deg)}}"}</style>
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

      {/* Slab dropoff location (CNC only) — where the transfer
          person delivers slabs for this vendor. Migration 025. */}
      {vendorType === "CNC" && (
        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
            Slab dropoff location
            <span style={{ marginLeft: 6, fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>
              (where the transfer runner drops slabs for this vendor)
            </span>
          </span>
          <input
            type="text"
            name="dropoff_location"
            value={dropoffLocation}
            onChange={(e) => setDropoffLocation(e.target.value)}

            style={{ padding: "8px 12px", fontSize: 13, border: "1px solid var(--border)", borderRadius: 6, background: "var(--bg)", color: "var(--text)" }}
          />
        </label>
      )}

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
                      <span style={{ fontSize: 10, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Type</span>
                      <select
                        value={m.machine_type ?? "multi_head_2"}
                        onChange={(e) => {
                          const nextType = e.target.value as MachineType;
                          // Mig 079 — keep cnc_axes consistent
                          // with machine_type. Flipping to lathe
                          // clears the axis count (NULL), flipping
                          // back to a CNC type re-applies 3-axis
                          // as the default.
                          const patch: Partial<Machine> = { machine_type: nextType };
                          if (nextType === "lathe") {
                            patch.cnc_axes = null;
                          } else if (m.cnc_axes == null) {
                            patch.cnc_axes = 3;
                          }
                          updateMachine(idx, patch);
                        }}
                        style={{ fontSize: 12, padding: "5px 7px", border: "1px solid var(--border)", borderRadius: 5, background: "var(--surface)", color: "var(--text)" }}
                        title="2-head: two heads on identical slabs (also runs solo with one head off). Lathe: turning machine for cylindrical work."
                      >
                        {SELECTABLE_TYPES.map((t) => (
                          <option key={t} value={t}>{MACHINE_TYPE_LABEL[t]}</option>
                        ))}
                        {/* If a legacy row has machine_type='single_head',
                            keep it visible (and selected) so saving doesn't
                            silently rewrite it. New machines default to
                            multi_head_2. */}
                        {m.machine_type === "single_head" && (
                          <option value="single_head">{MACHINE_TYPE_LABEL.single_head} (legacy)</option>
                        )}
                      </select>
                    </label>
                    {/* Mig 079 — CNC axes dropdown. Hidden when the
                        machine is a lathe (axis count doesn't
                        apply). 3-axis is the default for every
                        existing CNC; 4 and 5 are new options Daksh
                        added for the new generation machines. */}
                    {(m.machine_type ?? "multi_head_2") !== "lathe" && (
                      <label style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                        <span
                          style={{ fontSize: 10, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}
                          title="Axis count of this CNC. Slabs assigned with a specific axis requirement can only load on a matching machine."
                        >
                          Axes
                        </span>
                        <select
                          value={String(m.cnc_axes ?? 3)}
                          onChange={(e) =>
                            updateMachine(idx, { cnc_axes: Number(e.target.value) as CncAxes })
                          }
                          style={{ fontSize: 12, padding: "5px 7px", border: "1px solid var(--border)", borderRadius: 5, background: "var(--surface)", color: "var(--text)" }}
                        >
                          <option value="3">3-axis (default)</option>
                          <option value="4">4-axis</option>
                          <option value="5">5-axis</option>
                        </select>
                      </label>
                    )}
                    <label style={{ display: "flex", flexDirection: "column", gap: 3, flex: "0 0 60px" }}>
                      <span style={{ fontSize: 10, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.05em" }} title="Slab length larger than this can't fit. Leave blank for no limit.">
                        Max L ″
                      </span>
                      <input
                        type="number"
                        min="0"
                        step="0.5"
                        placeholder="—"
                        value={m.max_length_in ?? ""}
                        onChange={(e) => updateMachine(idx, { max_length_in: e.target.value === "" ? null : Number(e.target.value) })}
                        style={{ fontSize: 12, padding: "5px 7px", border: "1px solid var(--border)", borderRadius: 5, background: "var(--surface)", color: "var(--text)", width: "100%" }}
                      />
                    </label>
                    <label style={{ display: "flex", flexDirection: "column", gap: 3, flex: "0 0 60px" }}>
                      <span style={{ fontSize: 10, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.05em" }} title="Slab width larger than this can't fit. Leave blank for no limit.">
                        Max W ″
                      </span>
                      <input
                        type="number"
                        min="0"
                        step="0.5"
                        placeholder="—"
                        value={m.max_width_in ?? ""}
                        onChange={(e) => updateMachine(idx, { max_width_in: e.target.value === "" ? null : Number(e.target.value) })}
                        style={{ fontSize: 12, padding: "5px 7px", border: "1px solid var(--border)", borderRadius: 5, background: "var(--surface)", color: "var(--text)", width: "100%" }}
                      />
                    </label>
                    <label style={{ display: "flex", flexDirection: "column", gap: 3, flex: "0 0 60px" }}>
                      <span style={{ fontSize: 10, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.05em" }} title="Slab thickness larger than this can't fit (gantry clearance). Leave blank for no limit.">
                        Max T ″
                      </span>
                      <input
                        type="number"
                        min="0"
                        step="0.5"
                        placeholder="—"
                        value={m.max_thickness_in ?? ""}
                        onChange={(e) => updateMachine(idx, { max_thickness_in: e.target.value === "" ? null : Number(e.target.value) })}
                        style={{ fontSize: 12, padding: "5px 7px", border: "1px solid var(--border)", borderRadius: 5, background: "var(--surface)", color: "var(--text)", width: "100%" }}
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
                      onClick={() => {
                        // Daksh — confirm before removing a machine.
                        // Existing machines are deleted on Save; new
                        // unsaved rows vanish immediately. Cancel
                        // leaves the machine untouched.
                        const label = m.machine_code
                          ? `machine "${m.machine_code}"`
                          : "this machine";
                        if (
                          window.confirm(
                            `Remove ${label}? ${m.id ? "It will be permanently deleted when you press Save changes." : "This row will be removed."}`,
                          )
                        ) {
                          removeMachine(idx);
                        }
                      }}
                      title="Remove this machine"
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
        <SaveButton editing={editing} />
        {onCancel && (
          <button type="button" className="ghost-button" onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}
