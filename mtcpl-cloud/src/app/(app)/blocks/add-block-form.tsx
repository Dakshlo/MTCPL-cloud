"use client";

import { useState } from "react";
import { addBlockAction } from "./actions";

const STONES = ["PinkStone", "WhiteStone"] as const;
const YARDS = [1, 2, 3] as const;

function calcCft(l: string, w: string, h: string): string {
  const lv = parseFloat(l);
  const wv = parseFloat(w);
  const hv = parseFloat(h);
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
    <form action={addBlockAction} className="add-block-panel">
      <p className="add-block-title">Add New Block</p>
      <p className="add-block-subtitle">
        Dimensions in inches · CFT calculated automatically · ID auto-assigned
      </p>

      {/* Row 1: ID, Stone type, Yard */}
      <div className="form-row" style={{ marginBottom: 14 }}>
        <label className="stack wide">
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
            {STONES.map(s => (
              <button
                key={s}
                type="button"
                className={`stone-toggle-btn${stone === s ? (s === "PinkStone" ? " active-pink" : " active-white") : ""}`}
                onClick={() => setStone(s)}
              >
                {s}
              </button>
            ))}
          </div>
          <input type="hidden" name="stone" value={stone} />
        </div>

        <label className="stack narrow">
          <span>Yard</span>
          <select name="yard" defaultValue="1">
            {YARDS.map(y => (
              <option key={y} value={y}>Yard {y}</option>
            ))}
          </select>
        </label>
      </div>

      {/* Row 2: Dimensions + CFT */}
      <div className="form-row" style={{ alignItems: "flex-end" }}>
        <label className="stack narrow">
          <span>Length (in)</span>
          <input
            name="length_in"
            type="number"
            min="0"
            step="0.5"
            value={l}
            onChange={e => setL(e.target.value)}
            placeholder="72"
          />
        </label>

        <label className="stack narrow">
          <span>Width (in)</span>
          <input
            name="width_in"
            type="number"
            min="0"
            step="0.5"
            value={w}
            onChange={e => setW(e.target.value)}
            placeholder="48"
          />
        </label>

        <label className="stack narrow">
          <span>Height (in)</span>
          <input
            name="height_in"
            type="number"
            min="0"
            step="0.5"
            value={h}
            onChange={e => setH(e.target.value)}
            placeholder="24"
          />
        </label>

        <div className="cft-box" style={{ flex: "0 0 auto" }}>
          <span>CFT</span>
          <div className="cft-value">{cft}</div>
        </div>

        <div className="stack fixed" style={{ alignSelf: "flex-end" }}>
          <button className="primary-button" type="submit" style={{ height: 36 }}>
            Add Block
          </button>
        </div>
      </div>
    </form>
  );
}
