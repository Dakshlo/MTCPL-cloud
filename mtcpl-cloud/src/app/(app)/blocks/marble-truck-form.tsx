"use client";

/**
 * Inline form for logging a single marble truck. Produces one
 * marble_truck_entries row and N sibling blocks on submit (each
 * block = total_tonnes ÷ N).
 *
 * Only visible on /blocks when there is at least one stone_type
 * whose stone_category = 'marble'. Parent page passes the filtered
 * marble-only stone list.
 */

import { useMemo, useState, type CSSProperties } from "react";
import { createMarbleTruckAction } from "./marble-actions";
import { VendorSelect } from "./vendor-select";
import { stoneDisplayName } from "@/lib/stone-utils";
import { FACILITIES, YARDS_BY_FACILITY, facilityLabel, yardLabel, type Facility } from "@/lib/yards";
import { cftEquivFromTonnes } from "@/lib/stone-categories";

type StoneType = { name: string; color_top: string };

function Switch({ on, onClick }: { on: boolean; onClick: () => void }) {
  const track: CSSProperties = { width: 42, height: 24, borderRadius: 999, background: on ? "var(--gold-dark)" : "var(--border)", position: "relative", transition: "background .15s", flex: "0 0 auto", cursor: "pointer" };
  const knob: CSSProperties = { position: "absolute", top: 3, left: on ? 21 : 3, width: 18, height: 18, borderRadius: "50%", background: "#fff", transition: "left .15s", boxShadow: "0 1px 3px rgba(0,0,0,0.3)" };
  return <div role="switch" aria-checked={on} onClick={onClick} style={track}><span style={knob} /></div>;
}

