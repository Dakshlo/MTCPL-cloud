"use client";

/**
 * PrimarySlabPreview — rotatable 3D isometric view for a single primary slab.
 * Thin client wrapper around IsoBlockPreview (from planning-workbench) so the
 * cutter can drag to rotate / scroll to zoom just like the block-level preview.
 */

import { IsoBlockPreview } from "@/components/planning-workbench";
import type { StoneTypeDef } from "@/lib/stone-utils";

type Slab = {
  id: string;
  label?: string;
  temple?: string;
  sw: number;
  sh: number;
  sd?: number;
  px?: number;
  py?: number;
  pw?: number;
  ph?: number;
  rot?: boolean;
  zTop?: number;
  zBot?: number;
};

type Block = { l: number; w: number; h: number; stone: string };

export function PrimarySlabPreview({
  block,
  placed,
  stoneTypes,
}: {
  block: Block;
  placed: Slab[];
  stoneTypes?: StoneTypeDef[];
}) {
  // Normalise to the PlacedSlab shape IsoBlockPreview expects
  const normalised = placed.map((s) => ({
    id: s.id,
    label: s.label ?? "",
    temple: s.temple ?? "",
    sw: s.sw,
    sh: s.sh,
    sd: s.sd ?? 0,
    px: s.px ?? 0,
    py: s.py ?? 0,
    pw: s.pw ?? 0,
    ph: s.ph ?? 0,
    aw: s.pw ?? 0,
    ah: s.ph ?? 0,
    rot: s.rot ?? false,
    zTop: s.zTop,
    zBot: s.zBot,
  }));

  const blk = {
    id: "primary-slab",
    stone: block.stone,
    yard: 1,
    l: block.l,
    w: block.w,
    h: block.h,
  };

  return (
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    <IsoBlockPreview block={blk} placed={normalised as any} stoneTypes={stoneTypes} />
  );
}
