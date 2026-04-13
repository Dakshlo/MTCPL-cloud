"use client";

import { useState, useEffect } from "react";
import { addBlockAction } from "./actions";

const YARDS = [1, 2, 3, 4, 5, 6] as const;
type UnitMode = "inches" | "feetinches";

function toInches(ft: string, ino: string): string {
  const f = parseFloat(ft) || 0;
  const i = parseFloat(ino) || 0;
  const total = f * 12 + i;
  return total > 0 ? String(total) : "";
}

function calcCft(l: string, w: string, h: string): string {
  const lv = parseFloat(l), wv = parseFloat(w), hv = parseFloat(h);
  if (!lv || !wv || !hv) return "—";
  return ((lv * wv * hv) / 1728).toFixed(2);
}

function FtInInput({ label, inchValue, onInchChange }: { label: string; inchValue: string; onInchChange: (v: string) => void }) {
  const totalIn = parseFloat(inchValue) || 0;
  const [ft, setFt] = useState(totalIn >= 12 ? String(Math.floor(totalIn / 12)) : "");
  const [ino, setIno] = useState(totalIn > 0 ? String(Math.round(totalIn % 12)) : "");

  function handleFt(v: string) { setFt(v); onInchChange(toInches(v, ino)); }
  function handleIn(v: string) { setIno(v); onInchChange(toInches(ft, v)); }

  return (
    <label className="stack" style={{ flex: "1 1 110px" }}>
      <span>{label}</span>
      <div style={{ display: "flex", gap: 3, alignItems: "center" }}>
        <input type="number" min="0" step="1" value={ft} onChange={e => handleFt(e.target.value)} placeholder="0" style={{ width: "45%", minWidth: 0 }} />
        <span className="muted" style={{ fontSize: 11, whiteSpace: "nowrap" }}>ft</span>
        <input type="number" min="0" max="11" step="0.5" value={ino} onChange={e => handleIn(e.target.value)} placeholder="0" style={{ width: "38%", minWidth: 0 }} />
        <span className="muted" style={{ fontSize: 11, whiteSpace: "nowrap" }}>in</span>
      </div>
    </label>
  );
}

export function AddBlockForm({ suggestedId }: { suggestedId: string }) {
  const [stone, setStone] = useState<"PinkStone" | "WhiteStone">("PinkStone");
  const [quality, setQuality] = useState<"" | "A" | "B">("");
  const [l, setL] = useState("");
  const [w, setW] = useState("");
  const [h, setH] = useState("");
  const [unitMode, setUnitMode] = useState<UnitMode>("inches");

  useEffect(() => {
    const saved = localStorage.getItem("mtcpl_unit") as UnitMode | null;
    if (saved === "feetinches" || saved === "inches") setUnitMode(saved);
  }, []);

  function toggleUnit() {
    setUnitMode(m => {
      const next = m === "inches" ? "feetinches" : "inches";
      localStorage.setItem("mtcpl_unit", next);
      return next;
    });
  }

  const cft = calcCft(l, w, h);
  const isFtIn = unitMode === "feetinches";

  return (
    <form action={addBlockAction} className="add-panel">
      <div className="add-panel-header" style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
        <div>
          <p className="add-panel-title">Add New Block</p>
          <p className="add-panel-subtitle">
            {isFtIn ? "Dimensions in feet + inches" : "Dimensions in inches"} · CFT auto-calculated · ID auto-assigned
          </p>
        </div>
        <button
          type="button"
          onClick={toggleUnit}
          title="Toggle unit mode"
          style={{
            fontSize: 11, padding: "3px 9px", borderRadius: 6, cursor: "pointer", flexShrink: 0,
            background: "var(--bg)", border: "1px solid var(--border)", color: "var(--muted)", marginTop: 2
          }}
        >
          {isFtIn ? "ft+in ✓" : "in"}
        </button>
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
                  key={s} type="button"
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

          <div className="stack" style={{ flex: "0 0 auto" }}>
            <span>Quality</span>
            <div className="stone-toggle">
              {(["", "A", "B"] as const).map(q => (
                <button key={q} type="button"
                  className={`stone-toggle-btn${quality === q ? " active-pink" : ""}`}
                  onClick={() => setQuality(q)}
                >
                  {q === "" ? "Both" : `Grade ${q}`}
                </button>
              ))}
            </div>
            <input type="hidden" name="quality" value={quality} />
          </div>
        </div>

        {/* Row 2: Dimensions + CFT + Submit */}
        {/* Hidden inputs always carry the final inch value for submission */}
        <input type="hidden" name="length_in" value={l} />
        <input type="hidden" name="width_in" value={w} />
        <input type="hidden" name="height_in" value={h} />

        <div className="add-panel-row">
          {isFtIn ? (
            <>
              <FtInInput label="Length" inchValue={l} onInchChange={setL} />
              <FtInInput label="Width" inchValue={w} onInchChange={setW} />
              <FtInInput label="Height" inchValue={h} onInchChange={setH} />
            </>
          ) : (
            <>
              <label className="stack" style={{ flex: "1 1 80px" }}>
                <span>Length (in)</span>
                <input type="number" min="0" step="0.5" value={l} onChange={e => setL(e.target.value)} placeholder="72" />
              </label>
              <label className="stack" style={{ flex: "1 1 80px" }}>
                <span>Width (in)</span>
                <input type="number" min="0" step="0.5" value={w} onChange={e => setW(e.target.value)} placeholder="48" />
              </label>
              <label className="stack" style={{ flex: "1 1 80px" }}>
                <span>Height (in)</span>
                <input type="number" min="0" step="0.5" value={h} onChange={e => setH(e.target.value)} placeholder="24" />
              </label>
            </>
          )}

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
