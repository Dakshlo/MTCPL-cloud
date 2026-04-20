/**
 * Excel export for the Block Journey report.
 *
 * Auth-gated the same way as the page (owner/developer). Reapplies the
 * same filters the page supports and streams an xlsx.
 *
 * Query params:
 *   mode        = "yield" | "recovered"    (affects only the file label)
 *   stone       = stone name
 *   facility    = "mtcpl" | "riico"
 *   quality     = "A" | "B"
 *   size        = "small" | "medium" | "large"
 *   resolution  = "resolved" | "in_progress"
 *   date_from   = ISO date
 *   date_to     = ISO date
 */

import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import {
  buildLineages,
  type BjBlockRow,
  type BjSlabRow,
  type BjCsbRow,
} from "@/app/(app)/block-journey/build-lineages";

export async function GET(req: NextRequest) {
  try {
    await requireAuth(["owner", "developer"]);
  } catch {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const { searchParams } = req.nextUrl;
  const mode = searchParams.get("mode") === "recovered" ? "recovered" : "yield";
  const stone = searchParams.get("stone") || "";
  const facility = searchParams.get("facility") || "";
  const quality = searchParams.get("quality") || "";
  const size = searchParams.get("size") || "";
  const resolution = searchParams.get("resolution") || "";
  const dateFrom = searchParams.get("date_from") || "";
  const dateTo = searchParams.get("date_to") || "";

  const admin = createAdminSupabaseClient();

  const [freshR, reusedR, cutDoneR, doneCsbR] = await Promise.all([
    admin
      .from("blocks")
      .select(
        "id, stone, yard, quality, category, length_ft, width_ft, height_ft, status, created_at, created_by",
      )
      .eq("category", "Fresh"),
    admin
      .from("blocks")
      .select(
        "id, stone, yard, quality, category, length_ft, width_ft, height_ft, status, created_at, created_by",
      )
      .eq("category", "Reused"),
    admin
      .from("slab_requirements")
      .select("id, length_ft, width_ft, thickness_ft, source_block_id, label, temple, status")
      .not("source_block_id", "is", null)
      .eq("status", "cut_done"),
    admin
      .from("cut_session_blocks")
      .select("block_id, status")
      .eq("status", "done"),
  ]);

  const lineages = buildLineages(
    (freshR.data ?? []) as BjBlockRow[],
    (reusedR.data ?? []) as BjBlockRow[],
    (cutDoneR.data ?? []) as BjSlabRow[],
    (doneCsbR.data ?? []) as BjCsbRow[],
  );

  // Apply the same filters the client uses
  const filtered = lineages.filter((l) => {
    if (stone && l.rootStone !== stone) return false;
    if (facility && l.rootFacility !== facility) return false;
    if (quality && l.rootQuality !== quality) return false;
    if (size && l.sizeBucket !== size) return false;
    if (resolution === "resolved" && !l.isResolved) return false;
    if (resolution === "in_progress" && l.isResolved) return false;
    if (dateFrom && l.rootCreatedAt && l.rootCreatedAt < dateFrom) return false;
    if (dateTo && l.rootCreatedAt && l.rootCreatedAt > dateTo + "T23:59:59Z") return false;
    return true;
  });

  const rows = filtered.map((l) => ({
    "Block ID": l.rootId,
    "Stone": l.rootStone ?? "",
    "Yard": l.rootYard,
    "Facility": l.rootFacility.toUpperCase(),
    "Quality": l.rootQuality ?? "",
    "Size bucket": l.sizeBucket,
    "Added": l.rootCreatedAt ? new Date(l.rootCreatedAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "",
    "Original CFT": round(l.originalCft),
    "Slabs CFT": round(l.slabCft),
    "Slab % (Yield)": l.slabPct,
    "Live CFT": round(l.liveCft),
    "Live %": l.livePct,
    "Waste CFT": round(l.wasteCft),
    "Waste %": l.wastePct,
    "Recovered % (Slab + Live)": l.recoveredPct,
    "Cuts": l.cutCount,
    "Descendants": l.descendantCount,
    "Resolved": l.isResolved ? "Yes" : "No",
    "Last activity": l.lastActivityAt ? new Date(l.lastActivityAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "",
  }));

  const ws = XLSX.utils.json_to_sheet(rows);
  ws["!cols"] = [
    { wch: 12 }, { wch: 12 }, { wch: 6 }, { wch: 8 }, { wch: 8 }, { wch: 10 },
    { wch: 14 }, { wch: 12 }, { wch: 12 }, { wch: 14 }, { wch: 10 }, { wch: 8 },
    { wch: 10 }, { wch: 8 }, { wch: 22 }, { wch: 6 }, { wch: 12 }, { wch: 10 },
    { wch: 14 },
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, `Block Journey (${mode})`);

  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  const filename = `block-journey-${mode}-${new Date().toISOString().slice(0, 10)}.xlsx`;

  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
