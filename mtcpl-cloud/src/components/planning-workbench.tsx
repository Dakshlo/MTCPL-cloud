"use client";

import { useState, useRef, useEffect } from "react";
import { BlockMiniPreview, SlabMiniPreview } from "@/components/stone-previews";
import { getStonePalette } from "@/lib/stone-utils";
import type { StoneTypeDef } from "@/lib/stone-utils";
import type { AIAssignment, AIplanResponse } from "@/app/(app)/planning/actions";

export type BlockRow = {
  id: string;
  stone: string;
  yard: number;
  category: string;
  length_ft: number | string;
  width_ft: number | string;
  height_ft: number | string;
  status: string;
  quality: string | null;
};

export type SlabRow = {
  id: string;
  label: string;
  temple: string;
  stone: string | null;
  length_ft: number | string;
  width_ft: number | string;
  thickness_ft: number | string;
  status: string;
  quality: string | null;
  priority?: boolean;
};

export type PlacedSlab = {
  id: string;
  label: string;
  temple: string;
  sw: number;
  sh: number;
  sd: number;
  px: number;
  py: number;
  pw: number;
  ph: number;
  aw: number;
  ah: number;
  rot: boolean;
  zTop?: number; // top Z of this slab in the block (cutting-depth axis)
  zBot?: number; // bottom Z of this slab in the block
};

export type PlanBlock = {
  blk: {
    id: string;
    stone: string;
    yard: number;
    quality?: string | null;
    l: number;
    w: number;
    h: number;
    orient?: string;
  };
  placed: PlacedSlab[];
  spaces: Array<{ x: number; y: number; w: number; h: number }>;
  ua: number;
  ka: number;
  ba: number;
  eff: number;
  biggest: { l: number; w: number; h: number } | null;
};

export type PlanResult = {
  plan: PlanBlock[];
  unmet: Array<{ id: string; label: string; temple: string }>;
  unfittableLong?: Array<{ id: string; label: string; temple: string; maxDim: number }>;
  totalWaste: number;
};

const SLAB_COLORS = ["#D85A30", "#378ADD", "#1D9E75", "#7F77DD", "#BA7517", "#639922", "#D4537E", "#E24B4A", "#5F5E5A", "#0F6E56"];

