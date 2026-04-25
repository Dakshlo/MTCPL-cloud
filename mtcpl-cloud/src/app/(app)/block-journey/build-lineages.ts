/**
 * Pure lineage-building logic for the Block Journey page.
 *
 * Takes raw rows from four tables (blocks x2 for Fresh/Reused,
 * slab_requirements cut_done, cut_session_blocks done) and returns
 * a fully-computed `Lineage[]`.
 *
 * Kept pure + side-effect-free so:
 *   - the server page can call it after batch-fetching
 *   - the /api/block-journey/export route can call it with the same inputs
 *   - the AI tool `get_stone_efficiency` can call it without hitting a route
 *
 * See /Users/home/.claude/plans/iridescent-churning-zebra.md for the
 * full spec including the volume-accounting proof.
 */

import { facilityOfYard, type Facility } from "@/lib/yards";
import type { StoneCategory } from "@/lib/stone-categories";

// ─── Raw input row shapes (match what the callers SELECT from Supabase) ──

export type BjBlockRow = {
  id: string;
  stone: string | null;
  yard: number;
  quality: string | null;
  category: string | null;
  length_ft: number | string | null;
  width_ft: number | string | null;
  height_ft: number | string | null;
  status: string;
  created_at: string | null;
  created_by?: string | null;
  /** Marble blocks carry tonnage instead of dimensions. Null for sandstone. */
  tonnes?: number | string | null;
  /** Marble blocks link to their truck entry. Null for sandstone. */
  truck_entry_id?: string | null;
};

/** Minimal row shape of a marble_truck_entries record passed into the
 *  lineage builder. The builder needs these fields to roll up per-truck
 *  aggregates when the Block Journey client groups by truck. */
export type BjMarbleTruckRow = {
  id: string;
  stone: string;
  truck_no: string | null;
  vendor_name: string | null;
  total_tonnes: number | string;
  num_blocks: number;
  created_at?: string | null;
};

export type BjSlabRow = {
  id: string;
  length_ft: number | string;
  width_ft: number | string;
  thickness_ft: number | string;
  source_block_id: string | null;
  label: string | null;
  temple: string | null;
  status: string;
};

export type BjCsbRow = {
  block_id: string;
  status: string;
};

// ─── Output shapes ───────────────────────────────────────────────────────

/** A single node in the lineage tree — the root is also one of these. */
export type LineageNode = {
  id: string;
  isRoot: boolean;
  category: string | null;
  status: string;              // current block.status
  stone: string | null;
  yard: number;
  quality: string | null;
  l: number;
  w: number;
  h: number;
  cft: number;
  createdAt: string | null;
  wasCut: boolean;             // has a done cut_session_blocks row
  slabsFromThis: Array<{
    id: string;
    cft: number;
    temple: string | null;
    label: string | null;
  }>;
  slabCftFromThis: number;     // sum of slabsFromThis[].cft
  children: LineageNode[];     // DIRECT children only (recursion carries deeper)
};

/** Fields shared by every lineage regardless of stone category. */
type LineageCommon = {
  rootId: string;
  rootStone: string | null;
  rootYard: number;
  rootFacility: Facility;
  rootQuality: string | null;
  rootCreatedAt: string | null;
  rootCreatedBy: string | null;
  isResolved: boolean;
  lastActivityAt: string | null;
  descendantCount: number;
  cutCount: number;
  tree: LineageNode;
};

/** Sandstone lineage — the existing shape. CFT-based math throughout. */
export type SandstoneLineage = LineageCommon & {
  category: "sandstone";
  originalCft: number;
  slabCft: number;
  liveCft: number;           // available/reserved/cutting descendants
  discardedCft: number;      // explicitly thrown-out descendants
  wasteCft: number;          // original - slabs - live - discarded
  slabPct: number;
  livePct: number;
  wastePct: number;
  recoveredPct: number;      // slabPct + livePct
  sizeBucket: "small" | "medium" | "large";   // < 30 / 30–80 / > 80 CFT
};

/** Marble lineage — tonnes in, CFT out. No child-tree walk (marble doesn't
 *  restock). No waste percentage — owner's explicit call. The key metric
 *  is cftPerTonne = slabCft / tonnes. */
