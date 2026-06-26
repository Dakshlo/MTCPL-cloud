/**
 * GET /api/reports/dpr.xlsx?view=daily|weekly|monthly|yearly&date=…
 *
 * Downloadable Production DPR workbook — a Summary tab (stage totals)
 * plus one tab per stage, itemised by code with Qty + CFT. Same data
 * as the /reports/dpr screen (both call buildProductionDpr).
 *
 * Uses the stock `xlsx` package (Node-only; see serverExternalPackages
 * in next.config.ts). exceljs is deliberately avoided here — it has a
 * sheetPr/pageSetup corruption gotcha that breaks the workbook.
 */

import { NextRequest } from "next/server";
import * as XLSX from "xlsx";

import { requireAuth } from "@/lib/auth";
import { cutterPeriodFromSearch } from "@/lib/cutter-cost-report";
import { buildProductionDpr } from "@/lib/production-dpr";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Excel sheet names: ≤31 chars, none of  : \ / ? * [ ] . */
function safeSheetName(name: string, used: Set<string>): string {
  let s = name.replace(/[:\\/?*[\]]/g, " ").trim().slice(0, 28);
  let candidate = s || "Stage";
  let i = 2;
  while (used.has(candidate.toLowerCase())) {
    candidate = `${s.slice(0, 25)} ${i}`;
    i += 1;
  }
  used.add(candidate.toLowerCase());
  return candidate;
}

export async function GET(req: NextRequest) {
  const { profile } = await requireAuth();
  if (!["owner", "developer"].includes(profile.role)) {
    return new Response("Forbidden", { status: 403 });
  }

  const sp = Object.fromEntries(req.nextUrl.searchParams) as Record<string, string>;
  const period = cutterPeriodFromSearch(sp);
  const report = await buildProductionDpr(period);

  const wb = XLSX.utils.book_new();
  const used = new Set<string>();

  // ── Summary sheet ──────────────────────────────────────────────
  const summaryAoa: (string | number)[][] = [
    [`Production DPR — ${report.period.label}`],
    [`Generated ${new Date(report.generatedAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}`],
    [],
    ["Stage", "Type", "Qty", "CFT"],
    ...report.stages.map((s) => [
      s.label,
      s.kind === "block" ? "blocks" : "slabs",
      s.totalQty,
      round2(s.totalCft),
    ]),
  ];
  const summary = XLSX.utils.aoa_to_sheet(summaryAoa);
  summary["!cols"] = [{ wch: 30 }, { wch: 10 }, { wch: 10 }, { wch: 12 }];
  XLSX.utils.book_append_sheet(wb, summary, safeSheetName("Summary", used));

  // ── One sheet per stage, code-wise ─────────────────────────────
  for (const s of report.stages) {
    const codeHeader = s.kind === "block" ? "Block code" : "Slab code";
    const aoa: (string | number)[][] = [
      [s.label],
      ...(s.note ? [[s.note]] : []),
      [],
      ["#", codeHeader, "Detail", "Qty", "CFT"],
      ...s.items.map((it, i) => [i + 1, it.code, it.meta ?? "", it.qty, round2(it.cft)]),
      [],
      ["", "Total", "", s.totalQty, round2(s.totalCft)],
    ];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws["!cols"] = [{ wch: 6 }, { wch: 22 }, { wch: 20 }, { wch: 8 }, { wch: 12 }];
    XLSX.utils.book_append_sheet(wb, ws, safeSheetName(s.label, used));
  }

  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  const fname = `DPR-${period.kind}-${period.startDate}.xlsx`;

  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${fname}"`,
      "Cache-Control": "no-store",
    },
  });
}
