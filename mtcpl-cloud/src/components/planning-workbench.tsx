"use client";

import { useState } from "react";

export type BlockRow = {
  id: string;
  stone: string;
  yard: number;
  category: string;
  length_ft: number | string;
  width_ft: number | string;
  height_ft: number | string;
  trim_left_ft: number | string;
  trim_right_ft: number | string;
  trim_near_ft: number | string;
  trim_far_ft: number | string;
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
    tL: number;
    tR: number;
    tT: number;
    tB: number;
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
  Makrana: { top: "#EEE8DC", front: "#C8BFB0", side: "#D8D0BE" },
  Pinkstone: { top: "#EDCFC2", front: "#C09282", side: "#D8B4A2" }
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

    // Only place slabs that match this block's stone type (or have no stone preference)
    const eligible = remaining.filter((slab) => !slab.stone || slab.stone === block.stone);
    if (!eligible.length) return;

    const usableL = Math.max(0, toNum(block.length_ft) - toNum(block.trim_left_ft) - toNum(block.trim_right_ft));
    const usableW = Math.max(0, toNum(block.width_ft) - toNum(block.trim_near_ft) - toNum(block.trim_far_ft));

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
        biggest = {
          l: round2(space.w),
          w: round2(space.h),
          h: round2(toNum(block.height_ft))
        };
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
        h: round2(toNum(block.height_ft)),
        tL: round2(toNum(block.trim_left_ft)),
        tR: round2(toNum(block.trim_right_ft)),
        tT: round2(toNum(block.trim_near_ft)),
        tB: round2(toNum(block.trim_far_ft))
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
    totalWaste: round2(
      plan.reduce((sum, block) => {
        return sum + Math.max(0, block.ba - block.ua);
      }, 0)
    )
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
  const pal = STONE_PALETTES[block.stone] || STONE_PALETTES.Makrana;

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
        const ox = block.tL;
        const oy = block.tT;
        const center = txt(ox + item.px + item.pw / 2, oy + item.py + item.ph / 2, H);
        return (
          <g key={item.id}>
            <polygon
              points={[
                ptn(ox + item.px, oy + item.py, H),
                ptn(ox + item.px + item.pw, oy + item.py, H),
                ptn(ox + item.px + item.pw, oy + item.py + item.ph, H),
                ptn(ox + item.px, oy + item.py + item.ph, H)
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

  const slabsByTemple = openSlabs.reduce<Record<string, SlabRow[]>>((acc, slab) => {
    if (!acc[slab.temple]) acc[slab.temple] = [];
    acc[slab.temple].push(slab);
    return acc;
  }, {});
  const templeKeys = Object.keys(slabsByTemple).sort();

  function generatePlan() {
    setResult(runOptimization(usableBlocks, openSlabs, kerfMm));
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
          <div className="records-stack" style={{ marginTop: 12 }}>
            {usableBlocks.length === 0 ? (
              <div className="banner">No usable blocks found.</div>
            ) : usableBlocks.map((block) => (
              <div className="record-card compact-record" key={block.id}>
                <div className="record-head">
                  <div>
                    <div className="record-title-row">
                      <strong>{block.id}</strong>
                      <span className="role-pill">{block.category}</span>
                      <span className="role-pill">Yard {block.yard}</span>
                    </div>
                    <p className="muted">
                      {block.stone} | {block.length_ft} × {block.width_ft} × {block.height_ft} ft
                    </p>
                    {(toNum(block.trim_left_ft) > 0 || toNum(block.trim_right_ft) > 0 || toNum(block.trim_near_ft) > 0 || toNum(block.trim_far_ft) > 0) ? (
                      <p className="muted">
                        Trim L{block.trim_left_ft} R{block.trim_right_ft} N{block.trim_near_ft} F{block.trim_far_ft} ft
                      </p>
                    ) : null}
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
          {templeKeys.length === 0 ? (
            <div className="banner" style={{ marginTop: 12 }}>No open slab requirements found.</div>
          ) : templeKeys.map((temple) => (
            <div key={temple} style={{ marginTop: 14 }}>
              <p className="muted" style={{ fontWeight: 600, marginBottom: 6 }}>{temple}</p>
              <div className="records-stack">
                {slabsByTemple[temple].map((slab) => (
                  <div className="record-card compact-record" key={slab.id}>
                    <div className="record-head">
                      <div>
                        <div className="record-title-row">
                          <span className="mini-slab" style={{ background: sclr(slab.id) }} />
                          <strong style={{ color: sclr(slab.id) }}>{slab.id}</strong>
                          {slab.stone ? <span className="role-pill">{slab.stone}</span> : null}
                        </div>
                        <p className="muted">
                          {slab.label} | {slab.length_ft} × {slab.width_ft} × {slab.thickness_ft} ft
                        </p>
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
            <strong>{usableBlocks.length}</strong> blocks · <strong>{openSlabs.length}</strong> slabs · stone types are matched automatically
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
              Kerf {kerfMm} mm applied. Total waste {result.totalWaste.toFixed(2)} ft2. This preview is not yet saved to
              cutting sessions.
            </div>

            <div className="plan-grid">
              {result.plan.map((item) => (
                <article className="plan-card" key={item.blk.id}>
                  <div className="record-head">
                    <div>
                      <strong>{item.blk.id}</strong>
                      <p className="muted">
                        {item.blk.stone} | Yard {item.blk.yard} | {item.blk.l} x {item.blk.w} x {item.blk.h} ft
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
                        {slab.id} {slab.rot ? "R" : ""} {slab.sw}x{slab.sh} ft
                      </span>
                    ))}
                  </div>

                  <p className="muted" style={{ marginTop: 10 }}>
                    Used {item.ua.toFixed(2)} ft2 | Kerf waste {item.ka.toFixed(2)} ft2 | Remaining{" "}
                    {Math.max(0, item.ba - item.ua - item.ka).toFixed(2)} ft2
                  </p>

                  {item.biggest ? (
                    <p className="muted">
                      Largest remainder {item.biggest.l} x {item.biggest.w} x {item.biggest.h} ft
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
