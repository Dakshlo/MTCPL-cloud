/**
 * Pure server-safe cut-planning algorithm.
 *
 * Extracted from src/components/planning-workbench.tsx so the same functions
 * can be called from:
 *
 *   1. The existing client-side Planning Workbench UI (via the workbench's
 *      re-exports — no import changes anywhere else).
 *   2. The server-side Ask AI `run_plan_simulation` tool, which needs to
 *      compute "how many blocks do I need for temple X" from a Node runtime.
 *
 * Nothing in this file touches the browser — no `window` / `document` /
 * `navigator` / React hooks. If you add a new pure helper, put it here;
 * if it needs the DOM, keep it in the workbench file.
 */

import type { AIAssignment } from "@/app/(app)/planning/actions";

// ─── Public types ────────────────────────────────────────────────────────────

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

// ─── Internal types ──────────────────────────────────────────────────────────
// RemainingSlab + PackedResult are exported because the new
// fitBlockToFillAction (server action) reuses the geometry engine and
// needs to construct / inspect these shapes.

export type RemainingSlab = {
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

export type PackedResult = {
  allPlaced: PlacedSlab[];
  orient: BlockAxis | null;
  lastSpaces: Array<{ x: number; y: number; w: number; h: number }>;
  depthUsed: number;
};

// ─── Numeric helpers ─────────────────────────────────────────────────────────

function toNum(value: number | string | null | undefined, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function round2(value: number) {
  return Math.round(value * 100) / 100;
}

// ─── 2D guillotine packer ────────────────────────────────────────────────────

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
  kerfFt: number,
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
        { aw: item.sh + kerfFt, ah: item.sw + kerfFt, pw: item.sh, ph: item.sw, rot: true },
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
      rot: best.rot,
    });

    spaces.splice(best.index, 1);
    spaces = pruneSpaces(spaces.concat(chooseSplit(space, best.aw, best.ah)));
  }

  return { placed, spaces, unplaced };
}

// ─── Slab-face orientation picker ────────────────────────────────────────────

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
  faceL: number, faceW: number, availDepth: number,
): { fw: number; fh: number; depth: number } | null {
  const orients = [
    { fw: sl, fh: sw, depth: sd }, // natural: L×W face, thickness T goes into cut
    { fw: sl, fh: sd, depth: sw }, // on side:  L×T face, W goes into cut
    { fw: sw, fh: sd, depth: sl }, // on end:   W×T face, L goes into cut
  ];

  // Must fit within cut face (in either rotation) AND depth ≤ available cut depth
  const valid = orients.filter(
    (o) =>
      o.depth <= availDepth + 0.001 &&
      ((o.fw <= faceL + 0.001 && o.fh <= faceW + 0.001) || (o.fh <= faceL + 0.001 && o.fw <= faceW + 0.001)),
  );

  if (!valid.length) return null;
  // Return the orientation exposing the largest face area
  return valid.reduce((best, o) => (o.fw * o.fh >= best.fw * best.fh ? o : best));
}

// ─── Multi-layer block packer ────────────────────────────────────────────────

/**
 * Try to pack slabs into a single block.
 *
 * Block entry workers always record the vein-constrained dimension as
 * `height_ft`, so the cutter always passes through the height — face = L×W,
 * depth = H. We run the 2D packer repeatedly per depth layer, annotating
 * each placed slab with `zTop` / `zBot` so the 3D preview can render it at
 * the correct depth.
 */
export function tryPackBlock(
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

  const blockAxes: BlockAxis[] = [{ faceL: bl, faceW: bw, depth: bh, label: "L×W face" }];

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
        const items = group.map((e) => ({ id: e.id, label: e.label, temple: e.temple, sw: e.fw, sh: e.fh, sd: depth }));
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

// ─── Top-level optimisation entry points ─────────────────────────────────────

export function runOptimization(blocks: BlockRow[], slabs: SlabRow[], kerfMm: number): PlanResult {
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
      if (bMax !== aMax) return bMax - aMax; // longest first
      return b.sl * b.sw - a.sl * a.sw; // tiebreak: bigger face
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

// ─── AI-assisted optimisation ────────────────────────────────────────────────
// Uses Claude's block-slab groupings, then runs the same geometry engine.

export function runOptimizationWithAIGroups(
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