export type MarbleLineage = LineageCommon & {
  category: "marble";
  tonnes: number;
  slabCft: number;
  cftPerTonne: number;
  truckEntryId: string | null;
  truckNo: string | null;
  vendorName: string | null;
  truckTotalTonnes: number | null;
};

export type Lineage = SandstoneLineage | MarbleLineage;

// ─── Helpers ─────────────────────────────────────────────────────────────

function toCFT(cubicInches: number): number {
  return cubicInches / 1728;
}

function num(v: number | string | null | undefined): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function sizeBucketOf(cft: number): "small" | "medium" | "large" {
  if (cft < 30) return "small";
  if (cft <= 80) return "medium";
  return "large";
}

/** `MT-B-001-1-2` counts as a direct child of `MT-B-001-1` but NOT of
 *  `MT-B-001`. Works for any id format (no regex-escape drama). */
function isDirectChild(parentId: string, childId: string): boolean {
  if (!childId.startsWith(parentId + "-")) return false;
  const suffix = childId.slice(parentId.length + 1);
  return /^\d+$/.test(suffix);
}

/** Walk backwards from `id`, stripping `-\d+` suffixes, until we hit an
 *  id that's in the Fresh set. `MT-B-039-1-2` → `MT-B-039-1` → `MT-B-039`.
 *  Returns null if no ancestor is a Fresh block (e.g. malformed IDs). */
function rootIdOf(id: string, freshIds: Set<string>): string | null {
  if (freshIds.has(id)) return id;
  let cur = id;
  // Hard cap to prevent infinite loop on pathological IDs
  for (let i = 0; i < 10; i++) {
    const m = cur.match(/^(.+)-\d+$/);
    if (!m) return null;
    cur = m[1];
    if (freshIds.has(cur)) return cur;
  }
  return null;
}

// ─── Main entry point ────────────────────────────────────────────────────

