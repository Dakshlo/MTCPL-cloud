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

import { useMemo, useState } from "react";
import { createMarbleTruckAction } from "./marble-actions";
import { VendorSelect } from "./vendor-select";
import { stoneDisplayName } from "@/lib/stone-utils";
import { FACILITIES, YARDS_BY_FACILITY, facilityLabel, yardLabel, type Facility } from "@/lib/yards";
import { cftEquivFromTonnes, marbleBlockPrefix } from "@/lib/stone-categories";

type StoneType = { name: string; color_top: string };

export function MarbleTruckForm({
  marbleStones,
  vendors,
}: {
  marbleStones: StoneType[];
  vendors: string[];
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

  const yardsForFacility = YARDS_BY_FACILITY[facility];
  function pickFacility(f: Facility) {
    if (f === facility) return;
    setFacility(f);
    setYard(YARDS_BY_FACILITY[f][0]);
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
      prefix: marbleBlockPrefix(stone),
    };
  }, [totalTonnes, numBlocks, stone]);

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

  return (
    <form action={createMarbleTruckAction} className="stack" style={{ gap: 12 }}>
      <div className="section-heading" style={{ marginBottom: 0 }}>
        <div>
          <h2 style={{ display: "flex", alignItems: "center", gap: 8 }}>
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
          </h2>
          <p>
            Log one truck = N blocks. Each block&apos;s tonnage = total ÷ N.
            No dimensions needed — marble is cut manually per piece.
          </p>
        </div>
      </div>

      {/* Stone + category row */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
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
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
        <label className="stack" style={{ flex: "1 1 150px" }}>
          <span>Total tonnes from this truck</span>
          <input
            type="number"
            name="total_tonnes"
            value={totalTonnes}
            onChange={(e) => setTotalTonnes(e.target.value)}
            min="0.001"
            step="0.001"
            placeholder="e.g. 30.000"
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
            placeholder="e.g. 10"
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
                (≈ {preview.perCftEquiv.toFixed(2)} CFT equiv · 95 kg/CFT)
              </span>
            </div>
            <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 3 }}>
              IDs: {preview.prefix}001 to {preview.prefix}
              {String(parseInt(numBlocks, 10)).padStart(3, "0")} (sequential from existing)
            </div>
          </div>
        )}
      </div>

      {/* Truck metadata row */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <label className="stack" style={{ flex: "1 1 140px" }}>
          <span>Truck No. (optional)</span>
          <input
            type="text"
            name="truck_no"
            value={truckNo}
            onChange={(e) => setTruckNo(e.target.value)}
            placeholder="e.g. RJ-14-AB-1234"
          />
        </label>

        <div className="stack" style={{ flex: "1 1 180px" }}>
          <span>Vendor / Supplier (optional)</span>
          <VendorSelect name="vendor_name" vendors={vendors} />
        </div>

        <label className="stack" style={{ flex: "1 1 140px" }}>
          <span>Bill No. (optional)</span>
          <input
            type="text"
            name="bill_no"
            value={billNo}
            onChange={(e) => setBillNo(e.target.value)}
            placeholder="e.g. INV-2042"
          />
        </label>
      </div>

      <label className="stack">
        <span>Notes (optional)</span>
        <input
          type="text"
          name="notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="e.g. quality variance, delivery note, etc."
        />
      </label>

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
    </form>
  );
}
