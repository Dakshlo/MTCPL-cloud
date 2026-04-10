"use client";

import { useState } from "react";
import { addBlockAction } from "./actions";

const YARDS = [1, 2, 3] as const;

function calcCft(l: string, w: string, h: string): string {
  const lv = parseFloat(l), wv = parseFloat(w), hv = parseFloat(h);
  if (!lv || !wv || !hv) return "—";
  return ((lv * wv * hv) / 1728).toFixed(2);
}

export function AddBlockForm({ suggestedId }: { suggestedId: string }) {
  const [stone, setStone] = useState<"PinkStone" | "WhiteStone">("PinkStone");
  const [l, setL] = useState("");
  const [w, setW] = useState("");
  const [h, setH] = useState("");

  const cft = calcCft(l, w, h);

  return (
    <form action={addBlockAction} className="add-panel">
      <div className="add-panel-header">
        <div>
          <p className="add-panel-title">Add New Block</p>
          <p className="add-panel-subtitle">Dimensions in inches · CFT auto-calculated · ID auto-assigned</p>
        </div>
      </div>

      <div className="add-panel-body">
        {/* Row 1: Code + Stone + Yard */}
        <div className="add-panel-row">
          <label className="stack" style={{ flex: "2 1 160px" }}>
            <span>Block Code</span>
            <input
              name="id"
              defaultValue={suggestedId}
              placeholder={suggestedId}
              style={{ fontFamily: "ui-monospace, monospace", fontWeight: 600 }}
            />
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

          <label className="stack" style={{ flex: "0 0 100px" }}>
            <span>Yard</span>
            <select name="yard" defaultValue="1">
              {YARDS.map(y => <option key={y} value={y}>Yard {y}</option>)}
            </select>
          </label>
        </div>

        {/* Row 2: Dimensions + CFT + Submit */}
        <div className="add-panel-row">
          <label className="stack" style={{ flex: "1 1 80px" }}>
            <span>Length (in)</span>
            <input name="length_in" type="number" min="0" step="0.5" value={l} onChange={e => setL(e.target.value)} placeholder="72" />
          </label>
          <label className="stack" style={{ flex: "1 1 80px" }}>
            <span>Width (in)</span>
            <input name="width_in" type="number" min="0" step="0.5" value={w} onChange={e => setW(e.target.value)} placeholder="48" />
          </label>
          <label className="stack" style={{ flex: "1 1 80px" }}>
            <span>Height (in)</span>
            <input name="height_in" type="number" min="0" step="0.5" value={h} onChange={e => setH(e.target.value)} placeholder="24" />
          </label>

          <div className="stack" style={{ flex: "0 0 auto" }}>
            <span>CFT</span>
            <div className="cft-value" style={{ minWidth: 72 }}>{cft}</div>
          </div>

          <div className="stack" style={{ flex: "0 0 auto", justifyContent: "flex-end" }}>
            <span style={{ visibility: "hidden", fontSize: 12 }}>·</span>
            <button className="primary-button" type="submit">Add Block</button>
          </div>
        </div>
      </div>
    </form>
  );
}
