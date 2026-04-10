"use client";

import { useEffect, useState } from "react";
import { updateSlabAction, deleteSlabAction } from "./actions";

const STATUSES = ["open", "planned", "cutting", "cut_done", "completed", "rejected"] as const;

type Slab = {
  id: string;
  label: string;
  temple: string;
  stone: string | null;
  length_ft: number;
  width_ft: number;
  thickness_ft: number;
  status: string;
  priority: boolean;
};

type Temple = { id: string; name: string; code_prefix: string };

function stoneBadge(stone: string | null) {
  if (stone === "PinkStone") return "badge-pink";
  if (stone === "WhiteStone") return "badge-white-stone";
  return "";
}

function statusBadge(status: string) {
  const m: Record<string, string> = {
    open: "badge-open",
    planned: "badge-planned",
    completed: "badge-available",
    rejected: "badge-discarded",
  };
  return m[status] || "";
}

export function SlabGrid({ slabs, temples, canEdit }: { slabs: Slab[]; temples: Temple[]; canEdit: boolean }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = slabs.find(s => s.id === selectedId) ?? null;

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") setSelectedId(null); }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <>
      <div className="slab-card-grid">
        {slabs.map(slab => {
          const area = ((Number(slab.length_ft) * Number(slab.width_ft)) / 144).toFixed(1);
          const isSelected = selectedId === slab.id;

          return (
            <div
              key={slab.id}
              className={`slab-card${slab.priority ? " slab-card-priority" : ""}${isSelected ? " slab-card-active" : ""}`}
              onClick={() => setSelectedId(isSelected ? null : slab.id)}
              role="button"
              tabIndex={0}
              onKeyDown={e => { if (e.key === "Enter" || e.key === " ") setSelectedId(isSelected ? null : slab.id); }}
            >
              {slab.priority && <div className="slab-priority-bar" />}
              <div className="slab-card-top">
                <code className="slab-card-code">{slab.id}</code>
                {slab.priority && <span className="slab-priority-dot">⚡</span>}
              </div>
              <div className="slab-card-temple">{slab.temple}</div>
              <div className="slab-card-label">{slab.label}</div>
              <div className="slab-card-dims">
                {Number(slab.length_ft)}" × {Number(slab.width_ft)}" × {Number(slab.thickness_ft)}"
              </div>
              <div className="slab-card-footer">
                {slab.stone && <span className={`role-pill ${stoneBadge(slab.stone)}`}>{slab.stone === "PinkStone" ? "Pink" : "White"}</span>}
                <span className={`role-pill ${statusBadge(slab.status)}`}>{slab.status}</span>
                <span className="slab-card-area">{area} sq ft</span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Edit Drawer */}
      {selected && canEdit && (
        <>
          <div className="drawer-backdrop" onClick={() => setSelectedId(null)} />
          <div className="edit-drawer">
            <div className="drawer-header">
              <div>
                <div className="drawer-title">Edit Slab</div>
                <code className="drawer-subtitle">{selected.id}</code>
              </div>
              <button className="drawer-close" onClick={() => setSelectedId(null)}>✕</button>
            </div>

            <div className="drawer-body">
              <form action={updateSlabAction} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                <input name="id" type="hidden" value={selected.id} />

                <label className="stack">
                  <span>Label</span>
                  <input name="label" defaultValue={selected.label} required />
                </label>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <label className="stack">
                    <span>Temple</span>
                    <select name="temple" defaultValue={selected.temple}>
                      {temples.map(t => <option key={t.id} value={t.name}>{t.name}</option>)}
                    </select>
                  </label>
                  <label className="stack">
                    <span>Stone</span>
                    <select name="stone" defaultValue={selected.stone ?? ""}>
                      <option value="">— Not specified —</option>
                      <option value="PinkStone">PinkStone</option>
                      <option value="WhiteStone">WhiteStone</option>
                    </select>
                  </label>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
                  <label className="stack">
                    <span>Length (in)</span>
                    <input name="length_in" type="number" min="0" step="0.5" defaultValue={String(selected.length_ft)} />
                  </label>
                  <label className="stack">
                    <span>Width (in)</span>
                    <input name="width_in" type="number" min="0" step="0.5" defaultValue={String(selected.width_ft)} />
                  </label>
                  <label className="stack">
                    <span>Thickness (in)</span>
                    <input name="thickness_in" type="number" min="0" step="0.25" defaultValue={String(selected.thickness_ft)} />
                  </label>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <label className="stack">
                    <span>Status</span>
                    <select name="status" defaultValue={selected.status}>
                      {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </label>
                  <label className="stack">
                    <span>Priority</span>
                    <select name="priority" defaultValue={String(selected.priority)}>
                      <option value="false">Normal</option>
                      <option value="true">⚡ Priority</option>
                    </select>
                  </label>
                </div>

                <button className="primary-button" type="submit">Save Changes</button>
              </form>

              <div className="drawer-divider" />

              <div className="drawer-danger-zone">
                <p className="drawer-danger-label">Danger Zone</p>
                <form action={deleteSlabAction} style={{ display: "flex", gap: 10 }}>
                  <input name="id" type="hidden" value={selected.id} />
                  <input name="delete_code" placeholder="Code 1255 to delete" style={{ flex: 1 }} />
                  <button className="ghost-button danger-ghost" type="submit" formNoValidate>Delete</button>
                </form>
              </div>
            </div>
          </div>
        </>
      )}
    </>
  );
}
