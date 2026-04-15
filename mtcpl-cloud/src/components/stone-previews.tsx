type BlockPreviewProps = {
  stone: string;
  className?: string;
};

type SlabPreviewProps = {
  stone?: string | null;
  accent?: string;
  className?: string;
};

type BlockCardPreviewProps = {
  stone: string;
  l?: number | string;
  w?: number | string;
  h?: number | string;
};

import { getStonePalette } from "@/lib/stone-utils";
import type { StoneTypeDef } from "@/lib/stone-utils";

export const STONE_PALETTES: Record<string, { top: string; front: string; side: string; stroke: string }> = {
  PinkStone: { top: "#EDCFC2", front: "#C87A60", side: "#DDA88A", stroke: "rgba(140,60,35,0.2)" },
  WhiteStone: { top: "#E8E6DC", front: "#B8B6AC", side: "#D0CEC4", stroke: "rgba(80,78,70,0.15)" }
};

function paletteFor(stone?: string | null, stoneTypes?: StoneTypeDef[]) {
  const pal = getStonePalette(stone ?? "PinkStone", stoneTypes);
  // derive stroke from front colour
  return {
    top: pal.top,
    front: pal.front,
    side: pal.side,
    stroke: STONE_PALETTES[stone ?? ""]?.stroke ?? "rgba(0,0,0,0.12)",
  };
}

/** Small inline preview for planning / cutting lists */
export function BlockMiniPreview({ stone, className, stoneTypes }: BlockPreviewProps & { stoneTypes?: StoneTypeDef[] }) {
  const pal = paletteFor(stone, stoneTypes);
  return (
    <svg className={className} viewBox="0 0 44 34" width="34" height="28" aria-hidden="true">
      <polygon points="8,12 24,4 38,12 22,20" fill={pal.top} stroke={pal.stroke} strokeWidth="0.8" />
      <polygon points="8,12 22,20 22,30 8,22" fill={pal.front} stroke={pal.stroke} strokeWidth="0.8" />
      <polygon points="22,20 38,12 38,22 22,30" fill={pal.side} stroke={pal.stroke} strokeWidth="0.8" />
    </svg>
  );
}

/** Small inline preview for slabs */
export function SlabMiniPreview({ stone, accent, className, stoneTypes }: SlabPreviewProps & { stoneTypes?: StoneTypeDef[] }) {
  const pal = paletteFor(stone, stoneTypes);
  const border = accent || pal.front;
  return (
    <svg className={className} viewBox="0 0 42 30" width="32" height="24" aria-hidden="true">
      <polygon points="9,9 25,9 31,5 15,5" fill={pal.side} stroke={border} strokeWidth="0.8" />
      <polygon points="9,9 25,9 25,23 9,23" fill={pal.top} stroke={border} strokeWidth="1.2" />
      <polygon points="25,9 31,5 31,19 25,23" fill={pal.front} stroke={border} strokeWidth="0.8" />
    </svg>
  );
}

/**
 * Card-sized 3D isometric block preview.
 * Proportional to actual dimensions (L, W, H) passed in.
 * Fills the card preview container.
 */
export function BlockCardPreview({ stone, l = 60, w = 40, h = 24, stoneTypes }: BlockCardPreviewProps & { stoneTypes?: StoneTypeDef[] }) {
  const pal = paletteFor(stone, stoneTypes);

  const L = Math.max(Number(l) || 60, 1);
  const W = Math.max(Number(w) || 40, 1);
  const H = Math.max(Number(h) || 24, 1);

  // Isometric projection constants
  const C = Math.cos(Math.PI / 6);   // cos 30°
  const S = 0.5;                      // sin 30°

  // Scale to fit in a ~180x100 viewport
  const scale = Math.min(180 / ((L + W) * C), 90 / ((L + W) * S + H), 2.2);
  const offsetX = W * C * scale + 6;
  const offsetY = H * scale + 6;

  function pt(x: number, y: number, z: number) {
    return {
      x: offsetX + (x - y) * C * scale,
      y: offsetY + (x + y) * S * scale - z * scale
    };
  }

  const corners = [
    pt(0,0,0), pt(L,0,0), pt(L,W,0), pt(0,W,0),
    pt(0,0,H), pt(L,0,H), pt(L,W,H), pt(0,W,H)
  ];
  const xs = corners.map(p => p.x);
  const ys = corners.map(p => p.y);
  const minX = Math.min(...xs) - 4;
  const minY = Math.min(...ys) - 4;
  const maxX = Math.max(...xs) + 4;
  const maxY = Math.max(...ys) + 8;

  const vw = maxX - minX;
  const vh = maxY - minY;

  function ptn(x: number, y: number, z: number) {
    const p = pt(x, y, z);
    return `${(p.x - minX).toFixed(1)},${(p.y - minY).toFixed(1)}`;
  }

  return (
    <svg
      viewBox={`0 0 ${vw.toFixed(1)} ${vh.toFixed(1)}`}
      style={{ width: "100%", height: "100%", maxHeight: 88 }}
      aria-hidden="true"
    >
      {/* Left face (y=W — visible in this projection, appears on screen-left) */}
      <polygon
        points={[ptn(0,W,0), ptn(L,W,0), ptn(L,W,H), ptn(0,W,H)].join(" ")}
        fill={pal.front}
        stroke={pal.stroke}
        strokeWidth="0.6"
      />
      {/* Right face (x=L — visible in this projection, appears on screen-right) */}
      <polygon
        points={[ptn(L,0,0), ptn(L,W,0), ptn(L,W,H), ptn(L,0,H)].join(" ")}
        fill={pal.side}
        stroke={pal.stroke}
        strokeWidth="0.6"
      />
      {/* Top face */}
      <polygon
        points={[ptn(0,0,H), ptn(L,0,H), ptn(L,W,H), ptn(0,W,H)].join(" ")}
        fill={pal.top}
        stroke={pal.stroke}
        strokeWidth="0.6"
      />
      {/* Subtle highlight on top */}
      <polygon
        points={[ptn(0,0,H), ptn(L,0,H), ptn(L,W,H), ptn(0,W,H)].join(" ")}
        fill="rgba(255,255,255,0.15)"
      />
    </svg>
  );
}