export function buildLineages(
  freshBlocks: BjBlockRow[],
  reusedBlocks: BjBlockRow[],
  cutDoneSlabs: BjSlabRow[],
  doneCsbs: BjCsbRow[],
  /** Optional stone-name → category map. When omitted every block is
   *  treated as sandstone (backwards compatible). When present, marble
   *  blocks get the tonnage-based pipeline. */
  stoneCategoryMap: Record<string, StoneCategory> = {},
  /** Optional truck entries — only needed when marble lineages should
   *  carry truck context for per-truck rollups in the UI. */
  marbleTruckEntries: BjMarbleTruckRow[] = [],
): Lineage[] {
  const freshById = new Map(freshBlocks.map((b) => [b.id, b]));
  const freshIds = new Set(freshById.keys());
  const doneBlockIds = new Set(doneCsbs.map((c) => c.block_id));

  const truckById = new Map(marbleTruckEntries.map((t) => [t.id, t]));

  // Index slabs by source_block_id (each block can have 0..n slabs cut from it).
  const slabsByBlock = new Map<string, BjSlabRow[]>();
  for (const s of cutDoneSlabs) {
    if (!s.source_block_id) continue;
    const list = slabsByBlock.get(s.source_block_id) ?? [];
    list.push(s);
    slabsByBlock.set(s.source_block_id, list);
  }

  // Map every Reused block → its root Fresh id, skipping orphans.
  const descendantsByRoot = new Map<string, BjBlockRow[]>();
  for (const r of reusedBlocks) {
    const rootId = rootIdOf(r.id, freshIds);
    if (!rootId) continue;
    const list = descendantsByRoot.get(rootId) ?? [];
    list.push(r);
    descendantsByRoot.set(rootId, list);
  }

  // A root appears on the page if it has been cut OR has children OR
  // (for marble) is marble-category. Marble blocks show up even before
  // they're cut because the inventory tonnage is the denominator.
  const rootIds = new Set<string>();
  for (const fid of freshIds) {
    const row = freshById.get(fid)!;
    const isMarble = stoneCategoryMap[row.stone ?? ""] === "marble";
    if (doneBlockIds.has(fid) || descendantsByRoot.has(fid) || isMarble) {
      rootIds.add(fid);
    }
  }

  const lineages: Lineage[] = [];

  for (const rootId of rootIds) {
    const root = freshById.get(rootId)!;
    const isMarble = stoneCategoryMap[root.stone ?? ""] === "marble";

    // ── Marble path — tonnes in, slab CFT out, no descendant tree. ────────
    if (isMarble) {
      const tonnes = num(root.tonnes);
      if (tonnes <= 0) continue; // bad data — skip

      // Skip marble blocks that are still in yard (status='available' /
      // 'reserved') and have produced zero slabs. Block Journey is meant
      // to track CUT blocks; un-cut marble belongs on /blocks, not here.
      // We also keep 'consumed' blocks that produced 0 slabs (rare —
      // would mean a botched manual cut) so the user can investigate.
      const ownSlabs = slabsByBlock.get(root.id) ?? [];
      const hasBeenCut = root.status === "consumed" || ownSlabs.length > 0;
      if (!hasBeenCut) continue;

      const slabCft = ownSlabs.reduce(
        (sum, s) =>
          sum + toCFT(num(s.length_ft) * num(s.width_ft) * num(s.thickness_ft)),
        0,
      );

      const cftPerTonne = tonnes > 0 ? slabCft / tonnes : 0;
      const truckEntryId = root.truck_entry_id ?? null;
      const truck = truckEntryId ? truckById.get(truckEntryId) ?? null : null;

      // Marble is "resolved" once the block is consumed — there are no
      // live descendants to wait on.
      const isResolved = root.status === "consumed";

      const tree: LineageNode = buildTreeNode(root, true, [], slabsByBlock, doneBlockIds);

      lineages.push({
        category: "marble",
        rootId: root.id,
        rootStone: root.stone,
        rootYard: root.yard,
        rootFacility: facilityOfYard(root.yard),
        rootQuality: root.quality,
        rootCreatedAt: root.created_at ?? null,
        rootCreatedBy: root.created_by ?? null,
        tonnes,
        slabCft,
        cftPerTonne: Math.round(cftPerTonne * 100) / 100,
        truckEntryId,
        truckNo: truck?.truck_no ?? null,
        vendorName: truck?.vendor_name ?? null,
        truckTotalTonnes: truck ? Number(truck.total_tonnes) : null,
        isResolved,
        descendantCount: 0,
        cutCount: doneBlockIds.has(root.id) ? 1 : 0,
        lastActivityAt: root.created_at ?? null,
        tree,
      });
      continue;
    }

    // ── Sandstone path — existing CFT-based lineage math. ─────────────────
    const descendants = descendantsByRoot.get(rootId) ?? [];

    // Original CFT from the root's dimensions as it was added to inventory.
    const originalCft = toCFT(num(root.length_ft) * num(root.width_ft) * num(root.height_ft));
    if (originalCft <= 0) continue; // bad data — skip so we don't divide by zero

    // Sum every slab ever cut from any block in this lineage.
    let slabCft = 0;
    const allInLineage = [root, ...descendants];
    for (const b of allInLineage) {
      const slabs = slabsByBlock.get(b.id) ?? [];
      for (const s of slabs) {
        slabCft += toCFT(num(s.length_ft) * num(s.width_ft) * num(s.thickness_ft));
      }
    }

    // Live = volume still sitting in inventory in some still-usable state.
    // Discarded = volume explicitly thrown out as too-small scrap.
    // Consumed descendants (cut further into their own children) are NOT
    // counted here — their volume is represented by their slabs + further
    // children + their own implicit cutting waste.
    let liveCft = 0;
    let discardedCft = 0;
    for (const d of descendants) {
      const dCft = toCFT(num(d.length_ft) * num(d.width_ft) * num(d.height_ft));
      if (d.status === "available" || d.status === "reserved" || d.status === "cutting") {
        liveCft += dCft;
      } else if (d.status === "discarded") {
        discardedCft += dCft;
      }
    }

    // Waste = everything unaccounted for. This includes:
    //   - kerf + scrap lost at each cut
    //   - "consumed" descendants that produced no recorded slabs (rare edge case)
    // Clamp at 0 for floating-point safety.
    const wasteCft = Math.max(0, originalCft - slabCft - liveCft - discardedCft);

    const slabPct = Math.min(100, Math.max(0, Math.round((slabCft / originalCft) * 100)));
    const livePct = Math.min(100, Math.max(0, Math.round((liveCft / originalCft) * 100)));
    const wastePct = Math.min(100, Math.max(0, 100 - slabPct - livePct));
    const recoveredPct = Math.min(100, slabPct + livePct);

    // Cut count = root cut + any descendant cut
    let cutCount = 0;
    if (doneBlockIds.has(root.id)) cutCount++;
    for (const d of descendants) if (doneBlockIds.has(d.id)) cutCount++;

    // Last activity = newest created_at across lineage (remainder creation
    // is the closest signal we have to "something happened here").
    let lastActivityAt = root.created_at ?? null;
    for (const d of descendants) {
      if (d.created_at && (!lastActivityAt || d.created_at > lastActivityAt)) {
        lastActivityAt = d.created_at;
      }
    }

    const tree = buildTreeNode(root, true, descendants, slabsByBlock, doneBlockIds);

    lineages.push({
      category: "sandstone",
      rootId: root.id,
      rootStone: root.stone,
      rootYard: root.yard,
      rootFacility: facilityOfYard(root.yard),
      rootQuality: root.quality,
      rootCreatedAt: root.created_at ?? null,
      rootCreatedBy: root.created_by ?? null,
      originalCft,
      slabCft,
      liveCft,
      discardedCft,
      wasteCft,
      slabPct,
      livePct,
      wastePct,
      recoveredPct,
      isResolved: liveCft === 0,
      descendantCount: descendants.length,
      cutCount,
      lastActivityAt,
      sizeBucket: sizeBucketOf(originalCft),
      tree,
    });
  }

  return lineages;
}

