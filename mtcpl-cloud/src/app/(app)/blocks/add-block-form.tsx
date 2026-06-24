"use client";

import { useState, useEffect, type CSSProperties } from "react";
import { addBlockAction } from "./actions";
import { VendorSelect } from "./vendor-select";
import { stoneDisplayName } from "@/lib/stone-utils";
import { FACILITIES, YARDS_BY_FACILITY, facilityLabel, yardLabel, type Facility } from "@/lib/yards";

type StoneType = { name: string; color_top: string };
type UnitMode = "inches" | "feetinches";
type DimRow = { key: number; l: string; w: string; h: string };

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

/** Increment a trailing-number code, e.g. codeAt("MT-B-737", 2) → "MT-B-739". */
function codeAt(base: string, offset: number): string {
  const m = base.match(/^(.*?)(\d+)$/);
  if (!m) return offset === 0 ? base : `${base}-${offset + 1}`;
  const num = parseInt(m[2], 10) + offset;
  return `${m[1]}${String(num).padStart(m[2].length, "0")}`;
}

function FtInInput({ label, inchValue, onInchChange }: { label: string; inchValue: string; onInchChange: (v: string) => void }) {
  const totalIn = parseFloat(inchValue) || 0;
  const [ft, setFt] = useState(totalIn >= 12 ? String(Math.floor(totalIn / 12)) : "");
  const [ino, setIno] = useState(totalIn > 0 ? String(Math.round(totalIn % 12)) : "");
  function handleFt(v: string) { setFt(v); onInchChange(toInches(v, ino)); }
  function handleIn(v: string) { setIno(v); onInchChange(toInches(ft, v)); }
  return (
    <label className="stack" style={{ flex: "1 1 100px", minWidth: 0 }}>
      <span>{label}</span>
      <div style={{ display: "flex", gap: 3, alignItems: "center" }}>
        <input type="number" min="0" step="1" value={ft} onChange={e => handleFt(e.target.value)} placeholder="0" style={{ width: "45%", minWidth: 0 }} />
        <span className="muted" style={{ fontSize: 11 }}>ft</span>
        <input type="number" min="0" max="11" step="0.5" value={ino} onChange={e => handleIn(e.target.value)} placeholder="0" style={{ width: "38%", minWidth: 0 }} />
        <span className="muted" style={{ fontSize: 11 }}>in</span>
      </div>
    </label>
  );
}

/** One block's dimension row. Top-level component (keyed by row id) so editing
 *  a field never remounts the inputs and drops focus. */
function BlockDimRow({ code, row, isFtIn, onChange, onRemove }: {
  code: string;
  row: DimRow;
  isFtIn: boolean;
  onChange: (field: "l" | "w" | "h", value: string) => void;
  onRemove?: () => void;
}) {
  const cft = calcCft(row.l, row.w, row.h);
  return (
    <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end", padding: "10px 12px", border: "1px solid var(--border)", borderRadius: 9, background: "var(--bg)" }}>
      <div style={{ flex: "0 0 auto", alignSelf: "center" }}>
        <span style={{ fontFamily: "ui-monospace, monospace", fontWeight: 700, fontSize: 12.5, color: "var(--gold-dark)", background: "var(--gold-subtle)", border: "1px solid var(--gold-border)", borderRadius: 6, padding: "3px 8px", whiteSpace: "nowrap" }}>{code}</span>
      </div>
      {isFtIn ? (
        <>
          <FtInInput label="Length" inchValue={row.l} onInchChange={(v) => onChange("l", v)} />
          <FtInInput label="Width" inchValue={row.w} onInchChange={(v) => onChange("w", v)} />
          <FtInInput label="Height" inchValue={row.h} onInchChange={(v) => onChange("h", v)} />
        </>
      ) : (
        <>
          <label className="stack" style={{ flex: "1 1 80px", minWidth: 0 }}><span>Length (in)</span>
            <input type="number" min="0" step="0.5" value={row.l} onChange={e => onChange("l", e.target.value)} placeholder="72" /></label>
          <label className="stack" style={{ flex: "1 1 80px", minWidth: 0 }}><span>Width (in)</span>
            <input type="number" min="0" step="0.5" value={row.w} onChange={e => onChange("w", e.target.value)} placeholder="48" /></label>
          <label className="stack" style={{ flex: "1 1 80px", minWidth: 0 }}><span>Height (in)</span>
            <input type="number" min="0" step="0.5" value={row.h} onChange={e => onChange("h", e.target.value)} placeholder="24" /></label>
        </>
      )}
      <div className="stack" style={{ flex: "0 0 auto" }}>
        <span>CFT</span>
        <div className="cft-value" style={{ minWidth: 64 }}>{cft}</div>
      </div>
      {onRemove && (
        <button type="button" onClick={onRemove} title="Remove this block" style={{ flex: "0 0 auto", border: "none", background: "transparent", color: "#dc2626", fontSize: 16, fontWeight: 700, cursor: "pointer", alignSelf: "center", padding: "4px 6px" }}>✕</button>
      )}
    </div>
  );
}

