"use client";

import { useEffect, useState } from "react";
import {
  addExternalCutSlabAction,
  deleteExternalCutSlabAction,
  updateExternalCutSlabAction,
  // Mig 081 follow-on — batch edit/delete for multi-add groups.
  bulkUpdateExternalCutSlabsAction,
  bulkDeleteExternalCutSlabsAction,
} from "./actions";
import { StyledSelect } from "@/components/styled-select";

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
  /** Mig 081 follow-on — non-null when this slab was added as part
   *  of a multi-add. All slabs sharing a batch_id render as a single
   *  group in the panel with batch-level Edit / Delete affordances. */
  batch_id: string | null;
};

/** Mig 091 follow-on — an external slab that has already been assigned
 *  (moved past unassigned into the carving flow). Shown read-only in
 *  the panel so the user can see previously-added slabs aren't lost. */
export type AssignedExternalSlab = {
  id: string;
  temple: string;
  stone: string;
  length_ft: number;
  width_ft: number;
  thickness_ft: number;
  label: string | null;
  status: string;
};

export function ExternalCutSlabsPanel({
  temples,
  stoneTypes,
  externalSlabs,
  assignedExternalSlabs = [],
}: {
  temples: Temple[];
  stoneTypes: StoneType[];
  externalSlabs: ExternalSlab[];
  assignedExternalSlabs?: AssignedExternalSlab[];
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
          assignedExternalSlabs={assignedExternalSlabs}
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
  assignedExternalSlabs,
  onClose,
}: {
  temples: Temple[];
  stoneTypes: StoneType[];
  externalSlabs: ExternalSlab[];
  assignedExternalSlabs: AssignedExternalSlab[];
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

          {/* Mig 091 follow-on — read-only list of external slabs the
              user added earlier that have ALREADY been assigned. They
              live in the carving flow now (Active tab etc.); shown here
              so "where did my added slabs go?" has a clear answer. */}
          {assignedExternalSlabs.length > 0 && (
            <details style={{ marginTop: 18 }}>
              <summary
                style={{
                  cursor: "pointer",
                  fontSize: 12,
                  fontWeight: 800,
                  color: "var(--muted)",
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                  padding: "8px 0",
                  userSelect: "none",
                }}
              >
                📤 Previously added · already assigned ({assignedExternalSlabs.length})
              </summary>
              <p style={{ fontSize: 11, color: "var(--muted)", margin: "0 0 8px" }}>
                These external slabs were added here and have since been assigned —
                they&apos;re now in the carving flow (see the Active tab). Read-only.
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {assignedExternalSlabs.map((s) => (
                  <div
                    key={s.id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      padding: "8px 12px",
                      background: "var(--surface-alt)",
                      border: "1px solid var(--border)",
                      borderRadius: 8,
                      fontSize: 12,
                      flexWrap: "wrap",
                      opacity: 0.92,
                    }}
                  >
                    <strong style={{ color: "var(--text)" }}>{s.label || "(no label)"}</strong>
                    <span style={{ color: "var(--muted)" }}>{s.temple}</span>
                    <span style={{ color: "var(--muted)", fontFamily: "ui-monospace, monospace" }}>
                      {s.length_ft}×{s.width_ft}×{s.thickness_ft}″
                    </span>
                    {s.stone && <span style={{ color: "var(--muted)" }}>{s.stone}</span>}
                    <span
                      style={{
                        marginLeft: "auto",
                        fontSize: 10,
                        fontWeight: 800,
                        padding: "2px 8px",
                        borderRadius: 4,
                        background: "rgba(22,163,74,0.12)",
                        color: "#15803d",
                        textTransform: "uppercase",
                        letterSpacing: "0.04em",
                      }}
                    >
                      {s.status.replace(/_/g, " ")}
                    </span>
                  </div>
                ))}
              </div>
            </details>
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
  // Mig 081 follow-on — split into singletons + batches. A batch =
  // 2+ slabs sharing the same batch_id (added in one multi-add). All
  // batch members render together with batch-level Edit/Delete; one-
  // off external slabs render individually with the existing
  // single-slab affordances.
  const batches = new Map<string, ExternalSlab[]>();
  const singletons: ExternalSlab[] = [];
  for (const s of slabs) {
    if (s.batch_id) {
      const arr = batches.get(s.batch_id) ?? [];
      arr.push(s);
      batches.set(s.batch_id, arr);
    } else {
      singletons.push(s);
    }
  }
  // A "batch" of one is still a singleton from the user's POV — fold
  // it back. Happens if someone deletes all-but-one from a batch.
  for (const [bId, arr] of batches.entries()) {
    if (arr.length === 1) {
      singletons.push(arr[0]);
      batches.delete(bId);
    }
  }
  const batchEntries = [...batches.entries()].sort(([, aArr], [, bArr]) =>
    aArr[0].id.localeCompare(bArr[0].id),
  );

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
        {batchEntries.map(([batchId, batchSlabs]) => (
          <BatchGroup
            key={batchId}
            batchId={batchId}
            slabs={batchSlabs}
            temples={temples}
            stoneTypes={stoneTypes}
          />
        ))}
        {singletons.map((s) => (
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

/** Mig 081 follow-on — renders a multi-add batch as a single
 *  collapsible card with batch-level Edit + Delete buttons. The
 *  default is collapsed (just the summary + actions); click the
 *  header to expand and see each slab id in the batch. */
function BatchGroup({
  batchId,
  slabs,
  temples,
  stoneTypes,
}: {
  batchId: string;
  slabs: ExternalSlab[];
  temples: Temple[];
  stoneTypes: StoneType[];
}) {
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  // All members of the batch share their metadata at creation time,
  // so picking [0] as the representative is correct. The bulk-update
  // server action re-resolves the set anyway.
  const rep = slabs[0];
  const dims = `${rep.length_ft}×${rep.width_ft}×${rep.thickness_ft}″`;

  if (editing) {
    return (
      <div
        style={{
          padding: 14,
          background: "rgba(217,119,6,0.04)",
          borderTop: "1px solid var(--border)",
        }}
      >
        <div
          style={{
            fontSize: 11,
            fontWeight: 800,
            color: "var(--gold-dark)",
            textTransform: "uppercase",
            letterSpacing: "0.06em",
            marginBottom: 10,
          }}
        >
          ✎ Editing batch of {slabs.length} — every change applies to all
          {" "}slabs in this batch
        </div>
        <AddOrEditForm
          mode="batchEdit"
          existing={rep}
          batchId={batchId}
          batchSize={slabs.length}
          temples={temples}
          stoneTypes={stoneTypes}
          onCancel={() => setEditing(false)}
        />
      </div>
    );
  }

  return (
    <div
      style={{
        borderTop: "1px solid var(--border)",
        background: "rgba(217,119,6,0.04)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "10px 14px",
          flexWrap: "wrap",
        }}
      >
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          style={{
            background: "transparent",
            border: "none",
            cursor: "pointer",
            padding: 0,
            display: "flex",
            alignItems: "center",
            gap: 8,
            flex: "1 1 220px",
            minWidth: 0,
            color: "inherit",
            textAlign: "left",
          }}
          aria-expanded={expanded}
        >
          <span
            aria-hidden
            style={{
              fontSize: 11,
              color: "var(--muted)",
              transition: "transform 0.18s ease",
              transform: expanded ? "rotate(90deg)" : "rotate(0)",
              display: "inline-block",
            }}
          >
            ▶
          </span>
          <span
            style={{
              fontSize: 10,
              fontWeight: 800,
              padding: "2px 8px",
              borderRadius: 999,
              background: "var(--gold-dark)",
              color: "#fff",
              letterSpacing: "0.05em",
              flexShrink: 0,
            }}
          >
            📦 BATCH OF {slabs.length}
          </span>
          <span
            style={{
              fontFamily: "ui-monospace, monospace",
              fontWeight: 700,
              fontSize: 13,
              color: "var(--text)",
              flex: 1,
              minWidth: 0,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {rep.id}
            {slabs.length > 1
              ? ` … ${slabs[slabs.length - 1].id}`
              : ""}
          </span>
          {rep.priority && (
            <span
              style={{
                fontSize: 10,
                fontWeight: 800,
                padding: "1px 7px",
                borderRadius: 999,
                background: "#dc2626",
                color: "#fff",
                letterSpacing: "0.05em",
                flexShrink: 0,
              }}
            >
              ⚡ PRIORITY
            </span>
          )}
        </button>
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
            title="Edit every slab in this batch with the same values"
          >
            ✎ Edit batch
          </button>
          <form
            action={bulkDeleteExternalCutSlabsAction}
            onSubmit={(e) => {
              if (
                !window.confirm(
                  `Delete this entire batch of ${slabs.length} slabs?\n\nIDs: ${slabs.map((s) => s.id).join(", ")}\n\nThis cannot be undone.`,
                )
              ) {
                e.preventDefault();
              }
            }}
          >
            <input type="hidden" name="batch_id" value={batchId} />
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
              title="Delete every slab in this batch"
            >
              🗑 Delete batch
            </button>
          </form>
        </div>
      </div>
      {/* Slab summary line — same compact metadata as a single row */}
      <div
        style={{
          padding: "0 14px 8px 38px",
          fontSize: 11,
          color: "var(--muted)",
        }}
      >
        {dims} · {rep.stone}
        {rep.stock_location && ` · 📍 ${rep.stock_location}`}
        {rep.label && ` · 🏷 ${rep.label}`}
      </div>
      {rep.description && (
        <div
          style={{
            padding: "0 14px 10px 38px",
            fontSize: 11,
            color: "var(--text)",
            fontStyle: "italic",
          }}
        >
          {rep.description}
        </div>
      )}
      {expanded && (
        <div
          style={{
            padding: "8px 14px 12px 38px",
            borderTop: "1px dashed var(--border)",
            background: "var(--bg)",
            display: "flex",
            flexDirection: "column",
            gap: 4,
          }}
        >
          <div
            style={{
              fontSize: 10,
              fontWeight: 800,
              color: "var(--muted)",
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              marginBottom: 4,
            }}
          >
            All {slabs.length} ids in this batch:
          </div>
          {slabs.map((s) => (
            <div
              key={s.id}
              style={{
                fontFamily: "ui-monospace, monospace",
                fontSize: 12,
                color: "var(--text)",
              }}
            >
              · {s.id}
            </div>
          ))}
        </div>
      )}
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

/** Shared form for Add / single-Edit / batch-Edit. Mode controls
 *  which server action is hit + which hidden inputs ride along
 *  (single edit posts `id`; batch edit posts `batch_id` + `batchSize`
 *  is shown in the heading). Fields mirror the existing Required
 *  Sizes AddSlabForm so the carving-side data entry feels consistent.
 *
 *  Mig 081 follow-on:
 *  • Add mode now has a Quantity stepper (1-100) — multi-add
 *    creates a batch with shared metadata.
 *  • Label / Description / Stock location are now REQUIRED (with
 *    visible badges + server enforcement).
 *  • New "batchEdit" mode reuses the same form to edit every slab
 *    in a batch with one submission. */
function AddOrEditForm({
  mode,
  existing,
  batchId,
  batchSize,
  temples,
  stoneTypes,
  onCancel,
}: {
  mode: "add" | "edit" | "batchEdit";
  existing?: ExternalSlab;
  /** Only for batchEdit. Posts as the hidden batch_id input. */
  batchId?: string;
  /** Only for batchEdit. Drives the submit button label. */
  batchSize?: number;
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
  // Mig 081 — quantity stepper, only active in add mode. Mirrors the
  // pattern from /slabs Required Sizes add form.
  const [qty, setQty] = useState<number>(1);

  const dimsOk =
    Number(length) > 0 && Number(width) > 0 && Number(thickness) > 0;
  // Mandatory metadata — block submit when any are blank. Server
  // enforces too, but failing client-side is faster + clearer.
  const metadataOk =
    label.trim().length > 0 &&
    description.trim().length > 0 &&
    stockLocation.trim().length > 0;
  const canSubmit = !!selectedTemple && !!stone && dimsOk && metadataOk;

  const action =
    mode === "batchEdit"
      ? bulkUpdateExternalCutSlabsAction
      : mode === "edit"
        ? updateExternalCutSlabAction
        : addExternalCutSlabAction;

  return (
    <form
      action={action}
      style={{ display: "flex", flexDirection: "column", gap: 10 }}
    >
      <input type="hidden" name="redirect_to" value="/carving" />
      {mode === "edit" && existing && (
        <input type="hidden" name="id" value={existing.id} />
      )}
      {mode === "batchEdit" && batchId && (
        <input type="hidden" name="batch_id" value={batchId} />
      )}
      {mode === "add" && (
        <input type="hidden" name="quantity" value={String(qty)} />
      )}

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <Field label="Temple *" flex>
          <input type="hidden" name="temple" value={selectedTemple?.name ?? ""} />
          <StyledSelect
            placeholder="— select temple —"
            searchPlaceholder="Search temples…"
            value={selectedTemple?.name ?? ""}
            onChange={(name) => {
              const t = temples.find((x) => x.name === name) ?? null;
              setSelectedTemple(t);
              if (t?.default_stone && !existing) setStone(t.default_stone);
            }}
            options={temples.map((t) => ({
              value: t.name,
              label: t.name,
              subtitle: t.code_prefix,
              keywords: t.code_prefix,
              icon: "🏛",
            }))}
            required
          />
        </Field>
        <Field label="Stone *" flex>
          <input type="hidden" name="stone" value={stone} />
          <StyledSelect
            placeholder="— select stone —"
            searchPlaceholder="Search stones…"
            value={stone}
            onChange={setStone}
            options={stoneTypes.map((s) => ({
              value: s.name,
              label: s.name,
            }))}
            required
          />
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

      {/* Mig 081 follow-on — label / description / stock_location
          are now mandatory (server enforces too). REQUIRED badge +
          required attribute on the inputs so the browser blocks
          submit before the round-trip. */}
      <Field label="Label *">
        <input
          type="text"
          name="label"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          maxLength={80}
          placeholder={selectedTemple?.name ?? "Slab label"}
          required
          style={inputStyle}
        />
      </Field>
      <Field label="Description *">
        <input
          type="text"
          name="description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={200}
          placeholder="e.g. corner piece, top row"
          required
          style={inputStyle}
        />
      </Field>
      <Field label="Stock location *">
        <input
          type="text"
          name="stock_location"
          value={stockLocation}
          onChange={(e) => setStockLocation(e.target.value)}
          maxLength={60}
          placeholder="e.g. Yard A · row 3"
          required
          style={inputStyle}
        />
      </Field>
      <div style={{ display: "flex", gap: 8 }}>
        <Field label="Quality" flex>
          <input type="hidden" name="quality" value={quality} />
          <StyledSelect
            placeholder="—"
            value={quality}
            onChange={(v) => setQuality(v as "" | "A" | "B")}
            options={[
              { value: "", label: "—" },
              { value: "A", label: "Grade A" },
              { value: "B", label: "Grade B" },
            ]}
          />
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

      {/* Mig 081 follow-on — quantity stepper. Add-mode only; the
          edit/batchEdit paths operate on existing rows. Up to 100,
          matching the /slabs Required Sizes add form. */}
      {mode === "add" && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 14,
            padding: "10px 12px",
            background: "var(--bg)",
            border: "1px dashed var(--border)",
            borderRadius: 8,
            flexWrap: "wrap",
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                fontSize: 11,
                fontWeight: 700,
                color: "var(--muted)",
                textTransform: "uppercase",
                letterSpacing: "0.04em",
              }}
            >
              Quantity
            </div>
            <div
              style={{
                fontSize: 11,
                color: "var(--muted)",
                marginTop: 2,
                lineHeight: 1.4,
              }}
            >
              {qty === 1
                ? "Adds one slab. Use the +/− buttons to add a batch (e.g. 5 identical slabs)."
                : `Adds ${qty} slabs as a single batch — all share these dimensions + metadata and can be edited / deleted together later.`}
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <button
              type="button"
              onClick={() => setQty((q) => Math.max(1, q - 1))}
              disabled={qty <= 1}
              style={{
                width: 32,
                height: 32,
                fontSize: 16,
                fontWeight: 800,
                background: "var(--surface)",
                color: qty > 1 ? "var(--text)" : "var(--muted)",
                border: "1px solid var(--border)",
                borderRadius: 6,
                cursor: qty > 1 ? "pointer" : "not-allowed",
                lineHeight: 1,
              }}
              aria-label="Decrease quantity"
            >
              −
            </button>
            <div
              style={{
                minWidth: 50,
                textAlign: "center",
                fontSize: 18,
                fontWeight: 800,
                fontFamily: "ui-monospace, monospace",
                color: "var(--text)",
              }}
            >
              {qty}
            </div>
            <button
              type="button"
              onClick={() => setQty((q) => Math.min(100, q + 1))}
              disabled={qty >= 100}
              style={{
                width: 32,
                height: 32,
                fontSize: 16,
                fontWeight: 800,
                background: "var(--surface)",
                color: qty < 100 ? "var(--text)" : "var(--muted)",
                border: "1px solid var(--border)",
                borderRadius: 6,
                cursor: qty < 100 ? "pointer" : "not-allowed",
                lineHeight: 1,
              }}
              aria-label="Increase quantity"
            >
              +
            </button>
          </div>
        </div>
      )}

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
          {mode === "batchEdit"
            ? `Save batch of ${batchSize ?? "?"}`
            : mode === "edit"
              ? "Save changes"
              : qty > 1
                ? `Add ${qty} slabs to Unassigned`
                : "Add to Unassigned"}
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
