"use client";

import { useEffect, useState } from "react";
import {
  addExternalCutSlabAction,
  deleteExternalCutSlabAction,
  updateExternalCutSlabAction,
} from "./actions";

// Daksh May 2026 round 2 — "View / Add external cut slab" peek panel
// for the /carving Unassigned tab. Two purposes in one surface:
//
//   1. ADD new externally-supplied cut slabs (ready-to-carve slabs
//      that didn't pass through MTCPL's cutting pipeline). Lands in
//      Unassigned at status='cut_done' with source_block_id=NULL,
//      no cutting record created.
//   2. SEE every externally-added slab still in Unassigned, grouped
//      by temple, with inline Edit + Delete. Edit/Delete refuse
//      to touch slabs from cutting (source_block_id IS NOT NULL) and
//      anything that's already been assigned (status != 'cut_done').
//
// Visible only to dev / owner / carving_head / team_head (parent
// gates via canAddExternalCutSlab + passes the externalSlabs list).

type Temple = {
  id: string;
  name: string;
  code_prefix: string;
  default_stone?: string | null;
};
type StoneType = { id?: string; name: string };

export type ExternalSlab = {
  id: string;
  temple: string;
  stone: string;
  length_ft: number;
  width_ft: number;
  thickness_ft: number;
  label: string | null;
  description: string | null;
  stock_location: string | null;
  quality: string | null;
  priority: boolean;
};

