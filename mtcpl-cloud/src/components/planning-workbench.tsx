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

const SLAB_COLORS = ["#C9973A", "#9C6ADE", "#2E8B57", "#D75D39", "#4C88E8", "#9D7A33", "#C2495E", "#5B6770"];

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

function runOptimization(blocks: BlockRow[], slabs: SlabRow[], kerfMm: number): PlanResult {
  const kerfFt = kerfMm / 304.8;
  let remaining = slabs
    .filter((slab) => slab.status === "open" || slab.status === "planned")
    .map((slab) => ({
      id: slab.id,
      label: slab.label,
      temple: slab.temple,
      stone: slab.stone || null,
      sw: toNum(slab.length_ft),
      sh: toNum(slab.width_ft),
      sd: toNum(slab.thickness_ft)
    }))
    .sort((a, b) => b.sw * b.sh - a.sw * a.sh);

  const usableBlocks = blocks.filter((block) => block.status === "available" || block.status === "reserved");
  const plan: PlanBlock[] = [];

  usableBlocks.forEach((block) => {
    if (!remaining.length) return;
    const eligible = remaining.filter((slab) => !slab.stone || slab.stone === block.stone);
    if (!eligible.length) return;

    const usableL = Math.max(0, toNum(block.length_ft));
    const usableW = Math.max(0, toNum(block.width_ft));

    if (usableL <= 0.01 || usableW <= 0.01) return;

    const packed = packBlock(usableL, usableW, eligible, kerfFt);
    if (!packed.placed.length) return;

    const usedIds = new Set<string>();
    let usedArea = 0;
    let kerfWaste = 0;

    packed.placed.forEach((item) => {
      usedIds.add(item.id);
      usedArea += item.pw * item.ph;
      kerfWaste += item.aw * item.ah - item.pw * item.ph;
    });

    let biggest: { l: number; w: number; h: number } | null = null;
    packed.spaces.forEach((space) => {
      if (!biggest || space.w * space.h > biggest.l * biggest.w) {
        biggest = { l: round2(space.w), w: round2(space.h), h: round2(toNum(block.height_ft)) };
      }
    });

    const baseArea = usableL * usableW;
    plan.push({
      blk: {
        id: block.id,
        stone: block.stone,
        yard: toNum(block.yard, 1),
        l: round2(toNum(block.length_ft)),
        w: round2(toNum(block.width_ft)),
        h: round2(toNum(block.height_ft))
      },
      placed: packed.placed,
      spaces: packed.spaces,
      ua: round2(usedArea),
      ka: round2(kerfWaste),
      ba: round2(baseArea),
      eff: Math.round((usedArea / baseArea) * 100),
      biggest
    });

    remaining = remaining.filter((slab) => !usedIds.has(slab.id));
  });

  return {
    plan,
    unmet: remaining.map((item) => ({ id: item.id, label: item.label, temple: item.temple })),
    totalWaste: round2(plan.reduce((sum, block) => sum + Math.max(0, block.ba - block.ua), 0))
  };
}

