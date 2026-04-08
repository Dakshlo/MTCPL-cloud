type BlockPreviewProps = {
  stone: string;
  className?: string;
};

type SlabPreviewProps = {
  stone?: string | null;
  accent?: string;
  className?: string;
};

const STONE_PALETTES: Record<string, { top: string; front: string; side: string }> = {
  Makrana: { top: "#EEE8DC", front: "#C8BFB0", side: "#D8D0BE" },
  Pinkstone: { top: "#EDCFC2", front: "#C09282", side: "#D8B4A2" }
};

function paletteFor(stone?: string | null) {
  return STONE_PALETTES[stone || "Pinkstone"] || STONE_PALETTES.Pinkstone;
}

export function BlockMiniPreview({ stone, className }: BlockPreviewProps) {
  const pal = paletteFor(stone);

  return (
    <svg className={className} viewBox="0 0 44 34" width="34" height="28" aria-hidden="true">
      <polygon points="8,12 24,4 38,12 22,20" fill={pal.top} stroke="rgba(92,62,32,0.18)" strokeWidth="0.8" />
      <polygon points="8,12 22,20 22,30 8,22" fill={pal.front} stroke="rgba(92,62,32,0.16)" strokeWidth="0.8" />
      <polygon points="22,20 38,12 38,22 22,30" fill={pal.side} stroke="rgba(92,62,32,0.16)" strokeWidth="0.8" />
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
