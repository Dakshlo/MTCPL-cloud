import type { Stone } from "@/lib/types";

type BlockPreviewProps = {
  stone: Stone | string;
  className?: string;
  length?: number;
  width?: number;
  height?: number;
};

type SlabPreviewProps = {
  stone?: Stone | string | null;
  accent?: string;
  className?: string;
};

const STONE_PALETTES: Record<string, { top: string; front: string; side: string }> = {
  PinkStone: { top: "#E8B4A0", front: "#D4927A", side: "#C07858" },
  WhiteStone: { top: "#E8E6DC", front: "#D0CEC4", side: "#B8B6AC" }
};

function paletteFor(stone?: string | null) {
  return STONE_PALETTES[stone || "PinkStone"] || STONE_PALETTES.PinkStone;
}

export function BlockMiniPreview({ stone, className }: BlockPreviewProps) {
  return <BlockCardPreview stone={stone} className={className} length={56} width={36} height={24} />;
}

export function BlockCardPreview({
  stone,
  className,
  length = 72,
  width = 46,
  height = 34
}: BlockPreviewProps) {
  const pal = paletteFor(stone);
  const l = Math.max(length, 18);
  const w = Math.max(width, 14);
  const h = Math.max(height, 10);
  const sx = 1.05;
  const sy = 0.58;

  const topLeft = { x: 70, y: 36 };
  const topRight = { x: topLeft.x + l * sx, y: topLeft.y - l * sy };
  const rightMid = { x: topRight.x + w * sx, y: topRight.y + w * sy };
  const leftMid = { x: topLeft.x + w * sx, y: topLeft.y + w * sy };

  const frontBottomLeft = { x: leftMid.x, y: leftMid.y + h };
  const frontBottomRight = { x: rightMid.x, y: rightMid.y + h };
  const sideBottomLeft = { x: topLeft.x, y: topLeft.y + h };
  const sideBottomRight = { x: leftMid.x, y: leftMid.y + h };

  return (
    <svg className={className} viewBox="0 0 220 140" aria-hidden="true">
      <defs>
        <linearGradient id={`shadow-${stone}`} x1="0%" x2="100%">
          <stop offset="0%" stopColor="rgba(45,36,16,0.18)" />
          <stop offset="100%" stopColor="rgba(45,36,16,0.03)" />
        </linearGradient>
      </defs>
      <ellipse cx="112" cy="118" rx="78" ry="14" fill={`url(#shadow-${stone})`} />
      <polygon
        points={`${topLeft.x},${topLeft.y} ${topRight.x},${topRight.y} ${rightMid.x},${rightMid.y} ${leftMid.x},${leftMid.y}`}
        fill={pal.top}
        stroke="rgba(45,36,16,0.16)"
        strokeWidth="1.2"
      />
      <polygon
        points={`${leftMid.x},${leftMid.y} ${rightMid.x},${rightMid.y} ${frontBottomRight.x},${frontBottomRight.y} ${frontBottomLeft.x},${frontBottomLeft.y}`}
        fill={pal.front}
        stroke="rgba(45,36,16,0.14)"
        strokeWidth="1.2"
      />
      <polygon
        points={`${topLeft.x},${topLeft.y} ${leftMid.x},${leftMid.y} ${sideBottomRight.x},${sideBottomRight.y} ${sideBottomLeft.x},${sideBottomLeft.y}`}
        fill={pal.side}
        stroke="rgba(45,36,16,0.14)"
        strokeWidth="1.2"
      />
    </svg>
  );
}

export function SlabMiniPreview({ stone, accent, className }: SlabPreviewProps) {
  const pal = paletteFor(stone);
  const border = accent || pal.front;

  return (
    <svg className={className} viewBox="0 0 42 30" width="32" height="24" aria-hidden="true">
      <polygon points="9,9 25,9 31,5 15,5" fill={pal.side} stroke={border} strokeWidth="0.8" />
      <polygon points="9,9 25,9 25,23 9,23" fill={pal.top} stroke={border} strokeWidth="1.2" />
      <polygon points="25,9 31,5 31,19 25,23" fill={pal.front} stroke={border} strokeWidth="0.8" />
    </svg>
  );
}
