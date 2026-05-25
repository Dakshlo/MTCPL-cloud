"use client";

import { useEffect, useState } from "react";
import { addExternalCutSlabAction } from "./actions";

// Daksh May 2026 round 2 — "+ Add external cut slab" affordance for
// the /carving Unassigned tab. Use case: a ready-to-carve slab walks
// in from an outside supplier that never passed through MTCPL
// cutting, so the carving team needs to register it directly without
// going through Blocks → Cutting → cut_done.
//
// Visible only to dev / owner / carving_head / team_head (gated by
// the parent page passing `canAdd`).
//
// Shape mirrors /slabs's AddSlabForm in fields collected (temple +
// stone + label + dims + quality + priority + stock location). The
// IDs for the form inputs follow the names the server action reads.

type Temple = {
  id: string;
  name: string;
  code_prefix: string;
  default_stone?: string | null;
};
type StoneType = { id?: string; name: string };

export function AddExternalCutSlabButton({
  temples,
  stoneTypes,
}: {
  temples: Temple[];
  stoneTypes: StoneType[];
}) {
  const [open, setOpen] = useState(false);

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
        title="Register a ready-to-carve slab that arrived from outside MTCPL"
      >
        ＋ External cut slab
      </button>
      {open && (
        <AddExternalCutSlabModal
          temples={temples}
          stoneTypes={stoneTypes}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function AddExternalCutSlabModal({
  temples,
  stoneTypes,
  onClose,
}: {
  temples: Temple[];
  stoneTypes: StoneType[];
  onClose: () => void;
}) {
  const [selectedTemple, setSelectedTemple] = useState<Temple | null>(
    temples[0] ?? null,
  );
  const [stone, setStone] = useState<string>(
    temples[0]?.default_stone ?? stoneTypes[0]?.name ?? "PinkStone",
  );
  const [length, setLength] = useState("");
  const [width, setWidth] = useState("");
  const [thickness, setThickness] = useState("");
  const [label, setLabel] = useState("");
  const [description, setDescription] = useState("");
  const [stockLocation, setStockLocation] = useState("");
  const [quality, setQuality] = useState<"" | "A" | "B">("");
  const [priority, setPriority] = useState(false);

  // Esc closes the modal — matches the other modals in the cockpit
  // (LoadModal, HoldModal, etc).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const dimsOk =
    Number(length) > 0 && Number(width) > 0 && Number(thickness) > 0;
  const canSubmit = !!selectedTemple && !!stone && dimsOk;

  return (
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.45)",
        zIndex: 250,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
      }}
    >
      <div
        style={{
          background: "var(--surface)",
          color: "var(--text)",
          width: "min(560px, 100%)",
          maxHeight: "90vh",
          overflowY: "auto",
          border: "1px solid var(--border)",
          borderRadius: 12,
          padding: 18,
          boxShadow: "0 20px 60px rgba(0,0,0,0.35)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 12,
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
                fontSize: 17,
                fontWeight: 800,
                color: "var(--text)",
                letterSpacing: "-0.005em",
              }}
            >
              ＋ Add external cut slab
            </div>
            <div
              style={{
                fontSize: 11,
                color: "var(--muted)",
                marginTop: 3,
                maxWidth: 460,
              }}
            >
              Registers a ready-to-carve slab that arrived from outside.
              Lands in Unassigned, ready to assign. No block / cutting
              record is created.
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: "transparent",
              border: "1px solid var(--border)",
              color: "var(--muted)",
              padding: "4px 10px",
              borderRadius: 6,
              cursor: "pointer",
              fontSize: 12,
            }}
          >
            ✕
          </button>
        </div>

        <form
          action={addExternalCutSlabAction}
          style={{ display: "flex", flexDirection: "column", gap: 12 }}
        >
          <input type="hidden" name="redirect_to" value="/carving" />

          {/* Temple — temple-wise selection just like Required Sizes */}
          <Field label="Temple *">
            <select
              name="temple"
              value={selectedTemple?.name ?? ""}
              onChange={(e) => {
                const t = temples.find((x) => x.name === e.target.value) ?? null;
                setSelectedTemple(t);
                if (t?.default_stone) setStone(t.default_stone);
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

          {/* Stone */}
          <Field label="Stone *">
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

          {/* Dimensions — inches, mirrors how cutting stores them
              throughout the app (despite the column name *_ft). */}
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

          {/* Label + description */}
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

          {/* Stock location + quality + priority — same trio of fields
              the Unassigned cards render so the carving head sees the
              same metadata regardless of provenance. */}
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
              onClick={onClose}
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
              Add to Unassigned
            </button>
          </div>
        </form>
      </div>
    </div>
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
