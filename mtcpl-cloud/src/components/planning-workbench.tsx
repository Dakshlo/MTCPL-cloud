"use client";

import { useState } from "react";
import { BlockMiniPreview, SlabMiniPreview } from "@/components/stone-previews";

export type BlockRow = {
  id: string;
  stone: string;
  yard: number;
  category: string;
  length_ft: number | string;
  width_ft: number | string;
  height_ft: number | string;
  status: string;
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
};

export type PlanBlock = {
  blk: {
    id: string;
    stone: string;
    yard: number;
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
  totalWaste: number;
};

const STONE_PALETTES: Record<string, { top: string; front: string; side: string }> = {
  PinkStone: { top: "#EDCFC2", front: "#C87A60", side: "#DDA88A" },
  WhiteStone: { top: "#E8E6DC", front: "#B8B6AC", side: "#D0CEC4" }
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

  const sorted = items
    .slice()
    .sort((a, b) => b.sw * b.sh - a.sw * a.sh);

  for (const item of sorted) {
    let best:
      | {
          index: number;
          aw: number;
          ah: number;
          pw: number;
          ph: number;
          rot: boolean;
          waste: number;
          spaceArea: number;
        }
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
            best = {
              index,
              aw: option.aw,
              ah: option.ah,
              pw: option.pw,
              ph: option.ph,
              rot: option.rot,
              waste,
              spaceArea: space.w * space.h
            };
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
      id: item.id,
      label: item.label,
      temple: item.temple,
      sw: item.sw,
      sh: item.sh,
      sd: item.sd,
      px: round2(space.x),
      py: round2(space.y),
      pw: round2(best.pw),
      ph: round2(best.ph),
      aw: round2(best.aw),
      ah: round2(best.ah),
      rot: best.rot
    });

    spaces.splice(best.index, 1);
    spaces = pruneSpaces(spaces.concat(chooseSplit(space, best.aw, best.ah)));
  }

  return { placed, spaces, unplaced };
}

// Given slab dimensions (sl × sw, cut thickness = sd) and a block cutting depth,
// find the best slab orientation where the depth dimension ≤ blockDepth.
// A slab can be placed flat, on its side (length dir), or on its end (width dir).
function bestSlabFace(
  sl: number,
  sw: number,
  sd: number,
  blockDepth: number
): { fw: number; fh: number; depth: number } | null {
  const orients = [
    { fw: sl, fh: sw, depth: sd },  // flat: L×W face, thickness = cut depth
    { fw: sl, fh: sd, depth: sw },  // on side: L×T face, W = cut depth
    { fw: sw, fh: sd, depth: sl },  // on end: W×T face, L = cut depth
  ];
  const valid = orients.filter((o) => o.depth <= blockDepth + 0.001);
  if (!valid.length) return null;
  return valid.reduce((best, o) => (o.fw * o.fh >= best.fw * best.fh ? o : best));
}

