"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  upsertComponentAction,
  archiveComponentAction,
  unarchiveComponentAction,
} from "../../actions";
import {
  ComponentIcon,
  COMPONENT_TYPE_OPTIONS,
  labelForComponentType,
  type ScaffoldingComponentType,
} from "../../_components/component-icon";
import {
  INV_THEME,
  primaryButton,
  secondaryButton,
} from "../../_components/theme";
import type { ScaffoldingComponent } from "../../_components/stock";

export function ComponentsClient({
  components,
}: {
  components: ScaffoldingComponent[];
}) {
  const router = useRouter();
  const [editingId, setEditingId] = useState<string | "new" | null>(null);

  const active = components.filter((c) => c.is_active);
  const archived = components.filter((c) => !c.is_active);

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

      {/* Archived */}
      {archived.length > 0 && (
        <section
          style={{
            background: INV_THEME.paper,
            border: `1px solid ${INV_THEME.parchment}`,
            borderRadius: 10,
            padding: 14,
          }}
        >
          <h3
            style={{
              margin: "0 0 10px",
              fontSize: 12,
              fontWeight: 800,
              color: INV_THEME.steelLight,
              textTransform: "uppercase",
              letterSpacing: "0.1em",
            }}
          >
            Archived ({archived.length})
          </h3>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {archived.map((c) => (
              <ComponentRow
                key={c.id}
                component={c}
                archived
                onUnarchive={async () => {
                  const fd = new FormData();
                  fd.append("id", c.id);
                  await unarchiveComponentAction(fd);
                  router.refresh();
                }}
              />
            ))}
          </div>
        </section>
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
  onCancel,
  onSaved,
}: {
  mode: "create" | "edit";
  component?: ScaffoldingComponent;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [type, setType] = useState<ScaffoldingComponentType>(
    component?.component_type ?? "standard",
  );
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
        borderRadius: 10,
        padding: 14,
        display: "grid",
        gridTemplateColumns: "auto repeat(auto-fit, minmax(140px, 1fr))",
        gap: 10,
        alignItems: "center",
      }}
    >
      <div style={{ color: INV_THEME.steel }}>
        <ComponentIcon
          type={type}
          size={48}
          imageDataUrl={imageDataUrl ?? undefined}
        />
      </div>
      <Field label="Type">
        <select
          name="component_type"
          value={type}
          onChange={(e) => setType(e.target.value as ScaffoldingComponentType)}
          style={inputStyle}
        >
          {COMPONENT_TYPE_OPTIONS.map((t) => (
            <option key={t} value={t}>
              {labelForComponentType(t)}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Display name">
        <input
          name="name"
          defaultValue={component?.name ?? ""}
          required
          placeholder="Standard 2.5m"
          style={inputStyle}
        />
      </Field>
      <Field label="Size spec">
        <input
          name="size_spec"
          defaultValue={component?.size_spec ?? ""}
          placeholder="2.5m or blank"
          style={inputStyle}
        />
      </Field>
      <Field label="Unit">
        <input
          name="unit"
          defaultValue={component?.unit ?? "pcs"}
          required
          placeholder="pcs / kg / m"
          style={inputStyle}
        />
      </Field>
      <Field label="Sort order">
        <input
          name="display_order"
          type="number"
          step="1"
          defaultValue={component?.display_order ?? 0}
          style={inputStyle}
        />
      </Field>
      <Field label="Description" wide>
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
            gridColumn: "1 / -1",
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
          gridColumn: "1 / -1",
          display: "flex",
          gap: 8,
          justifyContent: "flex-end",
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
  wide,
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
        gap: 4,
        gridColumn: wide ? "1 / -1" : undefined,
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
  padding: "8px 10px",
  fontSize: 13,
  border: `1px solid ${INV_THEME.parchment}`,
  borderRadius: 6,
  background: INV_THEME.cream,
  color: INV_THEME.steel,
};
