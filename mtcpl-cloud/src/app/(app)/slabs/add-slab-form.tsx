"use client";

import { useState } from "react";
import { addSlabAction } from "./actions";
import { generateSlabCode } from "./utils";

type Temple = { id: string; name: string; code_prefix: string };

function calcCft(l: string, w: string, t: string): string {
  const lv = parseFloat(l), wv = parseFloat(w), tv = parseFloat(t);
  if (!lv || !wv || !tv) return "—";
  return ((lv * wv * tv) / 1728).toFixed(2); // cubic feet
}

export function AddSlabForm({ temples, existingIds }: { temples: Temple[]; existingIds: string[] }) {
  const [stone, setStone] = useState<"PinkStone" | "WhiteStone">("PinkStone");
  const [priority, setPriority] = useState(false);
  const [selectedTemple, setSelectedTemple] = useState<Temple | null>(temples[0] ?? null);
  const [l, setL] = useState("");
  const [w, setW] = useState("");
  const [t, setT] = useState("");

  const cft = calcCft(l, w, t);
  const previewCode = selectedTemple ? generateSlabCode(existingIds, selectedTemple.code_prefix) : "—";

  return (
    <form action={addSlabAction} className="add-panel">
      <div className="add-panel-header">
        <div>
          <p className="add-panel-title">Add Slab Requirement</p>
          <p className="add-panel-subtitle">Temple determines slab code · Dimensions in inches</p>
        </div>
      </div>

      <div className="add-panel-body">
        {/* Row 1: Temple + Stone + Priority */}
        <div className="add-panel-row">
          <label className="stack" style={{ flex: "2 1 180px" }}>
            <span>Temple</span>
            {temples.length === 0 ? (
              <input name="temple" placeholder="Add temples in Settings first" disabled />
            ) : (
              <select
                name="temple"
                value={selectedTemple?.name ?? ""}
                onChange={e => {
                  const t = temples.find(t => t.name === e.target.value) ?? null;
                  setSelectedTemple(t);
                }}
              >
                {temples.map(t => <option key={t.id} value={t.name}>{t.name}</option>)}
              </select>
            )}
          </label>

          <div className="stack" style={{ flex: "0 0 auto" }}>
            <span>Stone Type</span>
            <div className="stone-toggle">
              {(["PinkStone", "WhiteStone"] as const).map(s => (
                <button
                  key={s}
                  type="button"
                  className={`stone-toggle-btn${stone === s ? (s === "PinkStone" ? " active-pink" : " active-white") : ""}`}
                  onClick={() => setStone(s)}
                >
                  {s === "PinkStone" ? "Pink" : "White"}
                </button>
              ))}
            </div>
            <input type="hidden" name="stone" value={stone} />
          </div>

          <div className="stack" style={{ flex: "0 0 auto" }}>
            <span>Priority</span>
            <button
              type="button"
              className={`stone-toggle-btn${priority ? " active-pink" : ""}`}
              style={{ border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", padding: "7px 16px" }}
              onClick={() => setPriority(p => !p)}
            >
              {priority ? "⚡ Priority" : "Normal"}
            </button>
            <input type="hidden" name="priority" value={String(priority)} />
          </div>
        </div>

        {/* Row 2: Label */}
        <div className="add-panel-row">
          <label className="stack" style={{ flex: 1 }}>
            <span>Label / Description</span>
            <input name="label" placeholder="e.g. Main Hall Floor Panel" required />
          </label>
        </div>

        {/* Row 3: Dimensions + Area + Code + Submit */}
        <div className="add-panel-row">
          <label className="stack" style={{ flex: "1 1 80px" }}>
            <span>Length (in)</span>
            <input name="length_in" type="number" min="0" step="0.5" value={l} onChange={e => setL(e.target.value)} placeholder="48" required />
          </label>
          <label className="stack" style={{ flex: "1 1 80px" }}>
            <span>Width (in)</span>
            <input name="width_in" type="number" min="0" step="0.5" value={w} onChange={e => setW(e.target.value)} placeholder="36" required />
          </label>
          <label className="stack" style={{ flex: "1 1 70px" }}>
            <span>Thickness (in)</span>
            <input name="thickness_in" type="number" min="0" step="0.25" value={t} onChange={e => setT(e.target.value)} placeholder="2" required />
          </label>

          <div className="stack" style={{ flex: "0 0 auto" }}>
            <span>CFT</span>
            <div className="cft-value" style={{ minWidth: 68 }}>{cft}</div>
          </div>

          <div className="stack" style={{ flex: "0 0 auto" }}>
            <span>Slab Code</span>
            <div className="cft-value" style={{ minWidth: 90, fontFamily: "ui-monospace, monospace", fontSize: 13 }}>
              {previewCode}
            </div>
          </div>

          <div className="stack" style={{ flex: "0 0 auto", justifyContent: "flex-end" }}>
            <span style={{ visibility: "hidden", fontSize: 12 }}>·</span>
            <button className="primary-button" type="submit" disabled={temples.length === 0}>Add Slab</button>
          </div>
        </div>
      </div>
    </form>
  );
}
