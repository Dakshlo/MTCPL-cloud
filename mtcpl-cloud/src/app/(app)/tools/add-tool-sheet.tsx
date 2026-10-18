"use client";

/**
 * Add a tool, or edit one that exists.
 *
 * The add form carries an OPENING STOCK field. Daksh described it as two
 * steps — "they will create that item and add stock in that" — and two
 * steps is how it works on paper, but on a screen it means creating
 * "450mm tool", losing it in a list of thirty, finding it again and
 * typing 12. One form does both, and the opening stock is written as a
 * normal `receive` line so the register explains where the 12 came from.
 */

import { useEffect, useRef, useState } from "react";

import { DEFAULT_LOW_STOCK, type ToolRow } from "@/lib/cnc-tool-stock";
import { Sheet } from "./sheet";

export function AddToolSheet({
  open,
  editing,
  busy,
  onClose,
  onSubmit,
}: {
  open: boolean;
  editing: ToolRow | null;
  busy: boolean;
  onClose: () => void;
  onSubmit: (fd: FormData, mode: "create" | "edit") => void;
}) {
  const [name, setName] = useState("");
  const [spec, setSpec] = useState("");
  const [unit, setUnit] = useState("pcs");
  const [low, setLow] = useState("");
  const [opening, setOpening] = useState("");
  const [photo, setPhoto] = useState<File | null>(null);
  /** What the thumbnail shows right now: the new file, the saved photo,
   *  or nothing. Kept separate from `photo` so "remove" can clear the
   *  picture without pretending a file was chosen. */
  const [preview, setPreview] = useState<string | null>(null);
  const [dropped, setDropped] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) return;
    setName(editing?.name ?? "");
    setSpec(editing?.spec ?? "");
    setUnit(editing?.unit ?? "pcs");
    setLow(editing?.low_stock_qty == null ? "" : String(editing.low_stock_qty));
    setOpening("");
    setPhoto(null);
    setDropped(false);
    setPreview(editing?.imageUrl ?? null);
    if (fileRef.current) fileRef.current.value = "";
  }, [open, editing]);

  // A blob: URL is a live handle on the file — let it go when the
  // preview changes or the sheet closes, or the tab leaks one per photo.
  useEffect(() => {
    if (!photo) return;
    const url = URL.createObjectURL(photo);
    setPreview(url);
    setDropped(false);
    return () => URL.revokeObjectURL(url);
  }, [photo]);

  const mode = editing ? "edit" : "create";
  const ready = name.trim().length > 0 && !busy;

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={editing ? `Edit ${editing.name}` : "Add a tool"}
      subtitle={
        editing
          ? "In the store"
          : "It goes into the store, and every CNC vendor can take it straight away"
      }
      footer={
        <button
          type="button"
          disabled={!ready}
          onClick={() => {
            const fd = new FormData();
            if (editing) fd.set("tool_id", editing.id);
            fd.set("name", name.trim());
            fd.set("spec", spec.trim());
            fd.set("unit", unit.trim() || "pcs");
            fd.set("low_stock_qty", low.trim());
            if (!editing && opening.trim()) fd.set("opening_qty", opening.trim());
            if (photo) fd.set("photo", photo);
            else if (editing && dropped) fd.set("remove_photo", "1");
            onSubmit(fd, mode);
          }}
          style={{
            width: "100%", padding: "15px 18px", fontSize: 16, fontWeight: 800,
            borderRadius: 13, border: "none", color: "#fff",
            cursor: ready ? "pointer" : "not-allowed",
            background: ready ? "linear-gradient(135deg, #f59e0b 0%, #ea580c 100%)" : "var(--border)",
            boxShadow: ready ? "0 8px 20px rgba(234,88,12,0.3)" : "none",
          }}
        >
          {busy ? "Saving…" : editing ? "Save changes" : "Add tool"}
        </button>
      }
    >
      {/* The card as it will look on the shelf — the photo, the name and
          the size, together, while you are still typing them. */}
      <div style={{ display: "flex", gap: 13, alignItems: "center", marginBottom: 18 }}>
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          title={preview ? "Change the photo" : "Add a photo"}
          style={{
            width: 86, height: 86, flex: "0 0 auto", borderRadius: 18, cursor: "pointer",
            border: preview ? "1px solid var(--border)" : "2px dashed var(--border)",
            background: preview ? "var(--surface-alt)" : "var(--surface)",
            padding: 0, overflow: "hidden", display: "grid", placeItems: "center",
            position: "relative",
          }}
        >
          {preview ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={preview} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
          ) : (
            <span style={{ fontSize: 11, fontWeight: 800, color: "var(--muted)", lineHeight: 1.4 }}>
              <span style={{ display: "block", fontSize: 22 }} aria-hidden>📷</span>
              Photo
            </span>
          )}
        </button>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 16.5, fontWeight: 800, color: "var(--text)",
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {name.trim() || "New tool"}
          </div>
          <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 2 }}>
            {spec.trim() ? `${spec.trim()} · ` : ""}
            counted in {unit}
            {!editing && opening.trim() ? ` · starting at ${opening.trim()}` : ""}
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 7, flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              style={pill("var(--gold-dark)")}
            >
              {preview ? "Change photo" : "＋ Add photo"}
            </button>
            {preview && (
              <button
                type="button"
                onClick={() => {
                  setPhoto(null);
                  setPreview(null);
                  setDropped(true);
                  if (fileRef.current) fileRef.current.value = "";
                }}
                style={pill("var(--danger)")}
              >
                Remove
              </button>
            )}
          </div>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          // On a phone this offers the camera as well as the gallery,
          // which is how most of these photos will actually be taken.
          capture={undefined}
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0] ?? null;
            if (f) setPhoto(f);
          }}
        />
      </div>

      <Field label="Name" hint="What the men call it">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="450mm tool"
          maxLength={80}
          autoFocus
          style={inp()}
        />
      </Field>

      <Field label="Size / detail" hint="Optional — only if you keep more than one kind">
        <input
          value={spec}
          onChange={(e) => setSpec(e.target.value)}
          placeholder="carbide"
          maxLength={80}
          style={inp()}
        />
      </Field>

      <div style={{ display: "flex", gap: 12 }}>
        <div style={{ flex: 1 }}>
          <Field label="Counted in">
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {["pcs", "set", "box", "kg", "m"].map((u) => (
                <button
                  key={u} type="button" onClick={() => setUnit(u)}
                  style={{
                    padding: "9px 13px", fontSize: 13, fontWeight: 700, borderRadius: 9,
                    cursor: "pointer",
                    border: `1px solid ${unit === u ? "var(--gold)" : "var(--border)"}`,
                    background: unit === u ? "var(--gold-subtle)" : "var(--surface)",
                    color: unit === u ? "var(--gold-dark)" : "var(--muted)",
                  }}
                >
                  {u}
                </button>
              ))}
            </div>
          </Field>
        </div>
      </div>

      <Field
        label="Warn me at"
        hint={`Leave empty and it warns at ${DEFAULT_LOW_STOCK}`}
      >
        <input
          type="number" inputMode="numeric" min={0}
          value={low}
          onChange={(e) => setLow(e.target.value)}
          placeholder={String(DEFAULT_LOW_STOCK)}
          style={inp()}
        />
      </Field>

      {!editing && (
        <Field label="Stock in hand now" hint="Optional — goes in as the first line of the register">
          <input
            type="number" inputMode="numeric" min={0}
            value={opening}
            onChange={(e) => setOpening(e.target.value)}
            placeholder="0"
            style={inp()}
          />
        </Field>
      )}

      {editing && (
        <div
          style={{
            marginTop: 6, padding: "11px 14px", borderRadius: 11,
            background: "var(--surface-alt)", border: "1px solid var(--border-light)",
            fontSize: 12, color: "var(--muted)", lineHeight: 1.55,
          }}
        >
          Stock is not edited here — it is the sum of the register. To correct it, use{" "}
          <strong style={{ color: "var(--text)" }}>Fix count</strong> on the tool, which leaves a
          line saying why.
        </div>
      )}
    </Sheet>
  );
}

function Field({
  label, hint, children,
}: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div
        style={{
          fontSize: 11, fontWeight: 800, letterSpacing: "0.07em", textTransform: "uppercase",
          color: "var(--muted)", marginBottom: 7,
        }}
      >
        {label}
      </div>
      {children}
      {hint && (
        <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 6, lineHeight: 1.45 }}>{hint}</div>
      )}
    </div>
  );
}

function pill(colour: string): React.CSSProperties {
  return {
    padding: "6px 12px", fontSize: 11.5, fontWeight: 800, borderRadius: 999,
    cursor: "pointer", background: "var(--surface)", color: colour,
    border: `1.5px solid ${colour}`,
  };
}

function inp(): React.CSSProperties {
  return {
    width: "100%", padding: "13px 15px", fontSize: 15, borderRadius: 11,
    border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)",
    outline: "none",
  };
}