function buildTreeNode(
  block: BjBlockRow,
  isRoot: boolean,
  allDescendants: BjBlockRow[],
  slabsByBlock: Map<string, BjSlabRow[]>,
  doneBlockIds: Set<string>,
): LineageNode {
  const directChildren = allDescendants.filter((d) => isDirectChild(block.id, d.id));
  const ownSlabs = slabsByBlock.get(block.id) ?? [];

  const l = num(block.length_ft);
  const w = num(block.width_ft);
  const h = num(block.height_ft);

  return {
    id: block.id,
    isRoot,
    category: block.category,
    status: block.status,
    stone: block.stone,
    yard: block.yard,
    quality: block.quality,
    l,
    w,
    h,
    cft: toCFT(l * w * h),
    createdAt: block.created_at ?? null,
    wasCut: doneBlockIds.has(block.id),
    slabsFromThis: ownSlabs.map((s) => ({
      id: s.id,
      cft: toCFT(num(s.length_ft) * num(s.width_ft) * num(s.thickness_ft)),
      temple: s.temple,
      label: s.label,
    })),
    slabCftFromThis: ownSlabs.reduce(
      (sum, s) => sum + toCFT(num(s.length_ft) * num(s.width_ft) * num(s.thickness_ft)),
      0,
    ),
    children: directChildren.map((c) =>
      buildTreeNode(c, false, allDescendants, slabsByBlock, doneBlockIds),
    ),
  };
}

// ─── Aggregate helpers (used by the page + the AI tool + export) ─────────

export type LineageAggregate = {
  totalLineages: number;
  resolvedCount: number;
  inProgressCount: number;

  // ── Sandstone totals (CFT-based) ──────────────────────────────────────
  totalOriginalCft: number;
  totalSlabCft: number;
  totalLiveCft: number;
  totalWasteCft: number;

  // Yield framing (conservative)
  weightedSlabPct: number;
  weightedLivePct: number;
  simpleSlabPctAvg: number;

  // Recovered framing (optimistic)
  weightedRecoveredPct: number;
  weightedWastePct: number;
  simpleRecoveredPctAvg: number;

  // ── Marble totals (tonne-based) ───────────────────────────────────────
  marble: {
    lineageCount: number;
    resolvedCount: number;
    inProgressCount: number;
    totalTonnes: number;
    totalSlabCft: number;
    weightedCftPerTonne: number;    // = totalSlabCft / totalTonnes
    simpleCftPerTonneAvg: number;
    truckCount: number;
  };
};