function runOptimization(blocks: BlockRow[], slabs: SlabRow[], kerfMm: number): PlanResult {
  const kerfFt = kerfMm / 304.8;
  let remaining = slabs
    .filter((slab) => slab.status === "open" || slab.status === "planned")
    .map((slab) => ({
      id: slab.id,
      label: slab.label,
      temple: slab.temple,
      stone: slab.stone || null,
      sl: toNum(slab.length_ft),
      sw: toNum(slab.width_ft),
      sd: toNum(slab.thickness_ft)
    }))
    .sort((a, b) => b.sl * b.sw - a.sl * a.sw);

  const usableBlocks = blocks.filter((block) => block.status === "available" || block.status === "reserved");
  const plan: PlanBlock[] = [];
  const usedBlockIds = new Set<string>();

  while (remaining.length > 0) {
    let bestBlock: BlockRow | null = null;
    let bestOrient: { faceL: number; faceW: number; depth: number; label: string } | null = null;
    let bestPacked: ReturnType<typeof packBlock> | null = null;
    let bestScore = -Infinity;

    for (const block of usableBlocks) {
      if (usedBlockIds.has(block.id)) continue;

      const bl = toNum(block.length_ft);
      const bw = toNum(block.width_ft);
      const bh = toNum(block.height_ft);
      if (bl <= 0.01 || bw <= 0.01 || bh <= 0.01) continue;

      // Try all 3 block cutting face orientations
      const blockOrients = [
        { faceL: bl, faceW: bw, depth: bh, label: "L×W face" },
        { faceL: bl, faceW: bh, depth: bw, label: "L×H face" },
        { faceL: bw, faceW: bh, depth: bl, label: "W×H face" },
      ];

      for (const orient of blockOrients) {
        // For each slab, find the best orientation given this block depth
        const eligible = remaining
          .filter((s) => !s.stone || s.stone === block.stone)
          .map((s) => {
            const face = bestSlabFace(s.sl, s.sw, s.sd, orient.depth);
            if (!face) return null;
            return { id: s.id, label: s.label, temple: s.temple, sw: face.fw, sh: face.fh, sd: face.depth };
          })
          .filter((x): x is NonNullable<typeof x> => x !== null);

        if (!eligible.length) continue;

        const packed = packBlock(orient.faceL, orient.faceW, eligible, kerfFt);
        if (!packed.placed.length) continue;

        const placedArea = packed.placed.reduce((sum, p) => sum + p.pw * p.ph, 0);
        const faceArea = orient.faceL * orient.faceW;
        // Score: efficiency * 1000 - small penalty for large block (prefer small well-used blocks)
        const score = (placedArea / faceArea) * 1000 - faceArea * 0.0001;

        if (score > bestScore) {
          bestScore = score;
          bestBlock = block;
          bestOrient = orient;
          bestPacked = packed;
        }
      }
    }

    if (!bestBlock || !bestOrient || !bestPacked) break;

    usedBlockIds.add(bestBlock.id);
    const usedIds = new Set(bestPacked.placed.map((p) => p.id));
    let usedArea = 0;
    let kerfWaste = 0;

    bestPacked.placed.forEach((p) => {
      usedArea += p.pw * p.ph;
      kerfWaste += p.aw * p.ah - p.pw * p.ph;
    });

    let biggest: { l: number; w: number; h: number } | null = null;
    bestPacked.spaces.forEach((space) => {
      if (!biggest || space.w * space.h > biggest.l * biggest.w) {
        biggest = { l: round2(space.w), w: round2(space.h), h: round2(bestOrient!.depth) };
      }
    });

    const faceArea = bestOrient.faceL * bestOrient.faceW;
    plan.push({
      blk: {
        id: bestBlock.id,
        stone: bestBlock.stone,
        yard: toNum(bestBlock.yard, 1),
        l: round2(bestOrient.faceL),
        w: round2(bestOrient.faceW),
        h: round2(bestOrient.depth),
        orient: bestOrient.label,
      },
      placed: bestPacked.placed,
      spaces: bestPacked.spaces,
      ua: round2(usedArea),
      ka: round2(kerfWaste),
      ba: round2(faceArea),
      eff: Math.round((usedArea / faceArea) * 100),
      biggest,
    });

    remaining = remaining.filter((s) => !usedIds.has(s.id));
  }

  return {
    plan,
    unmet: remaining.map((s) => ({ id: s.id, label: s.label, temple: s.temple })),
    totalWaste: round2(plan.reduce((sum, b) => sum + Math.max(0, b.ba - b.ua), 0)),
  };
}

