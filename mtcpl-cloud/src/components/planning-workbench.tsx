"use client";

import { useState, useRef, useEffect } from "react";
import { BlockMiniPreview, SlabMiniPreview } from "@/components/stone-previews";
import { getStonePalette } from "@/lib/stone-utils";
import type { StoneTypeDef } from "@/lib/stone-utils";
import type { AISuggestion, AIProcurementSuggestion, AISuggestionsResponse } from "@/app/(app)/planning/actions";
import { computeCutEfficiency, toCFT, type CutEfficiency } from "@/lib/cut-efficiency";
import { EfficiencyBar } from "@/components/efficiency-bar";
import { yardLabel, yardShortLabel, FACILITIES, YARDS_BY_FACILITY, facilityLabel, facilityOfYard, type Facility } from "@/lib/yards";

// Pure algorithm + types live in a server-safe module so the Ask AI tool can
// invoke them from the Node runtime. Re-exported from here so existing
// imports (`from "@/components/planning-workbench"`) keep working unchanged.
import {
  runOptimization,
  runOptimizationWithAIGroups,
  type BlockRow,
  type SlabRow,
  type PlacedSlab,
  type PlanBlock,
  type PlanResult,
} from "@/lib/planning/packing";

export {
  runOptimization,
  runOptimizationWithAIGroups,
};
export type { BlockRow, SlabRow, PlacedSlab, PlanBlock, PlanResult };

const SLAB_COLORS = ["#D85A30", "#378ADD", "#1D9E75", "#7F77DD", "#BA7517", "#639922", "#D4537E", "#E24B4A", "#5F5E5A", "#0F6E56"];