export function aggregateLineages(lineages: Lineage[]): LineageAggregate {
  const sandstone = lineages.filter((l): l is SandstoneLineage => l.category === "sandstone");
  const marble = lineages.filter((l): l is MarbleLineage => l.category === "marble");
  const n = lineages.length;

  if (n === 0) {
    return {
      totalLineages: 0,
      resolvedCount: 0,
      inProgressCount: 0,
      totalOriginalCft: 0,
      totalSlabCft: 0,
      totalLiveCft: 0,
      totalWasteCft: 0,
      weightedSlabPct: 0,
      weightedLivePct: 0,
      simpleSlabPctAvg: 0,
      weightedRecoveredPct: 0,
      weightedWastePct: 0,
      simpleRecoveredPctAvg: 0,
      marble: {
        lineageCount: 0,
        resolvedCount: 0,
        inProgressCount: 0,
        totalTonnes: 0,
        totalSlabCft: 0,
        weightedCftPerTonne: 0,
        simpleCftPerTonneAvg: 0,
        truckCount: 0,
      },
    };
  }

  let sumOriginal = 0;
  let sumSlab = 0;
  let sumLive = 0;
  let sumWaste = 0;
  let resolvedCount = 0;
  let simpleSlabSum = 0;
  let simpleRecoveredSum = 0;

  for (const l of sandstone) {
    sumOriginal += l.originalCft;
    sumSlab += l.slabCft;
    sumLive += l.liveCft;
    sumWaste += l.wasteCft;
    if (l.isResolved) resolvedCount++;
    simpleSlabSum += l.slabPct;
    simpleRecoveredSum += l.recoveredPct;
  }

  // Marble aggregates: tonnes in, CFT out.
  let marbleTonnes = 0;
  let marbleSlabCft = 0;
  let marbleResolved = 0;
  let marbleSimpleCftPerTonneSum = 0;
  const marbleTruckIds = new Set<string>();
  for (const l of marble) {
    marbleTonnes += l.tonnes;
    marbleSlabCft += l.slabCft;
    if (l.isResolved) marbleResolved++;
    marbleSimpleCftPerTonneSum += l.cftPerTonne;
    if (l.truckEntryId) marbleTruckIds.add(l.truckEntryId);
  }
  const marbleWeightedCftPerTonne = marbleTonnes > 0 ? marbleSlabCft / marbleTonnes : 0;
  const marbleSimpleCftPerTonneAvg = marble.length > 0 ? marbleSimpleCftPerTonneSum / marble.length : 0;

  const weightedSlabPct = sumOriginal > 0 ? (sumSlab / sumOriginal) * 100 : 0;
  const weightedLivePct = sumOriginal > 0 ? (sumLive / sumOriginal) * 100 : 0;
  const weightedWastePct = sumOriginal > 0 ? (sumWaste / sumOriginal) * 100 : 0;
  const weightedRecoveredPct = weightedSlabPct + weightedLivePct;

  return {
    totalLineages: n,
    resolvedCount: resolvedCount + marbleResolved,
    inProgressCount: n - (resolvedCount + marbleResolved),
    totalOriginalCft: sumOriginal,
    totalSlabCft: sumSlab,
    totalLiveCft: sumLive,
    totalWasteCft: sumWaste,
    weightedSlabPct: round1(weightedSlabPct),
    weightedLivePct: round1(weightedLivePct),
    simpleSlabPctAvg: sandstone.length > 0 ? round1(simpleSlabSum / sandstone.length) : 0,
    weightedRecoveredPct: round1(weightedRecoveredPct),
    weightedWastePct: round1(weightedWastePct),
    simpleRecoveredPctAvg: sandstone.length > 0 ? round1(simpleRecoveredSum / sandstone.length) : 0,
    marble: {
      lineageCount: marble.length,
      resolvedCount: marbleResolved,
      inProgressCount: marble.length - marbleResolved,
      totalTonnes: round3(marbleTonnes),
      totalSlabCft: round2(marbleSlabCft),
      weightedCftPerTonne: round2(marbleWeightedCftPerTonne),
      simpleCftPerTonneAvg: round2(marbleSimpleCftPerTonneAvg),
      truckCount: marbleTruckIds.size,
    },
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