export function IsoBlockPreview({ block, placed }: { block: PlanBlock["blk"]; placed: PlacedSlab[] }) {
  const [angle, setAngle] = useState(0);
  const L = block.l;
  const W = block.w;
  const H = block.h;
  const C = Math.cos(Math.PI / 6);
  const S = 0.5;
  const scale = Math.min(320 / ((L + W) * C), 180 / (((L + W) * S) + H), 28);
  const offsetX = W * C * scale + 8;
  const offsetY = H * scale + 8;
  const pal = STONE_PALETTES[block.stone] || STONE_PALETTES.PinkStone;

  // 4 isometric viewpoints: SW (default), NW, NE, SE
  // Each proj transforms (x, y) before the isometric formula so different faces become visible
  function proj(x: number, y: number): [number, number] {
    switch (angle % 4) {
      case 1: return [x, W - y];       // NW: flip y — shows north + east faces
      case 2: return [L - x, W - y];   // NE: flip both — shows north + west faces
      case 3: return [L - x, y];       // SE: flip x — shows south + west faces
      default: return [x, y];          // SW: default — shows south + east faces
    }
  }

  function pt(x: number, y: number, z: number) {
    const [px, py] = proj(x, y);
    return {
      x: offsetX + (px - py) * C * scale,
      y: offsetY + (px + py) * S * scale - z * scale
    };
  }

  const allPoints = [
    pt(0, 0, 0), pt(L, 0, 0), pt(0, W, 0), pt(L, W, 0),
    pt(0, 0, H), pt(L, 0, H), pt(0, W, H), pt(L, W, H)
  ];
  const xs = allPoints.map((p) => p.x);
  const ys = allPoints.map((p) => p.y);
  const minX = Math.min(...xs) - 6;
  const minY = Math.min(...ys) - 6;
  const maxX = Math.max(...xs) + 6;
  const maxY = Math.max(...ys) + 18;

  function ptn(x: number, y: number, z: number) {
    const p = pt(x, y, z);
    return `${(p.x - minX).toFixed(1)},${(p.y - minY).toFixed(1)}`;
  }

  function txt(x: number, y: number, z: number) {
    const p = pt(x, y, z);
    return { x: p.x - minX, y: p.y - minY };
  }

  // Visible faces change with angle:
  // face1 (front): south (y=0) for angles 0,3 | north (y=W) for angles 1,2
  // face2 (side):  east (x=L) for angles 0,1  | west (x=0) for angles 2,3
  const face1Pts = (angle === 1 || angle === 2)
    ? [ptn(0, W, 0), ptn(L, W, 0), ptn(L, W, H), ptn(0, W, H)].join(" ")
    : [ptn(0, 0, 0), ptn(L, 0, 0), ptn(L, 0, H), ptn(0, 0, H)].join(" ");

  const face2Pts = (angle === 2 || angle === 3)
    ? [ptn(0, 0, 0), ptn(0, W, 0), ptn(0, W, H), ptn(0, 0, H)].join(" ")
    : [ptn(L, 0, 0), ptn(L, W, 0), ptn(L, W, H), ptn(L, 0, H)].join(" ");

  return (
    <svg
      className="plan-svg"
      viewBox={`0 0 ${(maxX - minX).toFixed(1)} ${(maxY - minY).toFixed(1)}`}
      onContextMenu={(e) => { e.preventDefault(); setAngle((a) => (a + 1) % 4); }}
      style={{ cursor: "context-menu" }}
      aria-label="Right-click to rotate view"
    >
      <polygon points={face1Pts} fill={pal.front} />
      <polygon points={face2Pts} fill={pal.side} />
      <polygon points={[ptn(0, 0, H), ptn(L, 0, H), ptn(L, W, H), ptn(0, W, H)].join(" ")} fill={pal.top} />

      {placed.map((item) => {
        const center = txt(item.px + item.pw / 2, item.py + item.ph / 2, H);
        return (
          <g key={item.id}>
            <polygon
              points={[
                ptn(item.px, item.py, H),
                ptn(item.px + item.pw, item.py, H),
                ptn(item.px + item.pw, item.py + item.ph, H),
                ptn(item.px, item.py + item.ph, H)
              ].join(" ")}
              fill={sclr(item.id)}
              opacity="0.86"
              stroke="rgba(255,255,255,0.72)"
              strokeWidth="0.8"
            />
            {Math.min(item.pw, item.ph) * scale > 16 ? (
              <text
                x={center.x}
                y={center.y}
                textAnchor="middle"
                dominantBaseline="middle"
                fill="#fff"
                fontSize={10}
                fontWeight={700}
              >
                {item.id}
              </text>
            ) : null}
          </g>
        );
      })}
    </svg>
  );
}

