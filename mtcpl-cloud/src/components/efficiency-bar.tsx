/**
 * EfficiencyBar — compact horizontal stacked bar visualising the three slices
 * of a block's volume: slab yield (green) + restockable (amber) + waste (red).
 * Works in both server and client components.
 */

import { toCFT, type CutEfficiency } from "@/lib/cut-efficiency";

const COLORS = {
  slab: "#15803d",     // green-700
  slabBg: "#dcfce7",   // green-100
  restock: "#b45309",  // amber-700
  restockBg: "#fef3c7",// amber-100
  waste: "#b91c1c",    // red-700
  wasteBg: "#fee2e2",  // red-100
};

export function EfficiencyBar({
  eff,
  compact = false,
}: {
  eff: CutEfficiency;
  /** Compact mode skips the legend and CFT numbers (for tight list rows). */
  compact?: boolean;
}) {
  const slabPct = eff.slabPct;
  const restockPct = eff.restockPct;
  // remainder of the bar, not the clamped sum — so the bar always adds up to 100
  const wastePct = Math.max(0, 100 - slabPct - restockPct);

  return (
    <div style={{ marginTop: compact ? 4 : 8 }}>
      {/* Stacked bar */}
      <div
        style={{
          display: "flex",
          height: compact ? 6 : 10,
          borderRadius: compact ? 3 : 5,
          overflow: "hidden",
          background: "var(--border, #e5e5e5)",
        }}
      >
        <div
          style={{ width: `${slabPct}%`, background: COLORS.slab }}
          title={`Slab yield: ${slabPct}% (${toCFT(eff.slabVol).toFixed(2)} CFT)`}
        />
        <div
          style={{ width: `${restockPct}%`, background: COLORS.restock }}
          title={`Restockable: ${restockPct}% (${toCFT(eff.restockVol).toFixed(2)} CFT)`}
        />
        <div
          style={{ width: `${wastePct}%`, background: COLORS.waste }}
          title={`Waste (kerf + scrap): ${wastePct}% (${toCFT(eff.wasteVol).toFixed(2)} CFT)`}
        />
      </div>

      {/* Legend — hidden in compact mode */}
      {!compact && (
        <div style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 10,
          marginTop: 6,
          fontSize: 11,
          color: "var(--muted, #666)",
        }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
            <span style={{ width: 9, height: 9, background: COLORS.slab, borderRadius: 2, display: "inline-block" }} />
            <span><strong style={{ color: "var(--text, #1a1a1a)" }}>{slabPct}%</strong> slabs ({toCFT(eff.slabVol).toFixed(2)} CFT)</span>
          </span>
          {restockPct > 0 && (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
              <span style={{ width: 9, height: 9, background: COLORS.restock, borderRadius: 2, display: "inline-block" }} />
              <span><strong style={{ color: "var(--text, #1a1a1a)" }}>{restockPct}%</strong> restockable ({toCFT(eff.restockVol).toFixed(2)} CFT)</span>
            </span>
          )}
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
            <span style={{ width: 9, height: 9, background: COLORS.waste, borderRadius: 2, display: "inline-block" }} />
            <span><strong style={{ color: "var(--text, #1a1a1a)" }}>{wastePct}%</strong> waste ({toCFT(eff.wasteVol).toFixed(2)} CFT)</span>
          </span>
        </div>
      )}
    </div>
  );
}
