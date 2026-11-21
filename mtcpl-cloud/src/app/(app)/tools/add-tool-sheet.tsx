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

import { prettyBytes, shrinkImage } from "@/lib/compress-image";

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
  const [low, setLow] = useState("");
  /** Edit only. Mig 235 owns the stock, so this is not a column being
   *  typed over — it is the count a man just made on the shelf, which
   *  the server turns into an `adjust` line against the stock that is
   *  true inside the lock. */
  const [count, setCount] = useState("");
  const [why, setWhy] = useState("");
  const [opening, setOpening] = useState("");
  const [photo, setPhoto] = useState<File | null>(null);
  /** "4.1 MB → 240 KB", once a photo has been through the shrinker. */
  const [photoNote, setPhotoNote] = useState<string | null>(null);
  /** What the thumbnail shows right now: the new file, the saved photo,
   *  or nothing. Kept separate from `photo` so "remove" can clear the
   *  picture without pretending a file was chosen. */
  const [preview, setPreview] = useState<string | null>(null);
  const [dropped, setDropped] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) return;
    setName(editing?.name ?? "");
    setLow(editing?.low_stock_qty == null ? "" : String(editing.low_stock_qty));
    setCount(editing ? String(editing.stock) : "");
    setWhy("");
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
  /** Only a DIFFERENT number is a correction. Opening the sheet, changing
   *  the warn line and saving must not write an adjust line saying the
   *  count was put right when nobody counted anything. */
  const countChanged =
    !!editing && count.trim() !== "" && Number(count) !== Number(editing.stock);

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
            // Daksh, Nov 2026: "there is a field size/detail — it's not
            // needed, they write everything in the name field itself. So
            // remove this field. And also remove that counted-in option,
            // by default it's in pcs."
            //
            // The columns stay (every screen prints "3 pcs", and a spec
            // typed before today still shows); they are simply no longer
            // asked for. Two fields out of a five-field form that one
            // man fills in standing at a cupboard.
            fd.set("unit", "pcs");
            fd.set("low_stock_qty", low.trim());
            if (editing && countChanged) {
              fd.set("fix_count_to", count.trim());
              fd.set("fix_seen", String(editing.stock));
              if (why.trim()) fd.set("fix_reason", why.trim());
            }
            if (!editing && opening.trim()) fd.set("opening_qty", opening.trim());
            if (photo) fd.set("photo", photo);
            else if (editing && dropped) fd.set("remove_photo", "1");
            onSubmit(fd, mode);
          }}
          style={{
            width: "100%", padding: "15px 18px", fontSize: 16, fontWeight: 800,
            borderRadius: 13, border: "none", color: "#fff",
            cursor: ready ? "pointer" : "not-allowed",
            background: ready ? "var(--gold)" : "var(--border)",
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
            {editing
              ? `${count.trim() || 0} pcs on the shelf`
              : opening.trim()
                ? `starting at ${opening.trim()} pcs`
                : "counted in pcs"}
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 7, flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              style={pill("var(--gold-dark)")}
            >
              {preview ? "Change photo" : "＋ Add photo"}
              {photoNote && <em style={{ display: "block", fontStyle: "normal", fontSize: 10.5, opacity: 0.7 }}>{photoNote}</em>}
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
            if (!f) return;
            // Shrink before it goes anywhere. A phone camera hands over
            // 4–12 MB for a picture this card shows at 120px.
            setPhotoNote("Shrinking…");
            void shrinkImage(f).then((out) => {
              setPhoto(out.file);
              setPhotoNote(
                out.changed
                  ? `${prettyBytes(out.beforeBytes)} → ${prettyBytes(out.afterBytes)}`
                  : prettyBytes(out.afterBytes),
              );
            });
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

      {/* ── Fix count, folded in ──────────────────────────────────
          Daksh, Nov 2026: "don't keep both Fix count and Edit tool
          separate — put Fix count in Edit tool itself, so less clutter."

          It used to be a second sheet behind a second menu row, and
          what stood here was a paragraph telling you to go and find it.
          Both are gone. This is still NOT a column being typed over:
          the stock is the sum of the register and always will be. The
          number is what a man counted on the shelf, and saving it
          writes an `adjust` line the same way the old sheet did, which
          is why it only fires when the figure actually changes. */}
      {editing && (
        <>
          <Field
            label="Stock on the shelf now"
            hint={
              countChanged
                ? `The register says ${editing.stock}. Saving puts it right and leaves a line saying so.`
                : "Count the shelf. Change it only if the register is wrong."
            }
          >
            <input
              type="number" inputMode="numeric" min={0}
              value={count}
              onChange={(e) => setCount(e.target.value)}
              placeholder={String(editing.stock)}
              style={{
                ...inp(),
                ...(countChanged
                  ? { borderColor: "var(--warning)", background: "var(--gold-subtle)" }
                  : null),
              }}
            />
          </Field>

          {/* Only once the number has moved. A reason box standing open
              beside a field nobody has touched is a question about
              nothing. */}
          {countChanged && (
            <Field label="Why" hint="Optional — it goes on the line in the register">
              <input
                value={why}
                onChange={(e) => setWhy(e.target.value)}
                placeholder="two were broken"
                maxLength={120}
                style={inp()}
              />
            </Field>
          )}
        </>
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
