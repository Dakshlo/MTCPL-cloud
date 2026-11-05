// ──────────────────────────────────────────────────────────────────
// GET /api/carving/raw-export.xlsx
//   ?from=2026-05-01&to=2026-11-02&temple=…&vendor=…&status=…
//
// The flat CNC table — one row per carving job — for the office to
// pivot in Excel themselves (Daksh, Nov 2026). Sibling of
// /api/reports/cnc-monthly.xlsx, which is the SUMMARY of this data;
// this is the raw grain underneath it.
//
// The rows come from lib/carving-raw-export, the workbook from
// lib/carving-raw-workbook — both outside the route so the sheet can
// be generated and opened in a test without going through HTTP.
//
// Auth: the office team — developer / owner / carving_head /
// senior_incharge / tender_manager. NOT the CNC vendors who can reach
// /carving via can_assign_carving: the sheet carries every vendor's
// jobwork rate, and Mohit should not be able to download Manthan's.
// ──────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from "next/server";

import { requireAuth } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { canExportCarvingRaw } from "@/lib/cutting-permissions";
import { buildCarvingRawExport, type CarvingRawFilters } from "@/lib/carving-raw-export";
import { buildCarvingRawWorkbook } from "@/lib/carving-raw-workbook";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * requireAuth() says "go to /login" by THROWING Next's redirect
 * error, so a blanket catch turns an expired session into a 500
 * reading `CNC export failed: NEXT_REDIRECT` instead of a login
 * page. Rethrow anything carrying a Next control-flow digest and
 * let the framework do its job.
 *
 * (The same swallow exists in /api/accounts/vendor-outstanding-export,
 * which this route was modelled on — not touched here.)
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
    console.error("[/api/carving/raw-export.xlsx] crashed", e);
    return NextResponse.json({ error: "CNC export failed: " + msg }, { status: 500 });
  }
}

async function handle(req: NextRequest) {
  const { profile } = await requireAuth();
  if (!canExportCarvingRaw(profile)) {
    return new Response("Forbidden", { status: 403 });
  }

  const sp = req.nextUrl.searchParams;
  const filters: CarvingRawFilters = {
    from: sp.get("from") || undefined,
    to: sp.get("to") || undefined,
    temple: sp.get("temple") || undefined,
    vendor: sp.get("vendor") || undefined,
    status: sp.get("status") || undefined,
  };

  const data = await buildCarvingRawExport(filters);
  const wb = buildCarvingRawWorkbook(data, profile.full_name || profile.role);

  void logAudit(profile.id, "carving_raw_exported", "carving", "raw-export", {
    rows: data.meta.rowCount,
    columns: data.columns.length,
    filters,
  });

  const buf = await wb.xlsx.writeBuffer();
  const stamp = new Date().toISOString().slice(0, 10);
  const name = `cnc-raw-data-${stamp}.xlsx`;

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
