"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  upsertComponentAction,
  archiveComponentAction,
  createComponentTypeAction,
} from "../../actions";
import {
  ComponentIcon,
  labelForComponentType,
  type ScaffoldingComponentType,
} from "../../_components/component-icon";
import {
  INV_THEME,
  primaryButton,
  secondaryButton,
} from "../../_components/theme";
import type { ScaffoldingComponent } from "../../_components/stock";

// Mig 084 — user-defined component types passed from the page.
type ComponentTypeOption = { value: string; label: string };

export function ComponentsClient({
  components,
  componentTypes,
}: {
  components: ScaffoldingComponent[];
  /** Mig 084 — the user-created type catalog. Feeds the Type
   *  picker in the Add Component form. Empty until the storekeeper
   *  adds their first type. */
  componentTypes: ComponentTypeOption[];
}) {
  const router = useRouter();
  const [editingId, setEditingId] = useState<string | "new" | null>(null);
  // Local mirror so a newly-created type appears immediately in the
  // picker without a full refresh.
  const [localTypes, setLocalTypes] = useState<ComponentTypeOption[]>(componentTypes);

  const active = components.filter((c) => c.is_active);

  // Group active by type for display.
  const byType = new Map<ScaffoldingComponentType, ScaffoldingComponent[]>();
  const typeOrder: ScaffoldingComponentType[] = [];
  for (const c of active) {
    if (!byType.has(c.component_type)) {
      byType.set(c.component_type, []);
      typeOrder.push(c.component_type);
    }
    byType.get(c.component_type)!.push(c);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <div
        style={{
          display: "flex",
          justifyContent: "flex-end",
        }}
      >
        {editingId !== "new" && (
          <button
            type="button"
            style={primaryButton}
            onClick={() => setEditingId("new")}
          >
            + Add component
          </button>
        )}
      </div>

      {editingId === "new" && (
        <ComponentForm
          mode="create"
          types={localTypes}
          onTypeCreated={(t) => setLocalTypes((prev) => [...prev, t])}
          onCancel={() => setEditingId(null)}
          onSaved={() => {
            setEditingId(null);
            router.refresh();
          }}
        />
      )}

      {/* Active groups */}
      {typeOrder.map((t) => (
        <section
          key={t}
          style={{
            background: INV_THEME.paper,
            border: `1px solid ${INV_THEME.parchment}`,
            borderRadius: 10,
            padding: 14,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              paddingBottom: 8,
              borderBottom: `1px solid ${INV_THEME.parchment}`,
              marginBottom: 10,
            }}
          >
            <span style={{ color: INV_THEME.steel }}>
              <ComponentIcon type={t} size={28} />
            </span>
            <h3
              style={{
                margin: 0,
                fontSize: 13,
                fontWeight: 800,
                color: INV_THEME.steel,
                textTransform: "uppercase",
                letterSpacing: "0.08em",
              }}
            >
              {labelForComponentType(t)}
            </h3>
            <span
              style={{ fontSize: 11, color: INV_THEME.steelLight, marginLeft: 6 }}
            >
              {byType.get(t)!.length} variant
              {byType.get(t)!.length === 1 ? "" : "s"}
            </span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {byType.get(t)!.map((c) =>
              editingId === c.id ? (
                <ComponentForm
                  key={c.id}
                  mode="edit"
                  component={c}
                  types={localTypes}
                  onTypeCreated={(nt) => setLocalTypes((prev) => [...prev, nt])}
                  onCancel={() => setEditingId(null)}
                  onSaved={() => {
                    setEditingId(null);
                    router.refresh();
                  }}
                />
              ) : (
                <ComponentRow
                  key={c.id}
                  component={c}
                  onEdit={() => setEditingId(c.id)}
                  onArchive={async () => {
                    if (!confirm(`Archive ${c.name}? History stays intact, but it won't show up in new-movement pickers.`)) return;
                    const fd = new FormData();
                    fd.append("id", c.id);
                    await archiveComponentAction(fd);
                    router.refresh();
                  }}
                />
              ),
            )}
          </div>
        </section>
      ))}

      {/* Mig 083 follow-on (Daksh) — the Archived section is gone.
          Daksh: "remove those archive too. ill add my self." The
          mig-083 soft wipe archived every legacy component, so
          showing a 38-row Archived list was pure noise. Archived
          rows still exist in the DB (recoverable via a manual
          is_active flip if ever needed) but the catalog screen no
          longer surfaces them. Empty-state hint when there are no
          active components yet. */}
      {typeOrder.length === 0 && editingId !== "new" && (
        <div
          style={{
            background: INV_THEME.paper,
            border: `1px dashed ${INV_THEME.parchment}`,
            borderRadius: 10,
            padding: "28px 18px",
            textAlign: "center",
            color: INV_THEME.steelLight,
            fontSize: 13,
          }}
        >
          No components yet. Tap <strong>+ Add component</strong> to
          start building the catalog.
        </div>
      )}
    </div>
  );
}