export function IsoBlockPreview({ block, placed }: { block: PlanBlock["blk"]; placed: PlacedSlab[] }) {
  const L = block.l;
  const W = block.w;
  const H = block.h;
  const C = Math.cos(Math.PI / 6);
  const S = 0.5;
  const scale = Math.min(320 / ((L + W) * C), 180 / (((L + W) * S) + H), 28);
  const offsetX = W * C * scale + 8;
  const offsetY = H * scale + 8;
  const pal = STONE_PALETTES[block.stone] || STONE_PALETTES.PinkStone;

  function pt(x: number, y: number, z: number) {
    return {
      x: offsetX + (x - y) * C * scale,
      y: offsetY + (x + y) * S * scale - z * scale
    };
  }

  const allPoints = [pt(0, 0, 0), pt(L, 0, 0), pt(0, W, 0), pt(L, W, 0), pt(0, 0, H), pt(L, 0, H), pt(0, W, H), pt(L, W, H)];
  const xs = allPoints.map((point) => point.x);
  const ys = allPoints.map((point) => point.y);
  const minX = Math.min(...xs) - 6;
  const minY = Math.min(...ys) - 6;
  const maxX = Math.max(...xs) + 6;
  const maxY = Math.max(...ys) + 18;

  function ptn(x: number, y: number, z: number) {
    const point = pt(x, y, z);
    return `${(point.x - minX).toFixed(1)},${(point.y - minY).toFixed(1)}`;
  }

  function txt(x: number, y: number, z: number) {
    const point = pt(x, y, z);
    return { x: point.x - minX, y: point.y - minY };
  }

  return (
    <svg className="plan-svg" viewBox={`0 0 ${(maxX - minX).toFixed(1)} ${(maxY - minY).toFixed(1)}`}>
      <polygon points={[ptn(0, 0, 0), ptn(L, 0, 0), ptn(L, 0, H), ptn(0, 0, H)].join(" ")} fill={pal.front} />
      <polygon points={[ptn(L, 0, 0), ptn(L, W, 0), ptn(L, W, H), ptn(L, 0, H)].join(" ")} fill={pal.side} />
      <polygon points={[ptn(0, 0, H), ptn(L, 0, H), ptn(L, W, H), ptn(0, W, H)].join(" ")} fill={pal.top} />

      {placed.map((item) => {
        const ox = 0;
        const oy = 0;
        const center = txt(ox + item.px + item.pw / 2, oy + item.py + item.ph / 2, H);
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
              <text x={center.x} y={center.y} textAnchor="middle" dominantBaseline="middle" fill="#fff" fontSize={10} fontWeight={700}>
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

  const [selectedBlockIds, setSelectedBlockIds] = useState<Set<string>>(() => new Set(usableBlocks.map((block) => block.id)));
  const [selectedSlabIds, setSelectedSlabIds] = useState<Set<string>>(() => new Set(openSlabs.map((slab) => slab.id)));

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
    const filteredBlocks = usableBlocks.filter((block) => selectedBlockIds.has(block.id));
    const filteredSlabs = openSlabs.filter((slab) => selectedSlabIds.has(slab.id));
    setResult(runOptimization(filteredBlocks, filteredSlabs, kerfMm));
  }

  const totalPlaced = result?.plan.reduce((sum, block) => sum + block.placed.length, 0) ?? 0;

  return (
    <div className="records-stack">
      <section className="page-card">
        <div className="page-heading">
          <div>
            <h1>Plan Generator</h1>
            <p className="muted">Review stock blocks and open slab demand, then generate a cut layout matched by stone type.</p>
          </div>
        </div>
      </section>

      <div className="planning-two-col">
        <section className="page-card">
          <div className="section-heading">
            <div>
              <h2>Blocks</h2>
              <p className="muted">Available and reserved blocks for planning</p>
            </div>
            <div className="plan-select-row">
              <button className="ghost-button" type="button" onClick={() => setSelectedBlockIds(new Set(usableBlocks.map((b) => b.id)))}>
                Select All
              </button>
              <button className="ghost-button" type="button" onClick={() => setSelectedBlockIds(new Set())}>
                Clear
              </button>
            </div>
          </div>

          <div className="records-stack">
            {usableBlocks.map((block) => (
              <div className={`record-card plan-selectable${selectedBlockIds.has(block.id) ? "" : " plan-deselected"}`} key={block.id} onClick={() => toggleBlock(block.id)}>
                <div className="record-head">
                  <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                    <input checked={selectedBlockIds.has(block.id)} readOnly type="checkbox" />
                    <BlockMiniPreview stone={block.stone} />
                    <div>
                      <strong>{block.id}</strong>
                      <p className="muted" style={{ margin: "6px 0 0" }}>
                        {block.stone} | {block.length_ft} × {block.width_ft} × {block.height_ft} ft
                      </p>
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <span className="yard-badge">Yard {block.yard}</span>
                    <span className="role-pill">{block.category}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="page-card">
          <div className="section-heading">
            <div>
              <h2>Slabs</h2>
              <p className="muted">Open demand grouped by temple</p>
            </div>
            <div className="plan-select-row">
              <button className="ghost-button" type="button" onClick={() => setSelectedSlabIds(new Set(openSlabs.map((s) => s.id)))}>
                Select All
              </button>
              <button className="ghost-button" type="button" onClick={() => setSelectedSlabIds(new Set())}>
                Clear
              </button>
            </div>
          </div>

          <div className="records-stack">
            {templeKeys.map((temple) => (
              <div key={temple}>
                <p className="muted" style={{ margin: "0 0 10px", fontWeight: 700 }}>{temple}</p>
                <div className="records-stack">
                  {slabsByTemple[temple].map((slab) => (
                    <div className={`record-card plan-selectable${selectedSlabIds.has(slab.id) ? "" : " plan-deselected"}`} key={slab.id} onClick={() => toggleSlab(slab.id)}>
                      <div className="record-head">
                        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                          <input checked={selectedSlabIds.has(slab.id)} readOnly type="checkbox" />
                          <SlabMiniPreview accent={sclr(slab.id)} stone={slab.stone} />
                          <div>
                            <strong>{slab.id}</strong>
                            <p className="muted" style={{ margin: "6px 0 0" }}>
                              {slab.label} | {slab.length_ft} × {slab.width_ft} × {slab.thickness_ft} ft
                            </p>
                          </div>
                        </div>
                        {slab.stone ? <span className="stone-badge">{slab.stone}</span> : null}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>

      <section className="page-card">
        <div className="planning-toolbar">
          <label className="stack" style={{ minWidth: 140 }}>
            <span>Blade Kerf (mm)</span>
            <input min="0.5" onChange={(event) => setKerfMm(Number(event.target.value) || 4)} step="0.5" type="number" value={kerfMm} />
          </label>
          <div className="banner">
            <strong>{selectedBlockIds.size}</strong>/{usableBlocks.length} blocks selected and <strong>{selectedSlabIds.size}</strong>/{openSlabs.length} slabs selected
          </div>
          <button className="primary-button" onClick={generatePlan} type="button">
            Generate Plan
          </button>
        </div>
      </section>

      {result ? (
        <>
          <section className="metrics-grid">
            <div className="metric-card">
              <span>Placed Slabs</span>
              <strong>{totalPlaced}</strong>
            </div>
            <div className="metric-card">
              <span>Blocks Used</span>
              <strong>{result.plan.length}</strong>
            </div>
            <div className="metric-card">
              <span>Total Waste</span>
              <strong>{result.totalWaste}</strong>
            </div>
            <div className="metric-card">
              <span>Unmet Slabs</span>
              <strong>{result.unmet.length}</strong>
            </div>
          </section>

          <div className="records-stack">
            {result.plan.map((block) => (
              <section className="page-card" key={block.blk.id}>
                <div className="section-heading">
                  <div>
                    <h2>{block.blk.id}</h2>
                    <p className="muted">
                      {block.blk.stone} | Yard {block.blk.yard} | Efficiency {block.eff}%
                    </p>
                  </div>
                  <span className="status-badge">{block.placed.length} slabs placed</span>
                </div>
                <div className="split-layout">
                  <IsoBlockPreview block={block.blk} placed={block.placed} />
                  <div className="records-stack">
                    {block.placed.map((slab) => (
                      <div className="record-card" key={slab.id}>
                        <strong style={{ color: sclr(slab.id) }}>{slab.id}</strong>
                        <p className="muted" style={{ margin: "8px 0 0" }}>
                          {slab.label} | {slab.pw} × {slab.ph} ft | {slab.rot ? "Rotated" : "Standard"}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              </section>
            ))}
          </div>

          <section className="page-card">
            <form action={approveAction} className="record-actions">
              <input name="kerf_mm" type="hidden" value={String(kerfMm)} />
              <input name="plan_json" type="hidden" value={JSON.stringify(result.plan)} />
              <div>
                <strong>Approve this generated layout</strong>
                <p className="muted" style={{ margin: "6px 0 0" }}>This will reserve blocks, mark slabs as planned, and open a cutting session.</p>
              </div>
              <button className="primary-button" type="submit">
                Approve Plan
              </button>
            </form>
          </section>
        </>
      ) : null}
    </div>
  );
}
