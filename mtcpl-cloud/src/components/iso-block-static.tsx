/**
 * IsoBlockStaticSVG — server-renderable (no hooks), fixed-angle isometric block view.
 * Used for print pages where we want multiple static angles of the same block.
 *
 * Rendering logic mirrors IsoBlockPreview from planning-workbench.tsx.
 */

const STONE_PALETTES: Record<string, { top: string; front: string; side: string }> = {
  PinkStone:  { top: "#EDCFC2", front: "#C87A60", side: "#DDA88A" },
  WhiteStone: { top: "#E8E6DC", front: "#B8B6AC", side: "#D0CEC4" },
};

const SLAB_COLORS = [
  "#D85A30","#378ADD","#1D9E75","#7F77DD","#BA7517",
  "#639922","#D4537E","#E24B4A","#5F5E5A","#0F6E56",
];

function slabColor(id: string) {
  const num = parseInt(String(id || "").replace(/\D/g, ""), 10);
  if (!num || Number.isNaN(num)) return SLAB_COLORS[0];
  return SLAB_COLORS[(num - 1) % SLAB_COLORS.length];
}

type PlacedSlab = {
  id: string;
  label?: string;
  temple?: string;
  sw: number;
  sh: number;
  sd?: number;
  px: number;
  py: number;
  pw: number;
  ph: number;
  aw?: number;
  ah?: number;
  rot?: boolean;
  zTop?: number;
  zBot?: number;
};

type Block = {
  l: number;
  w: number;
  h: number;
  stone: string;
};