export function PlanningWorkbench({
  blocks,
  slabs,
  approveAction
}: {
  blocks: BlockRow[];
  slabs: SlabRow[];
  approveAction: (formData: FormData) => void | Promise<void>;
}) {
  const [kerfMm, setKerfMm] = useState(4);
  const [result, setResult] = useState<PlanResult | null>(null);

  const usableBlocks = blocks.filter((block) => block.status === "available" || block.status === "reserved");
  const openSlabs = slabs.filter((slab) => slab.status === "open" || slab.status === "planned");

  const [selectedBlockIds, setSelectedBlockIds] = useState<Set<string>>(() => new Set(usableBlocks.map((b) => b.id)));
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
    setResult(runOptimization(filteredBlocks, filteredSlabs, kerfMm));
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
              Review stock blocks and required slabs below, then generate a 3D cut plan.
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
                    <BlockMiniPreview stone={block.stone} />
                    <div>
                      <div className="record-title-row">
                        <strong>{block.id}</strong>
                        <span className="role-pill">{block.category}</span>
                        <span className="role-pill">Yard {block.yard}</span>
                      </div>
                      <p className="muted">
                        {block.stone} | {block.length_ft} × {block.width_ft} × {block.height_ft} ft
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
          {templeKeys.length === 0 ? (
            <div className="banner" style={{ marginTop: 12 }}>No open slab requirements found.</div>
          ) : templeKeys.map((temple) => (
            <div key={temple} style={{ marginTop: 14 }}>
              <p className="muted" style={{ fontWeight: 600, marginBottom: 6 }}>{temple}</p>
              <div className="records-stack">
                {slabsByTemple[temple].map((slab) => (
                  <div className={`record-card compact-record plan-selectable${selectedSlabIds.has(slab.id) ? "" : " plan-deselected"}`} key={slab.id} onClick={() => toggleSlab(slab.id)} style={{ cursor: "pointer" }}>
                    <div className="record-head">
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <input
                          checked={selectedSlabIds.has(slab.id)}
                          className="plan-check"
                          readOnly
                          type="checkbox"
                          onClick={(e) => { e.stopPropagation(); toggleSlab(slab.id); }}
                        />
                        <SlabMiniPreview accent={sclr(slab.id)} stone={slab.stone} />
                        <div>
                          <div className="record-title-row">
                            <strong style={{ color: sclr(slab.id) }}>{slab.id}</strong>
                            {slab.stone ? <span className="role-pill">{slab.stone}</span> : null}
                          </div>
                          <p className="muted">
                            {slab.label} | {slab.length_ft} × {slab.width_ft} × {slab.thickness_ft} ft
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
            <strong>{selectedBlockIds.size}</strong>/{usableBlocks.length} blocks · <strong>{selectedSlabIds.size}</strong>/{openSlabs.length} slabs selected · all 3 block orientations tried automatically
          </div>

          <button className="primary-button" onClick={generatePlan} type="button">
            Generate 3D Cut Plan
          </button>
        </div>
      </section>

      {result ? (
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
              <span>Avg efficiency</span>
              <strong>{avgEff}%</strong>
            </div>
            <div className="metric-card">
              <span>Unfit slabs</span>
              <strong>{result.unmet.length}</strong>
            </div>
          </section>

          <section className="page-card">
            <div className="banner" style={{ marginBottom: 16 }}>
              Kerf {kerfMm} mm applied. Total waste {result.totalWaste.toFixed(2)} ft². Right-click any block preview to rotate view.
            </div>

            <div className="plan-grid">
              {result.plan.map((item) => (
                <article className="plan-card" key={item.blk.id}>
                  <div className="record-head">
                    <div>
                      <strong>{item.blk.id}</strong>
                      <p className="muted">
                        {item.blk.stone} | Yard {item.blk.yard} | {item.blk.l} × {item.blk.w} × {item.blk.h} ft
                        {item.blk.orient ? <> · <span className="role-pill">{item.blk.orient}</span></> : null}
                      </p>
                    </div>
                    <span className="role-pill">Efficiency {item.eff}%</span>
                  </div>

                  <IsoBlockPreview block={item.blk} placed={item.placed} />

                  <div className="chip-row">
                    {item.placed.map((slab) => (
                      <span
                        className="plan-chip"
                        key={slab.id}
                        style={{ background: `${sclr(slab.id)}22`, color: sclr(slab.id), borderColor: `${sclr(slab.id)}44` }}
                      >
                        {slab.id} {slab.rot ? "R" : ""} {slab.sw}×{slab.sh} ft
                      </span>
                    ))}
                  </div>

                  <p className="muted" style={{ marginTop: 10 }}>
                    Used {item.ua.toFixed(2)} ft² | Kerf waste {item.ka.toFixed(2)} ft² | Remaining{" "}
                    {Math.max(0, item.ba - item.ua - item.ka).toFixed(2)} ft²
                  </p>

                  {item.biggest ? (
                    <p className="muted">
                      Largest remainder {item.biggest.l} × {item.biggest.w} × {item.biggest.h} ft
                    </p>
                  ) : null}
                </article>
              ))}
            </div>

            {result.unmet.length ? (
              <div className="banner" style={{ marginTop: 16 }}>
                Unfit slabs: {result.unmet.map((item) => item.id).join(", ")}
              </div>
            ) : null}

            {result.plan.length ? (
              <form action={approveAction} style={{ marginTop: 18 }}>
                <input name="kerf_mm" type="hidden" value={String(kerfMm)} />
                <input name="plan_json" type="hidden" value={JSON.stringify(result.plan)} />
                <button className="primary-button" type="submit">
                  Approve Plan and Create Cutting Session
                </button>
              </form>
            ) : null}
          </section>
        </>
      ) : null}
    </>
  );
}