export function MarbleTruckForm({
  marbleStones,
  vendors,
  suggestedId,
}: {
  marbleStones: StoneType[];
  vendors: string[];
  /** Next free block id in the shared MT-B-XXX series. Used to show a
   *  live preview of the range of ids the truck's N blocks will get. */
  suggestedId: string;
}) {
  const defaultStone = marbleStones[0]?.name ?? "WhiteMarble";
  const [stone, setStone] = useState<string>(defaultStone);
  const [facility, setFacility] = useState<Facility>("mtcpl");
  const [yard, setYard] = useState<number>(YARDS_BY_FACILITY["mtcpl"][0]);
  const [truckNo, setTruckNo] = useState("");
  const [billNo, setBillNo] = useState("");
  const [notes, setNotes] = useState("");
  const [totalTonnes, setTotalTonnes] = useState("");
  const [numBlocks, setNumBlocks] = useState("");
  const [existingStock, setExistingStock] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const yardsForFacility = YARDS_BY_FACILITY[facility];
  function pickFacility(f: Facility) {
    if (f === facility) return;
    setFacility(f);
    setYard(YARDS_BY_FACILITY[f][0]);
  }

  /** Expand "MT-B-125" + count=10 → ["MT-B-125", "MT-B-134"]. */
  function idRange(firstId: string, count: number): { first: string; last: string } | null {
    const m = firstId.match(/^(.+?)(\d+)$/);
    if (!m) return null;
    const prefix = m[1];
    const startNum = parseInt(m[2], 10);
    if (!Number.isFinite(startNum) || count < 1) return null;
    const padLen = m[2].length;
    const pad = (n: number) => String(n).padStart(padLen, "0");
    return {
      first: `${prefix}${pad(startNum)}`,
      last: `${prefix}${pad(startNum + count - 1)}`,
    };
  }

  const preview = useMemo(() => {
    const t = parseFloat(totalTonnes);
    const n = parseInt(numBlocks, 10);
    if (!Number.isFinite(t) || t <= 0 || !Number.isFinite(n) || n <= 0) return null;
    const per = t / n;
    return {
      perTonnes: per,
      perCftEquiv: cftEquivFromTonnes(per),
      totalCftEquiv: cftEquivFromTonnes(t),
      ids: idRange(suggestedId, n),
    };
  }, [totalTonnes, numBlocks, suggestedId]);

  if (marbleStones.length === 0) {
    // Shouldn't render at all — the parent component gates on this — but
    // just in case, show a friendly empty state.
    return (
      <div className="banner" style={{ fontSize: 12 }}>
        No marble stones configured yet. Add one in{" "}
        <a href="/settings" style={{ color: "var(--gold-dark)", fontWeight: 600 }}>
          Settings → Stone Types
        </a>
        {" "}with category = Marble.
      </div>
    );
  }

  const canSubmit = stone && Number.isFinite(yard) &&
    parseFloat(totalTonnes) > 0 &&
    Number.isInteger(parseInt(numBlocks, 10)) &&
    parseInt(numBlocks, 10) >= 1 &&
    parseInt(numBlocks, 10) <= 50;

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    if (!existingStock) {
      const fd = new FormData(e.currentTarget);
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
    <form action={createMarbleTruckAction} onSubmit={onSubmit} className="add-panel">
      <div className="add-panel-header" style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
        <div>
          <p className="add-panel-title" style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            🚚 New Marble Truck
            <span
              style={{
                fontSize: 10,
                fontWeight: 700,
                color: "#b45309",
                background: "rgba(180,83,9,0.12)",
                padding: "2px 8px",
                borderRadius: 4,
                letterSpacing: "0.05em",
                textTransform: "uppercase",
              }}
            >
              Marble only
            </span>
            <span
              style={{
                fontSize: 11,
                fontWeight: 600,
                color: "var(--gold-dark)",
                background: "rgba(184,115,51,0.1)",
                padding: "2px 8px",
                borderRadius: 4,
                fontFamily: "ui-monospace, monospace",
                letterSpacing: "0.02em",
              }}
              title="The first new block will get this id; the remaining blocks continue in sequence."
            >
              Next id: {suggestedId}
            </span>
          </p>
          <p className="add-panel-subtitle">
            One truck = N blocks · each block&apos;s tonnage = total ÷ N.
          </p>
        </div>
      </div>

      <div className="add-panel-body">
      {/* Stone + category row */}
      <div className="add-panel-row">
        <label className="stack" style={{ flex: "1 1 160px" }}>
          <span>Stone</span>
          <select name="stone" value={stone} onChange={(e) => setStone(e.target.value)} required>
            {marbleStones.map((s) => (
              <option key={s.name} value={s.name}>
                {stoneDisplayName(s.name)}
              </option>
            ))}
          </select>
        </label>

        <div className="stack" style={{ flex: "1 1 220px" }}>
          <span>Facility</span>
          <div style={{ display: "inline-flex", border: "1px solid var(--border)", borderRadius: 6, overflow: "hidden" }}>
            {FACILITIES.map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => pickFacility(f)}
                style={{
                  padding: "6px 14px",
                  fontSize: 12,
                  fontWeight: 600,
                  background: facility === f ? "var(--gold-dark)" : "transparent",
                  color: facility === f ? "#fff" : "var(--muted)",
                  border: "none",
                  cursor: "pointer",
                }}
              >
                {facilityLabel(f)}
              </button>
            ))}
          </div>
        </div>

        <label className="stack" style={{ flex: "1 1 120px" }}>
          <span>Yard</span>
          <select name="yard" value={yard} onChange={(e) => setYard(Number(e.target.value))} required>
            {yardsForFacility.map((y) => (
              <option key={y} value={y}>
                {yardLabel(y)}
              </option>
            ))}
          </select>
        </label>
      </div>

      {/* Tonnage + block count row */}
      <div className="add-panel-row" style={{ alignItems: "flex-end" }}>
        <label className="stack" style={{ flex: "1 1 150px" }}>
          <span>Total tonnes from this truck</span>
          <input
            type="number"
            name="total_tonnes"
            value={totalTonnes}
            onChange={(e) => setTotalTonnes(e.target.value)}
            min="0.001"
            step="0.001"

            required
          />
        </label>

        <label className="stack" style={{ flex: "1 1 110px" }}>
          <span>Number of blocks</span>
          <input
            type="number"
            name="num_blocks"
            value={numBlocks}
            onChange={(e) => setNumBlocks(e.target.value)}
            min="1"
            max="50"
            step="1"

            required
          />
        </label>

        {preview && (
          <div
            style={{
              flex: "2 1 260px",
              padding: "10px 14px",
              background: "rgba(180,83,9,0.08)",
              border: "1px solid rgba(180,83,9,0.3)",
              borderRadius: 8,
              fontSize: 12,
              lineHeight: 1.6,
            }}
          >
            <div style={{ fontWeight: 700, color: "var(--gold-dark)", marginBottom: 3 }}>
              Preview — each of the {parseInt(numBlocks, 10)} blocks:
            </div>
            <div style={{ fontFamily: "ui-monospace, monospace" }}>
              <strong>{preview.perTonnes.toFixed(3)} T</strong>{" "}
              <span style={{ color: "var(--muted)" }}>
                (≈ {preview.perCftEquiv.toFixed(2)} CFT equiv · 8 CFT/tonne)
              </span>
            </div>
            <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 3, fontFamily: "ui-monospace, monospace" }}>
              {preview.ids ? (
                preview.ids.first === preview.ids.last ? (
                  <>Id: <strong style={{ color: "var(--gold-dark)" }}>{preview.ids.first}</strong></>
                ) : (
                  <>
                    Ids: <strong style={{ color: "var(--gold-dark)" }}>{preview.ids.first}</strong>
                    {" → "}
                    <strong style={{ color: "var(--gold-dark)" }}>{preview.ids.last}</strong>
                  </>
                )
              ) : (
                <>IDs auto-assigned in the shared MT-B-XXX series</>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Logistics — mandatory unless "Existing stock" is on */}
      <input type="hidden" name="existing_stock" value={existingStock ? "1" : "0"} />
      <div style={{ border: "1px solid var(--border)", borderRadius: 9, overflow: "hidden", marginTop: 4 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", padding: "9px 12px", background: "var(--bg)", borderBottom: "1px solid var(--border)" }}>
          <span style={{ fontSize: 12.5, fontWeight: 800, color: "var(--text)" }}>
            🚚 Logistics {existingStock ? <span style={{ color: "var(--muted)", fontWeight: 600 }}>(optional)</span> : <span style={{ color: "#b45309", fontWeight: 700 }}>· required</span>}
          </span>
          <label style={{ display: "inline-flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 12, fontWeight: 700, color: "var(--muted)" }}>
            <Switch on={existingStock} onClick={() => { setExistingStock((v) => !v); setFormError(null); }} />
            📦 Existing stock (no bill/truck)
          </label>
        </div>
        <div style={{ padding: 12 }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <label className="stack" style={{ flex: "1 1 140px" }}>
              <span>Truck No.{!existingStock && <em style={{ color: "#b45309", fontStyle: "normal" }}> *</em>}</span>
              <input type="text" name="truck_no" value={truckNo} onChange={(e) => setTruckNo(e.target.value)} />
            </label>
            <div className="stack" style={{ flex: "2 1 180px" }}>
              <span>Vendor / Supplier{!existingStock && <em style={{ color: "#b45309", fontStyle: "normal" }}> *</em>}</span>
              <VendorSelect name="vendor_name" vendors={vendors} />
            </div>
            <label className="stack" style={{ flex: "1 1 140px" }}>
              <span>Bill No.{!existingStock && <em style={{ color: "#b45309", fontStyle: "normal" }}> *</em>}</span>
              <input type="text" name="bill_no" value={billNo} onChange={(e) => setBillNo(e.target.value)} />
            </label>
          </div>
          <label className="stack" style={{ marginTop: 8 }}>
            <span>Notes</span>
            <input type="text" name="notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </label>
        </div>
      </div>

      {formError && (
        <div style={{ fontSize: 12.5, fontWeight: 700, color: "#dc2626", background: "rgba(220,38,38,0.07)", border: "1px solid rgba(220,38,38,0.3)", borderRadius: 8, padding: "8px 12px" }}>
          ⚠ {formError}
        </div>
      )}

      <div style={{ display: "flex", gap: 8 }}>
        <button
          type="submit"
          className="primary-button"
          disabled={!canSubmit}
          style={{ opacity: canSubmit ? 1 : 0.5 }}
        >
          {preview
            ? `Add ${parseInt(numBlocks, 10)} blocks from this truck`
            : "Add marble truck"}
        </button>
      </div>
      </div>
    </form>
  );
}