function toNum(value: number | string | null | undefined, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function sclr(id: string) {
  const num = parseInt(String(id || "").replace(/\D/g, ""), 10);
  if (!num || Number.isNaN(num)) return SLAB_COLORS[0];
  return SLAB_COLORS[(num - 1) % SLAB_COLORS.length];
}

// ─── 3D Isometric Block Preview ────────────────────────────────────────────────

export function IsoBlockPreview({ block, placed, stoneTypes, onHoverSlab }: { block: PlanBlock["blk"]; placed: PlacedSlab[]; stoneTypes?: StoneTypeDef[]; onHoverSlab?: (id: string | null) => void }) {
  const [az, setAz] = useState(Math.PI * 0.25);
  const [zoom, setZoom] = useState(1.0);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number } | null>(null);
  const [activeLayerIdx, setActiveLayerIdx] = useState<number | null>(null);
  const dragRef = useRef({ active: false, lastX: 0 });
  const svgRef = useRef<SVGSVGElement>(null);
  const hoveredSlab = placed.find(p => p.id === hoveredId) ?? null;

  // Build layer list from placed slabs (group by zBot–zTop range)
  const layers = (() => {
    const map = new Map<string, { zBot: number; zTop: number; ids: Set<string> }>();
    for (const s of placed) {
      if (s.zTop == null) continue;
      const zTop = s.zTop;
      const zBot = s.zBot ?? 0;
      const key = `${zBot.toFixed(2)}_${zTop.toFixed(2)}`;
      if (!map.has(key)) map.set(key, { zBot, zTop, ids: new Set() });
      map.get(key)!.ids.add(s.id);
    }
    return [...map.values()].sort((a, b) => b.zTop - a.zTop);
  })();
  const activeLayerIds = activeLayerIdx !== null ? layers[activeLayerIdx]?.ids : null;

  // Non-passive wheel & touchmove listeners to enable preventDefault
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      setZoom((z) => Math.min(4, Math.max(0.3, z * (e.deltaY > 0 ? 0.88 : 1.14))));
    };
    const onTouchMove = (e: TouchEvent) => { e.preventDefault(); };
    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    return () => {
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("touchmove", onTouchMove);
    };
  }, []);

  const L = block.l, W = block.w, H = block.h;
  const C = Math.cos(Math.PI / 6); // ≈ 0.866 horizontal compression
  const S = 0.5;                   // vertical compression
  const diag = Math.sqrt(L * L + W * W);
  const scale = Math.min(280 / (diag * C + 4), 160 / (diag * S + H + 4), 30);

  const Ca = Math.cos(az), Sa = Math.sin(az);

  function raw(x: number, y: number, z: number) {
    const rx = x * Ca - y * Sa;
    const ry = x * Sa + y * Ca;
    return { x: rx * C * scale, y: ry * S * scale - z * scale };
  }

  // Compute viewBox from 8 block corners (unzoomed — zoom applied via SVG transform)
  const corners8 = (
    [[0,0,0],[L,0,0],[0,W,0],[L,W,0],[0,0,H],[L,0,H],[0,W,H],[L,W,H]] as Array<[number,number,number]>
  ).map(([x, y, z]) => raw(x, y, z));
  const pad = 8;
  const minX = Math.min(...corners8.map((p) => p.x)) - pad;
  const minY = Math.min(...corners8.map((p) => p.y)) - pad;
  const maxX = Math.max(...corners8.map((p) => p.x)) + pad;
  const maxY = Math.max(...corners8.map((p) => p.y)) + pad + 14;

  function ptn(x: number, y: number, z: number) {
    const p = raw(x, y, z);
    return `${(p.x - minX).toFixed(1)},${(p.y - minY).toFixed(1)}`;
  }
  function ptObj(x: number, y: number, z: number) {
    const p = raw(x, y, z);
    return { x: p.x - minX, y: p.y - minY };
  }

  const pal = getStonePalette(block.stone, stoneTypes);
  const showFrontY = Sa >= 0;
  const showRightX = Ca >= 0;
  const bY = showFrontY ? W : 0;   // show far Y face when viewer is on +y side
  const bX = showRightX ? L : 0;

  // Sort slabs back-to-front: larger projected Y = farther away = draw first
  // Within same depth band, lower Z drawn first (appears behind higher Z)
  const sortedSlabs = [...placed].sort((a, b) => {
    const ra = (a.px + a.pw / 2) * Sa + (a.py + a.ph / 2) * Ca;
    const rb = (b.px + b.pw / 2) * Sa + (b.py + b.ph / 2) * Ca;
    if (Math.abs(ra - rb) > 0.05) return rb - ra;
    const aZ = (a.zTop ?? H) + (a.zBot ?? 0);
    const bZ = (b.zTop ?? H) + (b.zBot ?? 0);
    return aZ - bZ;
  });

  // Left-click drag → rotation
  function onMouseDown(e: React.MouseEvent) {
    if (e.button === 0) {
      e.preventDefault();
      dragRef.current = { active: true, lastX: e.clientX };
    }
  }
  function onMouseMove(e: React.MouseEvent) {
    if (dragRef.current.active) {
      const dx = e.clientX - dragRef.current.lastX;
      setAz((a) => a - dx * 0.012);
      dragRef.current.lastX = e.clientX;
    }
    // Update tooltip position
    if (hoveredId) {
      const rect = svgRef.current?.getBoundingClientRect();
      if (rect) setTooltipPos({ x: e.clientX - rect.left, y: e.clientY - rect.top });
    }
  }
  function onMouseUp() { dragRef.current.active = false; }
  function onContextMenu(e: React.MouseEvent) { e.preventDefault(); }

  // Touch → single-finger rotate
  function onTouchStart(e: React.TouchEvent) {
    if (e.touches.length === 1) dragRef.current = { active: true, lastX: e.touches[0].clientX };
  }
  function onTouchMoveReact(e: React.TouchEvent) {
    if (dragRef.current.active && e.touches.length === 1) {
      const dx = e.touches[0].clientX - dragRef.current.lastX;
      setAz((a) => a - dx * 0.012);
      dragRef.current.lastX = e.touches[0].clientX;
    }
  }
  function onTouchEnd() { dragRef.current.active = false; }

  const vbW = (maxX - minX).toFixed(1);
  const vbH = (maxY - minY).toFixed(1);
  const cx = Number(vbW) / 2;
  const cy = (Number(vbH) - 14) / 2; // centre above hint text

  return (
    <div style={{ position: "relative" }}>
    {/* Tooltip overlay */}
    {hoveredSlab && tooltipPos && (
      <div style={{
        position: "absolute",
        left: Math.min(tooltipPos.x + 12, 240),
        top: tooltipPos.y + 12,
        zIndex: 10,
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: 6,
        padding: "6px 10px",
        fontSize: 12,
        pointerEvents: "none",
        boxShadow: "0 2px 8px rgba(0,0,0,0.18)",
        maxWidth: 180,
        lineHeight: 1.5
      }}>
        <strong style={{ color: sclr(hoveredSlab.id) }}>{hoveredSlab.id}</strong>
        {hoveredSlab.label ? <div className="muted">{hoveredSlab.label}</div> : null}
        {hoveredSlab.temple ? <div className="muted" style={{ fontSize: 11 }}>{hoveredSlab.temple}</div> : null}
        <div>{hoveredSlab.sw} × {hoveredSlab.sh} in{hoveredSlab.sd ? ` · T: ${hoveredSlab.sd} in` : ""}</div>
        {hoveredSlab.rot ? <div className="muted" style={{ fontSize: 11 }}>Rotated 90°</div> : null}
        {hoveredSlab.zTop != null ? <div className="muted" style={{ fontSize: 11 }}>Layer depth {hoveredSlab.zBot?.toFixed(1)}–{hoveredSlab.zTop.toFixed(1)}</div> : null}
      </div>
    )}
    <svg
      ref={svgRef}
      className="plan-svg"
      viewBox={`0 0 ${vbW} ${vbH}`}
      style={{ cursor: dragRef.current.active ? "grabbing" : "grab", touchAction: "none", userSelect: "none" }}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onMouseLeave={e => { onMouseUp(); setTooltipPos(null); }}
      onContextMenu={onContextMenu}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMoveReact}
      onTouchEnd={onTouchEnd}
    >
      {/* Zoom group — scale around centre of block area */}
      <g transform={`translate(${cx},${cy}) scale(${zoom}) translate(${-cx},${-cy})`}>
        {/* Block side face (front Y) */}
        <polygon
          points={[ptn(0,bY,0),ptn(L,bY,0),ptn(L,bY,H),ptn(0,bY,H)].join(" ")}
          fill={pal.front}
        />
        {/* Block side face (right X) */}
        <polygon
          points={[ptn(bX,0,0),ptn(bX,W,0),ptn(bX,W,H),ptn(bX,0,H)].join(" ")}
          fill={pal.side}
        />
        {/* Block top face */}
        <polygon
          points={[ptn(0,0,H),ptn(L,0,H),ptn(L,W,H),ptn(0,W,H)].join(" ")}
          fill={pal.top}
        />

        {/* Slab 3D boxes — sorted back-to-front */}
        {sortedSlabs.map((item) => {
          const isHovered = hoveredId === item.id;
          const layerDimmed = activeLayerIds !== null && !activeLayerIds.has(item.id);
          const hoverDimmed = hoveredId !== null && !isHovered;
          const dimmed = layerDimmed || hoverDimmed;
          const topAlpha = dimmed ? 0.10 : 0.88;
          const sideAlpha = dimmed ? 0.07 : 0.70;
          const color = sclr(item.id);

          // Use annotated Z positions from multilayer algorithm; fall back for old data
          const slabZTop = item.zTop ?? H;
          const slabZBot = item.zBot ?? Math.max(0, H - (item.sd > 0 ? item.sd : H * 0.4));

          const sy = showFrontY ? item.py + item.ph : item.py;
          const sx = showRightX ? item.px + item.pw : item.px;
          const center = ptObj(item.px + item.pw / 2, item.py + item.ph / 2, slabZTop);
          return (
            <g
              key={item.id}
              style={{ cursor: activeLayerIds !== null && !activeLayerIds.has(item.id) ? "default" : "pointer" }}
              onMouseEnter={() => {
                if (activeLayerIds !== null && !activeLayerIds.has(item.id)) return;
                setHoveredId(item.id);
                onHoverSlab?.(item.id);
              }}
              onMouseLeave={() => {
                setHoveredId(null);
                setTooltipPos(null);
                onHoverSlab?.(null);
              }}
            >
              {/* Y-direction side face */}
              <polygon
                points={[
                  ptn(item.px, sy, slabZBot),
                  ptn(item.px + item.pw, sy, slabZBot),
                  ptn(item.px + item.pw, sy, slabZTop),
                  ptn(item.px, sy, slabZTop)
                ].join(" ")}
                fill={color}
                opacity={sideAlpha}
                stroke="rgba(0,0,0,0.12)"
                strokeWidth="0.5"
              />
              {/* X-direction side face */}
              <polygon
                points={[
                  ptn(sx, item.py, slabZBot),
                  ptn(sx, item.py + item.ph, slabZBot),
                  ptn(sx, item.py + item.ph, slabZTop),
                  ptn(sx, item.py, slabZTop)
                ].join(" ")}
                fill={color}
                opacity={sideAlpha * 0.82}
                stroke="rgba(0,0,0,0.12)"
                strokeWidth="0.5"
              />
              {/* Top face */}
              <polygon
                points={[
                  ptn(item.px, item.py, slabZTop),
                  ptn(item.px + item.pw, item.py, slabZTop),
                  ptn(item.px + item.pw, item.py + item.ph, slabZTop),
                  ptn(item.px, item.py + item.ph, slabZTop)
                ].join(" ")}
                fill={color}
                opacity={topAlpha}
                stroke={isHovered ? "rgba(255,255,255,0.95)" : "rgba(255,255,255,0.6)"}
                strokeWidth={isHovered ? "2" : "0.8"}
              />
            </g>
          );
        })}
      </g>

      {/* Hint text — outside zoom group so it stays fixed */}
      <text
        x={Number(vbW) / 2}
        y={Number(vbH) - 3}
        textAnchor="middle"
        fill="var(--muted, #7A6A52)"
        fontSize={9}
        style={{ pointerEvents: "none" }}
      >
        drag to rotate · scroll to zoom · hover slab for details
      </text>
    </svg>

    {/* Layer selector — only shown when multiple layers exist */}
    {layers.length > 1 && (
      <div style={{
        display: "flex", flexWrap: "wrap", gap: 5, marginTop: 8,
        justifyContent: "center", alignItems: "center",
      }}>
        <span style={{ fontSize: 10, color: "var(--muted)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", marginRight: 2 }}>
          Layer:
        </span>
        <button
          onClick={() => setActiveLayerIdx(null)}
          style={{
            fontSize: 11, padding: "3px 10px", borderRadius: 12,
            border: `1.5px solid ${activeLayerIdx === null ? "var(--gold)" : "var(--border)"}`,
            background: activeLayerIdx === null ? "var(--gold)" : "transparent",
            color: activeLayerIdx === null ? "#fff" : "var(--muted)",
            fontWeight: activeLayerIdx === null ? 700 : 500,
            cursor: "pointer", transition: "all 0.12s",
          }}
        >
          All
        </button>
        {layers.map((layer, li) => {
          const isActive = activeLayerIdx === li;
          const layerSlabIds = [...layer.ids];
          const sampleColor = sclr(layerSlabIds[0] ?? "1");
          return (
            <button
              key={li}
              onClick={() => setActiveLayerIdx(isActive ? null : li)}
              style={{
                fontSize: 11, padding: "3px 10px", borderRadius: 12,
                border: `1.5px solid ${isActive ? sampleColor : "var(--border)"}`,
                background: isActive ? sampleColor + "22" : "transparent",
                color: isActive ? "var(--text)" : "var(--muted)",
                fontWeight: isActive ? 700 : 500,
                cursor: "pointer", transition: "all 0.12s",
                display: "flex", alignItems: "center", gap: 4,
              }}
            >
              <span style={{ width: 7, height: 7, borderRadius: 2, background: sampleColor, display: "inline-block", flexShrink: 0 }} />
              L{li + 1} &nbsp;
              <span style={{ fontSize: 9, opacity: 0.75, fontFamily: "ui-monospace, monospace" }}>
                {layer.zBot.toFixed(0)}–{layer.zTop.toFixed(0)}&Prime;
              </span>
            </button>
          );
        })}
      </div>
    )}
    </div>
  );
}

