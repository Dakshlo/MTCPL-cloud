type SlabPreviewProps = {
  stone?: string | null;
  lengthFt?: number | null;
  widthFt?: number | null;
  thicknessFt?: number | null;
  accent?: string | null;
  className?: string;
};

const STONE_PALETTES: Record<string, { top: string; front: string; side: string }> = {
  Makrana: { top: "#EEE8DC", front: "#C8BFB0", side: "#D8D0BE" },
  Pinkstone: { top: "#EDCFC2", front: "#C09282", side: "#D8B4A2" }
};

function paletteFor(stone?: string | null) {
  return STONE_PALETTES[stone || "Pinkstone"] || STONE_PALETTES.Pinkstone;
}

export function SlabSizedPreview({
  stone,
  lengthFt = 2,
  widthFt = 2,
  thicknessFt = 0.5,
  accent,
  className
}: SlabPreviewProps) {
  const pal = paletteFor(stone);
  const border = accent || pal.front;
  const safeLength = Math.max(Number(lengthFt || 1), 0.5);
  const safeWidth = Math.max(Number(widthFt || 1), 0.5);
  const safeThickness = Math.max(Number(thicknessFt || 0.25), 0.15);
  const maxFace = Math.max(safeLength, safeWidth);
  const faceW = 22 + (safeLength / maxFace) * 20;
  const faceH = 12 + (safeWidth / maxFace) * 14;
  const depthX = 5 + safeThickness * 5;
  const depthY = 3 + safeThickness * 3;
  const left = 6;
  const top = 6 + depthY;
  const p1 = `${left},${top}`;
  const p2 = `${left + faceW},${top}`;
  const p3 = `${left + faceW},${top + faceH}`;
  const p4 = `${left},${top + faceH}`;
  const p5 = `${left + depthX},${top - depthY}`;
  const p6 = `${left + faceW + depthX},${top - depthY}`;
  const p7 = `${left + faceW + depthX},${top + faceH - depthY}`;
  const viewW = left + faceW + depthX + 8;
  const viewH = top + faceH + 8;

  return (
    <svg aria-hidden="true" className={className} height="36" viewBox={`0 0 ${viewW} ${viewH}`} width="52">
      <polygon fill={pal.side} points={`${p1} ${p2} ${p6} ${p5}`} stroke={border} strokeWidth="0.8" />
      <polygon fill={pal.top} points={`${p1} ${p2} ${p3} ${p4}`} stroke={border} strokeWidth="1" />
      <polygon fill={pal.front} points={`${p2} ${p6} ${p7} ${p3}`} stroke={border} strokeWidth="0.8" />
    </svg>
  );
}

export function SlabMiniPreview({
  stone,
  accent,
  className
}: {
  stone?: string | null;
  accent?: string | null;
  className?: string;
}) {
  return <SlabSizedPreview accent={accent} className={className} stone={stone} />;
}

export function BlockMiniPreview({
  stone,
  className
}: {
  stone?: string | null;
  className?: string;
}) {
  return <SlabSizedPreview className={className} lengthFt={3} stone={stone} thicknessFt={1.5} widthFt={2.2} />;
}
