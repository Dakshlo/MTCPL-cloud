// ──────────────────────────────────────────────────────────────────
// GET /api/dispatch/raw-export.xlsx
//   ?from=2026-04-01&to=2026-11-06&temple=…&stage=delivered
//
// The flat dispatch table — one row per slab per trip — for the office
// to pivot in Excel themselves (Daksh, Nov 2026: "that excel export we
// made for cnc, likewise we want excel export feature for dispatch
// module too"). Sibling of /api/carving/raw-export.xlsx and built the
// same way, on purpose: one sheet shape to learn, not two.
//
// The rows come from lib/dispatch-raw-export, the workbook from
// lib/dispatch-raw-workbook — both outside the route so the sheet can
// be generated and opened in a test without going through HTTP.
//
// Auth: everyone who can open /dispatch, the dispatch incharge
// included. The CNC sheet excludes the vendors because it carries
// their jobwork rates; this one carries no money at all.
// ──────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from "next/server";

import { requireAuth } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { canExportDispatchRaw } from "@/lib/cutting-permissions";
import { buildDispatchRawExport, type DispatchRawFilters } from "@/lib/dispatch-raw-export";
import { buildDispatchRawWorkbook } from "@/lib/dispatch-raw-workbook";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * requireAuth() says "go to /login" by THROWING Next's redirect error,
 * so a blanket catch turns an expired session into a 500 reading
 * `Dispatch export failed: NEXT_REDIRECT` instead of a login page.
 * Rethrow anything carrying a Next control-flow digest and let the
 * framework do its job. (This caught us once on the CNC export.)
 */
function isNextControlFlow(e: unknown): boolean {
  const digest = (e as { digest?: unknown } | null)?.digest;
  return (
    typeof digest === "string" &&
    (digest.startsWith("NEXT_REDIRECT") || digest === "NEXT_NOT_FOUND")
  );
}

export async function GET(req: NextRequest) {
  try {
    return await handle(req);
  } catch (e) {
    if (isNextControlFlow(e)) throw e;
    const msg = e instanceof Error ? e.message : "Unknown error";
    console.error("[/api/dispatch/raw-export.xlsx] crashed", e);
    return NextResponse.json({ error: "Dispatch export failed: " + msg }, { status: 500 });
  }
}

async function handle(req: NextRequest) {
  const { profile } = await requireAuth();
  if (!canExportDispatchRaw(profile)) {
    return new Response("Forbidden", { status: 403 });
  }

  const sp = req.nextUrl.searchParams;
  const filters: DispatchRawFilters = {
    from: sp.get("from") || undefined,
    to: sp.get("to") || undefined,
    temple: sp.get("temple") || undefined,
    stage: sp.get("stage") || undefined,
  };

  const data = await buildDispatchRawExport(filters);
  const wb = buildDispatchRawWorkbook(data, profile.full_name || profile.role);

  await logAudit(profile.id, "dispatch_raw_exported", "dispatch", "raw-export", {
    rows: data.meta.rowCount,
    trips: data.meta.tripCount,
    columns: data.columns.length,
    filters,
  });

  const buf = await wb.xlsx.writeBuffer();
  const stamp = new Date().toISOString().slice(0, 10);
  const name = `dispatch-raw-data-${stamp}.xlsx`;

  return new Response(buf as ArrayBuffer, {
    status: 200,
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "no-store",
    },
  });
}
