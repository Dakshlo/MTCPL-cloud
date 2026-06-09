// ──────────────────────────────────────────────────────────────────
// /api/accounts/vendor-outstanding-export — vendor-wise outstanding .xlsx
// ──────────────────────────────────────────────────────────────────
// Audit export for Finance → Reconcile. One row per vendor with their
// current GRAND outstanding (plus billed / paid / held / open-bill
// count), ordered highest-first, with a TOTAL row — for cross-checking
// against external books (Tally).
//
// Auth: same audience as the Reconcile page — developer / owner /
// accountant_star.
//
// Source data is identical to the Reconcile page query (approved,
// non-cancelled bills with amount_outstanding > 0) so the exported
// totals tie out exactly to what's on screen. Read-only — writes
// nothing except an audit-log event.
//
// Styled with ExcelJS in the Node runtime: header band, zebra-striped
// rows for easy scanning, Indian (lakh) number format, highlighted
// total. (The repo's xlsx-js-style fork trips a Turbopack bundling bug
// and plain `xlsx` strips cell colours on write — see
// /api/slabs/import-template for the same approach.)

import { NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function round2(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function thin(argb: string) {
  const side = { style: "thin" as const, color: { argb } };
  return { top: side, bottom: side, left: side, right: side };
}

export async function GET() {
  try {
    return await handleExport();
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    console.error("[/api/accounts/vendor-outstanding-export] crashed", e);
    return NextResponse.json(
      { error: "Vendor outstanding export failed: " + msg },
      { status: 500 },
    );
  }
}

async function handleExport() {
  const { profile } = await requireAuth();
  // Mirror the Reconcile page audience exactly.
  const allowed =
    profile.role === "developer" ||
    profile.role === "owner" ||
    profile.role === "accountant_star";
  if (!allowed) {
    return NextResponse.json(
      { error: "Only developer / owner / accountant★ can export this." },
      { status: 403 },
    );
  }

  const admin = createAdminSupabaseClient();

  // Same filter the Reconcile page uses for its source set.
  const { data: billRows, error } = await admin
    .from("bills")
    .select(
      "amount_total, amount_paid, amount_outstanding, held_amount, bill_vendor_id, bill_vendors(id, name, nickname, category)",
    )
    .gt("amount_outstanding", 0)
    .eq("status", "approved")
    .is("cancelled_at", null)
    .limit(5000);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  type Vendor = { id: string; name: string; nickname: string | null; category: string | null };
  type Raw = {
    amount_total: number | string;
    amount_paid: number | string;
    amount_outstanding: number | string;
    held_amount: number | string | null;
    bill_vendor_id: string;
    bill_vendors: Vendor | Vendor[] | null;
  };

  type Agg = {
    name: string;
    nickname: string;
    category: string;
    count: number;
    billed: number;
    paid: number;
    held: number;
    outstanding: number;
  };
  const byVendor = new Map<string, Agg>();

  for (const r of (billRows ?? []) as Raw[]) {
    const v = Array.isArray(r.bill_vendors) ? r.bill_vendors[0] ?? null : r.bill_vendors;
    const key = r.bill_vendor_id || v?.id || "unknown";
    const cur =
      byVendor.get(key) ??
      {
        name: v?.name ?? "—",
        nickname: v?.nickname ?? "",
        category: v?.category ?? "",
        count: 0,
        billed: 0,
        paid: 0,
        held: 0,
        outstanding: 0,
      };
    cur.count += 1;
    cur.billed += Number(r.amount_total ?? 0);
    cur.paid += Number(r.amount_paid ?? 0);
    cur.held += Number(r.held_amount ?? 0);
    cur.outstanding += Number(r.amount_outstanding ?? 0);
    byVendor.set(key, cur);
  }

  // Highest outstanding first — the order an auditor wants to scan.
  const rows = [...byVendor.values()].sort((a, b) => b.outstanding - a.outstanding);

  const totals = rows.reduce(
    (s, r) => {
      s.count += r.count;
      s.billed += r.billed;
      s.paid += r.paid;
      s.held += r.held;
      s.outstanding += r.outstanding;
      return s;
    },
    { count: 0, billed: 0, paid: 0, held: 0, outstanding: 0 },
  );

  // IST wall-clock date for the title + filename (UTC + 5:30). Direct
  // offset math — toLocaleString has crashed on Vercel's ICU build.
  const ist = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
  const yyyy = ist.getUTCFullYear();
  const mm = String(ist.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(ist.getUTCDate()).padStart(2, "0");

  // ── Build the styled workbook ────────────────────────────────────
  const NCOLS = 9;
  const INR_FMT = "#,##,##0.00"; // Indian lakh grouping, 2 decimals
  // Column alignment by index (1-based): 1=# center, 2-4 text left,
  // 5 Open Bills center, 6-9 money right.
  const alignFor = (col: number): "left" | "center" | "right" =>
    col === 1 || col === 5 ? "center" : col >= 6 ? "right" : "left";

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Vendor Outstanding");
  ws.columns = [
    { width: 5 }, // #
    { width: 34 }, // Vendor
    { width: 16 }, // Nickname
    { width: 16 }, // Category
    { width: 11 }, // Open Bills
    { width: 18 }, // Total Billed
    { width: 18 }, // Total Paid
    { width: 14 }, // Held
    { width: 20 }, // Outstanding
  ];

  // Row 1 — title (merged across all columns).
  ws.addRow(["MATESHWARI TEMPLE CONSTRUCTION PVT LTD — Vendor Outstanding"]);
  ws.mergeCells(1, 1, 1, NCOLS);
  const titleCell = ws.getCell(1, 1);
  titleCell.font = { name: "Calibri", size: 15, bold: true, color: { argb: "FF1F3A5F" } };
  titleCell.alignment = { horizontal: "left", vertical: "middle" };
  ws.getRow(1).height = 26;

  // Row 2 — subtitle (merged).
  ws.addRow([`As on ${dd}-${mm}-${yyyy} (IST)  ·  ${rows.length} vendors`]);
  ws.mergeCells(2, 1, 2, NCOLS);
  const subCell = ws.getCell(2, 1);
  subCell.font = { name: "Calibri", size: 11, italic: true, color: { argb: "FF6B7280" } };
  subCell.alignment = { horizontal: "left", vertical: "middle" };
  ws.getRow(2).height = 18;

  // Row 3 — spacer.
  ws.addRow([]);

  // Row 4 — header band (dark slate-blue, white bold).
  const HEADER_ROW = 4;
  const header = [
    "#",
    "Vendor",
    "Nickname",
    "Category",
    "Open Bills",
    "Total Billed (₹)",
    "Total Paid (₹)",
    "Held (₹)",
    "Outstanding (₹)",
  ];
  const headerRow = ws.addRow(header);
  headerRow.height = 24;
  headerRow.eachCell((c, col) => {
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F3A5F" } };
    c.font = { name: "Calibri", size: 11, bold: true, color: { argb: "FFFFFFFF" } };
    c.alignment = { horizontal: alignFor(col), vertical: "middle", wrapText: true };
    c.border = thin("FF14283F");
  });

  // Data rows — zebra striped for easy scanning.
  rows.forEach((r, i) => {
    const row = ws.addRow([
      i + 1,
      r.name,
      r.nickname || "",
      r.category || "",
      r.count,
      round2(r.billed),
      round2(r.paid),
      round2(r.held),
      round2(r.outstanding),
    ]);
    row.height = 17;
    const stripe = i % 2 === 0 ? "FFFFFFFF" : "FFEFF4FB"; // white / light blue
    row.eachCell((c, col) => {
      c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: stripe } };
      c.font = {
        name: "Calibri",
        size: 11,
        // The Outstanding column is the headline number — bold + red.
        bold: col === NCOLS,
        color: { argb: col === NCOLS ? "FFB91C1C" : "FF1F2937" },
      };
      c.alignment = { horizontal: alignFor(col), vertical: "middle" };
      c.border = thin("FFD7E2F0");
      if (col >= 6) c.numFmt = INR_FMT;
    });
  });

  // Spacer + TOTAL row (gold band, bold, thicker top border).
  ws.addRow([]);
  const totalRow = ws.addRow([
    "",
    "TOTAL",
    "",
    "",
    totals.count,
    round2(totals.billed),
    round2(totals.paid),
    round2(totals.held),
    round2(totals.outstanding),
  ]);
  totalRow.height = 22;
  totalRow.eachCell((c, col) => {
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFCE8B2" } };
    c.font = { name: "Calibri", size: 12, bold: true, color: { argb: "FF6B4E0F" } };
    c.alignment = { horizontal: alignFor(col), vertical: "middle" };
    c.border = {
      top: { style: "medium", color: { argb: "FFB8860B" } },
      bottom: { style: "medium", color: { argb: "FFB8860B" } },
      left: { style: "thin", color: { argb: "FFE7C77A" } },
      right: { style: "thin", color: { argb: "FFE7C77A" } },
    };
    if (col >= 6) c.numFmt = INR_FMT;
  });

  // Freeze everything down to the header so it stays visible on scroll,
  // and turn on an auto-filter over the data columns.
  ws.views = [{ state: "frozen", ySplit: HEADER_ROW }];
  ws.autoFilter = {
    from: { row: HEADER_ROW, column: 1 },
    to: { row: HEADER_ROW, column: NCOLS },
  };

  const out = await wb.xlsx.writeBuffer();
  const body = out instanceof Uint8Array ? out : new Uint8Array(out as ArrayBuffer);

  void logAudit(profile.id, "vendor_outstanding_exported", "report", `vendors_${rows.length}`, {
    vendor_count: rows.length,
    grand_outstanding: round2(totals.outstanding),
    as_on: `${yyyy}-${mm}-${dd}`,
  });

  const filename = `MTCPL-Vendor-Outstanding-${yyyy}-${mm}-${dd}.xlsx`;
  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store, must-revalidate",
    },
  });
}
