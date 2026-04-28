"use client";

import { useState } from "react";
import { IsoBlockPreview } from "@/components/planning-workbench";
import type { StoneTypeDef } from "@/lib/stone-utils";

const SLAB_COLORS = ["#D85A30","#378ADD","#1D9E75","#7F77DD","#BA7517","#639922","#D4537E","#E24B4A","#5F5E5A","#0F6E56"];
function slabColor(id: string) {
  const num = parseInt(String(id || "").replace(/\D/g, ""), 10);
  if (!num || Number.isNaN(num)) return SLAB_COLORS[0];
  return SLAB_COLORS[(num - 1) % SLAB_COLORS.length];
}

type Slab = {
  id: string;
  label?: string;
  temple?: string;
  sw: number;
  sh: number;
  sd?: number;
  px?: number;
  py?: number;
  pw?: number;
  ph?: number;
  rot?: boolean;
  zTop?: number;
  zBot?: number;
};

type Blk = { id: string; stone: string; yard: number; l: number; w: number; h: number; quality?: string | null };

export function CuttingDetailPreview({
  blk,
  placed,
  stoneTypes,
  extraSlabIds,
}: {
  blk: Blk;
  placed: Slab[];
  stoneTypes?: StoneTypeDef[];
  /** Slabs flagged as filler / cut-ahead inventory. Render with
   * purple tint + EXTRA badge so cutters know they're not part
   * of the current order. */
  extraSlabIds?: Set<string>;
}) {
  const [highlightedId, setHighlightedId] = useState<string | null>(null);

  return (
    <>
      {/* 3D block preview — hover feeds back to slab chip list */}
      <div style={{ margin: "0 0 20px" }}>
        <IsoBlockPreview
          block={blk as any}
          placed={placed as any}
          stoneTypes={stoneTypes}
          onHoverSlab={setHighlightedId}
          extraIds={extraSlabIds}
        />
      </div>

      {/* Planned slab chips — highlighted when hovered in 3D view */}
      {placed.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <p style={{
            fontSize: 11, fontWeight: 700, color: "var(--muted)",
            textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8,
          }}>
            Planned Slabs
          </p>
          <div className="chip-row">
            {placed.map((s) => {
              const isHighlighted = highlightedId === s.id;
              const isExtra = extraSlabIds?.has(s.id) ?? false;
              const col = isExtra ? "#7c3aed" : slabColor(s.id);
              return (
                <span
                  key={s.id}
                  className="plan-chip"
                  title={isExtra ? "Filler slab — cut ahead, not for current order" : undefined}
                  style={{
                    fontFamily: "ui-monospace, monospace",
                    fontSize: 12,
                    transition: "all 0.12s",
                    background: isHighlighted ? col + "22" : (isExtra ? "#7c3aed11" : undefined),
                    border: isHighlighted ? `1.5px solid ${col}` : (isExtra ? "1px solid #7c3aed44" : undefined),
                    color: isHighlighted ? "var(--text)" : (isExtra ? "#7c3aed" : undefined),
                    fontWeight: isHighlighted ? 700 : undefined,
                    boxShadow: isHighlighted ? `0 0 0 2px ${col}44` : undefined,
                  }}
                >
                  {isHighlighted && (
                    <span style={{ display: "inline-block", width: 7, height: 7, borderRadius: 2, background: col, marginRight: 5, verticalAlign: "middle" }} />
                  )}
                  {s.id}
                  {s.temple ? ` · ${s.temple}` : ""}
                  {` · ${s.sw}×${s.sh}${s.sd ? `×${s.sd}` : ""} in`}
                  {s.rot ? " ↻" : ""}
                  {isExtra && (
                    <span style={{ marginLeft: 5, fontSize: 9, fontWeight: 700, padding: "1px 5px", borderRadius: 3, background: "#7c3aed", color: "#fff", letterSpacing: "0.04em" }}>
                      EXTRA
                    </span>
                  )}
                </span>
              );
            })}
          </div>
        </div>
      )}
    </>
  );
}