export function IsoBlockStaticSVG({
  block,
  placed,
  az = Math.PI * 0.25,
  size = 280,
  label,
}: {
  block: Block;
  placed: PlacedSlab[];
  az?: number;
  size?: number;
  label?: string;
}) {
  const L = block.l, W = block.w, H = block.h;
  const C = Math.cos(Math.PI / 6); // ≈ 0.866
  const S = 0.5;
  const diag = Math.sqrt(L * L + W * W);
  const scale = Math.min(
    size / (diag * C + 4),
    (size * 0.57) / (diag * S + H + 4),
    30
  );

  const Ca = Math.cos(az);
  const Sa = Math.sin(az);

  function raw(x: number, y: number, z: number) {
    const rx = x * Ca - y * Sa;
    const ry = x * Sa + y * Ca;
    return { x: rx * C * scale, y: ry * S * scale - z * scale };
  }

  // Compute viewBox from 8 corners
  const corners = (
    [[0,0,0],[L,0,0],[0,W,0],[L,W,0],[0,0,H],[L,0,H],[0,W,H],[L,W,H]] as [number,number,number][]
  ).map(([x, y, z]) => raw(x, y, z));
  const pad = 10;
  const minX = Math.min(...corners.map(p => p.x)) - pad;
  const minY = Math.min(...corners.map(p => p.y)) - pad;
  const maxX = Math.max(...corners.map(p => p.x)) + pad;
  const maxY = Math.max(...corners.map(p => p.y)) + pad + (label ? 18 : 4);

  function ptn(x: number, y: number, z: number) {
    const p = raw(x, y, z);
    return `${(p.x - minX).toFixed(1)},${(p.y - minY).toFixed(1)}`;
  }
  function ptObj(x: number, y: number, z: number) {
    const p = raw(x, y, z);
    return { x: p.x - minX, y: p.y - minY };
  }

  const pal = STONE_PALETTES[block.stone] || STONE_PALETTES.PinkStone;
  const showFrontY = Sa >= 0;
  const showRightX = Ca >= 0;
  const bY = showFrontY ? 0 : W;
  const bX = showRightX ? L : 0;

  // Sort back-to-front
  const sortedSlabs = [...placed].sort((a, b) => {
    const ra = (a.px + a.pw / 2) * Sa + (a.py + a.ph / 2) * Ca;
    const rb = (b.px + b.pw / 2) * Sa + (b.py + b.ph / 2) * Ca;
    if (Math.abs(ra - rb) > 0.05) return rb - ra;
    const aZ = (a.zTop ?? H) + (a.zBot ?? 0);
    const bZ = (b.zTop ?? H) + (b.zBot ?? 0);
    return aZ - bZ;
  });

  const vbW = (maxX - minX).toFixed(1);
  const vbH = (maxY - minY).toFixed(1);

  return (
    <svg
      viewBox={`0 0 ${vbW} ${vbH}`}
      style={{ width: "100%", display: "block" }}
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* Block faces */}
      <polygon
        points={[ptn(0,bY,0),ptn(L,bY,0),ptn(L,bY,H),ptn(0,bY,H)].join(" ")}
        fill={pal.front}
        stroke="rgba(0,0,0,0.12)" strokeWidth="0.5"
      />
      <polygon
        points={[ptn(bX,0,0),ptn(bX,W,0),ptn(bX,W,H),ptn(bX,0,H)].join(" ")}
        fill={pal.side}
        stroke="rgba(0,0,0,0.12)" strokeWidth="0.5"
      />
      <polygon
        points={[ptn(0,0,H),ptn(L,0,H),ptn(L,W,H),ptn(0,W,H)].join(" ")}
        fill={pal.top}
        stroke="rgba(0,0,0,0.12)" strokeWidth="0.5"
      />

      {/* Slabs */}
      {sortedSlabs.map((item) => {
        const color = slabColor(item.id);
        const slabZTop = item.zTop ?? H;
        const slabZBot = item.zBot ?? Math.max(0, H - (item.sd && item.sd > 0 ? item.sd : H * 0.4));
        const sy = showFrontY ? item.py : item.py + item.ph;
        const sx = showRightX ? item.px + item.pw : item.px;
        const center = ptObj(item.px + item.pw / 2, item.py + item.ph / 2, slabZTop);
        const showLabel = Math.min(item.pw, item.ph) * scale > 14;

        return (
          <g key={item.id}>
            {/* Y-side face */}
            <polygon
              points={[
                ptn(item.px, sy, slabZBot),
                ptn(item.px + item.pw, sy, slabZBot),
                ptn(item.px + item.pw, sy, slabZTop),
                ptn(item.px, sy, slabZTop),
              ].join(" ")}
              fill={color} opacity={0.7}
              stroke="rgba(0,0,0,0.12)" strokeWidth="0.5"
            />
            {/* X-side face */}
            <polygon
              points={[
                ptn(sx, item.py, slabZBot),
                ptn(sx, item.py + item.ph, slabZBot),
                ptn(sx, item.py + item.ph, slabZTop),
                ptn(sx, item.py, slabZTop),
              ].join(" ")}
              fill={color} opacity={0.57}
              stroke="rgba(0,0,0,0.12)" strokeWidth="0.5"
            />
            {/* Top face */}
            <polygon
              points={[
                ptn(item.px, item.py, slabZTop),
                ptn(item.px + item.pw, item.py, slabZTop),
                ptn(item.px + item.pw, item.py + item.ph, slabZTop),
                ptn(item.px, item.py + item.ph, slabZTop),
              ].join(" ")}
              fill={color} opacity={0.88}
              stroke="rgba(255,255,255,0.6)" strokeWidth="0.8"
            />
            {showLabel && (
              <text
                x={center.x} y={center.y}
                textAnchor="middle" dominantBaseline="middle"
                fill="#fff" fontSize={9} fontWeight={700}
              >
                {item.id}
              </text>
            )}
          </g>
        );
      })}

      {/* Angle label at bottom */}
      {label && (
        <text
          x={Number(vbW) / 2}
          y={Number(vbH) - 3}
          textAnchor="middle"
          fill="#888"
          fontSize={9}
          fontStyle="italic"
        >
          {label}
        </text>
      )}
    </svg>
  );
}
