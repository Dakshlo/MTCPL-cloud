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
import { POST_CUT_STATUSES } from "@/lib/slab-statuses";
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
    // Match the in-app /block-journey page: lineage credits a block for
    // every slab that came out of it, regardless of where the slab is
    // now in the carving/dispatch pipeline (including rejected as
    // broken). cut_done-only was the MT-B-246 bug.
    admin
      .from("slab_requirements")
      .select("id, length_ft, width_ft, thickness_ft, source_block_id, label, temple, status")
      .not("source_block_id", "is", null)
      .in("status", POST_CUT_STATUSES),
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

  // Apply the same filters the client uses. Sandstone-specific filters
  // (size) only apply to sandstone lineages; marble lineages are
  // unaffected.
  const filtered = lineages.filter((l) => {
    if (stone && l.rootStone !== stone) return false;
    if (facility && l.rootFacility !== facility) return false;
    if (quality && l.rootQuality !== quality) return false;
    if (size && l.category === "sandstone" && l.sizeBucket !== size) return false;
    if (resolution === "resolved" && !l.isResolved) return false;
    if (resolution === "in_progress" && l.isResolved) return false;
    if (dateFrom && l.rootCreatedAt && l.rootCreatedAt < dateFrom) return false;
    if (dateTo && l.rootCreatedAt && l.rootCreatedAt > dateTo + "T23:59:59Z") return false;
    return true;
  });

  // Unified export row shape. Sandstone fields are blank for marble rows
  // and vice versa, so both categories show up in the same sheet.
  const rows = filtered.map((l) => ({
    "Block ID": l.rootId,
    "Category": l.category === "marble" ? "Marble" : "Sandstone",
    "Stone": l.rootStone ?? "",
    "Yard": l.rootYard,
    "Facility": l.rootFacility.toUpperCase(),
    "Quality": l.rootQuality ?? "",
    "Size bucket": l.category === "sandstone" ? l.sizeBucket : "",
    "Added": l.rootCreatedAt
      ? new Date(l.rootCreatedAt).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric" })
      : "",
    // Sandstone columns
    "Original CFT": l.category === "sandstone" ? round(l.originalCft) : "",
    "Slabs CFT": round(l.slabCft),
    "Slab % (Yield)": l.category === "sandstone" ? l.slabPct : "",
    "Live CFT": l.category === "sandstone" ? round(l.liveCft) : "",
    "Live %": l.category === "sandstone" ? l.livePct : "",
    "Waste CFT": l.category === "sandstone" ? round(l.wasteCft) : "",
    "Waste %": l.category === "sandstone" ? l.wastePct : "",
    "Recovered % (Slab + Live)": l.category === "sandstone" ? l.recoveredPct : "",
    // Marble columns
    "Tonnes": l.category === "marble" ? round(l.tonnes) : "",
    "CFT per Tonne": l.category === "marble" ? round(l.cftPerTonne) : "",
    "Truck No.": l.category === "marble" ? (l.truckNo ?? "") : "",
    "Vendor": l.category === "marble" ? (l.vendorName ?? "") : "",
    // Shared
    "Cuts": l.cutCount,
    "Descendants": l.descendantCount,
    "Resolved": l.isResolved ? "Yes" : "No",
    "Last activity": l.lastActivityAt
      ? new Date(l.lastActivityAt).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric" })
      : "",
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