function ComponentRow({
  component: c,
  archived,
  onEdit,
  onArchive,
  onUnarchive,
}: {
  component: ScaffoldingComponent;
  archived?: boolean;
  onEdit?: () => void;
  onArchive?: () => void;
  onUnarchive?: () => void;
}) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "auto 1fr auto",
        gap: 12,
        alignItems: "center",
        padding: 10,
        background: INV_THEME.cream,
        borderRadius: 8,
        border: `1px solid ${INV_THEME.parchment}`,
        opacity: archived ? 0.7 : 1,
      }}
    >
      <span style={{ color: INV_THEME.steel }}>
        <ComponentIcon
          type={c.component_type}
          size={32}
          imageDataUrl={c.image_data_url ?? undefined}
        />
      </span>
      <div>
        <div style={{ fontWeight: 800, fontSize: 13, color: INV_THEME.steel }}>
          {c.name}
        </div>
        <div style={{ fontSize: 11, color: INV_THEME.steelLight, marginTop: 2 }}>
          {c.size_spec ? `${c.size_spec} · ` : ""}
          unit: {c.unit}
          {c.display_order !== 0 && ` · order ${c.display_order}`}
          {c.description ? ` · ${c.description}` : ""}
        </div>
      </div>
      <div style={{ display: "flex", gap: 6 }}>
        {!archived && (
          <>
            <button type="button" onClick={onEdit} style={secondaryButton}>
              Edit
            </button>
            <button
              type="button"
              onClick={onArchive}
              style={{
                ...secondaryButton,
                color: INV_THEME.stockOut,
                borderColor: "rgba(193, 68, 46, 0.3)",
              }}
            >
              Archive
            </button>
          </>
        )}
        {archived && (
          <button type="button" onClick={onUnarchive} style={secondaryButton}>
            Restore
          </button>
        )}
      </div>
    </div>
  );
}