// ─── Planning Workbench UI ──────────────────────────────────────────────────────

export function PlanningWorkbench({
  blocks,
  slabs,
  aiAvailablePool = [],
  approveAction,
  aiSuggestionsAction,
  stoneTypes,
}: {
  blocks: BlockRow[];
  slabs: SlabRow[];
  /**
   * Open slabs the user did NOT send to this planner (URL-unselected).
   * NOT rendered in the slab-selection UI — purely a candidate pool
   * for the developer-only AI suggestions endpoint, which scans it
   * for slabs that would fit into leftover space on planned blocks.
   * Defaults to [] so non-developer / un-fetched cases are safe.
   */
  aiAvailablePool?: SlabRow[];
  approveAction: (formData: FormData) => void | Promise<void>;
  /**
   * Developer-only post-algorithm AI assistant. When provided, a "Get
   * AI suggestions" button appears below the result card. Clicking it
   * sends the algorithm's plan + unfittable slabs + open inventory
   * to the model and gets back filler + procurement suggestions.
   */
  aiSuggestionsAction?: (payload: {
    plan: Array<{
      block: { id: string; stone: string; length_ft: number; width_ft: number; height_ft: number; quality: string | null };
      placed: Array<{ id: string; label: string; temple: string; length_ft: number; width_ft: number; thickness_ft: number }>;
      biggest_leftover: { length: number; width: number; height: number } | null;
      efficiency_pct: number;
    }>;
    unfittableSlabs: Array<{ id: string; label: string; temple: string; stone: string | null; length_ft: number; width_ft: number; thickness_ft: number; quality: string | null; priority: boolean }>;
    availableSlabs: Array<{ id: string; label: string; temple: string; stone: string | null; length_ft: number; width_ft: number; thickness_ft: number; priority: boolean; quality: string | null }>;
    kerfMm: number;
  }) => Promise<AISuggestionsResponse>;
  stoneTypes?: StoneTypeDef[];
}) {
  const [kerfMm, setKerfMm] = useState(20);
  const [result, setResult] = useState<PlanResult | null>(null);
  // Facility = hard separation between MTCPL and RIICO sites. A plan can only
  // ever use blocks from the active facility — switching facility wipes prior
  // selections to prevent cross-site mixing.
  const [facility, setFacility] = useState<Facility>("mtcpl");
  // Yards within the active facility that are currently ticked. Starts full.
  const [selectedYards, setSelectedYards] = useState<Set<number>>(
    () => new Set(YARDS_BY_FACILITY["mtcpl"]),
  );
  const [ackUnmet, setAckUnmet] = useState(false);
  const [originalSelectedCount, setOriginalSelectedCount] = useState(0);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiStrategy, setAiStrategy] = useState<string | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  // AI filler suggestions = open slabs the user did NOT select but which
  // the model thinks would fit into leftover space on already-planned
  // blocks. Cleared whenever a fresh algorithm run starts.
  const [aiSuggestions, setAiSuggestions] = useState<AISuggestion[]>([]);
  // AI procurement suggestions = block dimensions the company should
  // procure to unblock currently-unfittable slabs.
  const [aiProcurement, setAiProcurement] = useState<AIProcurementSuggestion[]>([]);

  const allUsableBlocks = blocks.filter((block) => block.status === "available" || block.status === "reserved");
  // Blocks restricted to active facility first, then to ticked yards within it.
  const facilityBlocks = allUsableBlocks.filter((b) => facilityOfYard(b.yard) === facility);
  const usableBlocks = facilityBlocks.filter((b) => selectedYards.has(Number(b.yard)));
  const openSlabs = slabs.filter((slab) => slab.status === "open" || slab.status === "planned");

  const [selectedBlockIds, setSelectedBlockIds] = useState<Set<string>>(
    () => new Set(allUsableBlocks.filter((b) => facilityOfYard(b.yard) === "mtcpl").map((b) => b.id)),
  );
  const [selectedSlabIds, setSelectedSlabIds] = useState<Set<string>>(() => new Set(openSlabs.map((s) => s.id)));
  // Hide the long block list once there are enough blocks that scrolling
  // past them just to reach "Generate Plan" becomes a chore. The header
  // shows a toggle so the user can re-expand any time. Default-collapsed
  // when >20 blocks; small inventories stay expanded so nothing changes
  // for the common case.
  const [showBlockList, setShowBlockList] = useState<boolean>(
    () => allUsableBlocks.length <= 20,
  );

  function pickFacility(f: Facility) {
    if (f === facility) return;
    setFacility(f);
    // Auto-tick every yard of the new facility so the user starts with
    // "everything in this site" rather than nothing.
    setSelectedYards(new Set(YARDS_BY_FACILITY[f]));
    // Re-seed block selection to include every available block in the new
    // facility. Any previously-selected MTCPL block can never survive into a
    // RIICO plan (and vice versa) — this enforces the no-mixing rule.
    setSelectedBlockIds(
      new Set(allUsableBlocks.filter((b) => facilityOfYard(b.yard) === f).map((b) => b.id)),
    );
    // Old suggestions reference the previous facility's blocks — drop them.
    setAiSuggestions([]);
    setAiProcurement([]);
    setAiStrategy(null);
  }

  function toggleYard(y: number) {
    setSelectedYards((prev) => {
      const next = new Set(prev);
      if (next.has(y)) next.delete(y);
      else next.add(y);
      return next;
    });
  }

  const slabsByTemple = openSlabs.reduce<Record<string, SlabRow[]>>((acc, slab) => {
    if (!acc[slab.temple]) acc[slab.temple] = [];
    acc[slab.temple].push(slab);
    return acc;
  }, {});
  const templeKeys = Object.keys(slabsByTemple).sort();

  function toggleBlock(id: string) {
    setSelectedBlockIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function toggleSlab(id: string) {
    setSelectedSlabIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function generatePlan() {
    const filteredBlocks = usableBlocks.filter((b) => selectedBlockIds.has(b.id));
    const filteredSlabs = openSlabs.filter((s) => selectedSlabIds.has(s.id));
    setAckUnmet(false);
    setAiStrategy(null);
    setAiError(null);
    // Re-planning invalidates any prior AI suggestions — they were
    // computed against the previous plan output and could now point
    // to slabs/blocks that have moved.
    setAiSuggestions([]);
    setAiProcurement([]);
    setOriginalSelectedCount(filteredSlabs.length);
    if (filteredSlabs.length === 0) {
      setResult({ plan: [], unmet: [], totalWaste: 0 });
      return;
    }
    setResult(runOptimization(filteredBlocks, filteredSlabs, kerfMm));
  }

  /**
   * Post-algorithm AI assistant. Sends the algorithm's plan + the
   * unfittable slabs + the open inventory to the model and asks it
   * for filler suggestions (slabs to add for tighter packing) and
   * procurement suggestions (block sizes to order to unblock the
   * unfittable slabs). Does NOT re-plan — the algorithm's output is
   * authoritative.
   */
  async function handleGetAISuggestions() {
    if (!aiSuggestionsAction || !result) return;

    setAiLoading(true);
    setAiError(null);
    setAiStrategy(null);
    setAiSuggestions([]);
    setAiProcurement([]);

    // Available pool fed to the AI = (a) open slabs the user could
    // have picked but didn't, plus (b) the broader pool fetched on
    // page load (every OTHER open slab in the system that wasn't
    // sent to this planner). The latter is the important addition —
    // without it, when the user sends only 3 slabs from /slabs/view
    // the AI thought the inventory was empty.
    //
    // De-dupe by id in case a slab somehow appears in both lists.
    const planSlabIds = new Set(result.plan.flatMap((pb) => pb.placed.map((p) => p.id)));
    const availableMap = new Map<string, SlabRow>();
    for (const s of openSlabs) {
      if (!selectedSlabIds.has(s.id) && !planSlabIds.has(s.id)) {
        availableMap.set(s.id, s);
      }
    }
    for (const s of aiAvailablePool) {
      if (!planSlabIds.has(s.id)) availableMap.set(s.id, s);
    }
    const availableSlabs = [...availableMap.values()];

    // Unfittable list — every slab in result.unmet, looked up in the
    // current open-slab data so the AI sees full dims/stone/quality.
    const slabById = new Map(openSlabs.map((s) => [s.id, s]));
    const unfittable = result.unmet
      .map((u) => slabById.get(u.id))
      .filter((s): s is SlabRow => !!s)
      .map((s) => ({
        id: s.id, label: s.label, temple: s.temple,
        stone: s.stone, length_ft: toNum(s.length_ft), width_ft: toNum(s.width_ft),
        thickness_ft: toNum(s.thickness_ft),
        quality: s.quality,
        priority: s.priority ?? false,
      }));

    try {
      const response = await aiSuggestionsAction({
        plan: result.plan.map((pb) => ({
          block: {
            id: pb.blk.id,
            stone: pb.blk.stone,
            length_ft: pb.blk.l,
            width_ft: pb.blk.w,
            height_ft: pb.blk.h,
            quality: pb.blk.quality ?? null,
          },
          placed: pb.placed.map((p) => ({
            id: p.id, label: p.label, temple: p.temple,
            length_ft: p.sw, width_ft: p.sh, thickness_ft: p.sd,
          })),
          biggest_leftover: pb.biggest
            ? { length: pb.biggest.l, width: pb.biggest.w, height: pb.biggest.h }
            : null,
          efficiency_pct: pb.eff,
        })),
        unfittableSlabs: unfittable,
        availableSlabs: availableSlabs.map((s) => ({
          id: s.id, label: s.label, temple: s.temple, stone: s.stone,
          length_ft: toNum(s.length_ft), width_ft: toNum(s.width_ft),
          thickness_ft: toNum(s.thickness_ft),
          priority: s.priority ?? false, quality: s.quality,
        })),
        kerfMm,
      });

      if (response.error) {
        setAiError(response.error);
        return;
      }

      setAiStrategy(response.strategy ?? null);

      // Defensive filtering of fillers — block_id must be in the plan,
      // slab_id must be in the available pool. Guards against the model
      // hallucinating IDs.
      const validBlockIds = new Set(result.plan.map((pb) => pb.blk.id));
      const validSlabIds = new Set(availableSlabs.map((s) => s.id));
      setAiSuggestions(
        (response.fillerSuggestions ?? []).filter(
          (s) => validBlockIds.has(s.block_id) && validSlabIds.has(s.slab_id),
        ),
      );

      // Procurement: keep entries whose unblocks_slab_ids reference
      // genuinely-unfittable slabs (drop hallucinated refs).
      const unfittableIds = new Set(unfittable.map((s) => s.id));
      setAiProcurement(
        (response.procurementSuggestions ?? []).map((p) => ({
          ...p,
          unblocks_slab_ids: p.unblocks_slab_ids.filter((id) => unfittableIds.has(id)),
        })).filter((p) => p.unblocks_slab_ids.length > 0),
      );
    } catch (err) {
      setAiError(err instanceof Error ? err.message : "AI suggestion request failed. Try again.");
    } finally {
      setAiLoading(false);
    }
  }

  /**
   * Add an AI filler suggestion to the user's slab selection and
   * immediately re-run the algorithmic plan so the new slab is placed.
   */
  function acceptSuggestion(slabId: string) {
    setSelectedSlabIds((prev) => new Set(prev).add(slabId));
    setAiSuggestions((prev) => prev.filter((s) => s.slab_id !== slabId));
    // Re-plan on the next tick so React picks up the new selection.
    // NOTE: we use the ALGORITHM (generatePlan), not AI — the AI gave
    // us suggestions, the algorithm packs them.
    setTimeout(() => generatePlan(), 0);
  }

  /** Bulk-accept every filler + re-plan. */
  function acceptAllSuggestions() {
    if (aiSuggestions.length === 0) return;
    setSelectedSlabIds((prev) => {
      const next = new Set(prev);
      for (const s of aiSuggestions) next.add(s.slab_id);
      return next;
    });
    setAiSuggestions([]);
    setTimeout(() => generatePlan(), 0);
  }

  const totalPlaced = result?.plan.reduce((sum, block) => sum + block.placed.length, 0) ?? 0;
  // Aggregate efficiency across all plan blocks, weighted by block volume.
  const planTotals = (() => {
    if (!result || !result.plan.length) return null;
    let totalBlockVol = 0, totalSlabVol = 0, totalRestockVol = 0;
    for (const pb of result.plan) {
      const e = computeCutEfficiency(pb.blk, pb.placed, pb.biggest);
      if (!e) continue;
      totalBlockVol += e.blockVol;
      totalSlabVol += e.slabVol;
      totalRestockVol += e.restockVol;
    }
    if (totalBlockVol <= 0) return null;
    const slabPct = Math.round((totalSlabVol / totalBlockVol) * 100);
    const restockPct = Math.round((totalRestockVol / totalBlockVol) * 100);
    return { slabPct, restockPct, wastePct: Math.max(0, 100 - slabPct - restockPct) };
  })();
  const avgEff = planTotals?.slabPct ?? 0;

  return (
    <>
      <section className="page-card">
        <div className="topbar" style={{ marginBottom: 0 }}>
          <div>
            <h1>3D Cut Planning</h1>
            <p className="muted">
              Review stock blocks and required slabs below, then generate a multilayer 3D cut plan.
            </p>
          </div>
        </div>
      </section>

      <div className="planning-two-col">
        <section className="page-card">
          <div className="section-heading" style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
            <div>
              <h2 style={{ margin: 0 }}>Stock Blocks ({usableBlocks.length})</h2>
              <p className="muted">Available and reserved blocks for cutting</p>
            </div>
            {/* Hide/show button — collapses just the long list of cards
                so users with 100+ blocks can still reach the controls
                + Generate Plan button without endless scrolling. */}
            <button
              type="button"
              onClick={() => setShowBlockList((v) => !v)}
              className="ghost-button"
              style={{ fontSize: 12, padding: "6px 12px", whiteSpace: "nowrap" }}
              aria-expanded={showBlockList}
            >
              {showBlockList ? "▴ Hide list" : `▾ Show list (${usableBlocks.length})`}
            </button>
          </div>
          {/* Facility selector — hard split between MTCPL and RIICO sites.
              Switching wipes block selection so a plan can never mix sites. */}
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8, flexWrap: "wrap" }}>
            <span style={{ fontSize: 11, color: "var(--muted)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em" }}>
              Facility:
            </span>
            {FACILITIES.map(f => {
              const isActive = facility === f;
              return (
                <button
                  key={f}
                  type="button"
                  onClick={() => pickFacility(f)}
                  style={{
                    fontSize: 12,
                    fontWeight: 700,
                    padding: "5px 14px",
                    borderRadius: 6,
                    border: `1.5px solid ${isActive ? "var(--gold)" : "var(--border)"}`,
                    background: isActive ? "var(--gold)" : "var(--bg)",
                    color: isActive ? "#fff" : "var(--muted)",
                    cursor: "pointer",
                    letterSpacing: "0.04em",
                  }}
                >
                  {facilityLabel(f)}
                </button>
              );
            })}
            <span style={{ fontSize: 10, color: "var(--muted)", fontStyle: "italic" }}>
              (can't mix — different physical sites)
            </span>
          </div>

          {/* Yard checkboxes — scoped to active facility */}
          <div style={{ display: "flex", gap: 6, marginBottom: 10, flexWrap: "wrap", alignItems: "center" }}>
            <span style={{ fontSize: 11, color: "var(--muted)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", marginRight: 4 }}>
              Yards:
            </span>
            {YARDS_BY_FACILITY[facility].map(y => {
              const ticked = selectedYards.has(y);
              return (
                <button
                  key={y}
                  type="button"
                  onClick={() => toggleYard(y)}
                  style={{
                    fontSize: 11, padding: "3px 10px", borderRadius: 20,
                    border: `1px solid ${ticked ? "var(--gold-dark)" : "var(--border)"}`,
                    background: ticked ? "rgba(184,115,51,0.15)" : "var(--bg)",
                    color: ticked ? "var(--gold-dark)" : "var(--muted)",
                    fontWeight: 600, cursor: "pointer",
                    display: "inline-flex", alignItems: "center", gap: 5,
                  }}
                >
                  <span style={{ fontSize: 10 }}>{ticked ? "✓" : "○"}</span>
                  {yardLabel(y)}
                </button>
              );
            })}
            <button
              type="button"
              onClick={() => setSelectedYards(new Set(YARDS_BY_FACILITY[facility]))}
              style={{ fontSize: 10, padding: "3px 8px", borderRadius: 10, border: "1px dashed var(--border)", background: "transparent", color: "var(--muted)", cursor: "pointer", marginLeft: 4 }}
            >
              All
            </button>
            <button
              type="button"
              onClick={() => setSelectedYards(new Set())}
              style={{ fontSize: 10, padding: "3px 8px", borderRadius: 10, border: "1px dashed var(--border)", background: "transparent", color: "var(--muted)", cursor: "pointer" }}
            >
              None
            </button>
          </div>

          <div className="plan-select-row" style={{ marginBottom: 8 }}>
            <button className="ghost-button" style={{ fontSize: 12, padding: "2px 10px" }} type="button" onClick={() => setSelectedBlockIds(new Set(usableBlocks.map((b) => b.id)))}>Select All</button>
            <button className="ghost-button" style={{ fontSize: 12, padding: "2px 10px" }} type="button" onClick={() => setSelectedBlockIds(new Set())}>Deselect All</button>
          </div>
          {!showBlockList && (
            // Collapsed summary — keep the operator informed without
            // forcing them to expand the list. Selection counter
            // matches the toolbar at the bottom.
            <div
              className="banner"
              style={{ marginTop: 4, fontSize: 12, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}
            >
              <span>
                <strong>{selectedBlockIds.size}</strong> of <strong>{usableBlocks.length}</strong> blocks selected ·
                list hidden to keep Generate Plan in reach.
              </span>
              <button
                type="button"
                onClick={() => setShowBlockList(true)}
                className="ghost-button"
                style={{ fontSize: 11, padding: "3px 10px" }}
              >
                Show list
              </button>
            </div>
          )}
          {showBlockList && (
          <div className="records-stack" style={{ marginTop: 4 }}>
            {usableBlocks.length === 0 ? (
              <div className="banner">No usable blocks found.</div>
            ) : usableBlocks.map((block) => (
              <div className={`record-card compact-record plan-selectable${selectedBlockIds.has(block.id) ? "" : " plan-deselected"}`} key={block.id} onClick={() => toggleBlock(block.id)} style={{ cursor: "pointer" }}>
                <div className="record-head">
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <input
                      checked={selectedBlockIds.has(block.id)}
                      className="plan-check"
                      readOnly
                      type="checkbox"
                      onClick={(e) => { e.stopPropagation(); toggleBlock(block.id); }}
                    />
                    <BlockMiniPreview stone={block.stone} stoneTypes={stoneTypes} />
                    <div>
                      <div className="record-title-row">
                        <strong>{block.id}</strong>
                        <span className="role-pill">{block.category}</span>
                        <span className="role-pill">{yardShortLabel(block.yard)}</span>
                        {block.quality ? (
                          <span className={`role-pill ${block.quality === "A" ? "badge-available" : "badge-reserved"}`}>
                            Grade {block.quality}
                          </span>
                        ) : <span className="role-pill">Any Grade</span>}
                      </div>
                      <p className="muted">
                        {block.stone} | {block.length_ft} × {block.width_ft} × {block.height_ft} in
                      </p>
                    </div>
                  </div>
                  <span className="role-pill">{block.status}</span>
                </div>
              </div>
            ))}
          </div>
          )}
        </section>

        <section className="page-card">
          <div className="section-heading">
            <h2 style={{ margin: 0 }}>Required Slabs ({openSlabs.length})</h2>
            <p className="muted">Sorted by temple</p>
          </div>
          <div className="plan-select-row" style={{ marginBottom: 8 }}>
            <button className="ghost-button" style={{ fontSize: 12, padding: "2px 10px" }} type="button" onClick={() => setSelectedSlabIds(new Set(openSlabs.map((s) => s.id)))}>Select All</button>
            <button className="ghost-button" style={{ fontSize: 12, padding: "2px 10px" }} type="button" onClick={() => setSelectedSlabIds(new Set())}>Deselect All</button>
          </div>
          {openSlabs.length === 0 ? (
            <div className="banner" style={{ marginTop: 12 }}>No open slab requirements found. Add slabs in the Slabs section first.</div>
          ) : templeKeys.length === 0 ? (
            <div className="banner" style={{ marginTop: 12 }}>No open slab requirements found.</div>
          ) : templeKeys.map((temple) => (
            <div key={temple} style={{ marginTop: 14 }}>
              <p className="muted" style={{ fontWeight: 600, marginBottom: 6 }}>{temple}</p>
              <div className="records-stack">
                {slabsByTemple[temple].map((slab) => (
                  <div className={`record-card compact-record plan-selectable${selectedSlabIds.has(slab.id) ? "" : " plan-deselected"}`} key={slab.id} onClick={() => toggleSlab(slab.id)} style={{ cursor: "pointer", ...(slab.priority ? { borderLeft: "4px solid #DC2626", background: "rgba(220,38,38,0.10)" } : {}) }}>
                    <div className="record-head">
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <input
                          checked={selectedSlabIds.has(slab.id)}
                          className="plan-check"
                          readOnly
                          type="checkbox"
                          onClick={(e) => { e.stopPropagation(); toggleSlab(slab.id); }}
                        />
                        <SlabMiniPreview accent={sclr(slab.id)} stone={slab.stone} stoneTypes={stoneTypes} />
                        <div>
                          <div className="record-title-row">
                            <strong style={{ color: sclr(slab.id) }}>{slab.id}</strong>
                            {slab.priority && <span style={{ fontSize: 10, fontWeight: 700, color: "#DC2626", background: "rgba(220,38,38,0.12)", padding: "1px 6px", borderRadius: 8 }}>⚡ Urgent</span>}
                            {slab.stone ? <span className="role-pill">{slab.stone}</span> : null}
                            {slab.quality ? (
                              <span className={`role-pill ${slab.quality === "A" ? "badge-available" : "badge-reserved"}`}>
                                Grade {slab.quality}
                              </span>
                            ) : <span className="role-pill">Any Grade</span>}
                          </div>
                          <p className="muted">
                            {slab.label} | {slab.length_ft} × {slab.width_ft} × {slab.thickness_ft} in
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </section>
      </div>

      <section className="page-card">
        <div className="planning-toolbar">
          <label className="stack">
            <span>Blade Kerf</span>
            <input
              min="0.5"
              step="0.5"
              type="number"
              value={kerfMm}
              onChange={(event) => setKerfMm(Number(event.target.value) || 4)}
            />
          </label>
          <span className="muted">mm</span>

          <div className="banner">
            <strong>{selectedBlockIds.size}</strong>/{usableBlocks.length} blocks · <strong>{selectedSlabIds.size}</strong>/{openSlabs.length} slabs selected · multilayer cuts, all 3 block orientations
          </div>

          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <button className="primary-button" onClick={generatePlan} type="button">
              Generate 3D Cut Plan
            </button>
          </div>
          {aiError && (
            <div style={{ fontSize: 12, color: "#DC2626", marginTop: 4, padding: "6px 10px", background: "rgba(220,38,38,0.05)", borderRadius: 6 }}>
              ⚠ {aiError}
            </div>
          )}
        </div>
      </section>

      {/* ── AI suggestion trigger ────────────────────────────────────
          Developer-only. Visible once an algorithm plan exists OR
          the algorithm produced unfittable slabs. Fires the AI to
          look for filler slabs (open-pool slabs that fit leftover
          space) and procurement suggestions (block sizes to order
          for unfittable slabs). Hidden after a successful AI run
          since the panels themselves carry the actionable info. */}
      {aiSuggestionsAction && result && (result.plan.length > 0 || result.unmet.length > 0) &&
        aiSuggestions.length === 0 && aiProcurement.length === 0 && !aiStrategy && (
          <section className="page-card" style={{ background: "rgba(124,58,237,0.04)", border: "1px solid rgba(124,58,237,0.2)" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
              <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                <span style={{ fontSize: 22, lineHeight: 1.3 }}>🤖</span>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "#7c3aed", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                    AI Suggestions <span style={{ color: "#888", fontWeight: 500 }}>(developer-only)</span>
                  </div>
                  <p style={{ margin: "2px 0 0", fontSize: 13, color: "var(--text)" }}>
                    {result.plan.length > 0 && result.unmet.length === 0 &&
                      "Plan generated. Ask AI to suggest other open slabs that could fit into leftover space for tighter packing."}
                    {result.plan.length > 0 && result.unmet.length > 0 &&
                      `Plan generated with ${result.unmet.length} unfittable slab${result.unmet.length === 1 ? "" : "s"}. AI can suggest filler slabs AND block sizes to procure.`}
                    {result.plan.length === 0 && result.unmet.length > 0 &&
                      `${result.unmet.length} slab${result.unmet.length === 1 ? "" : "s"} couldn't be placed in current stock. AI can suggest block sizes to procure.`}
                  </p>
                </div>
              </div>
              <button
                type="button"
                className="primary-button"
                onClick={handleGetAISuggestions}
                disabled={aiLoading}
                style={{ fontSize: 13, padding: "8px 18px", whiteSpace: "nowrap", display: "flex", alignItems: "center", gap: 6 }}
              >
                <span style={{ fontSize: 14 }}>✨</span>
                {aiLoading ? "AI thinking…" : "Get suggestions from AI"}
              </button>
            </div>
            {aiError && (
              <div style={{ fontSize: 12, color: "#DC2626", marginTop: 10, padding: "6px 10px", background: "rgba(220,38,38,0.05)", borderRadius: 6 }}>
                ⚠ {aiError}
              </div>
            )}
          </section>
        )}

      {/* ── AI Strategy banner ────────────────────────────────────── */}
      {aiStrategy && (
        <section className="page-card" style={{ background: "rgba(124,58,237,0.04)", border: "1px solid rgba(124,58,237,0.2)" }}>
          <div style={{ display: "flex", gap: 10, alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap" }}>
            <div style={{ display: "flex", gap: 10, alignItems: "flex-start", flex: "1 1 360px", minWidth: 0 }}>
              <span style={{ fontSize: 20, flexShrink: 0, lineHeight: 1.3 }}>✨</span>
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#7c3aed", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 5 }}>
                  AI Analysis
                </div>
                <p style={{ margin: 0, fontSize: 13, color: "var(--text)", lineHeight: 1.6 }}>{aiStrategy}</p>
              </div>
            </div>
            {/* Re-run button — useful if the user wants a second
                opinion or has changed something. */}
            {aiSuggestionsAction && result && (
              <button
                type="button"
                className="ghost-button"
                onClick={handleGetAISuggestions}
                disabled={aiLoading}
                style={{ fontSize: 11, padding: "5px 12px", whiteSpace: "nowrap" }}
              >
                {aiLoading ? "AI thinking…" : "↻ Re-run AI"}
              </button>
            )}
          </div>
          {aiError && (
            <div style={{ fontSize: 12, color: "#DC2626", marginTop: 10, padding: "6px 10px", background: "rgba(220,38,38,0.05)", borderRadius: 6 }}>
              ⚠ {aiError}
            </div>
          )}
        </section>
      )}

      {aiSuggestions.length > 0 && (() => {
        const slabById = new Map(openSlabs.map((s) => [s.id, s]));
        // Group suggestions by block for compact display
        const groups = new Map<string, AISuggestion[]>();
        for (const sug of aiSuggestions) {
          const arr = groups.get(sug.block_id) ?? [];
          arr.push(sug);
          groups.set(sug.block_id, arr);
        }
        return (
          <section
            className="page-card"
            style={{
              background: "rgba(245,158,11,0.05)",
              border: "1px solid rgba(245,158,11,0.3)",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
              <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                <span style={{ fontSize: 20, lineHeight: 1.3 }}>💡</span>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "#b45309", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                    Efficiency suggestions
                  </div>
                  <p style={{ margin: "2px 0 0", fontSize: 13, color: "var(--text)" }}>
                    {aiSuggestions.length} open slab{aiSuggestions.length === 1 ? "" : "s"} you didn&rsquo;t select would fit into leftover space on the planned blocks.
                  </p>
                </div>
              </div>
              {aiSuggestions.length > 1 && (
                <button
                  type="button"
                  className="primary-button"
                  onClick={acceptAllSuggestions}
                  style={{ fontSize: 12, padding: "6px 14px" }}
                  disabled={aiLoading}
                >
                  Add all {aiSuggestions.length} & re-plan
                </button>
              )}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {[...groups.entries()].map(([blockId, sugs]) => (
                <div
                  key={blockId}
                  style={{
                    border: "1px solid rgba(245,158,11,0.2)",
                    borderRadius: 8,
                    padding: "10px 12px",
                    background: "var(--surface)",
                  }}
                >
                  <div style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>
                    On block <code style={{ fontFamily: "ui-monospace, monospace", color: "var(--gold-dark)" }}>{blockId}</code>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {sugs.map((sug) => {
                      const slab = slabById.get(sug.slab_id);
                      return (
                        <div
                          key={sug.slab_id}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            gap: 10,
                            flexWrap: "wrap",
                            padding: "8px 10px",
                            background: "var(--surface-alt)",
                            borderRadius: 6,
                          }}
                        >
                          <div style={{ flex: "1 1 240px", minWidth: 0 }}>
                            <div style={{ display: "flex", alignItems: "baseline", gap: 6, flexWrap: "wrap" }}>
                              <strong style={{ fontFamily: "ui-monospace, monospace", fontSize: 13 }}>{sug.slab_id}</strong>
                              {slab && (
                                <span style={{ fontSize: 11, color: "var(--muted)" }}>
                                  · {slab.temple} · {slab.length_ft}×{slab.width_ft}×{slab.thickness_ft}″
                                  {slab.priority && <span style={{ color: "#DC2626", marginLeft: 6, fontWeight: 700 }}>⚡</span>}
                                </span>
                              )}
                            </div>
                            <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 3, fontStyle: "italic" }}>
                              {sug.reasoning}
                            </div>
                          </div>
                          <button
                            type="button"
                            className="ghost-button"
                            onClick={() => acceptSuggestion(sug.slab_id)}
                            disabled={aiLoading}
                            style={{ fontSize: 12, padding: "5px 12px", whiteSpace: "nowrap" }}
                          >
                            + Add &amp; re-plan
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
            <p className="muted" style={{ fontSize: 11, marginTop: 10, marginBottom: 0, fontStyle: "italic" }}>
              These are AI estimates — the geometry engine will validate fit when you re-plan. If a suggestion
              doesn&rsquo;t pack as expected, the slab quietly drops out of the new plan.
            </p>
          </section>
        );
      })()}

      {/* ── Procurement suggestions ─────────────────────────────────
          Block dimensions the AI suggests procuring/ordering to
          unblock slabs the algorithm flagged as unfittable. Surfaced
          when result.unmet contains slabs (selected slabs that no
          block in current stock could hold). */}
      {aiProcurement.length > 0 && (() => {
        const slabById = new Map(openSlabs.map((s) => [s.id, s]));
        return (
          <section
            className="page-card"
            style={{
              background: "rgba(220,38,38,0.04)",
              border: "1px solid rgba(220,38,38,0.3)",
            }}
          >
            <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 10 }}>
              <span style={{ fontSize: 22, lineHeight: 1.3 }}>📦</span>
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#991b1b", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                  Procurement suggestions
                </div>
                <p style={{ margin: "2px 0 0", fontSize: 13, color: "var(--text)" }}>
                  AI recommends procuring {aiProcurement.length} block size{aiProcurement.length === 1 ? "" : "s"} to handle slabs that don&rsquo;t fit in current stock.
                </p>
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {aiProcurement.map((p, i) => (
                <div
                  key={i}
                  style={{
                    border: "1px solid rgba(220,38,38,0.2)",
                    borderRadius: 8,
                    padding: "12px 14px",
                    background: "var(--surface)",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap", marginBottom: 6 }}>
                    <strong style={{ fontSize: 14 }}>
                      {p.quantity}× {p.stone}
                    </strong>
                    <span style={{ fontFamily: "ui-monospace, monospace", fontSize: 13, color: "var(--gold-dark)" }}>
                      {p.recommended.length}″L × {p.recommended.width}″W × {p.recommended.height}″H
                    </span>
                    {p.quality && (
                      <span className="role-pill" style={{ fontSize: 10 }}>Grade {p.quality}</span>
                    )}
                  </div>
                  <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 8, fontStyle: "italic" }}>
                    {p.reasoning}
                  </div>
                  <div style={{ fontSize: 11, color: "var(--muted)" }}>
                    <span style={{ fontWeight: 700, color: "#991b1b", textTransform: "uppercase", letterSpacing: "0.05em", fontSize: 10 }}>
                      Unblocks {p.unblocks_slab_ids.length} slab{p.unblocks_slab_ids.length === 1 ? "" : "s"}:
                    </span>
                    <div style={{ marginTop: 3, display: "flex", gap: 6, flexWrap: "wrap" }}>
                      {p.unblocks_slab_ids.map((id) => {
                        const slab = slabById.get(id);
                        return (
                          <span
                            key={id}
                            style={{
                              fontFamily: "ui-monospace, monospace",
                              fontSize: 11,
                              padding: "2px 7px",
                              background: "var(--surface-alt)",
                              borderRadius: 10,
                              color: "var(--text)",
                            }}
                          >
                            {id}
                            {slab && <span style={{ color: "var(--muted)", marginLeft: 4 }}>({slab.length_ft}×{slab.width_ft}×{slab.thickness_ft}″)</span>}
                          </span>
                        );
                      })}
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <p className="muted" style={{ fontSize: 11, marginTop: 10, marginBottom: 0, fontStyle: "italic" }}>
              AI estimate based on the unfittable slabs — verify dims with your supplier before placing the order.
            </p>
          </section>
        );
      })()}

      {result ? (
        <>
          {result.plan.length === 0 && selectedSlabIds.size === 0 ? (
            <section className="page-card">
              <div className="banner" style={{ textAlign: "center", padding: "32px 20px" }}>
                <strong>No slabs selected.</strong>
                <p className="muted" style={{ marginTop: 8 }}>Select at least one slab requirement above, then click Generate 3D Cut Plan.</p>
              </div>
            </section>
          ) : result.plan.length === 0 ? (
            <section className="page-card">
              <div className="banner" style={{ textAlign: "center", padding: "32px 20px" }}>
                <strong>No slabs could be placed.</strong>
                <p className="muted" style={{ marginTop: 8 }}>Check that selected blocks are large enough to fit the selected slab dimensions.</p>
              </div>
            </section>
          ) : (
            <>
              <section className="metrics-grid" style={{ marginTop: 16 }}>
                <div className="metric-card">
                  <span>Placed slabs</span>
                  <strong>{totalPlaced}</strong>
                </div>
                <div className="metric-card">
                  <span>Blocks used</span>
                  <strong>{result.plan.length}</strong>
                </div>
                <div className="metric-card" title="Volume of block that becomes actual slabs — excludes kerf, scrap, and any reusable remainder piece.">
                  <span>Slab yield</span>
                  <strong>{avgEff}%</strong>
                </div>
                {planTotals && planTotals.restockPct > 0 && (
                  <div className="metric-card" title="Volume recovered as restockable remainder piece (not waste).">
                    <span>Restockable</span>
                    <strong>{planTotals.restockPct}%</strong>
                  </div>
                )}
                <div className="metric-card" title="True waste = block − slabs − restockable. Includes kerf loss and small scraps.">
                  <span>True waste</span>
                  <strong>{planTotals?.wastePct ?? 0}%</strong>
                </div>
                <div className="metric-card">
                  <span>Unfit slabs</span>
                  <strong>{result.unmet.length}</strong>
                </div>
              </section>

              <section className="page-card">
                <div className="banner" style={{ marginBottom: 16 }}>
                  Kerf {kerfMm} mm · Multilayer vertical cuts · right-click drag 3D view to rotate · scroll to zoom
                </div>

                <div className="plan-grid">
                  {result.plan.map((item) => {
                    // Count distinct layers by unique zTop values
                    const layerCount = new Set(item.placed.map((p) => p.zTop?.toFixed(3) ?? "0")).size;
                    const eff = computeCutEfficiency(item.blk, item.placed, item.biggest);
                    return (
                      <article className="plan-card" key={item.blk.id}>
                        <div className="record-head">
                          <div>
                            <strong>{item.blk.id}</strong>
                            <p className="muted">
                              {item.blk.stone} | {yardLabel(item.blk.yard)} | {item.blk.l} × {item.blk.w} × {item.blk.h} in
                              {item.blk.orient ? <> · <span className="role-pill">{item.blk.orient}</span></> : null}
                              {layerCount > 1 ? <> · <span className="role-pill">{layerCount} layers</span></> : null}
                            </p>
                          </div>
                          <span className="role-pill">Slab yield {eff?.slabPct ?? item.eff}%</span>
                        </div>

                        <IsoBlockPreview block={item.blk} placed={item.placed} stoneTypes={stoneTypes} />

                        <div className="chip-row">
                          {item.placed.map((slab) => (
                            <span
                              className="plan-chip"
                              key={slab.id}
                              style={{ background: `${sclr(slab.id)}22`, color: sclr(slab.id), borderColor: `${sclr(slab.id)}44` }}
                            >
                              {slab.id} {slab.rot ? "R" : ""} {slab.sw}×{slab.sh}×{slab.sd} in
                            </span>
                          ))}
                        </div>

                        {eff && <EfficiencyBar eff={eff} />}

                        {item.biggest ? (
                          <p className="muted" style={{ marginTop: 6, fontSize: 11 }}>
                            Restockable piece: {item.biggest.l} × {item.biggest.w} × {item.biggest.h} in
                            <span style={{ marginLeft: 6, color: "#888" }}>
                              ({toCFT(item.biggest.l * item.biggest.w * item.biggest.h).toFixed(2)} CFT)
                            </span>
                          </p>
                        ) : null}
                      </article>
                    );
                  })}
                </div>

                {/* LOUD red banner: generic unmet slabs (can't be missed) */}
                {result.unmet.length > 0 && (
                  <div style={{
                    marginTop: 16,
                    padding: "14px 18px",
                    background: "#fef2f2",
                    border: "2px solid #dc2626",
                    borderRadius: 8,
                  }}>
                    <p style={{ margin: 0, fontWeight: 800, fontSize: 14, color: "#991b1b" }}>
                      ⚠ {result.unmet.length} of {originalSelectedCount} selected slab{result.unmet.length > 1 ? "s" : ""} could NOT be placed in this plan
                    </p>
                    <p style={{ margin: "6px 0 0", fontSize: 12, color: "#991b1b", wordBreak: "break-word" }}>
                      <strong>Unplaced:</strong> {result.unmet.map((u) => u.id).join(", ")}
                    </p>
                    <p className="muted" style={{ margin: "4px 0 0", fontSize: 11 }}>
                      These will stay as <strong>open</strong> and need to be re-planned or assigned to different blocks later.
                    </p>
                  </div>
                )}

                {/* Amber banner: specifically long slabs that no block can physically hold */}
                {result.unfittableLong && result.unfittableLong.length > 0 && (
                  <div style={{
                    marginTop: 12,
                    padding: "12px 16px",
                    background: "#fef3c7",
                    border: "1px solid #f59e0b",
                    borderRadius: 8,
                  }}>
                    <p style={{ margin: 0, fontWeight: 700, color: "#92400e", fontSize: 13 }}>
                      ⚠ {result.unfittableLong.length} long slab{result.unfittableLong.length > 1 ? "s need" : " needs"} a longer block than you have
                    </p>
                    <p className="muted" style={{ margin: "4px 0 0", fontSize: 12 }}>
                      {result.unfittableLong.map((s) => `${s.id} (${s.maxDim}″)`).join(", ")} — procure longer blocks or split the requirement.
                    </p>
                  </div>
                )}


                {result.plan.length ? (
                  <form action={approveAction} style={{ marginTop: 18 }}>
                    <input name="kerf_mm" type="hidden" value={String(kerfMm)} />
                    {/* Only send what the server needs — strip spaces/eff/ua/ka/ba/aw/ah/label/temple. Keep zTop/zBot for 3D rendering. */}
                    <input
                      name="plan_json"
                      type="hidden"
                      value={JSON.stringify(result.plan.map(pb => ({
                        blk: pb.blk,
                        placed: pb.placed.map(s => ({
                          id: s.id,
                          sw: s.sw, sh: s.sh, sd: s.sd,
                          pw: s.pw, ph: s.ph,
                          px: s.px, py: s.py,
                          rot: s.rot,
                          zTop: s.zTop, zBot: s.zBot,
                        })),
                        biggest: pb.biggest,
                      })))}
                    />
                    {/* Pass slab IDs so server can redirect back to workbench on error */}
                    <input
                      name="slab_ids"
                      type="hidden"
                      value={[...new Set(result.plan.flatMap(pb => pb.placed.map(s => s.id)))].join(",")}
                    />

                    {/* Acknowledgement gate — user cannot approve until they check this when there are unmet slabs */}
                    {result.unmet.length > 0 && (
                      <label style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 13, margin: "4px 0 14px", cursor: "pointer", padding: "10px 14px", background: "#fef2f2", border: "1px solid #fca5a5", borderRadius: 6 }}>
                        <input
                          type="checkbox"
                          checked={ackUnmet}
                          onChange={(e) => setAckUnmet(e.target.checked)}
                          style={{ marginTop: 2 }}
                        />
                        <span style={{ color: "#991b1b", fontWeight: 600 }}>
                          I understand {result.unmet.length} slab{result.unmet.length > 1 ? "s" : ""} will remain open and will need a new plan later.
                        </span>
                      </label>
                    )}

                    <button
                      className="primary-button"
                      type="submit"
                      disabled={result.unmet.length > 0 && !ackUnmet}
                    >
                      Approve Plan and Create Cutting Session
                    </button>
                  </form>
                ) : null}
              </section>
            </>
          )}
        </>
      ) : null}
    </>
  );
}
