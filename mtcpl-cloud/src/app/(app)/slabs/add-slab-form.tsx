"use client";

import { useState } from "react";
import { addSlabAction } from "./actions";
import { generateSlabCode } from "./utils";

type Temple = { id: string; name: string; code_prefix: string };

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

export function AddSlabForm({ temples, existingIds }: { temples: Temple[]; existingIds: string[] }) {
  const [stone, setStone] = useState<"PinkStone" | "WhiteStone">("PinkStone");
  const [priority, setPriority] = useState(false);
  const [selectedTemple, setSelectedTemple] = useState<Temple | null>(temples[0] ?? null);
  const [l, setL] = useState("");
  const [w, setW] = useState("");
  const [t, setT] = useState("");
  const [qty, setQty] = useState(1);

  const cft = calcCft(l, w, t);
  const baseCode = selectedTemple ? generateSlabCode(existingIds, selectedTemple.code_prefix) : "—";
  const codePreview = baseCode === "—" ? "—" : previewCodes(baseCode, qty);

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
                  const found = temples.find(tp => tp.name === e.target.value) ?? null;
                  setSelectedTemple(found);
                }}
              >
                {temples.map(tp => <option key={tp.id} value={tp.name}>{tp.name}</option>)}
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

        {/* Row 3: Dimensions + CFT + Quantity + Code preview + Submit */}
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
            <div className="cft-value" style={{ minWidth: 60 }}>{cft}</div>
          </div>

          {/* Quantity stepper */}
          <div className="stack" style={{ flex: "0 0 auto" }}>
            <span>Quantity</span>
            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <button
                type="button"
                className="qty-btn"
                onClick={() => setQty(q => Math.max(1, q - 1))}
                disabled={qty <= 1}
              >−</button>
              <span className="cft-value" style={{ minWidth: 36, textAlign: "center", fontSize: 15, fontWeight: 700 }}>{qty}</span>
              <button
                type="button"
                className="qty-btn"
                onClick={() => setQty(q => Math.min(50, q + 1))}
                disabled={qty >= 50}
              >+</button>
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
