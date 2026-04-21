"use client";

/**
 * Interactive procurement simulator — the [[PROCUREMENT:...]] widget.
 *
 * Data comes pre-computed from the suggest_blocks_to_buy tool (the
 * server ran the real cut-packing algorithm once for 1..N synthetic
 * blocks and returned the full iteration trace). This widget lets the
 * user EXPLORE that trace: drag the slider → instantly see what
 * "buying K blocks" gets you. No AI re-call, no lag — all the data
 * is already in the payload.
 *
 * The bar chart shows the diminishing-returns curve so the owner can
 * eyeball where marginal value drops (the "sweet spot" before wasted
 * procurement). The highlighted bar tracks the slider position.
 */

import { useId, useMemo, useState } from "react";

export type ProcurementTracePoint = {
  /** How many hypothetical blocks have been added at this step (1..N). */
  blocks: number;
  /** Cumulative slabs placed = baseline + whatever this round added. */
  placed: number;
  /** Slabs placed incrementally by THIS round only. */
  newlyPlaced: number;
  /** Slabs still unmet after this many blocks. */
  unmet: number;
  /** Average packing efficiency across all blocks used this round. */
  effPct: number;
};

export type ProcurementSimProps = {
  stone: string;
  quality?: string;
  temple?: string;
  totalSlabs: number;
  /** Slabs placed with CURRENT real inventory before any buying. */
  baselineCovered: number;
  /** The typical block size — what the user would tell their vendor. */
  typicalBlock: { l: number; w: number; h: number; cft: number; basedOnBlocks: number };
  /** The 1..N simulation trace. */
  trace: ProcurementTracePoint[];
  /**
   * Where marginal returns drop off — slider defaults to this. Usually
   * where newlyPlaced drops <=1 OR where coverage crosses 95%.
   */
  sweetSpot: number;
  /** Slabs whose dims exceed the typical block — require custom procurement. */
  tooLargeCount: number;
  /** True if the loop converged (covered 95%+), false if it hit a placement wall. */
  converged: boolean;
};

