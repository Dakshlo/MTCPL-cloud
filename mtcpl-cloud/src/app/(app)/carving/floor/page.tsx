/**
 * Carving Floor View — every CNC vendor's cockpit on one page.
 *
 * Built for two audiences:
 *   1. Carving head — wants the bird's-eye view of all operators at
 *      once. Default mode = grid; every vendor shown stacked.
 *   2. The owner's TV at home / shop floor display — wants a CCTV-
 *      style auto-rotate. Mode = TV shows ONE vendor at a time
 *      full-screen and advances every 20s.
 *
 * Data computation lives in src/lib/floor-view-data.ts so the
 * Active tab on /carving can embed the same vendor sections without
 * duplicating queries.
 */

import { requireAuth } from "@/lib/auth";
import { buildFloorViewData } from "@/lib/floor-view-data";
import { FloorViewClient } from "./floor-client";

type Search = Promise<{ mode?: "grid" | "tv"; rotate?: string; vendor?: string }>;

export default async function CarvingFloorPage({ searchParams }: { searchParams: Search }) {
  await requireAuth(["developer", "owner", "carving_head", "senior_incharge", "tv"]);
  const params = await searchParams;
  const initialMode: "grid" | "tv" = params.mode === "tv" ? "tv" : "grid";
  // Default 25s — long enough to read a whole operator's board before
  // it swipes to the next (Daksh). ?rotate= query param still overrides.
  const initialRotateSec = Math.max(5, Math.min(120, Number(params.rotate) || 25));

  const floorVendors = await buildFloorViewData();

  return (
    <FloorViewClient
      vendors={floorVendors}
      initialMode={initialMode}
      initialRotateSec={initialRotateSec}
      initialVendorId={params.vendor ?? null}
    />
  );
}