function Switch({ on, onClick }: { on: boolean; onClick: () => void }) {
  const track: CSSProperties = { width: 42, height: 24, borderRadius: 999, background: on ? "var(--gold-dark)" : "var(--border)", position: "relative", transition: "background .15s", flex: "0 0 auto", cursor: "pointer" };
  const knob: CSSProperties = { position: "absolute", top: 3, left: on ? 21 : 3, width: 18, height: 18, borderRadius: "50%", background: "#fff", transition: "left .15s", boxShadow: "0 1px 3px rgba(0,0,0,0.3)" };
  return <div role="switch" aria-checked={on} onClick={onClick} style={track}><span style={knob} /></div>;
}

const FALLBACK_STONES: StoneType[] = [
  { name: "PinkStone", color_top: "#EDCFC2" },
  { name: "WhiteStone", color_top: "#E8E6DC" },
];

export function AddBlockForm({ suggestedId, vendors, stoneTypes }: { suggestedId: string; vendors: string[]; stoneTypes?: StoneType[] }) {
  const stones = stoneTypes && stoneTypes.length > 0 ? stoneTypes : FALLBACK_STONES;
  const [stone, setStone] = useState<string>(stones[0]?.name ?? "PinkStone");
  const [quality, setQuality] = useState<"" | "A" | "B">("");
  const [facility, setFacility] = useState<Facility>("mtcpl");
  const [yard, setYard] = useState<number>(YARDS_BY_FACILITY["mtcpl"][0]);
  const [baseCode, setBaseCode] = useState(suggestedId);
  const [rows, setRows] = useState<DimRow[]>([{ key: 0, l: "", w: "", h: "" }]);
  const [nextKey, setNextKey] = useState(1);
  const [unitMode, setUnitMode] = useState<UnitMode>("inches");
  const [existingStock, setExistingStock] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const yardsForFacility = YARDS_BY_FACILITY[facility];
  function pickFacility(f: Facility) {
    if (f === facility) return;
    setFacility(f);
    setYard(YARDS_BY_FACILITY[f][0]);
  }

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

  function updateRow(key: number, field: "l" | "w" | "h", value: string) {
    setRows(rs => rs.map(r => (r.key === key ? { ...r, [field]: value } : r)));
  }
  function addRow() {
    setRows(rs => [...rs, { key: nextKey, l: "", w: "", h: "" }]);
    setNextKey(k => k + 1);
  }
  function removeRow(key: number) {
    setRows(rs => (rs.length > 1 ? rs.filter(r => r.key !== key) : rs));
  }

  const isFtIn = unitMode === "feetinches";
  const filledRows = rows.filter(r => r.l && r.w && r.h);
  // Submit only the dimension triples; the server assigns the real codes.
  const blocksJson = JSON.stringify(rows.map(r => ({ l: r.l, w: r.w, h: r.h })));

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    const fd = new FormData(e.currentTarget);
    if (filledRows.length === 0) {
      e.preventDefault();
      setFormError("Enter dimensions for at least one block.");
      return;
    }
    if (!existingStock) {
      const truck = String(fd.get("truck_no") || "").trim();
      const vend = String(fd.get("vendor_name") || "").trim();
      const bill = String(fd.get("bill_no") || "").trim();
      if (!truck || !vend || !bill) {
        e.preventDefault();
        setFormError("Truck No., Vendor and Bill No. are required. Turn on “Existing stock” to add without them.");
        return;
      }
    }
    setFormError(null);
  }

  return (
    <form action={addBlockAction} onSubmit={onSubmit} className="add-panel">
      <div className="add-panel-header">
        <div>
          <p className="add-panel-title">Add Block{rows.length > 1 ? `s · ${rows.length}` : ""}</p>
          <p className="add-panel-subtitle">{isFtIn ? "Feet + inches" : "Inches"} · CFT &amp; IDs auto-assigned</p>
        </div>
        <button type="button" onClick={toggleUnit} title="Toggle unit mode"
          style={{ fontSize: 11, padding: "3px 9px", borderRadius: 6, cursor: "pointer", flexShrink: 0, background: "var(--bg)", border: "1px solid var(--border)", color: "var(--muted)", marginTop: 2 }}>
          {isFtIn ? "ft+in ✓" : "in"}
        </button>
      </div>

      <div className="add-panel-body">
        {/* Shared attributes */}
        <div className="add-panel-row">
          <label className="stack" style={{ flex: "1 1 150px" }}>
            <span>Starting Code</span>
            <input value={baseCode} onChange={e => setBaseCode(e.target.value)} placeholder={suggestedId}
              style={{ fontFamily: "ui-monospace, monospace", fontWeight: 600 }} />
          </label>

          <div className="stack" style={{ flex: "0 0 auto" }}>
            <span>Stone Type</span>
            <div className="stone-toggle">
              {stones.map(s => (
                <button key={s.name} type="button"
                  className={`stone-toggle-btn${stone === s.name ? " active-pink" : ""}`}
                  style={stone === s.name ? { borderColor: s.color_top, background: s.color_top + "44" } : undefined}
                  onClick={() => setStone(s.name)}>
                  {stoneDisplayName(s.name)}
                </button>
              ))}
            </div>
            <input type="hidden" name="stone" value={stone} />
          </div>

          <div className="stack" style={{ flex: "0 0 auto" }}>
            <span>Facility</span>
            <div className="stone-toggle">
              {FACILITIES.map(f => (
                <button key={f} type="button" className={`stone-toggle-btn${facility === f ? " active-pink" : ""}`} onClick={() => pickFacility(f)}>
                  {facilityLabel(f)}
                </button>
              ))}
            </div>
          </div>

          <label className="stack" style={{ flex: "0 0 auto", minWidth: 130 }}>
            <span>Yard</span>
            <select name="yard" value={yard} onChange={e => setYard(Number(e.target.value))}>
              {yardsForFacility.map(y => <option key={y} value={y}>{yardLabel(y)}</option>)}
            </select>
          </label>

          <div className="stack" style={{ flex: "0 0 auto" }}>
            <span>Quality</span>
            <div className="stone-toggle">
              {(["", "A", "B"] as const).map(q => (
                <button key={q} type="button" className={`stone-toggle-btn${quality === q ? " active-pink" : ""}`} onClick={() => setQuality(q)}>
                  {q === "" ? "Both" : `Grade ${q}`}
                </button>
              ))}
            </div>
            <input type="hidden" name="quality" value={quality} />
          </div>
        </div>

        {/* Hidden payload */}
        <input type="hidden" name="id" value={baseCode} />
        <input type="hidden" name="blocks_json" value={blocksJson} />
        <input type="hidden" name="existing_stock" value={existingStock ? "1" : "0"} />

        {/* Per-block dimensions */}
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {rows.map((r, i) => (
            <BlockDimRow
              key={r.key}
              code={codeAt(baseCode || suggestedId, i)}
              row={r}
              isFtIn={isFtIn}
              onChange={(field, value) => updateRow(r.key, field, value)}
              onRemove={rows.length > 1 ? () => removeRow(r.key) : undefined}
            />
          ))}
          <button type="button" onClick={addRow}
            style={{ alignSelf: "flex-start", fontSize: 12.5, fontWeight: 700, color: "var(--gold-dark)", background: "transparent", border: "1.5px dashed var(--gold-border)", borderRadius: 8, padding: "7px 14px", cursor: "pointer" }}>
            ＋ Add another block
          </button>
        </div>

        {/* Logistics — mandatory unless "Existing stock" is on */}
        <div style={{ border: "1px solid var(--border)", borderRadius: 9, overflow: "hidden" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", padding: "9px 12px", background: "var(--bg)", borderBottom: "1px solid var(--border)" }}>
            <span style={{ fontSize: 12.5, fontWeight: 800, color: "var(--text)" }}>
              🚚 Logistics {existingStock ? <span style={{ color: "var(--muted)", fontWeight: 600 }}>(optional)</span> : <span style={{ color: "#b45309", fontWeight: 700 }}>· required</span>}
            </span>
            <label style={{ display: "inline-flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 12, fontWeight: 700, color: "var(--muted)" }}>
              <Switch on={existingStock} onClick={() => { setExistingStock(v => !v); setFormError(null); }} />
              📦 Existing stock (no bill/truck)
            </label>
          </div>
          <div className="add-panel-row" style={{ padding: "12px" }}>
            <label className="stack" style={{ flex: "1 1 130px" }}>
              <span>Truck No.{!existingStock && <em style={{ color: "#b45309", fontStyle: "normal" }}> *</em>}</span>
              <input name="truck_no" />
            </label>
            <div className="stack" style={{ flex: "2 1 180px" }}>
              <span>Vendor / Supplier{!existingStock && <em style={{ color: "#b45309", fontStyle: "normal" }}> *</em>}</span>
              <VendorSelect vendors={vendors} name="vendor_name" />
            </div>
            <label className="stack" style={{ flex: "1 1 130px" }}>
              <span>Bill No.{!existingStock && <em style={{ color: "#b45309", fontStyle: "normal" }}> *</em>}</span>
              <input name="bill_no" />
            </label>
          </div>
        </div>

        {formError && (
          <div style={{ fontSize: 12.5, fontWeight: 700, color: "#dc2626", background: "rgba(220,38,38,0.07)", border: "1px solid rgba(220,38,38,0.3)", borderRadius: 8, padding: "8px 12px" }}>
            ⚠ {formError}
          </div>
        )}

        <div style={{ display: "flex" }}>
          <button className="primary-button" type="submit">
            {rows.length > 1 ? `Add ${rows.length} Blocks` : "Add Block"}
          </button>
        </div>
      </div>
    </form>
  );
}