const GOLD = "#E8C572";
const GOLD_SOFT = "rgba(232,197,114,0.18)";
const GOLD_BORDER = "rgba(232,197,114,0.3)";
const GREEN = "#4ade80";
const AMBER = "#f59e0b";
const WHITE_FAINT = "rgba(255,255,255,0.55)";
const WHITE_LINE = "rgba(255,255,255,0.08)";

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function ProcurementSim(props: ProcurementSimProps) {
  const uid = useId();
  const { trace, baselineCovered, totalSlabs, typicalBlock, sweetSpot, tooLargeCount, converged } = props;

  const maxBlocks = Math.max(1, trace.length);
  const defaultBlocks = Math.min(Math.max(1, sweetSpot), maxBlocks);
  const [blocksBought, setBlocksBought] = useState<number>(defaultBlocks);

  // Look up the currently-selected row (slider value is 1-indexed over trace positions)
  const current = trace[Math.max(0, Math.min(trace.length - 1, blocksBought - 1))];
  const placed = current?.placed ?? baselineCovered;
  const unmet = current?.unmet ?? (totalSlabs - baselineCovered);
  const effPct = current?.effPct ?? 0;
  const coveragePct = totalSlabs > 0 ? Math.round((placed / totalSlabs) * 100) : 0;

  // Marginal value of the last-added block (for the "worth it?" callout)
  const marginal = current?.newlyPlaced ?? 0;

  const totalCft = round2(blocksBought * typicalBlock.cft);
  const addedByThisPurchase = placed - baselineCovered;

  // Peak newlyPlaced across the trace — used to normalise the bar chart
  const peakNew = useMemo(() => {
    return Math.max(1, ...trace.map((t) => t.newlyPlaced));
  }, [trace]);

  // Marginal-value verdict for the insight box
  const verdict = (() => {
    if (marginal === 0) {
      return {
        tone: "bad" as const,
        title: "Block " + blocksBought + " adds ZERO new slabs",
        body: "Buying this block is pure waste — remaining unmet slabs are bigger than the typical block size. See the too-large count below.",
      };
    }
    if (marginal === 1) {
      return {
        tone: "warn" as const,
        title: "Diminishing returns — only 1 new slab",
        body: "Block " + blocksBought + " places just 1 slab. Consider stopping here unless the extra coverage is worth the CFT.",
      };
    }
    if (marginal >= 5) {
      return {
        tone: "good" as const,
        title: "Good marginal value — " + marginal + " slabs from this block",
        body: "Block " + blocksBought + " still packs densely. Worth buying.",
      };
    }
    return {
      tone: "neutral" as const,
      title: "Block " + blocksBought + " adds " + marginal + " slabs",
      body: "Decent marginal value. Weigh against purchase cost.",
    };
  })();

  const verdictPalette = {
    good: { bg: "rgba(22,163,74,0.12)", fg: GREEN, border: "rgba(22,163,74,0.35)" },
    warn: { bg: "rgba(217,119,6,0.12)", fg: AMBER, border: "rgba(217,119,6,0.35)" },
    bad: { bg: "rgba(220,38,38,0.12)", fg: "#fca5a5", border: "rgba(220,38,38,0.35)" },
    neutral: { bg: GOLD_SOFT, fg: GOLD, border: GOLD_BORDER },
  }[verdict.tone];

  return (
    <div
      style={{
        margin: "14px 0",
        padding: 16,
        background: "rgba(0,0,0,0.2)",
        border: "1px solid " + WHITE_LINE,
        borderRadius: 12,
        display: "flex",
        flexDirection: "column",
        gap: 14,
      }}
    >
      {/* Header: stone + temple context */}
      <div style={{ display: "flex", alignItems: "baseline", flexWrap: "wrap", gap: 8 }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: WHITE_FAINT, textTransform: "uppercase", letterSpacing: "0.08em" }}>
          Procurement Simulator
        </span>
        <span style={{ fontSize: 11, color: GOLD }}>
          {props.stone}
          {props.quality ? " · Grade " + props.quality : ""}
          {props.temple && props.temple !== "all" ? " · " + props.temple : ""}
        </span>
      </div>

      {/* Top row: 4 live-updating KPI tiles */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))",
          gap: 8,
        }}
      >
        <KPI label="Buy" value={blocksBought} unit={blocksBought === 1 ? "block" : "blocks"} color={GOLD} />
        <KPI label="Covers" value={placed} unit={"of " + totalSlabs} color={GREEN} />
        <KPI label="Coverage" value={coveragePct} unit="%" color={coveragePct >= 90 ? GREEN : coveragePct >= 60 ? AMBER : "#fca5a5"} />
        <KPI label="Total CFT" value={totalCft} unit="CFT" color={GOLD} />
      </div>

      {/* The slider — 1..maxBlocks */}
      <div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
          <label htmlFor={uid + "-slider"} style={{ fontSize: 12, fontWeight: 700, color: "rgba(255,255,255,0.85)" }}>
            Drag to try different purchase amounts
          </label>
          <span style={{ fontSize: 11, color: WHITE_FAINT }}>
            {marginal > 0
              ? "+" + marginal + " slab" + (marginal !== 1 ? "s" : "") + " from block " + blocksBought
              : "Block " + blocksBought + " adds 0 slabs"}
          </span>
        </div>
        <input
          id={uid + "-slider"}
          type="range"
          min={1}
          max={maxBlocks}
          step={1}
          value={blocksBought}
          onChange={(e) => setBlocksBought(Number(e.target.value))}
          style={{
            width: "100%",
            accentColor: GOLD,
            cursor: "pointer",
          }}
        />
        {/* Tick labels */}
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 2, fontSize: 10, color: WHITE_FAINT }}>
          <span>1</span>
          {maxBlocks > 4 && <span>{Math.round(maxBlocks / 2)}</span>}
          <span>
            {maxBlocks}
            {!converged && " ⚠"}
          </span>
        </div>
      </div>

      {/* Bar chart: diminishing returns curve */}
      <div>
        <div style={{ fontSize: 11, fontWeight: 700, color: WHITE_FAINT, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>
          New slabs per added block
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "flex-end",
            gap: 2,
            height: 60,
            padding: "4px 0",
            borderBottom: "1px dashed " + WHITE_LINE,
          }}
        >
          {trace.map((t) => {
            const heightPct = (t.newlyPlaced / peakNew) * 100;
            const isCurrent = t.blocks === blocksBought;
            const isZero = t.newlyPlaced === 0;
            return (
              <div
                key={t.blocks}
                onClick={() => setBlocksBought(t.blocks)}
                title={"Block " + t.blocks + ": +" + t.newlyPlaced + " slab" + (t.newlyPlaced !== 1 ? "s" : "") + " · total " + t.placed + " · eff " + t.effPct + "%"}
                style={{
                  flex: "1 1 auto",
                  minWidth: 4,
                  // Floor the height so very small percentages stay visible.
                  // Zero-value bars get a tiny 2px sliver to remain clickable.
                  height: isZero ? 2 : Math.max(6, heightPct) + "%",
                  background: isCurrent ? GOLD : isZero ? "rgba(220,38,38,0.3)" : GOLD_SOFT,
                  borderTop: isCurrent ? "2px solid " + GOLD : "2px solid transparent",
                  borderRadius: 2,
                  cursor: "pointer",
                  transition: "background 0.12s, border-color 0.12s",
                }}
              />
            );
          })}
        </div>
        <div style={{ fontSize: 11, color: WHITE_FAINT, marginTop: 4 }}>
          Click any bar to jump. Smaller bars = diminishing returns. Red ticks = block adds 0 slabs (don&apos;t buy beyond).
        </div>
      </div>

      {/* Verdict callout — changes with slider */}
      <div
        style={{
          padding: "10px 14px",
          background: verdictPalette.bg,
          border: "1px solid " + verdictPalette.border,
          borderRadius: 8,
        }}
      >
        <div style={{ fontSize: 13, fontWeight: 700, color: verdictPalette.fg, marginBottom: 2 }}>
          {verdict.title}
        </div>
        <div style={{ fontSize: 12, color: "rgba(255,255,255,0.75)", lineHeight: 1.5 }}>
          {verdict.body}
        </div>
      </div>

      {/* Bottom summary: the vendor-facing spec */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, fontSize: 12, color: "rgba(255,255,255,0.7)", paddingTop: 4, borderTop: "1px dashed " + WHITE_LINE }}>
        <div>
          <span style={{ color: WHITE_FAINT }}>Vendor spec:</span>{" "}
          <strong style={{ color: GOLD, fontFamily: "ui-monospace, monospace" }}>
            {typicalBlock.l}×{typicalBlock.w}×{typicalBlock.h} in
          </strong>{" "}
          <span style={{ color: WHITE_FAINT }}>(~{typicalBlock.cft} CFT each · median of {typicalBlock.basedOnBlocks} historical blocks)</span>
        </div>
        {tooLargeCount > 0 && (
          <div>
            <span style={{ color: AMBER }}>⚠ {tooLargeCount} slab{tooLargeCount !== 1 ? "s" : ""} need custom-sized blocks</span>
            <span style={{ color: WHITE_FAINT }}> — dimensions exceed the typical block.</span>
          </div>
        )}
        <div style={{ marginLeft: "auto", color: WHITE_FAINT }}>
          From baseline inventory: {baselineCovered} covered · this purchase adds {addedByThisPurchase} more · {unmet} still unmet · {effPct}% avg efficiency
        </div>
      </div>
    </div>
  );
}

function KPI({ label, value, unit, color }: { label: string; value: number | string; unit?: string; color: string }) {
  return (
    <div
      style={{
        padding: "8px 12px",
        background: "rgba(255,255,255,0.03)",
        border: "1px solid " + WHITE_LINE,
        borderRadius: 8,
      }}
    >
      <div style={{ fontSize: 10, fontWeight: 700, color: WHITE_FAINT, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 3 }}>
        {label}
      </div>
      <div style={{ fontSize: 20, fontWeight: 800, color, fontFamily: "ui-monospace, monospace", lineHeight: 1.1 }}>
        {value}
        {unit && (
          <span style={{ fontSize: 11, fontWeight: 600, color: WHITE_FAINT, marginLeft: 4 }}>
            {unit}
          </span>
        )}
      </div>
    </div>
  );
}