function ComponentForm({
  mode,
  component,
  types,
  onTypeCreated,
  onCancel,
  onSaved,
}: {
  mode: "create" | "edit";
  component?: ScaffoldingComponent;
  /** Mig 084 — user-defined types for the picker. */
  types: ComponentTypeOption[];
  /** Called after a new type is created so the parent can mirror
   *  it into its localTypes state. */
  onTypeCreated: (t: ComponentTypeOption) => void;
  onCancel: () => void;
  onSaved: () => void;
}) {
  // Mig 084 — the picked type. Defaults to the component's existing
  // type on edit, else the first available type, else "" (no types
  // exist yet — the user must create one first).
  const [type, setType] = useState<string>(
    component?.component_type ?? types[0]?.value ?? "",
  );
  // Inline "+ Add component type" form state.
  const [creatingType, setCreatingType] = useState(false);
  const [newTypeLabel, setNewTypeLabel] = useState("");
  const [typeError, setTypeError] = useState<string | null>(null);
  const [typePending, setTypePending] = useState(false);

  // Resolve the human label for the currently-picked type. Prefer
  // the live types list (covers custom types); fall back to the
  // built-in label helper for legacy/edit rows whose type isn't in
  // the active list.
  const typeLabel =
    types.find((t) => t.value === type)?.label ??
    (type ? labelForComponentType(type) : "");

  // Mig 083 follow-on — size is controlled so the auto-name preview
  // updates live. Name = "<type label> <size>" (or just the type
  // label when size is blank).
  const [size, setSize] = useState<string>(component?.size_spec ?? "");
  const derivedName = type
    ? size.trim()
      ? `${typeLabel} ${size.trim()}`
      : typeLabel
    : "";

  async function handleCreateType() {
    const label = newTypeLabel.trim();
    if (!label) {
      setTypeError("Enter a type name.");
      return;
    }
    setTypePending(true);
    setTypeError(null);
    const fd = new FormData();
    fd.set("label", label);
    const res = await createComponentTypeAction(fd);
    setTypePending(false);
    if (!res.ok) {
      setTypeError(res.error);
      return;
    }
    onTypeCreated({ value: res.value, label: res.label });
    setType(res.value);
    setNewTypeLabel("");
    setCreatingType(false);
  }
  // Mig 044 — image upload. The user picks a PNG (transparent
  // recommended); we read it into a data URL and store the full
  // string in scaffolding_components.image_data_url. Tiny files
  // for ~4 components, no Supabase Storage needed.
  const [imageDataUrl, setImageDataUrl] = useState<string | null>(
    component?.image_data_url ?? null,
  );
  const [imageError, setImageError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Max accepted upload size — keeps the DB row small + the JSON
  // round-trip fast. 200 KB is plenty for a transparent PNG icon.
  const MAX_IMAGE_BYTES = 200 * 1024;

  async function onImagePick(e: React.ChangeEvent<HTMLInputElement>) {
    setImageError(null);
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setImageError("Pick an image file (PNG / JPG / WebP).");
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setImageError(
        `Image is ${Math.round(file.size / 1024)} KB — keep it under ${MAX_IMAGE_BYTES / 1024} KB so cards stay snappy.`,
      );
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result === "string") setImageDataUrl(result);
    };
    reader.onerror = () => setImageError("Couldn't read the file.");
    reader.readAsDataURL(file);
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    // Mig 084 — guard: a type must be picked. When the catalog has
    // zero types yet, the user has to create one first.
    if (!type) {
      setError("Pick or create a component type first.");
      return;
    }
    setSubmitting(true);
    const fd = new FormData(e.currentTarget);
    if (mode === "edit" && component) fd.append("id", component.id);
    // Send the image data URL alongside. Empty string clears any
    // previously-saved image; non-empty replaces it.
    fd.set("image_data_url", imageDataUrl ?? "");
    const res = await upsertComponentAction(fd);
    if (!res.ok) {
      setError(res.error);
      setSubmitting(false);
      return;
    }
    onSaved();
  }

  return (
    <form
      onSubmit={onSubmit}
      style={{
        background: INV_THEME.paper,
        border: `1.5px solid ${INV_THEME.steel}`,
        borderRadius: 14,
        padding: 18,
        display: "flex",
        flexDirection: "column",
        gap: 16,
        boxShadow: "0 8px 28px rgba(28, 52, 69, 0.10)",
      }}
    >
      {/* Mig 084 follow-on (Daksh) — form redesigned from a cramped
          auto-fit grid into a clean vertical card. Header shows a
          big live preview of the icon + the auto-derived name so
          the user sees exactly what they're building as they fill
          the form. The fields below flow top-to-bottom with
          generous spacing instead of being squeezed onto one row. */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 14,
          paddingBottom: 14,
          borderBottom: `1px solid ${INV_THEME.parchment}`,
        }}
      >
        <div
          style={{
            width: 56,
            height: 56,
            flexShrink: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: INV_THEME.cream,
            border: `1px solid ${INV_THEME.parchment}`,
            borderRadius: 10,
            color: INV_THEME.steel,
          }}
        >
          <ComponentIcon
            type={type}
            size={42}
            imageDataUrl={imageDataUrl ?? undefined}
          />
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div
            style={{
              fontSize: 10,
              fontWeight: 800,
              color: INV_THEME.steelLight,
              textTransform: "uppercase",
              letterSpacing: "0.1em",
            }}
          >
            {mode === "create" ? "New component" : "Edit component"}
          </div>
          <div
            style={{
              fontSize: 18,
              fontWeight: 800,
              color: INV_THEME.steel,
              marginTop: 2,
              lineHeight: 1.2,
            }}
          >
            {derivedName || (
              <span style={{ color: INV_THEME.steelLight, fontWeight: 600, fontSize: 14 }}>
                Pick a type + size to name this part…
              </span>
            )}
          </div>
        </div>
      </div>
      {/* Mig 084 (Daksh) — Type is now user-defined. The dropdown
          is fed by the live scaffolding_component_types list (no
          more hardcoded 12-option enum). "+ Add component type"
          reveals an inline create form so the storekeeper builds
          their own type list. The hidden inputs carry the picked
          slug + its label so the server can derive the component
          name without a DB round-trip. */}
      <Field label="Type" wide>
        <input type="hidden" name="component_type" value={type} />
        <input type="hidden" name="type_label" value={typeLabel} />
        {creatingType ? (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 6,
              padding: 10,
              background: INV_THEME.cream,
              border: `1px solid ${INV_THEME.steel}`,
              borderRadius: 8,
            }}
          >
            <input
              type="text"
              autoFocus
              maxLength={60}
              value={newTypeLabel}
              onChange={(e) => {
                setNewTypeLabel(e.target.value);
                if (typeError) setTypeError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void handleCreateType();
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  setCreatingType(false);
                  setNewTypeLabel("");
                  setTypeError(null);
                }
              }}
              placeholder="New type name (e.g. Cuplock, Prop)"
              style={inputStyle}
            />
            {typeError && (
              <span
                style={{ fontSize: 11, color: INV_THEME.stockOut, fontWeight: 600 }}
              >
                {typeError}
              </span>
            )}
            <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
              <button
                type="button"
                onClick={() => {
                  setCreatingType(false);
                  setNewTypeLabel("");
                  setTypeError(null);
                }}
                disabled={typePending}
                style={secondaryButton}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleCreateType}
                disabled={typePending || !newTypeLabel.trim()}
                style={{
                  ...primaryButton,
                  opacity: typePending || !newTypeLabel.trim() ? 0.6 : 1,
                }}
              >
                {typePending ? "Adding…" : "+ Add type"}
              </button>
            </div>
          </div>
        ) : (
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <select
              value={type}
              onChange={(e) => setType(e.target.value)}
              style={{ ...inputStyle, flex: 1 }}
            >
              {types.length === 0 && (
                <option value="">— No types yet —</option>
              )}
              {types.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => setCreatingType(true)}
              style={{ ...secondaryButton, whiteSpace: "nowrap" }}
            >
              + Add component type
            </button>
          </div>
        )}
      </Field>
      {/* Mig 083 follow-on (Daksh) — the standalone Display Name
          field is gone. The name auto-builds from Type + Size and
          shows in the header preview above; the server re-derives
          it the same way so the two never drift. */}
      <Field label="Size">
        <input
          name="size_spec"
          value={size}
          onChange={(e) => setSize(e.target.value)}
          placeholder="e.g. 2.5m · 100×50 · 18ga — or leave blank"
          style={inputStyle}
        />
      </Field>
      {/* Secondary row — Unit + Sort order sit side by side; they're
          lower-priority than Type/Size so they share one compact
          line instead of each taking a full row. */}
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <div style={{ flex: "1 1 120px", minWidth: 0 }}>
          <Field label="Unit">
            <input
              name="unit"
              defaultValue={component?.unit ?? "pcs"}
              required
              placeholder="pcs / kg / m"
              style={inputStyle}
            />
          </Field>
        </div>
        <div style={{ flex: "1 1 120px", minWidth: 0 }}>
          <Field label="Sort order">
            <input
              name="display_order"
              type="number"
              step="1"
              defaultValue={component?.display_order ?? 0}
              style={inputStyle}
            />
          </Field>
        </div>
      </div>
      <Field label="Description (optional)">
        <input
          name="description"
          defaultValue={component?.description ?? ""}
          placeholder="Notes shown next to the catalog row"
          style={inputStyle}
        />
      </Field>

      {/* Mig 044 — image upload. PNG (transparent) recommended.
          Reads the file as a data URL; preview shows the resulting
          image at card-sized scale so the user sees what cards will
          look like before saving. Max 200 KB. */}
      <Field label="Image (PNG, transparent)" wide>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 14,
            background: INV_THEME.cream,
            border: `1px solid ${INV_THEME.parchment}`,
            borderRadius: 8,
            padding: 10,
          }}
        >
          <div
            style={{
              width: 80,
              height: 80,
              flexShrink: 0,
              background: "#fff",
              border: `1px dashed ${INV_THEME.parchment}`,
              borderRadius: 6,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: INV_THEME.steel,
            }}
          >
            <ComponentIcon
              type={type}
              size={64}
              imageDataUrl={imageDataUrl ?? undefined}
            />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, flex: 1 }}>
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={onImagePick}
              style={{ fontSize: 12 }}
              aria-label="Upload component image"
            />
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              {imageDataUrl && (
                <button
                  type="button"
                  onClick={() => {
                    setImageDataUrl(null);
                    setImageError(null);
                  }}
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    background: "transparent",
                    color: INV_THEME.stockOut,
                    border: "none",
                    cursor: "pointer",
                    padding: 0,
                    textDecoration: "underline",
                  }}
                >
                  Remove image
                </button>
              )}
              <span
                style={{
                  fontSize: 10,
                  color: INV_THEME.steelLight,
                  marginLeft: imageDataUrl ? "auto" : 0,
                }}
              >
                PNG / JPG / WebP, ≤ 200 KB
              </span>
            </div>
            {imageError && (
              <span
                style={{
                  fontSize: 11,
                  color: INV_THEME.stockOut,
                  fontWeight: 600,
                }}
              >
                {imageError}
              </span>
            )}
          </div>
        </div>
      </Field>

      {error && (
        <div
          role="alert"
          style={{
            padding: "8px 10px",
            background: "rgba(193, 68, 46, 0.1)",
            color: INV_THEME.stockOut,
            fontSize: 12,
            fontWeight: 600,
            border: `1px solid ${INV_THEME.stockOut}`,
            borderRadius: 6,
          }}
        >
          {error}
        </div>
      )}
      <div
        style={{
          display: "flex",
          gap: 8,
          justifyContent: "flex-end",
          paddingTop: 4,
          borderTop: `1px solid ${INV_THEME.parchment}`,
          marginTop: 2,
        }}
      >
        <button type="button" onClick={onCancel} style={secondaryButton}>
          Cancel
        </button>
        <button type="submit" style={primaryButton} disabled={submitting}>
          {submitting ? "Saving…" : mode === "create" ? "Create component" : "Save changes"}
        </button>
      </div>
    </form>
  );
}

function Field({
  label,
  children,
  // Mig 084 follow-on — `wide` is a no-op now that the form is a
  // flex column (every field is full-width by default). Kept in the
  // signature so existing call sites with `wide` don't error.
  wide: _wide,
}: {
  label: string;
  children: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <label
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 5,
        width: "100%",
      }}
    >
      <span
        style={{
          fontSize: 10,
          fontWeight: 800,
          color: INV_THEME.steelLight,
          textTransform: "uppercase",
          letterSpacing: "0.1em",
        }}
      >
        {label}
      </span>
      {children}
    </label>
  );
}

const inputStyle: React.CSSProperties = {
  padding: "9px 12px",
  fontSize: 13.5,
  border: `1px solid ${INV_THEME.parchment}`,
  borderRadius: 8,
  background: INV_THEME.cream,
  color: INV_THEME.steel,
  width: "100%",
  boxSizing: "border-box",
};
