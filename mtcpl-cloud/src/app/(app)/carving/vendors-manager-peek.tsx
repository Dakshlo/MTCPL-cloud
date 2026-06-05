"use client";

/**
 * Center-peek vendor manager surfaced from the Carving Jobs page
 * header. The carving head doesn't have to leave their working view
 * to add / rename / deactivate / delete a vendor — common ops are
 * one click away. Deeper edits (machine sub-list, etc.) still link
 * out to /carving/vendors/[id] for the full form.
 *
 * Hard delete is only allowed when a vendor has zero machines AND
 * zero carving_items referencing it; the server action falls back
 * to a soft-delete (is_active=false) otherwise so we never lose
 * history.
 */

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  createVendorAction,
  updateVendorAction,
  deactivateVendorAction,
  reactivateVendorAction,
  deleteVendorAction,
} from "./actions";

type VendorRow = {
  id: string;
  name: string;
  vendor_type: "CNC" | "Manual";
  is_active: boolean;
  machines: number;
  busy: number;
  maintenance: number;
  free: number;
  active_jobs: number;
};

export function VendorsManagerPeek({ vendors }: { vendors: VendorRow[] }) {
  const [open, setOpen] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  // Daksh June 2026 — the CNC / Manual toggle now drives BOTH which
  // type a new vendor will be AND which vendors the list shows. Press
  // "🪚 Manual" → the list filters to manual carvers.
  const [vendorType, setVendorType] = useState<"CNC" | "Manual">("CNC");
  const isManualView = vendorType === "Manual";

  // Esc closes
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // Filter by the selected type, then sort: active first, then name.
  const sorted = [...vendors]
    .filter((v) => v.vendor_type === vendorType)
    .sort((a, b) => {
      if (a.is_active !== b.is_active) return a.is_active ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

  // Button count = all active vendors across both types.
  const activeCount = vendors.filter((v) => v.is_active).length;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        style={{
          fontSize: 12,
          padding: "6px 14px",
          background: "var(--surface)",
          border: "1px solid var(--border)",
          color: "var(--gold-dark)",
          fontWeight: 600,
          borderRadius: 6,
          cursor: "pointer",
          whiteSpace: "nowrap",
        }}
      >
        👥 Manage Vendors ({activeCount})
      </button>

      {open && (
        <div
          onMouseDown={(e) => {
            if (dialogRef.current && !dialogRef.current.contains(e.target as Node)) {
              setOpen(false);
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
              maxHeight: "84vh",
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
              <div>
                <h2 style={{ margin: 0, fontSize: 17 }}>
                  👥 Manage {isManualView ? "Manual Carvers" : "CNC Vendors"}
                </h2>
                <p className="muted" style={{ fontSize: 12, margin: "4px 0 0" }}>
                  Add, rename, deactivate or delete vendors without leaving the
                  carving page. Use the <strong>CNC / Manual</strong> toggle to
                  switch the list.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
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

            {/* Body */}
            <div style={{ flex: 1, overflowY: "auto", padding: "14px 18px 18px", display: "flex", flexDirection: "column", gap: 16 }}>
              {/* Add vendor — the CNC/Manual toggle here also filters
                  the list below (lifted state). */}
              <AddVendorRow vendorType={vendorType} setVendorType={setVendorType} />

              {/* Vendor list (filtered to the selected type) */}
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <div
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    color: "var(--muted)",
                    textTransform: "uppercase",
                    letterSpacing: "0.06em",
                  }}
                >
                  {sorted.length} {isManualView ? "manual carver" : "CNC vendor"}
                  {sorted.length !== 1 ? "s" : ""}
                </div>
                {sorted.length === 0 ? (
                  <div
                    style={{
                      padding: "16px 14px",
                      textAlign: "center",
                      color: "var(--muted-light)",
                      fontSize: 12,
                      background: "var(--surface-alt)",
                      borderRadius: 8,
                    }}
                  >
                    No {isManualView ? "manual carvers" : "CNC vendors"} yet. Add
                    one above to get started.
                  </div>
                ) : (
                  sorted.map((v) => <VendorRowCard key={v.id} v={v} />)
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ── Add vendor — inline minimal form ───────────────────────────────

function AddVendorRow({
  vendorType,
  setVendorType,
}: {
  // Daksh June 2026 — state lifted to the peek so this toggle ALSO
  // filters the vendor list (press Manual → list shows manual carvers).
  vendorType: "CNC" | "Manual";
  setVendorType: (t: "CNC" | "Manual") => void;
}) {
  const [name, setName] = useState("");
  const valid = name.trim().length > 0;
  const isManual = vendorType === "Manual";
  const accent = isManual ? "#92400e" : "var(--gold-dark)";
  const bg = isManual ? "rgba(146,64,14,0.06)" : "rgba(180,115,51,0.06)";
  return (
    <form
      action={createVendorAction}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "10px 12px",
        background: bg,
        border: `1px dashed ${accent}`,
        borderRadius: 8,
        flexWrap: "wrap",
      }}
    >
      <input type="hidden" name="vendor_type" value={vendorType} />
      <input type="hidden" name="machines_json" value="[]" />
      {/* Land back on /carving after create so the new (esp. Manual)
          vendor is immediately pickable in the Assign modal. */}
      <input type="hidden" name="redirect_to" value="/carving" />
      <span
        style={{
          fontSize: 11,
          fontWeight: 700,
          color: accent,
          textTransform: "uppercase",
          letterSpacing: "0.06em",
        }}
      >
        + New {isManual ? "Manual" : "CNC"} vendor
      </span>

      {/* Type toggle — small segmented pair, defaults to CNC (most
          common). Manual hides the machine setup since manual
          carvers don't have tracked machines. */}
      <div
        role="tablist"
        style={{
          display: "inline-flex",
          border: "1px solid var(--border)",
          borderRadius: 6,
          overflow: "hidden",
          background: "var(--bg)",
        }}
      >
        {(["CNC", "Manual"] as const).map((t) => {
          const active = vendorType === t;
          const tone = t === "Manual" ? "#92400e" : "var(--gold-dark)";
          return (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setVendorType(t)}
              style={{
                padding: "5px 10px",
                fontSize: 11,
                fontWeight: 700,
                border: "none",
                cursor: "pointer",
                background: active ? tone : "transparent",
                color: active ? "#fff" : "var(--muted)",
                transition: "background 0.12s",
              }}
            >
              {t === "Manual" ? "🪚 Manual" : "🏭 CNC"}
            </button>
          );
        })}
      </div>

      <input
        type="text"
        name="name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder={isManual ? "Carver name (e.g. Sharma)" : "Vendor name (e.g. Vivek)"}
        required
        style={{
          flex: "1 1 200px",
          minWidth: 180,
          padding: "7px 10px",
          fontSize: 13,
          border: "1px solid var(--border)",
          borderRadius: 6,
          background: "var(--bg)",
          color: "var(--text)",
        }}
      />
      <button
        type="submit"
        className="primary-button"
        disabled={!valid}
        style={{ fontSize: 12, padding: "7px 14px", opacity: valid ? 1 : 0.5 }}
      >
        Create
      </button>
    </form>
  );
}

// ── Vendor row — rename inline + edit/deactivate/delete ────────────

function VendorRowCard({ v }: { v: VendorRow }) {
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(v.name);
  // Mig 081 follow-on (Daksh) — protective lock on Delete. Locks if
  // the vendor has ANY machines OR ANY active jobs (slabs currently
  // assigned). The server enforces the same gate; the UI just
  // surfaces the lock visually so the user can see why the button
  // is disabled before clicking.
  const canHardDelete = v.machines === 0 && v.active_jobs === 0;
  const lockParts: string[] = [];
  if (v.machines > 0) {
    lockParts.push(`${v.machines} machine${v.machines === 1 ? "" : "s"}`);
  }
  if (v.active_jobs > 0) {
    lockParts.push(`${v.active_jobs} active slab${v.active_jobs === 1 ? "" : "s"}`);
  }
  const lockReason = lockParts.length > 0
    ? `Locked — vendor has ${lockParts.join(" + ")}. Use Deactivate instead to keep history.`
    : null;

  return (
    <div
      style={{
        padding: "10px 12px",
        background: v.is_active ? "var(--surface)" : "var(--surface-alt)",
        border: "1px solid var(--border)",
        borderRadius: 8,
        opacity: v.is_active ? 1 : 0.7,
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      {/* Row 1: name + status + main actions */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        {renaming ? (
          // Rename form — submits the existing updateVendorAction with
          // just the name change. We pass empty machines_json so the
          // existing-machine-sync logic on the server is skipped.
          <RenameForm v={v} name={name} setName={setName} onDone={() => setRenaming(false)} />
        ) : (
          <>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  fontWeight: 700,
                  fontSize: 14,
                  color: "var(--text)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {v.name}
                {!v.is_active && (
                  <span style={{ fontSize: 10, fontWeight: 700, color: "#dc2626", marginLeft: 8 }}>
                    INACTIVE
                  </span>
                )}
              </div>
              <div
                style={{
                  fontSize: 11,
                  color: "var(--muted)",
                  fontFamily: "ui-monospace, monospace",
                  marginTop: 2,
                }}
              >
                {v.machines} machine{v.machines !== 1 ? "s" : ""}
                {v.busy > 0 && ` · ${v.busy} carving`}
                {v.maintenance > 0 && ` · ${v.maintenance} maint`}
                {v.free > 0 && ` · ${v.free} free`}
                {v.active_jobs > 0 && ` · ${v.active_jobs} active job${v.active_jobs !== 1 ? "s" : ""}`}
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                setName(v.name);
                setRenaming(true);
              }}
              className="ghost-button"
              style={{ fontSize: 11, padding: "5px 10px" }}
            >
              ✎ Rename
            </button>
            <Link
              href={`/carving/vendors/${v.id}`}
              className="ghost-button"
              style={{ fontSize: 11, padding: "5px 10px", textDecoration: "none" }}
            >
              ⚙ Machines
            </Link>
            {v.is_active ? (
              <form action={deactivateVendorAction} style={{ display: "inline" }}>
                <input type="hidden" name="vendor_id" value={v.id} />
                <input type="hidden" name="redirect_to" value="/carving" />
                <button
                  type="submit"
                  onClick={(e) => {
                    if (!confirm(`Deactivate ${v.name}? Existing jobs and machines stay intact, but they won't be assignable.`)) {
                      e.preventDefault();
                    }
                  }}
                  className="ghost-button"
                  style={{ fontSize: 11, padding: "5px 10px", color: "#b45309" }}
                >
                  ⊘ Deactivate
                </button>
              </form>
            ) : (
              <form action={reactivateVendorAction} style={{ display: "inline" }}>
                <input type="hidden" name="vendor_id" value={v.id} />
                <input type="hidden" name="redirect_to" value="/carving" />
                <button
                  type="submit"
                  className="ghost-button"
                  style={{ fontSize: 11, padding: "5px 10px", color: "#15803d" }}
                >
                  ✓ Reactivate
                </button>
              </form>
            )}
            {/* Mig 081 follow-on (Daksh) — visual lock. When the
                vendor has machines or active slabs we disable the
                button + show the lock reason on hover. Saves a
                round-trip to the server only to get the same
                "cannot delete" toast back. */}
            {canHardDelete ? (
              <form action={deleteVendorAction} style={{ display: "inline" }}>
                <input type="hidden" name="vendor_id" value={v.id} />
                <input type="hidden" name="redirect_to" value="/carving" />
                <button
                  type="submit"
                  onClick={(e) => {
                    if (
                      !confirm(
                        `Delete ${v.name} permanently? This cannot be undone.`,
                      )
                    ) {
                      e.preventDefault();
                    }
                  }}
                  className="ghost-button danger-ghost"
                  style={{ fontSize: 11, padding: "5px 10px" }}
                >
                  🗑 Delete
                </button>
              </form>
            ) : (
              <button
                type="button"
                disabled
                title={lockReason ?? "Locked"}
                aria-disabled
                style={{
                  fontSize: 11,
                  padding: "5px 10px",
                  background: "var(--surface-alt)",
                  color: "var(--muted)",
                  border: "1px solid var(--border)",
                  borderRadius: 6,
                  cursor: "not-allowed",
                  opacity: 0.7,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                }}
              >
                🔒 Delete
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// Rename inline form — uses updateVendorAction with the existing
// vendor_type / is_active / machines_json so only the name changes.
// Empty machines_json signals "don't touch the machine list".
function RenameForm({
  v,
  name,
  setName,
  onDone,
}: {
  v: VendorRow;
  name: string;
  setName: (s: string) => void;
  onDone: () => void;
}) {
  const valid = name.trim().length > 0 && name.trim() !== v.name;
  return (
    <form
      action={updateVendorAction}
      style={{ display: "flex", alignItems: "center", gap: 6, flex: 1 }}
    >
      <input type="hidden" name="vendor_id" value={v.id} />
      <input type="hidden" name="vendor_type" value="CNC" />
      <input type="hidden" name="is_active" value={String(v.is_active)} />
      <input type="hidden" name="machines_json" value="" />
      <input
        type="text"
        name="name"
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        required
        style={{
          flex: 1,
          padding: "6px 10px",
          fontSize: 13,
          fontWeight: 700,
          border: "1px solid var(--gold-dark)",
          borderRadius: 6,
          background: "var(--bg)",
          color: "var(--text)",
        }}
      />
      <button
        type="submit"
        disabled={!valid}
        className="primary-button"
        style={{ fontSize: 11, padding: "5px 10px", opacity: valid ? 1 : 0.5 }}
      >
        Save
      </button>
      <button
        type="button"
        onClick={onDone}
        className="ghost-button"
        style={{ fontSize: 11, padding: "5px 10px" }}
      >
        Cancel
      </button>
    </form>
  );
}
