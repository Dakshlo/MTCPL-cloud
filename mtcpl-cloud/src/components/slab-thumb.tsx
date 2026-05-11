/**
 * Shared 3D-style slab thumbnail.
 *
 * Renders a proportional isometric block sized to the slab's
 * L×W×T dimensions, colour-keyed by stone type. Used on:
 *   - Carving page Active / Awaiting Review / Done cards
 *   - Vendor cockpit machine cards + queue rows
 *   - Slab transfer dispatch list rows
 *
 * Stays in /components/ (not inside /carving/) because the vendor
 * cockpit, transfer page, etc. all need to import it without
 * pulling the whole carving dashboard module.
 */

import { IsoBlockStaticSVG } from "./iso-block-static";
import type { StoneTypeDef } from "@/lib/stone-utils";

export function SlabThumb({
  stone,
  l,
  w,
  t,
  stoneTypes,
  size = 90,
  height = 80,
}: {
  stone: string | null;
  l: number;
  w: number;
  t: number;
  stoneTypes: StoneTypeDef[];
  /** SVG width passed to IsoBlockStaticSVG. Defaults to 90. */
  size?: number;
  /** Outer container height. Defaults to 80. */
  height?: number;
}) {
  if (!l || !w || !t) {
    return (
      <div
        style={{
          height,
          background: "var(--surface-alt)",
          borderRadius: 6,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--muted-light)",
          fontSize: 11,
        }}
      >
        no dimensions
      </div>
    );
  }
  return (
    <div
      style={{
        height,
        background: "var(--surface-alt)",
        borderRadius: 6,
        padding: 4,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div style={{ width: size, maxHeight: height - 8, display: "flex" }}>
        <IsoBlockStaticSVG
          block={{ l, w, h: t, stone: stone ?? "" }}
          placed={[]}
          size={size}
          stoneTypes={stoneTypes}
        />
      </div>
    </div>
  );
}
