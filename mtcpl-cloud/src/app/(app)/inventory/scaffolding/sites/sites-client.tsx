"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  upsertSiteAction,
  archiveSiteAction,
  unarchiveSiteAction,
} from "../../actions";
import { INV_THEME, primaryButton, secondaryButton } from "../../_components/theme";

type SiteRow = {
  id: string;
  code: string;
  name: string;
  address: string | null;
  manager_name: string | null;
  manager_phone: string | null;
  started_on: string | null;
  closed_on: string | null;
  is_plant: boolean;
  is_active: boolean;
  notes: string | null;
};

export function SitesClient({ sites }: { sites: SiteRow[] }) {
  const router = useRouter();
  const [editingId, setEditingId] = useState<string | "new" | null>(null);

  const plant = sites.find((s) => s.is_plant);
  const active = sites.filter((s) => !s.is_plant && s.is_active);
  const archived = sites.filter((s) => !s.is_plant && !s.is_active);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      {/* Plant row (read-only) */}
      {plant && (
        <section>
          <SectionLabel>Plant (Warehouse)</SectionLabel>
          <SiteRowDisplay site={plant} readOnly />
        </section>
      )}

      {/* Active project sites */}
      <section>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 8,
          }}
        >
          <SectionLabel inline>Active project sites ({active.length})</SectionLabel>
          {editingId !== "new" && (
            <button
              type="button"
              onClick={() => setEditingId("new")}
              style={primaryButton}
            >
              + Add site
            </button>
          )}
        </div>

        {editingId === "new" && (
          <SiteForm
            mode="create"
            onCancel={() => setEditingId(null)}
            onSaved={() => {
              setEditingId(null);
              router.refresh();
            }}
          />
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8 }}>
          {active.map((s) =>
            editingId === s.id ? (
              <SiteForm
                key={s.id}
                mode="edit"
                site={s}
                onCancel={() => setEditingId(null)}
                onSaved={() => {
                  setEditingId(null);
                  router.refresh();
                }}
              />
            ) : (
              <SiteRowDisplay
                key={s.id}
                site={s}
                onEdit={() => setEditingId(s.id)}
                onArchive={async () => {
                  if (!confirm(`Archive ${s.name}? Movement history is preserved; the site disappears from new-movement pickers.`)) return;
                  const fd = new FormData();
                  fd.append("id", s.id);
                  await archiveSiteAction(fd);
                  router.refresh();
                }}
              />
            ),
          )}
          {active.length === 0 && editingId !== "new" && (
            <div
              style={{
                padding: 24,
                textAlign: "center",
                color: INV_THEME.steelLight,
                fontSize: 12,
                border: `1px dashed ${INV_THEME.parchment}`,
                borderRadius: 10,
              }}
            >
              No active project sites yet. Click + Add site above to register
              your first one.
            </div>
          )}
        </div>
      </section>

      {/* Archived */}
      {archived.length > 0 && (
        <section>
          <SectionLabel>Archived ({archived.length})</SectionLabel>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8 }}>
            {archived.map((s) => (
              <SiteRowDisplay
                key={s.id}
                site={s}
                archived
                onUnarchive={async () => {
                  const fd = new FormData();
                  fd.append("id", s.id);
                  await unarchiveSiteAction(fd);
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

function SectionLabel({
  children,
  inline,
}: {
  children: React.ReactNode;
  inline?: boolean;
}) {
  return (
    <div
      style={{
        fontSize: 11,
        fontWeight: 800,
        color: INV_THEME.steel,
        textTransform: "uppercase",
        letterSpacing: "0.1em",
        marginBottom: inline ? 0 : 8,
      }}
    >
      {children}
    </div>
  );
}

function SiteRowDisplay({
  site,
  readOnly,
  archived,
  onEdit,
  onArchive,
  onUnarchive,
}: {
  site: SiteRow;
  readOnly?: boolean;
  archived?: boolean;
  onEdit?: () => void;
  onArchive?: () => void;
  onUnarchive?: () => void;
}) {
  return (
    <div
      style={{
        background: INV_THEME.paper,
        border: `1px solid ${INV_THEME.parchment}`,
        borderRadius: 10,
        padding: 14,
        display: "grid",
        gridTemplateColumns: "minmax(100px, auto) 1fr auto",
        gap: 12,
        alignItems: "center",
        opacity: archived ? 0.7 : 1,
      }}
    >
      <div
        style={{
          fontWeight: 800,
          fontSize: 12,
          color: site.is_plant ? "#fff" : INV_THEME.steel,
          background: site.is_plant ? INV_THEME.steel : INV_THEME.cream,
          padding: "5px 10px",
          borderRadius: 6,
          textAlign: "center",
          letterSpacing: "0.04em",
          textTransform: "uppercase",
          border: site.is_plant ? "none" : `1px solid ${INV_THEME.parchment}`,
        }}
      >
        {site.code}
      </div>
      <div>
        <div
          style={{
            fontWeight: 800,
            fontSize: 14,
            color: INV_THEME.steel,
          }}
        >
          {site.name}
        </div>
        <div
          style={{
            fontSize: 11,
            color: INV_THEME.steelLight,
            marginTop: 2,
            display: "flex",
            gap: 10,
            flexWrap: "wrap",
          }}
        >
          {site.manager_name && <span>👤 {site.manager_name}</span>}
          {site.manager_phone && <span>📞 {site.manager_phone}</span>}
          {site.address && <span>📍 {site.address}</span>}
          {site.started_on && <span>Started {site.started_on}</span>}
          {site.closed_on && <span>Closed {site.closed_on}</span>}
        </div>
        {site.notes && (
          <div
            style={{
              fontSize: 11,
              color: INV_THEME.steelLight,
              marginTop: 4,
              fontStyle: "italic",
            }}
          >
            {site.notes}
          </div>
        )}
      </div>
      <div style={{ display: "flex", gap: 6 }}>
        {!readOnly && !archived && (
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

function SiteForm({
  mode,
  site,
  onCancel,
  onSaved,
}: {
  mode: "create" | "edit";
  site?: SiteRow;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    const fd = new FormData(e.currentTarget);
    if (mode === "edit" && site) fd.append("id", site.id);
    const res = await upsertSiteAction(fd);
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
        padding: 16,
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
        gap: 10,
      }}
    >
      <Field label="Site code">
        <input
          name="code"
          defaultValue={site?.code ?? ""}
          required
          placeholder="ALPHA, BETA-2…"
          maxLength={32}
          style={inputStyle}
        />
      </Field>
      <Field label="Site name">
        <input
          name="name"
          defaultValue={site?.name ?? ""}
          required
          placeholder="Whitefield Apartments"
          style={inputStyle}
        />
      </Field>
      <Field label="Manager name">
        <input
          name="manager_name"
          defaultValue={site?.manager_name ?? ""}
          placeholder="Site manager / supervisor"
          style={inputStyle}
        />
      </Field>
      <Field label="Manager phone">
        <input
          name="manager_phone"
          defaultValue={site?.manager_phone ?? ""}
          placeholder="+91…"
          style={inputStyle}
        />
      </Field>
      <Field label="Started on">
        <input
          name="started_on"
          type="date"
          defaultValue={site?.started_on ?? ""}
          style={inputStyle}
        />
      </Field>
      <Field label="Address" wide>
        <input
          name="address"
          defaultValue={site?.address ?? ""}
          placeholder="Street, city, landmark"
          style={inputStyle}
        />
      </Field>
      <Field label="Notes" wide>
        <textarea
          name="notes"
          defaultValue={site?.notes ?? ""}
          placeholder="Anything the storekeeper or owner should know"
          rows={2}
          style={{ ...inputStyle, resize: "vertical" }}
        />
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
          {submitting ? "Saving…" : mode === "create" ? "Create site" : "Save changes"}
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
