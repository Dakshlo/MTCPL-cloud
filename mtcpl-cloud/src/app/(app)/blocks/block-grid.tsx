"use client";

import { useEffect, useState } from "react";
import { BlockCardPreview } from "@/components/stone-previews";
import { updateBlockAction, deleteBlockAction } from "./actions";

const STONES = ["PinkStone", "WhiteStone"] as const;
const YARDS = [1, 2, 3] as const;
const STATUSES = ["available", "reserved", "consumed", "discarded"] as const;

function calcCft(l: number, w: number, h: number) {
  return ((l * w * h) / 1728).toFixed(2);
}

function statusBadgeClass(status: string) {
  const map: Record<string, string> = {
    available: "badge-available",
    reserved: "badge-reserved",
    consumed: "badge-consumed",
    discarded: "badge-discarded",
  };
  return map[status] || "";
}

function fmtDate(iso: string | null) {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "2-digit" });
}

type Block = {
  id: string;
  stone: string;
  yard: number;
  length_ft: number;
  width_ft: number;
  height_ft: number;
  status: string;
  quality: string | null;
  truck_no: string | null;
  vendor_name: string | null;
  bill_no: string | null;
  created_at: string | null;
};

export function BlockGrid({ blocks, canEdit }: { blocks: Block[]; canEdit: boolean }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = blocks.find(b => b.id === selectedId) ?? null;

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setSelectedId(null);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <>
      <div className="block-card-grid">
        {blocks.map(block => {
          const L = Number(block.length_ft);
          const W = Number(block.width_ft);
          const H = Number(block.height_ft);
          const cft = calcCft(L, W, H);
          const stoneBadge = block.stone === "PinkStone" ? "badge-pink" : "badge-white-stone";
          const isSelected = selectedId === block.id;

          return (
            <div
              key={block.id}
              className={`block-card${isSelected ? " block-card-active" : ""}`}
              onClick={() => setSelectedId(isSelected ? null : block.id)}
              role="button"
              tabIndex={0}
              onKeyDown={e => { if (e.key === "Enter" || e.key === " ") setSelectedId(isSelected ? null : block.id); }}
            >
              <div className="block-card-preview">
                <BlockCardPreview stone={block.stone} l={L} w={W} h={H} />
              </div>
              <div className="block-card-info">
                <div className="block-card-code">{block.id}</div>
                <div className="block-card-badges">
                  <span className={`role-pill ${stoneBadge}`}>{block.stone === "PinkStone" ? "Pink" : "White"}</span>
                  <span className="role-pill">Y{block.yard}</span>
                  <span className={`role-pill ${statusBadgeClass(block.status)}`}>{block.status}</span>
                  {block.quality && (
                    <span className={`role-pill ${block.quality === "A" ? "badge-available" : "badge-reserved"}`}>
                      {block.quality === "A" ? "Grade A" : "Grade B"}
                    </span>
                  )}
                </div>
                <div className="block-card-dims">{L} × {W} × {H} ft</div>
                <div className="block-card-cft">{cft} CFT</div>
                {block.created_at && (
                  <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>Added {fmtDate(block.created_at)}</div>
                )}
              </div>
              {canEdit && <div className="block-card-edit-hint">{isSelected ? "✕ Close" : "Edit"}</div>}
            </div>
          );
        })}
      </div>

      {selected && canEdit && (
        <>
          <div className="drawer-backdrop" onClick={() => setSelectedId(null)} />
          <div className="edit-drawer">
            <div className="drawer-header">
              <div>
                <div className="drawer-title">Edit Block</div>
                <code className="drawer-subtitle">{selected.id}</code>
              </div>
              <button className="drawer-close" onClick={() => setSelectedId(null)}>✕</button>
            </div>

            <div className="drawer-body">
              <div className="drawer-preview">
                <BlockCardPreview
                  stone={selected.stone}
                  l={Number(selected.length_ft)}
                  w={Number(selected.width_ft)}
                  h={Number(selected.height_ft)}
                />
              </div>

              <form action={updateBlockAction} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                <input name="original_id" type="hidden" value={selected.id} />

                <label className="stack">
                  <span>Block Code</span>
                  <input name="id" defaultValue={selected.id} required style={{ fontFamily: "ui-monospace, monospace", fontWeight: 600 }} />
                </label>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <label className="stack">
                    <span>Stone</span>
                    <select name="stone" defaultValue={selected.stone}>
                      {STONES.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </label>
                  <label className="stack">
                    <span>Yard</span>
                    <select name="yard" defaultValue={String(selected.yard)}>
                      {YARDS.map(y => <option key={y} value={y}>Yard {y}</option>)}
                    </select>
                  </label>
                </div>

                <label className="stack">
                  <span>Status</span>
                  <select name="status" defaultValue={selected.status}>
                    {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </label>

                <label className="stack">
                  <span>Quality Grade</span>
                  <select name="quality" defaultValue={selected.quality ?? ""}>
                    <option value="">Both / Unspecified</option>
                    <option value="A">Grade A</option>
                    <option value="B">Grade B</option>
                  </select>
                </label>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
                  <label className="stack">
                    <span>Length (ft)</span>
                    <input name="length_in" type="number" min="0" step="0.5" defaultValue={String(selected.length_ft)} />
                  </label>
                  <label className="stack">
                    <span>Width (ft)</span>
                    <input name="width_in" type="number" min="0" step="0.5" defaultValue={String(selected.width_ft)} />
                  </label>
                  <label className="stack">
                    <span>Height (ft)</span>
                    <input name="height_in" type="number" min="0" step="0.5" defaultValue={String(selected.height_ft)} />
                  </label>
                </div>

                <details style={{ marginTop: 4 }}>
                  <summary style={{ cursor: "pointer", fontSize: 12, color: "var(--muted)", padding: "4px 0", userSelect: "none" }}>
                    Logistics Info (Truck No., Vendor, Bill No.)
                  </summary>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginTop: 10 }}>
                    <label className="stack">
                      <span>Truck No.</span>
                      <input name="truck_no" defaultValue={selected.truck_no ?? ""} placeholder="e.g. GJ01AB1234" />
                    </label>
                    <label className="stack">
                      <span>Vendor</span>
                      <input name="vendor_name" defaultValue={selected.vendor_name ?? ""} placeholder="e.g. Raj Stones" />
                    </label>
                    <label className="stack">
                      <span>Bill No.</span>
                      <input name="bill_no" defaultValue={selected.bill_no ?? ""} placeholder="e.g. INV-001" />
                    </label>
                  </div>
                </details>

                <button className="primary-button" type="submit" style={{ marginTop: 4 }}>Save Changes</button>
              </form>

              <div className="drawer-divider" />

              <div className="drawer-danger-zone">
                <p className="drawer-danger-label">Danger Zone</p>
                <form action={deleteBlockAction} onSubmit={(e) => { if (!confirm(`Delete block ${selected.id}? This cannot be undone.`)) e.preventDefault(); }}>
                  <input name="delete_target_id" type="hidden" value={selected.id} />
                  <button className="ghost-button danger-ghost" type="submit">Delete Block</button>
                </form>
              </div>
            </div>
          </div>
        </>
      )}
    </>
  );
}