export function ExternalCutSlabsPanel({
  temples,
  stoneTypes,
  externalSlabs,
}: {
  temples: Temple[];
  stoneTypes: StoneType[];
  externalSlabs: ExternalSlab[];
}) {
  const [open, setOpen] = useState(false);
  const totalCount = externalSlabs.length;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        style={{
          padding: "8px 14px",
          fontSize: 13,
          fontWeight: 700,
          background: "var(--surface)",
          color: "var(--gold-dark)",
          border: "1.5px solid var(--gold-dark)",
          borderRadius: 8,
          cursor: "pointer",
          whiteSpace: "nowrap",
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
        }}
        title="View externally-added cut slabs and add new ones"
      >
        ＋ View / Add external cut slab
        {totalCount > 0 && (
          <span
            style={{
              fontSize: 10,
              fontFamily: "ui-monospace, monospace",
              fontWeight: 800,
              padding: "1px 7px",
              borderRadius: 999,
              background: "var(--gold-dark)",
              color: "#fff",
              minWidth: 18,
              textAlign: "center",
            }}
          >
            {totalCount}
          </span>
        )}
      </button>
      {open && (
        <ExternalCutSlabsModal
          temples={temples}
          stoneTypes={stoneTypes}
          externalSlabs={externalSlabs}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function ExternalCutSlabsModal({
  temples,
  stoneTypes,
  externalSlabs,
  onClose,
}: {
  temples: Temple[];
  stoneTypes: StoneType[];
  externalSlabs: ExternalSlab[];
  onClose: () => void;
}) {
  const [showAddForm, setShowAddForm] = useState(externalSlabs.length === 0);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Group existing slabs by temple. Sort temples alphabetically,
  // slabs within each temple by id (which roughly matches creation
  // order because the per-temple sequence is monotonic).
  const byTemple = new Map<string, ExternalSlab[]>();
  for (const s of externalSlabs) {
    const arr = byTemple.get(s.temple) ?? [];
    arr.push(s);
    byTemple.set(s.temple, arr);
  }
  const groupedTemples = [...byTemple.entries()]
    .map(([temple, slabs]) => ({
      temple,
      slabs: [...slabs].sort((a, b) => a.id.localeCompare(b.id)),
    }))
    .sort((a, b) => a.temple.localeCompare(b.temple));

  return (
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.5)",
        zIndex: 250,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
      }}
    >
      <div
        style={{
          background: "var(--surface)",
          color: "var(--text)",
          width: "min(960px, 100%)",
          maxHeight: "92vh",
          display: "flex",
          flexDirection: "column",
          border: "1px solid var(--border)",
          borderRadius: 14,
          boxShadow: "0 20px 60px rgba(0,0,0,0.35)",
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "16px 20px",
            borderBottom: "1px solid var(--border)",
            background: "var(--surface-alt)",
          }}
        >
          <div>
            <div
              style={{
                fontSize: 10,
                fontWeight: 800,
                color: "var(--muted)",
                textTransform: "uppercase",
                letterSpacing: "0.08em",
              }}
            >
              External supplier
            </div>
            <div
              style={{
                fontSize: 18,
                fontWeight: 800,
                color: "var(--text)",
                letterSpacing: "-0.005em",
              }}
            >
              External cut slabs
            </div>
            <div
              style={{
                fontSize: 11,
                color: "var(--muted)",
                marginTop: 2,
              }}
            >
              {externalSlabs.length} unassigned · ready-to-carve slabs from
              outside MTCPL · no cutting record created
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: "transparent",
              border: "1px solid var(--border)",
              color: "var(--muted)",
              padding: "6px 12px",
              borderRadius: 6,
              cursor: "pointer",
              fontSize: 12,
            }}
          >
            ✕ Close
          </button>
        </div>

        {/* Scrollable body */}
        <div style={{ overflowY: "auto", padding: "16px 20px" }}>
          {/* Add-new toggle + form */}
          <div style={{ marginBottom: 18 }}>
            <button
              type="button"
              onClick={() => setShowAddForm((s) => !s)}
              style={{
                width: "100%",
                padding: "10px 14px",
                fontSize: 13,
                fontWeight: 700,
                background: showAddForm ? "var(--surface-alt)" : "var(--gold-dark)",
                color: showAddForm ? "var(--text)" : "#fff",
                border: `1.5px solid ${showAddForm ? "var(--border)" : "var(--gold-dark)"}`,
                borderRadius: 8,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
              }}
            >
              {showAddForm ? "✕ Cancel add" : "＋ Add new external cut slab"}
            </button>
            {showAddForm && (
              <div
                style={{
                  marginTop: 10,
                  padding: 14,
                  background: "var(--bg)",
                  border: "1px solid var(--border)",
                  borderRadius: 10,
                }}
              >
                <AddOrEditForm
                  mode="add"
                  temples={temples}
                  stoneTypes={stoneTypes}
                  onCancel={() => setShowAddForm(false)}
                />
              </div>
            )}
          </div>

          {/* Existing list, temple-wise */}
          {groupedTemples.length === 0 ? (
            <div
              style={{
                padding: "32px 16px",
                textAlign: "center",
                color: "var(--muted)",
                fontSize: 13,
                background: "var(--bg)",
                border: "1px dashed var(--border)",
                borderRadius: 10,
              }}
            >
              No externally-added slabs yet. Use the button above to add the
              first one.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {groupedTemples.map(({ temple, slabs }) => (
                <TempleGroup
                  key={temple}
                  temple={temple}
                  slabs={slabs}
                  temples={temples}
                  stoneTypes={stoneTypes}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function TempleGroup({
  temple,
  slabs,
  temples,
  stoneTypes,
}: {
  temple: string;
  slabs: ExternalSlab[];
  temples: Temple[];
  stoneTypes: StoneType[];
}) {
  return (
    <div
      style={{
        border: "1px solid var(--border)",
        borderRadius: 10,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          padding: "8px 14px",
          background: "var(--surface-alt)",
          fontSize: 11,
          fontWeight: 800,
          color: "var(--muted)",
          textTransform: "uppercase",
          letterSpacing: "0.06em",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <span>🏛 {temple}</span>
        <span
          style={{
            fontFamily: "ui-monospace, monospace",
            fontWeight: 800,
            color: "var(--gold-dark)",
          }}
        >
          {slabs.length}
        </span>
      </div>
      <div style={{ display: "flex", flexDirection: "column" }}>
        {slabs.map((s) => (
          <SlabRow
            key={s.id}
            slab={s}
            temples={temples}
            stoneTypes={stoneTypes}
          />
        ))}
      </div>
    </div>
  );
}

function SlabRow({
  slab,
  temples,
  stoneTypes,
}: {
  slab: ExternalSlab;
  temples: Temple[];
  stoneTypes: StoneType[];
}) {
  const [editing, setEditing] = useState(false);

  if (editing) {
    return (
      <div
        style={{
          padding: 14,
          background: "rgba(217,119,6,0.04)",
          borderTop: "1px solid var(--border)",
        }}
      >
        <AddOrEditForm
          mode="edit"
          existing={slab}
          temples={temples}
          stoneTypes={stoneTypes}
          onCancel={() => setEditing(false)}
        />
      </div>
    );
  }

  const dims = `${slab.length_ft}×${slab.width_ft}×${slab.thickness_ft}″`;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "10px 14px",
        borderTop: "1px solid var(--border)",
        flexWrap: "wrap",
      }}
    >
      <div style={{ flex: "1 1 220px", minWidth: 0 }}>
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
              fontFamily: "ui-monospace, monospace",
              fontWeight: 700,
              fontSize: 13,
              color: "var(--text)",
            }}
          >
            {slab.id}
          </span>
          {slab.priority && (
            <span
              style={{
                fontSize: 10,
                fontWeight: 800,
                padding: "1px 7px",
                borderRadius: 999,
                background: "#dc2626",
                color: "#fff",
                letterSpacing: "0.05em",
              }}
            >
              ⚡ PRIORITY
            </span>
          )}
          {slab.quality && (
            <span
              style={{
                fontSize: 10,
                fontWeight: 700,
                padding: "1px 6px",
                borderRadius: 3,
                background: "var(--surface-alt)",
                color: "var(--muted)",
              }}
            >
              {slab.quality}
            </span>
          )}
        </div>
        <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>
          {dims} · {slab.stone}
          {slab.stock_location && ` · 📍 ${slab.stock_location}`}
        </div>
        {slab.description && (
          <div
            style={{
              fontSize: 11,
              color: "var(--text)",
              marginTop: 3,
              fontStyle: "italic",
            }}
          >
            {slab.description}
          </div>
        )}
      </div>
      <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
        <button
          type="button"
          onClick={() => setEditing(true)}
          style={{
            padding: "6px 12px",
            fontSize: 12,
            fontWeight: 700,
            background: "transparent",
            color: "var(--gold-dark)",
            border: "1px solid var(--gold-dark)",
            borderRadius: 6,
            cursor: "pointer",
          }}
        >
          ✎ Edit
        </button>
        <form
          action={deleteExternalCutSlabAction}
          onSubmit={(e) => {
            if (
              !window.confirm(
                `Delete slab ${slab.id}? This cannot be undone.`,
              )
            ) {
              e.preventDefault();
            }
          }}
        >
          <input type="hidden" name="id" value={slab.id} />
          <input type="hidden" name="redirect_to" value="/carving" />
          <button
            type="submit"
            style={{
              padding: "6px 12px",
              fontSize: 12,
              fontWeight: 700,
              background: "transparent",
              color: "#b91c1c",
              border: "1px solid rgba(220,38,38,0.5)",
              borderRadius: 6,
              cursor: "pointer",
            }}
          >
            🗑 Delete
          </button>
        </form>
      </div>
    </div>
  );
}

/** Shared form for both Add and Edit. Mode controls the target server
 *  action + whether the id hidden input is rendered. Fields mirror
 *  the existing Required Sizes AddSlabForm so the carving-side data
 *  entry feels consistent. */
function AddOrEditForm({
  mode,
  existing,
  temples,
  stoneTypes,
  onCancel,
}: {
  mode: "add" | "edit";
  existing?: ExternalSlab;
  temples: Temple[];
  stoneTypes: StoneType[];
  onCancel: () => void;
}) {
  const initialTemple =
    temples.find((t) => t.name === existing?.temple) ?? temples[0] ?? null;
  const [selectedTemple, setSelectedTemple] = useState<Temple | null>(
    initialTemple,
  );
  const [stone, setStone] = useState<string>(
    existing?.stone ??
      initialTemple?.default_stone ??
      stoneTypes[0]?.name ??
      "PinkStone",
  );
  const [length, setLength] = useState(
    existing ? String(existing.length_ft) : "",
  );
  const [width, setWidth] = useState(
    existing ? String(existing.width_ft) : "",
  );
  const [thickness, setThickness] = useState(
    existing ? String(existing.thickness_ft) : "",
  );
  const [label, setLabel] = useState(existing?.label ?? "");
  const [description, setDescription] = useState(existing?.description ?? "");
  const [stockLocation, setStockLocation] = useState(
    existing?.stock_location ?? "",
  );
  const [quality, setQuality] = useState<"" | "A" | "B">(
    (existing?.quality as "" | "A" | "B") ?? "",
  );
  const [priority, setPriority] = useState(existing?.priority ?? false);

  const dimsOk =
    Number(length) > 0 && Number(width) > 0 && Number(thickness) > 0;
  const canSubmit = !!selectedTemple && !!stone && dimsOk;

  const action =
    mode === "edit" ? updateExternalCutSlabAction : addExternalCutSlabAction;

  return (
    <form
      action={action}
      style={{ display: "flex", flexDirection: "column", gap: 10 }}
    >
      <input type="hidden" name="redirect_to" value="/carving" />
      {mode === "edit" && existing && (
        <input type="hidden" name="id" value={existing.id} />
      )}

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <Field label="Temple *" flex>
          <select
            name="temple"
            value={selectedTemple?.name ?? ""}
            onChange={(e) => {
              const t =
                temples.find((x) => x.name === e.target.value) ?? null;
              setSelectedTemple(t);
              if (t?.default_stone && !existing) setStone(t.default_stone);
            }}
            required
            style={selectStyle}
          >
            <option value="">— select temple —</option>
            {temples.map((t) => (
              <option key={t.id} value={t.name}>
                {t.name} ({t.code_prefix})
              </option>
            ))}
          </select>
        </Field>
        <Field label="Stone *" flex>
          <select
            name="stone"
            value={stone}
            onChange={(e) => setStone(e.target.value)}
            required
            style={selectStyle}
          >
            <option value="">— select stone —</option>
            {stoneTypes.map((s) => (
              <option key={s.name} value={s.name}>
                {s.name}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <div style={{ display: "flex", gap: 8 }}>
        <Field label="Length (in) *" flex>
          <input
            type="number"
            name="length_in"
            value={length}
            onChange={(e) => setLength(e.target.value)}
            min="0"
            step="0.5"
            required
            style={inputStyle}
          />
        </Field>
        <Field label="Width (in) *" flex>
          <input
            type="number"
            name="width_in"
            value={width}
            onChange={(e) => setWidth(e.target.value)}
            min="0"
            step="0.5"
            required
            style={inputStyle}
          />
        </Field>
        <Field label="Thickness (in) *" flex>
          <input
            type="number"
            name="thickness_in"
            value={thickness}
            onChange={(e) => setThickness(e.target.value)}
            min="0"
            step="0.5"
            required
            style={inputStyle}
          />
        </Field>
      </div>

      <Field label="Label (optional — defaults to temple name)">
        <input
          type="text"
          name="label"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          maxLength={80}
          placeholder={selectedTemple?.name ?? "Slab label"}
          style={inputStyle}
        />
      </Field>
      <Field label="Description (optional)">
        <input
          type="text"
          name="description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={200}
          placeholder="e.g. corner piece, top row"
          style={inputStyle}
        />
      </Field>
      <Field label="Stock location (optional)">
        <input
          type="text"
          name="stock_location"
          value={stockLocation}
          onChange={(e) => setStockLocation(e.target.value)}
          maxLength={60}
          placeholder="e.g. Yard A · row 3"
          style={inputStyle}
        />
      </Field>
      <div style={{ display: "flex", gap: 8 }}>
        <Field label="Quality" flex>
          <select
            name="quality"
            value={quality}
            onChange={(e) => setQuality(e.target.value as "" | "A" | "B")}
            style={selectStyle}
          >
            <option value="">—</option>
            <option value="A">A</option>
            <option value="B">B</option>
          </select>
        </Field>
        <Field label="Priority" flex>
          <label
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              padding: "8px 12px",
              border: "1px solid var(--border)",
              borderRadius: 6,
              background: priority ? "rgba(217,119,6,0.10)" : "var(--bg)",
              cursor: "pointer",
            }}
          >
            <input
              type="checkbox"
              name="priority"
              value="true"
              checked={priority}
              onChange={(e) => setPriority(e.target.checked)}
            />
            <span style={{ fontSize: 12, fontWeight: 700 }}>
              ⚡ High priority
            </span>
          </label>
        </Field>
      </div>

      <div
        style={{
          display: "flex",
          justifyContent: "flex-end",
          gap: 8,
          marginTop: 4,
        }}
      >
        <button
          type="button"
          onClick={onCancel}
          className="ghost-button"
          style={{ padding: "8px 16px", fontSize: 13 }}
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={!canSubmit}
          style={{
            padding: "8px 18px",
            fontSize: 13,
            fontWeight: 700,
            background: canSubmit ? "var(--gold-dark)" : "var(--surface-alt)",
            color: canSubmit ? "#fff" : "var(--muted)",
            border: `1px solid ${canSubmit ? "var(--gold-dark)" : "var(--border)"}`,
            borderRadius: 8,
            cursor: canSubmit ? "pointer" : "not-allowed",
          }}
        >
          {mode === "edit" ? "Save changes" : "Add to Unassigned"}
        </button>
      </div>
    </form>
  );
}

function Field({
  label,
  children,
  flex = false,
}: {
  label: string;
  children: React.ReactNode;
  flex?: boolean;
}) {
  return (
    <label
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 4,
        flex: flex ? "1 1 0" : undefined,
        minWidth: 0,
      }}
    >
      <span
        style={{
          fontSize: 11,
          fontWeight: 700,
          color: "var(--muted)",
          textTransform: "uppercase",
          letterSpacing: "0.04em",
        }}
      >
        {label}
      </span>
      {children}
    </label>
  );
}

const inputStyle: React.CSSProperties = {
  fontSize: 13,
  padding: "8px 10px",
  border: "1px solid var(--border)",
  borderRadius: 6,
  background: "var(--bg)",
  color: "var(--text)",
  width: "100%",
};

const selectStyle: React.CSSProperties = {
  ...inputStyle,
};