function toNum(value: number | string | null | undefined, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function round2(value: number) {
  return Math.round(value * 100) / 100;
}

export function sclr(id: string) {
  const num = parseInt(String(id || "").replace(/\D/g, ""), 10);
  if (!num || Number.isNaN(num)) return SLAB_COLORS[0];
  return SLAB_COLORS[(num - 1) % SLAB_COLORS.length];
}

function chooseSplit(space: { x: number; y: number; w: number; h: number }, aw: number, ah: number) {
  const opt1A = { x: space.x + aw, y: space.y, w: space.w - aw, h: ah };
  const opt1B = { x: space.x, y: space.y + ah, w: space.w, h: space.h - ah };
  const opt2A = { x: space.x, y: space.y + ah, w: aw, h: space.h - ah };
  const opt2B = { x: space.x + aw, y: space.y, w: space.w - aw, h: space.h };
  const big1 = Math.max(Math.max(0, opt1A.w) * Math.max(0, opt1A.h), Math.max(0, opt1B.w) * Math.max(0, opt1B.h));
  const big2 = Math.max(Math.max(0, opt2A.w) * Math.max(0, opt2A.h), Math.max(0, opt2B.w) * Math.max(0, opt2B.h));
  return big1 >= big2 ? [opt1A, opt1B] : [opt2A, opt2B];
}

function pruneSpaces(spaces: Array<{ x: number; y: number; w: number; h: number }>) {
  return spaces
    .filter((space) => space.w > 0.01 && space.h > 0.01)
    .sort((a, b) => b.w * b.h - a.w * a.h);
}

function packBlock(
  width: number,
  height: number,
  items: Array<{ id: string; label: string; temple: string; sw: number; sh: number; sd: number }>,
  kerfFt: number
) {
  let spaces = [{ x: 0, y: 0, w: width, h: height }];
  const placed: PlacedSlab[] = [];
  const unplaced: typeof items = [];

  const sorted = items.slice().sort((a, b) => b.sw * b.sh - a.sw * a.sh);

  for (const item of sorted) {
    let best:
      | { index: number; aw: number; ah: number; pw: number; ph: number; rot: boolean; waste: number; spaceArea: number }
      | undefined;

    spaces.forEach((space, index) => {
      const options = [
        { aw: item.sw + kerfFt, ah: item.sh + kerfFt, pw: item.sw, ph: item.sh, rot: false },
        { aw: item.sh + kerfFt, ah: item.sw + kerfFt, pw: item.sh, ph: item.sw, rot: true }
      ];

      options.forEach((option) => {
        if (option.aw <= space.w + 0.0001 && option.ah <= space.h + 0.0001) {
          const waste = space.w * space.h - option.aw * option.ah;
          if (!best || waste < best.waste || (waste === best.waste && space.w * space.h < best.spaceArea)) {
            best = { index, aw: option.aw, ah: option.ah, pw: option.pw, ph: option.ph, rot: option.rot, waste, spaceArea: space.w * space.h };
          }
        }
      });
    });

    if (!best) {
      unplaced.push(item);
      continue;
    }

    const space = spaces[best.index];
    placed.push({
      id: item.id, label: item.label, temple: item.temple,
      sw: item.sw, sh: item.sh, sd: item.sd,
      px: round2(space.x), py: round2(space.y),
      pw: round2(best.pw), ph: round2(best.ph),
      aw: round2(best.aw), ah: round2(best.ah),
      rot: best.rot
    });

    spaces.splice(best.index, 1);
    spaces = pruneSpaces(spaces.concat(chooseSplit(space, best.aw, best.ah)));
  }

  return { placed, spaces, unplaced };
}

/**
 * Determine the best orientation for a slab (sl × sw, thickness sd) on a block cut face
 * of dimensions faceL × faceW, with the slab's depth dimension ≤ availDepth.
 *
 * The machine makes vertical cuts going FULL HEIGHT through the block in one pass.
 * Each "plate" produced is faceL × faceW, with thickness = slab's depth dimension.
 * A slab can be oriented in 3 ways (which of its 3 dimensions faces into the cut depth).
 */
function bestSlabFaceForAxis(
  sl: number, sw: number, sd: number,
  faceL: number, faceW: number, availDepth: number
): { fw: number; fh: number; depth: number } | null {
  const orients = [
    { fw: sl, fh: sw, depth: sd },  // natural: L×W face, thickness T goes into cut
    { fw: sl, fh: sd, depth: sw },  // on side:  L×T face, W goes into cut
    { fw: sw, fh: sd, depth: sl },  // on end:   W×T face, L goes into cut
  ];

  // Must fit within cut face (in either rotation) AND depth ≤ available cut depth
  const valid = orients.filter(o =>
    o.depth <= availDepth + 0.001 &&
    (
      (o.fw <= faceL + 0.001 && o.fh <= faceW + 0.001) ||
      (o.fh <= faceL + 0.001 && o.fw <= faceW + 0.001)
    )
  );

  if (!valid.length) return null;
  // Return the orientation exposing the largest face area
  return valid.reduce((best, o) => o.fw * o.fh >= best.fw * best.fh ? o : best);
}

/**
 * Multi-layer cutting algorithm.
 *
 * For each block, we try all 3 cutting axes. For each axis:
 *   faceL × faceW  = the flat face of each "plate" produced
 *   depth          = the block dimension consumed by successive plates
 *
 * We pack slabs onto the face in repeated layers until the depth runs out or no
 * more slabs fit. Each layer's slabs receive zTop / zBot annotations so the 3D
 * view can render them at the correct depth inside the block.
 */
type RemainingSlab = {
  id: string;
  label: string;
  temple: string;
  stone: string | null;
  quality: string | null;
  sl: number;
  sw: number;
  sd: number;
};

type BlockAxis = { faceL: number; faceW: number; depth: number; label: string };

type PackedResult = {
  allPlaced: PlacedSlab[];
  orient: BlockAxis | null;
  lastSpaces: Array<{ x: number; y: number; w: number; h: number }>;
  depthUsed: number;
};

/**
 * Try to pack slabs into a single block. Tries all 3 block orientations,
 * picks the one that places the most slabs. Returns empty if nothing fits.
 */
function tryPackBlock(
  block: BlockRow,
  remaining: RemainingSlab[],
  kerfFt: number,
): PackedResult {
  const bl = toNum(block.length_ft);
  const bw = toNum(block.width_ft);
  const bh = toNum(block.height_ft);
  if (bl <= 0.01 || bw <= 0.01 || bh <= 0.01) {
    return { allPlaced: [], orient: null, lastSpaces: [], depthUsed: 0 };
  }

  // Block entry workers always record the vein-constrained dimension as height_ft.
  // The cutter always passes through the height — face = L×W, depth = H.
  const blockAxes: BlockAxis[] = [
    { faceL: bl, faceW: bw, depth: bh, label: "L×W face" },
  ];

  let best: PackedResult = { allPlaced: [], orient: null, lastSpaces: [], depthUsed: 0 };

  for (const axis of blockAxes) {
    let depthUsed = 0;
    const allPlaced: PlacedSlab[] = [];
    let lastSpaces: Array<{ x: number; y: number; w: number; h: number }> = [];
    let tempRemaining = remaining.filter((s) => {
      if (s.stone && s.stone !== block.stone) return false;
      if (block.quality === "B" && s.quality === "A") return false;
      return true;
    });

    while (tempRemaining.length > 0 && axis.depth - depthUsed > 0.01) {
      const availDepth = axis.depth - depthUsed;

      type EligSlab = { id: string; label: string; temple: string; fw: number; fh: number; depth: number; quality: string | null };
      const eligibleAll: EligSlab[] = [];
      for (const s of tempRemaining) {
        const face = bestSlabFaceForAxis(s.sl, s.sw, s.sd, axis.faceL, axis.faceW, availDepth);
        if (face) eligibleAll.push({ id: s.id, label: s.label, temple: s.temple, fw: face.fw, fh: face.fh, depth: face.depth, quality: s.quality });
      }
      if (!eligibleAll.length) break;

      const byDepth = new Map<number, EligSlab[]>();
      for (const e of eligibleAll) {
        const key = Math.round(e.depth * 10000);
        if (!byDepth.has(key)) byDepth.set(key, []);
        byDepth.get(key)!.push(e);
      }

      let bestLayerPack: ReturnType<typeof packBlock> | null = null;
      let bestLayerDepth = 0;

      for (const [key, group] of byDepth) {
        const depth = key / 10000;
        const items = group.map(e => ({ id: e.id, label: e.label, temple: e.temple, sw: e.fw, sh: e.fh, sd: depth }));
        const tryPack = packBlock(axis.faceL, axis.faceW, items, kerfFt);
        if (tryPack.placed.length > (bestLayerPack?.placed.length ?? 0)) {
          bestLayerPack = tryPack;
          bestLayerDepth = depth;
        }
      }

      if (!bestLayerPack || !bestLayerPack.placed.length) break;

      const zTop = axis.depth - depthUsed;
      const zBot = Math.max(0, zTop - bestLayerDepth);

      bestLayerPack.placed.forEach((p) => allPlaced.push({ ...p, zTop, zBot }));
      lastSpaces = bestLayerPack.spaces;

      depthUsed += bestLayerDepth + kerfFt;
      const placedIds = new Set(bestLayerPack.placed.map((p) => p.id));
      tempRemaining = tempRemaining.filter((s) => !placedIds.has(s.id));
    }

    if (allPlaced.length > best.allPlaced.length) {
      best = { allPlaced, orient: axis, lastSpaces, depthUsed };
    }
  }

  return best;
}

function runOptimization(blocks: BlockRow[], slabs: SlabRow[], kerfMm: number): PlanResult {
  const kerfFt = kerfMm / 25.4; // mm → inches (all dimensions stored in inches)

  // Sort slabs LONGEST-DIMENSION first (tiebreak by face area).
  // This makes the longest unplaced slab the "anchor" on every iteration, so
  // big/beam slabs claim their long blocks before small slabs eat into them.
  let remaining: RemainingSlab[] = slabs
    .filter((slab) => slab.status === "open" || slab.status === "planned")
    .map((slab) => ({
      id: slab.id, label: slab.label, temple: slab.temple,
      stone: slab.stone || null, quality: slab.quality || null,
      sl: toNum(slab.length_ft), sw: toNum(slab.width_ft), sd: toNum(slab.thickness_ft),
    }))
    .sort((a, b) => {
      const aMax = Math.max(a.sl, a.sw);
      const bMax = Math.max(b.sl, b.sw);
      if (bMax !== aMax) return bMax - aMax;                 // longest first
      return (b.sl * b.sw) - (a.sl * a.sw);                   // tiebreak: bigger face
    });

  const usableBlocks = blocks.filter((block) => block.status === "available" || block.status === "reserved");

  const plan: PlanBlock[] = [];
  const usedBlockIds = new Set<string>();
  const unfittable: RemainingSlab[] = [];

  while (remaining.length > 0) {
    const anchor = remaining[0];
    const anchorMax = Math.max(anchor.sl, anchor.sw);

    // Candidate blocks: not yet used, stone/quality compatible, long enough for anchor.
    // Sorted ascending by volume so the SMALLEST sufficient block is tried first.
    const candidates = usableBlocks
      .filter((b) => !usedBlockIds.has(b.id))
      .filter((b) => {
        const bl = toNum(b.length_ft);
        const bw = toNum(b.width_ft);
        const bh = toNum(b.height_ft);
        const bMax = Math.max(bl, bw, bh);
        if (bMax + 0.001 < anchorMax) return false;
        if (anchor.stone && anchor.stone !== b.stone) return false;
        if (b.quality === "B" && anchor.quality === "A") return false;
        return true;
      })
      .sort((a, b) => {
        const va = toNum(a.length_ft) * toNum(a.width_ft) * toNum(a.height_ft);
        const vb = toNum(b.length_ft) * toNum(b.width_ft) * toNum(b.height_ft);
        return va - vb;
      });

    if (candidates.length === 0) {
      // No block can physically hold this slab — skip it and continue with the rest.
      unfittable.push(remaining.shift()!);
      continue;
    }

    // Try candidates smallest-first. Accept the first block that actually packs the anchor.
    let chosenBlock: BlockRow | null = null;
    let chosenPacked: PackedResult | null = null;
    for (const block of candidates) {
      const packed = tryPackBlock(block, remaining, kerfFt);
      if (!packed.allPlaced.length || !packed.orient) continue;
      if (!packed.allPlaced.some((p) => p.id === anchor.id)) continue;
      chosenBlock = block;
      chosenPacked = packed;
      break;
    }

    if (!chosenBlock || !chosenPacked || !chosenPacked.orient) {
      // Geometry said the anchor fits, but no candidate actually packed it
      // (quirky thickness/orientation edge case). Mark unfittable, move on.
      unfittable.push(remaining.shift()!);
      continue;
    }

    usedBlockIds.add(chosenBlock.id);
    const usedIds = new Set(chosenPacked.allPlaced.map((p) => p.id));

    const bl = toNum(chosenBlock.length_ft);
    const bw = toNum(chosenBlock.width_ft);
    const bh = toNum(chosenBlock.height_ft);
    const blockVol = bl * bw * bh;
    const placedVol = chosenPacked.allPlaced.reduce((sum, p) => sum + p.pw * p.ph * p.sd, 0);
    const kerfVol = chosenPacked.allPlaced.reduce((sum, p) => sum + (p.aw * p.ah - p.pw * p.ph) * p.sd, 0);

    // Biggest remainder
    const remainingDepth = Math.max(0, chosenPacked.orient.depth - chosenPacked.depthUsed);
    let biggest: { l: number; w: number; h: number } | null = null;
    if (remainingDepth > 0.05) {
      biggest = {
        l: round2(chosenPacked.orient.faceL),
        w: round2(chosenPacked.orient.faceW),
        h: round2(remainingDepth),
      };
    } else {
      chosenPacked.lastSpaces.forEach((space) => {
        if (!biggest || space.w * space.h > biggest.l * biggest.w) {
          biggest = { l: round2(space.w), w: round2(space.h), h: round2(chosenPacked!.orient!.depth) };
        }
      });
    }

    plan.push({
      blk: {
        id: chosenBlock.id,
        stone: chosenBlock.stone,
        yard: toNum(chosenBlock.yard, 1),
        quality: chosenBlock.quality || null,
        l: round2(chosenPacked.orient.faceL),
        w: round2(chosenPacked.orient.faceW),
        h: round2(chosenPacked.orient.depth),
        orient: chosenPacked.orient.label,
      },
      placed: chosenPacked.allPlaced,
      spaces: chosenPacked.lastSpaces,
      ua: round2(placedVol),
      ka: round2(kerfVol),
      ba: round2(blockVol),
      eff: Math.min(99, Math.round((placedVol / blockVol) * 100)),
      biggest,
    });

    remaining = remaining.filter((s) => !usedIds.has(s.id));
  }

  return {
    plan,
    unmet: [...remaining, ...unfittable].map((s) => ({ id: s.id, label: s.label, temple: s.temple })),
    unfittableLong: unfittable.map((s) => ({
      id: s.id,
      label: s.label,
      temple: s.temple,
      maxDim: round2(Math.max(s.sl, s.sw)),
    })),
    totalWaste: round2(plan.reduce((sum, b) => sum + Math.max(0, b.ba - b.ua - b.ka), 0)),
  };
}

// ─── AI-assisted optimisation ──────────────────────────────────────────────────
// Uses Claude's block-slab groupings, then runs the same geometry engine.

function runOptimizationWithAIGroups(
  blocks: BlockRow[],
  slabs: SlabRow[],
  kerfMm: number,
  assignments: AIAssignment[],
): PlanResult {
  const kerfFt = kerfMm / 25.4;
  const plan: PlanBlock[] = [];
  const usedBlockIds = new Set<string>();
  const placedSlabIds = new Set<string>();

  const blockMap = new Map(blocks.map((b) => [b.id, b]));
  const slabMap = new Map(slabs.map((s) => [s.id, s]));

  for (const assignment of assignments) {
    const block = blockMap.get(assignment.block_id);
    if (!block || usedBlockIds.has(block.id)) continue;

    const assignedSlabs = assignment.slab_ids
      .map((id) => slabMap.get(id))
      .filter((s): s is SlabRow => !!s && !placedSlabIds.has(s.id));
    if (!assignedSlabs.length) continue;

    const remainingForBlock: RemainingSlab[] = assignedSlabs
      .filter((s) => s.status === "open" || s.status === "planned")
      .map((s) => ({
        id: s.id, label: s.label, temple: s.temple,
        stone: s.stone || null, quality: s.quality || null,
        sl: toNum(s.length_ft), sw: toNum(s.width_ft), sd: toNum(s.thickness_ft),
      }));
    if (!remainingForBlock.length) continue;

    const packed = tryPackBlock(block, remainingForBlock, kerfFt);
    if (!packed.allPlaced.length || !packed.orient) continue;

    usedBlockIds.add(block.id);
    for (const p of packed.allPlaced) placedSlabIds.add(p.id);

    const bl = toNum(block.length_ft);
    const bw = toNum(block.width_ft);
    const bh = toNum(block.height_ft);
    const blockVol = bl * bw * bh;
    const placedVol = packed.allPlaced.reduce((sum, p) => sum + p.pw * p.ph * p.sd, 0);
    const kerfVol = packed.allPlaced.reduce((sum, p) => sum + (p.aw * p.ah - p.pw * p.ph) * p.sd, 0);

    const remainingDepth = Math.max(0, packed.orient.depth - packed.depthUsed);
    let biggest: { l: number; w: number; h: number } | null = null;
    if (remainingDepth > 0.05) {
      biggest = { l: round2(packed.orient.faceL), w: round2(packed.orient.faceW), h: round2(remainingDepth) };
    } else {
      packed.lastSpaces.forEach((space) => {
        if (!biggest || space.w * space.h > biggest!.l * biggest!.w) {
          biggest = { l: round2(space.w), w: round2(space.h), h: round2(packed.orient!.depth) };
        }
      });
    }

    plan.push({
      blk: {
        id: block.id, stone: block.stone,
        yard: toNum(block.yard, 1), quality: block.quality || null,
        l: round2(packed.orient.faceL), w: round2(packed.orient.faceW), h: round2(packed.orient.depth),
        orient: packed.orient.label,
      },
      placed: packed.allPlaced,
      spaces: packed.lastSpaces,
      ua: round2(placedVol),
      ka: round2(kerfVol),
      ba: round2(blockVol),
      eff: Math.min(99, Math.round((placedVol / blockVol) * 100)),
      biggest,
    });
  }

  // Fall back to regular algorithm for any slabs the AI didn't assign
  const remainingSlabs = slabs.filter((s) => !placedSlabIds.has(s.id));
  const remainingBlocks = blocks.filter((b) => !usedBlockIds.has(b.id));

  if (remainingSlabs.length > 0 && remainingBlocks.length > 0) {
    const fallback = runOptimization(remainingBlocks, remainingSlabs, kerfMm);
    plan.push(...fallback.plan);
    return {
      plan,
      unmet: fallback.unmet,
      unfittableLong: fallback.unfittableLong,
      totalWaste: round2(plan.reduce((sum, b) => sum + Math.max(0, b.ba - b.ua - b.ka), 0)),
    };
  }

  const unmetSlabs = slabs.filter((s) => !placedSlabIds.has(s.id) && (s.status === "open" || s.status === "planned"));
  return {
    plan,
    unmet: unmetSlabs.map((s) => ({ id: s.id, label: s.label, temple: s.temple })),
    totalWaste: round2(plan.reduce((sum, b) => sum + Math.max(0, b.ba - b.ua - b.ka), 0)),
  };
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
  approveAction,
  aiPlanAction,
  stoneTypes,
}: {
  blocks: BlockRow[];
  slabs: SlabRow[];
  approveAction: (formData: FormData) => void | Promise<void>;
  aiPlanAction?: (payload: {
    blocks: Array<{ id: string; stone: string; yard: number; length_ft: number; width_ft: number; height_ft: number; quality: string | null }>;
    slabs: Array<{ id: string; label: string; temple: string; stone: string | null; length_ft: number; width_ft: number; thickness_ft: number; priority: boolean; quality: string | null }>;
    kerfMm: number;
  }) => Promise<AIplanResponse>;
  stoneTypes?: StoneTypeDef[];
}) {
  const [kerfMm, setKerfMm] = useState(20);
  const [result, setResult] = useState<PlanResult | null>(null);
  const [yardFilter, setYardFilter] = useState<number | null>(null);
  const [ackUnmet, setAckUnmet] = useState(false);
  const [originalSelectedCount, setOriginalSelectedCount] = useState(0);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiStrategy, setAiStrategy] = useState<string | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);

  const allUsableBlocks = blocks.filter((block) => block.status === "available" || block.status === "reserved");
  const yards = [...new Set(allUsableBlocks.map(b => Number(b.yard)))].sort((a, b) => a - b);
  const usableBlocks = yardFilter !== null ? allUsableBlocks.filter(b => Number(b.yard) === yardFilter) : allUsableBlocks;
  const openSlabs = slabs.filter((slab) => slab.status === "open" || slab.status === "planned");

  const [selectedBlockIds, setSelectedBlockIds] = useState<Set<string>>(() => new Set(allUsableBlocks.map((b) => b.id)));
  const [selectedSlabIds, setSelectedSlabIds] = useState<Set<string>>(() => new Set(openSlabs.map((s) => s.id)));

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
    setOriginalSelectedCount(filteredSlabs.length);
    if (filteredSlabs.length === 0) {
      setResult({ plan: [], unmet: [], totalWaste: 0 });
      return;
    }
    setResult(runOptimization(filteredBlocks, filteredSlabs, kerfMm));
  }

  async function handleAIGenerate() {
    if (!aiPlanAction) return;
    const filteredBlocks = usableBlocks.filter((b) => selectedBlockIds.has(b.id));
    const filteredSlabs = openSlabs.filter((s) => selectedSlabIds.has(s.id));

    if (filteredSlabs.length === 0) {
      setResult({ plan: [], unmet: [], totalWaste: 0 });
      return;
    }

    setAiLoading(true);
    setAiError(null);
    setAiStrategy(null);
    setAckUnmet(false);
    setOriginalSelectedCount(filteredSlabs.length);

    try {
      const response = await aiPlanAction({
        blocks: filteredBlocks.map((b) => ({
          id: b.id, stone: b.stone, yard: toNum(b.yard, 1),
          length_ft: toNum(b.length_ft), width_ft: toNum(b.width_ft), height_ft: toNum(b.height_ft),
          quality: b.quality,
        })),
        slabs: filteredSlabs.map((s) => ({
          id: s.id, label: s.label, temple: s.temple, stone: s.stone,
          length_ft: toNum(s.length_ft), width_ft: toNum(s.width_ft), thickness_ft: toNum(s.thickness_ft),
          priority: s.priority ?? false, quality: s.quality,
        })),
        kerfMm,
      });

      if (response.error) {
        setAiError(response.error);
        return;
      }

      setAiStrategy(response.strategy ?? null);
      setResult(runOptimizationWithAIGroups(filteredBlocks, filteredSlabs, kerfMm, response.assignments ?? []));
    } catch (err) {
      setAiError(err instanceof Error ? err.message : "AI generation failed. Try again.");
    } finally {
      setAiLoading(false);
    }
  }

  const totalPlaced = result?.plan.reduce((sum, block) => sum + block.placed.length, 0) ?? 0;
  const avgEff =
    result && result.plan.length
      ? Math.round(result.plan.reduce((sum, block) => sum + block.eff, 0) / result.plan.length)
      : 0;

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
          <div className="section-heading">
            <h2 style={{ margin: 0 }}>Stock Blocks ({usableBlocks.length})</h2>
            <p className="muted">Available and reserved blocks for cutting</p>
          </div>
          {/* Yard filter */}
          {yards.length > 1 && (
            <div style={{ display: "flex", gap: 6, marginBottom: 10, flexWrap: "wrap" }}>
              <button
                type="button"
                onClick={() => setYardFilter(null)}
                style={{ fontSize: 11, padding: "3px 10px", borderRadius: 20, border: "1px solid var(--border)", background: yardFilter === null ? "var(--gold)" : "var(--bg)", color: yardFilter === null ? "#fff" : "var(--muted)", fontWeight: 600, cursor: "pointer" }}
              >
                All Yards
              </button>
              {yards.map(y => (
                <button
                  key={y}
                  type="button"
                  onClick={() => setYardFilter(y)}
                  style={{ fontSize: 11, padding: "3px 10px", borderRadius: 20, border: "1px solid var(--border)", background: yardFilter === y ? "var(--gold)" : "var(--bg)", color: yardFilter === y ? "#fff" : "var(--muted)", fontWeight: 600, cursor: "pointer" }}
                >
                  Yard {y}
                </button>
              ))}
            </div>
          )}
          <div className="plan-select-row" style={{ marginBottom: 8 }}>
            <button className="ghost-button" style={{ fontSize: 12, padding: "2px 10px" }} type="button" onClick={() => setSelectedBlockIds(new Set(usableBlocks.map((b) => b.id)))}>Select All</button>
            <button className="ghost-button" style={{ fontSize: 12, padding: "2px 10px" }} type="button" onClick={() => setSelectedBlockIds(new Set())}>Deselect All</button>
          </div>
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
                        <span className="role-pill">Yard {block.yard}</span>
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
            {aiPlanAction && (
              <button
                className="ghost-button"
                onClick={handleAIGenerate}
                type="button"
                disabled={aiLoading}
                style={{ display: "flex", alignItems: "center", gap: 6, opacity: aiLoading ? 0.7 : 1 }}
              >
                <span style={{ fontSize: 15 }}>✨</span>
                {aiLoading ? "AI thinking…" : "Generate with AI"}
              </button>
            )}
          </div>
          {aiError && (
            <div style={{ fontSize: 12, color: "#DC2626", marginTop: 4, padding: "6px 10px", background: "rgba(220,38,38,0.05)", borderRadius: 6 }}>
              ⚠ {aiError}
            </div>
          )}
        </div>
      </section>

      {aiStrategy && (
        <section className="page-card" style={{ background: "rgba(124,58,237,0.04)", border: "1px solid rgba(124,58,237,0.2)" }}>
          <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
            <span style={{ fontSize: 20, flexShrink: 0, lineHeight: 1.3 }}>✨</span>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#7c3aed", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 5 }}>
                AI Strategy
              </div>
              <p style={{ margin: 0, fontSize: 13, color: "var(--text)", lineHeight: 1.6 }}>{aiStrategy}</p>
            </div>
          </div>
        </section>
      )}

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
                <div className="metric-card">
                  <span>Avg vol. efficiency</span>
                  <strong>{avgEff}%</strong>
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
                    return (
                      <article className="plan-card" key={item.blk.id}>
                        <div className="record-head">
                          <div>
                            <strong>{item.blk.id}</strong>
                            <p className="muted">
                              {item.blk.stone} | Yard {item.blk.yard} | {item.blk.l} × {item.blk.w} × {item.blk.h} in
                              {item.blk.orient ? <> · <span className="role-pill">{item.blk.orient}</span></> : null}
                              {layerCount > 1 ? <> · <span className="role-pill">{layerCount} layers</span></> : null}
                            </p>
                          </div>
                          <span className="role-pill">Vol. eff. {item.eff}%</span>
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

                        <p className="muted" style={{ marginTop: 10 }}>
                          Used {(item.ua / 1728).toFixed(3)} CFT | Kerf {(item.ka / 1728).toFixed(3)} CFT | Block vol. {(item.ba / 1728).toFixed(3)} CFT | Waste {(Math.max(0, item.ba - item.ua - item.ka) / 1728).toFixed(3)} CFT
                        </p>

                        {item.biggest ? (
                          <p className="muted">
                            Largest remainder {item.biggest.l} × {item.biggest.w} × {item.biggest.h} in
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
