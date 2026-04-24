"use client";

import { useState, useEffect } from "react";
import { addSlabAction } from "./actions";
import { nextSlabCodeFromMaxId } from "./utils";
import { LabelSelect } from "./label-select";

type Temple = { id: string; name: string; code_prefix: string; default_stone?: string | null };
type StoneType = { id: string; name: string };
type UnitMode = "inches" | "feetinches";

function toInches(ft: string, ino: string): string {
  const f = parseFloat(ft) || 0;
  const i = parseFloat(ino) || 0;
  const total = f * 12 + i;
  return total > 0 ? String(total) : "";
}

function calcCft(l: string, w: string, t: string): string {
  const lv = parseFloat(l), wv = parseFloat(w), tv = parseFloat(t);
  if (!lv || !wv || !tv) return "—";
  return ((lv * wv * tv) / 1728).toFixed(2);
}

function previewCodes(baseCode: string, qty: number): string {
  if (qty <= 1) return baseCode;
  const codes = [baseCode];
  for (let i = 1; i < Math.min(qty, 4); i++) codes.push(`${baseCode}-${i}`);
  return codes.join(", ") + (qty > 4 ? ` … +${qty - 4} more` : "");
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

export function AddSlabForm({
  temples,
  maxIdByPrefix,
  stoneTypes = [],
  labels = [],
}: {
  temples: Temple[];
  /** Highest existing slab id per temple code_prefix, computed server-side
   * via ORDER BY id DESC LIMIT 1. Sidesteps Supabase's 1000-row cap. */
  maxIdByPrefix: Record<string, string | null>;
  stoneTypes?: StoneType[];
  labels?: string[];
}) {
  const [quality, setQuality] = useState<"" | "A" | "B">("");
  const [selectedTemple, setSelectedTemple] = useState<Temple | null>(temples[0] ?? null);
  const [stone, setStone] = useState<string>(temples[0]?.default_stone ?? "PinkStone");
  const [l, setL] = useState("");
  const [w, setW] = useState("");
  const [t, setT] = useState("");
  const [qty, setQty] = useState(1);
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

  const isFtIn = unitMode === "feetinches";
  const cft = calcCft(l, w, t);
  const baseCode = selectedTemple
    ? nextSlabCodeFromMaxId(maxIdByPrefix[selectedTemple.code_prefix] ?? null, selectedTemple.code_prefix)
    : "—";
  const codePreview = baseCode === "—" ? "—" : previewCodes(baseCode, qty);

  return (
    <form action={addSlabAction} className="add-panel">
      <div className="add-panel-header" style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
        <div>
          <p className="add-panel-title">Add Slab Requirement</p>
          <p className="add-panel-subtitle">
            Temple determines slab code · {isFtIn ? "Dimensions in feet + inches" : "Dimensions in inches"}
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
        {/* Row 1: Temple + Quality */}
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
                  const found = temples.find(tp => tp.name === e.target.value) ?? null;
                  setSelectedTemple(found);
                  if (found?.default_stone) setStone(found.default_stone);
                }}
              >
                {temples.map(tp => <option key={tp.id} value={tp.name}>{tp.name}</option>)}
              </select>
            )}
          </label>

          {/* Stone — auto-set from temple but can be overridden */}
          <label className="stack" style={{ flex: "1 1 120px" }}>
            <span>Stone Type</span>
            <select name="stone" value={stone} onChange={e => setStone(e.target.value)}>
              {stoneTypes.length > 0
                ? stoneTypes.map(st => <option key={st.id} value={st.name}>{st.name}</option>)
                : <>
                    <option value="PinkStone">PinkStone</option>
                    <option value="WhiteStone">WhiteStone</option>
                  </>
              }
            </select>
          </label>

          <div className="stack" style={{ flex: "0 0 auto" }}>
            <span>Quality</span>
            <div className="stone-toggle">
              {(["", "A", "B"] as const).map(q => (
                <button
                  key={q}
                  type="button"
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

        {/* Row 2: Label (dropdown) + Description (free text) */}
        <div className="add-panel-row">
          <label className="stack" style={{ flex: "1 1 240px" }}>
            <span>Label</span>
            <LabelSelect labels={labels} name="label" />
          </label>
          <label className="stack" style={{ flex: "2 1 320px" }}>
            <span>Description</span>
            <input name="description" placeholder="Type description" />
          </label>
        </div>

        {/* Hidden inputs carry final inch values for submission */}
        <input type="hidden" name="length_in" value={l} />
        <input type="hidden" name="width_in" value={w} />
        <input type="hidden" name="thickness_in" value={t} />

        {/* Row 3: Dimensions + CFT + Quantity + Code preview + Submit */}
        <div className="add-panel-row">
          {isFtIn ? (
            <>
              <FtInInput label="Length" inchValue={l} onInchChange={setL} />
              <FtInInput label="Width" inchValue={w} onInchChange={setW} />
              <FtInInput label="Thickness" inchValue={t} onInchChange={setT} />
            </>
          ) : (
            <>
              <label className="stack" style={{ flex: "1 1 80px" }}>
                <span>Length (in)</span>
                <input type="number" min="0" step="0.5" value={l} onChange={e => setL(e.target.value)} placeholder="48" required />
              </label>
              <label className="stack" style={{ flex: "1 1 80px" }}>
                <span>Width (in)</span>
                <input type="number" min="0" step="0.5" value={w} onChange={e => setW(e.target.value)} placeholder="36" required />
              </label>
              <label className="stack" style={{ flex: "1 1 70px" }}>
                <span>Thickness (in)</span>
                <input type="number" min="0" step="0.25" value={t} onChange={e => setT(e.target.value)} placeholder="2" required />
              </label>
            </>
          )}

          <div className="stack" style={{ flex: "0 0 auto" }}>
            <span>CFT</span>
            <div className="cft-value" style={{ minWidth: 60 }}>{cft}</div>
          </div>

          <div className="stack" style={{ flex: "0 0 auto" }}>
            <span>Qty</span>
            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <button type="button" className="qty-btn" onClick={() => setQty(q => Math.max(1, q - 1))} disabled={qty <= 1}>−</button>
              <span className="cft-value" style={{ minWidth: 36, textAlign: "center", fontSize: 15, fontWeight: 700 }}>{qty}</span>
              <button type="button" className="qty-btn" onClick={() => setQty(q => Math.min(50, q + 1))} disabled={qty >= 50}>+</button>
            </div>
            <input type="hidden" name="quantity" value={qty} />
          </div>

          <div className="stack" style={{ flex: "0 0 auto" }}>
            <span>Code{qty > 1 ? "s" : ""}</span>
            <div
              className="cft-value"
              style={{ minWidth: 90, fontFamily: "ui-monospace, monospace", fontSize: 11, maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
              title={codePreview}
            >
              {codePreview}
            </div>
          </div>

          <div className="stack" style={{ flex: "0 0 auto", justifyContent: "flex-end" }}>
            <span style={{ visibility: "hidden", fontSize: 12 }}>·</span>
            <button className="primary-button" type="submit" disabled={temples.length === 0}>
              {qty > 1 ? `Add ${qty} Slabs` : "Add Slab"}
            </button>
          </div>
        </div>
      </div>
    </form>
  );
}
