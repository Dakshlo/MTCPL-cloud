/**
 * Migration 055 — per-party Excel export.
 * Migration 056 follow-on — proper styled workbook via exceljs
 * (Daksh: "the excel is boring, use color in heading, show
 * invoice detail like on portal, put related sections in boxes").
 *
 * GET /api/personal-ledger/[partyId]/export.xlsx
 *
 * Three sheets:
 *   1. Summary   — portal-style overview: invoices block + receipts
 *                  block + per-bucket box + outstanding callout
 *   2. Invoices  — every invoice header row + nested line-items +
 *                  footer subtotal row (full detail for the
 *                  accountant view)
 *   3. Receipts  — flat list + per-bucket subtotals + total
 *
 * Library: exceljs. Switched off the stock `xlsx` package — its
 * community build doesn't write cell styles, so the previous Excel
 * was unstyled. xlsx-js-style (the styled fork) hit a Turbopack
 * bundling bug on Vercel. exceljs is the maintained alternative
 * with proper style support and no bundling quirks.
 */

import { NextResponse, type NextRequest } from "next/server";
import ExcelJS from "exceljs";
import { cookies } from "next/headers";
import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { canUsePersonalLedger } from "@/lib/personal-ledger-permissions";
import {
  unlockCookieName,
  verifyUnlockToken,
} from "@/lib/personal-ledger-party-auth";
import { logAudit } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ partyId: string }> };

type InvoiceItem = {
  description?: string;
  stone_type?: string;
  unit?: string;
  quantity?: number | string;
  rate?: number | string;
  line_total?: number | string;
};

type InvoiceRowDb = {
  id: string;
  invoice_no: string;
  invoice_date: string;
  items_json: unknown;
  subtotal: number | string;
  gst_amount: number | string;
  total: number | string;
  notes: string | null;
  created_at: string;
};

type ReceiptRowDb = {
  id: string;
  amount: number | string;
  receipt_date: string;
  note: string | null;
  created_at: string;
  bucket_id: string;
};

// ── Palette (matches the on-portal Summary card) ──────────────────
const COLOR = {
  // Tile colours
  accent: "FF4F46E5",        // indigo
  accentLight: "FFE0E7FF",
  accentTint: "FFEEF2FF",
  success: "FF15803D",       // emerald
  successLight: "FFD1FAE5",
  successTint: "FFECFDF5",
  warning: "FFB45309",       // amber
  warningLight: "FFFEF3C7",
  warningTint: "FFFFFBEB",
  danger: "FFB91C1C",
  // Bucket pills
  bucketB_bg: "FFDBEAFE",
  bucketB_fg: "FF1D4ED8",
  bucketC_bg: "FFE2E8F0",
  bucketC_fg: "FF475569",
  bucketOther_bg: "FFDCFCE7",
  bucketOther_fg: "FF15803D",
  // Neutrals
  border: "FFE2E8F0",
  borderStrong: "FFCBD5E1",
  surfaceMuted: "FFF8FAFC",
  textMuted: "FF64748B",
  text: "FF0F172A",
  white: "FFFFFFFF",
} as const;

function bucketColors(label: string): { bg: string; fg: string } {
  const u = label.trim().toUpperCase();
  if (u === "B") return { bg: COLOR.bucketB_bg, fg: COLOR.bucketB_fg };
  if (u === "C") return { bg: COLOR.bucketC_bg, fg: COLOR.bucketC_fg };
  return { bg: COLOR.bucketOther_bg, fg: COLOR.bucketOther_fg };
}

function todayIso(): string {
  const t = Date.now() + 5.5 * 60 * 60 * 1000;
  const d = new Date(t);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

function slugify(name: string): string {
  const cleaned = name
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return cleaned || "Party";
}

function invoiceUnitOf(items: InvoiceItem[]): string {
  if (items.length === 0) return "—";
  const seen = new Set(items.map((it) => String(it.unit ?? "").toUpperCase()));
  seen.delete("");
  if (seen.size === 0) return "—";
  if (seen.size === 1) return Array.from(seen)[0];
  return "MIX";
}

// ── Style helpers ────────────────────────────────────────────────
function fill(argb: string): ExcelJS.FillPattern {
  return { type: "pattern", pattern: "solid", fgColor: { argb } };
}

function thinBorder(argb: string = COLOR.border): ExcelJS.Borders {
  const s: ExcelJS.Border = { style: "thin", color: { argb } };
  return { top: s, left: s, right: s, bottom: s } as ExcelJS.Borders;
}

function setRowStyle(
  row: ExcelJS.Row,
  opts: {
    fontColor?: string;
    bold?: boolean;
    size?: number;
    fillColor?: string;
    border?: string;
    height?: number;
    italic?: boolean;
  },
) {
  if (opts.height) row.height = opts.height;
  row.eachCell({ includeEmpty: true }, (cell) => {
    cell.font = {
      ...(cell.font ?? {}),
      bold: opts.bold ?? cell.font?.bold ?? false,
      italic: opts.italic ?? cell.font?.italic ?? false,
      size: opts.size ?? cell.font?.size ?? 11,
      color: opts.fontColor ? { argb: opts.fontColor } : cell.font?.color,
      name: "Calibri",
    };
    if (opts.fillColor) cell.fill = fill(opts.fillColor);
    if (opts.border) cell.border = thinBorder(opts.border);
  });
}

// ── Route ────────────────────────────────────────────────────────
export async function GET(req: NextRequest, ctx: RouteContext) {
  try {
    return await handleExport(req, ctx);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    console.error("[/api/personal-ledger/export.xlsx] crashed", e);
    return NextResponse.json(
      { error: "Personal-ledger export failed: " + msg },
      { status: 500 },
    );
  }
}

async function handleExport(_req: NextRequest, ctx: RouteContext) {
  const { profile } = await requireAuth();
  if (!canUsePersonalLedger(profile)) {
    return NextResponse.json(
      { error: "Personal ledger access denied." },
      { status: 403 },
    );
  }

  const { partyId } = await ctx.params;
  if (!partyId) {
    return NextResponse.json({ error: "Missing party id." }, { status: 400 });
  }

  // Mig 056 — gate on the PIN-unlock cookie. If the user is not
  // currently unlocked for this party we refuse the export.
  const cookieStore = await cookies();
  const unlockToken = cookieStore.get(unlockCookieName(partyId))?.value;
  if (!verifyUnlockToken(unlockToken, profile.id, partyId)) {
    return NextResponse.json(
      { error: "Party locked. Unlock the party first, then re-download." },
      { status: 403 },
    );
  }

  const supabase = createAdminSupabaseClient();

  const [
    { data: party },
    { data: bucketsRaw },
    { data: invoicesRaw },
    { data: receiptsRaw },
  ] = await Promise.all([
    supabase
      .from("personal_ledger_parties")
      .select("id, name")
      .eq("id", partyId)
      .eq("owner_profile_id", profile.id)
      .maybeSingle(),
    supabase
      .from("personal_ledger_buckets")
      .select("id, label")
      .eq("owner_profile_id", profile.id),
    supabase
      .from("personal_ledger_invoices")
      .select("id, invoice_no, invoice_date, items_json, subtotal, gst_amount, total, notes, created_at")
      .eq("party_id", partyId)
      .eq("owner_profile_id", profile.id)
      .is("cancelled_at", null)
      .order("invoice_date", { ascending: true }),
    supabase
      .from("personal_ledger_receipts")
      .select("id, amount, receipt_date, note, created_at, bucket_id")
      .eq("party_id", partyId)
      .eq("owner_profile_id", profile.id)
      .is("cancelled_at", null)
      .order("receipt_date", { ascending: true }),
  ]);

  if (!party) {
    return NextResponse.json(
      { error: "Party not found or not yours." },
      { status: 404 },
    );
  }

  const partyName = (party as { name: string }).name;
  const invoices = (invoicesRaw ?? []) as InvoiceRowDb[];
  const receipts = (receiptsRaw ?? []) as ReceiptRowDb[];
  const bucketLabelById = new Map<string, string>();
  for (const b of (bucketsRaw ?? []) as Array<{ id: string; label: string }>) {
    bucketLabelById.set(b.id, b.label);
  }

  // Aggregates
  let invoicedSubtotal = 0;
  let invoicedTax = 0;
  let invoicedTotal = 0;
  for (const inv of invoices) {
    invoicedSubtotal += Number(inv.subtotal ?? 0);
    invoicedTax += Number(inv.gst_amount ?? 0);
    invoicedTotal += Number(inv.total ?? 0);
  }
  const receivedTotal = receipts.reduce((s, r) => s + Number(r.amount ?? 0), 0);
  const outstanding = invoicedTotal - receivedTotal;

  const byBucket = new Map<string, number>();
  for (const r of receipts) {
    const label = bucketLabelById.get(r.bucket_id) ?? "—";
    byBucket.set(label, (byBucket.get(label) ?? 0) + Number(r.amount ?? 0));
  }

  // ── Workbook ───────────────────────────────────────────────────
  const wb = new ExcelJS.Workbook();
  wb.creator = "MTCPL Personal Ledger";
  wb.created = new Date();
  wb.modified = new Date();

  buildSummarySheet(wb, {
    partyName,
    invoices,
    receipts,
    bucketLabelById,
    invoicedSubtotal,
    invoicedTax,
    invoicedTotal,
    receivedTotal,
    outstanding,
    byBucket,
  });

  buildInvoicesSheet(wb, {
    invoices,
    invoicedSubtotal,
    invoicedTax,
    invoicedTotal,
  });

  buildReceiptsSheet(wb, {
    receipts,
    bucketLabelById,
    byBucket,
    receivedTotal,
    outstanding,
  });

  const buf = await wb.xlsx.writeBuffer();
  const filename = `Personal_Ledger_${slugify(partyName)}_${todayIso()}.xlsx`;

  void logAudit(
    profile.id,
    "personal_ledger_export_xlsx",
    "personal_ledger_party",
    partyId,
    {
      party_name: partyName,
      invoice_count: invoices.length,
      receipt_count: receipts.length,
      invoiced_total: invoicedTotal,
      received_total: receivedTotal,
    },
  );

  return new NextResponse(buf as unknown as BodyInit, {
    status: 200,
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}

// ────────────────────────────────────────────────────────────────
// Sheet 1: Summary — portal-style overview
// ────────────────────────────────────────────────────────────────

function buildSummarySheet(
  wb: ExcelJS.Workbook,
  d: {
    partyName: string;
    invoices: InvoiceRowDb[];
    receipts: ReceiptRowDb[];
    bucketLabelById: Map<string, string>;
    invoicedSubtotal: number;
    invoicedTax: number;
    invoicedTotal: number;
    receivedTotal: number;
    outstanding: number;
    byBucket: Map<string, number>;
  },
) {
  const ws = wb.addWorksheet("Summary", {
    properties: { defaultRowHeight: 18 },
    views: [{ showGridLines: false }],
  });

  // Column widths — table needs 6 cols max (Invoices: Date · # · Unit · Net · Tax · Total)
  ws.columns = [
    { width: 16 }, // A
    { width: 24 }, // B
    { width: 12 }, // C
    { width: 16 }, // D
    { width: 14 }, // E
    { width: 18 }, // F
  ];

  let r = 1;

  // ── Title band ────────────────────────────────────────────────
  ws.mergeCells(r, 1, r, 6);
  const title = ws.getCell(r, 1);
  title.value = `📓  ${d.partyName} · Personal Ledger`;
  title.font = { name: "Calibri", size: 18, bold: true, color: { argb: COLOR.white } };
  title.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
  title.fill = fill(COLOR.accent);
  ws.getRow(r).height = 36;
  r++;

  // Sub-title strip
  ws.mergeCells(r, 1, r, 6);
  const sub = ws.getCell(r, 1);
  sub.value = `Exported ${todayIso()} (IST) · NOT company books`;
  sub.font = { name: "Calibri", size: 11, italic: true, color: { argb: COLOR.white } };
  sub.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
  sub.fill = fill("FF6366F1"); // slightly lighter indigo
  ws.getRow(r).height = 22;
  r++;

  r++; // gap

  // ── INVOICES section ──────────────────────────────────────────
  r = drawSectionHeader(ws, r, "INVOICES", "📄", COLOR.accent, COLOR.accentTint);

  // Column headers
  const invHeader = ws.getRow(r);
  invHeader.values = ["Date", "Invoice #", "Unit", "Net (₹)", "Tax (₹)", "Total (₹)"];
  setRowStyle(invHeader, {
    bold: true,
    size: 10,
    fontColor: COLOR.textMuted,
    fillColor: COLOR.surfaceMuted,
    border: COLOR.border,
  });
  invHeader.alignment = { vertical: "middle" };
  ws.getCell(r, 3).alignment = { horizontal: "center", vertical: "middle" };
  ws.getCell(r, 4).alignment = { horizontal: "right", vertical: "middle" };
  ws.getCell(r, 5).alignment = { horizontal: "right", vertical: "middle" };
  ws.getCell(r, 6).alignment = { horizontal: "right", vertical: "middle" };
  r++;

  // Invoice rows (one per invoice — like the portal Summary, not the line items)
  if (d.invoices.length === 0) {
    ws.mergeCells(r, 1, r, 6);
    const empty = ws.getCell(r, 1);
    empty.value = "No invoices.";
    empty.font = { italic: true, color: { argb: COLOR.textMuted } };
    empty.alignment = { horizontal: "center", vertical: "middle" };
    setRowStyle(ws.getRow(r), { border: COLOR.border });
    r++;
  } else {
    for (const inv of d.invoices) {
      const items = Array.isArray(inv.items_json) ? (inv.items_json as InvoiceItem[]) : [];
      const unit = invoiceUnitOf(items);
      const row = ws.getRow(r);
      row.values = [
        inv.invoice_date,
        inv.invoice_no,
        unit,
        Number(inv.subtotal ?? 0),
        Number(inv.gst_amount ?? 0),
        Number(inv.total ?? 0),
      ];
      setRowStyle(row, { size: 11, border: COLOR.border });
      ws.getCell(r, 2).font = { ...ws.getCell(r, 2).font, bold: true };
      // Unit chip — coloured pill effect via fill
      ws.getCell(r, 3).alignment = { horizontal: "center", vertical: "middle" };
      ws.getCell(r, 3).fill = fill(unit === "MIX" ? COLOR.warningLight : COLOR.accentLight);
      ws.getCell(r, 3).font = {
        ...ws.getCell(r, 3).font,
        bold: true,
        color: { argb: unit === "MIX" ? COLOR.warning : COLOR.accent },
      };
      // Numbers
      ws.getCell(r, 4).numFmt = '"₹"#,##0.00';
      ws.getCell(r, 5).numFmt = '"₹"#,##0.00';
      ws.getCell(r, 6).numFmt = '"₹"#,##0.00';
      ws.getCell(r, 4).alignment = { horizontal: "right", vertical: "middle" };
      ws.getCell(r, 5).alignment = { horizontal: "right", vertical: "middle" };
      ws.getCell(r, 6).alignment = { horizontal: "right", vertical: "middle" };
      ws.getCell(r, 6).font = {
        ...ws.getCell(r, 6).font,
        bold: true,
        color: { argb: COLOR.accent },
      };
      r++;
    }
    // Footer subtotal row
    const ft = ws.getRow(r);
    ft.values = ["", "", "Subtotals", d.invoicedSubtotal, d.invoicedTax, d.invoicedTotal];
    setRowStyle(ft, { bold: true, fillColor: COLOR.accentTint, border: COLOR.accent, size: 11 });
    ws.getCell(r, 3).alignment = { horizontal: "center", vertical: "middle" };
    ws.getCell(r, 3).font = { ...ws.getCell(r, 3).font, color: { argb: COLOR.accent } };
    ws.getCell(r, 4).numFmt = '"₹"#,##0.00';
    ws.getCell(r, 5).numFmt = '"₹"#,##0.00';
    ws.getCell(r, 6).numFmt = '"₹"#,##0.00';
    ws.getCell(r, 4).alignment = { horizontal: "right", vertical: "middle" };
    ws.getCell(r, 5).alignment = { horizontal: "right", vertical: "middle" };
    ws.getCell(r, 6).alignment = { horizontal: "right", vertical: "middle" };
    ws.getCell(r, 6).font = {
      ...ws.getCell(r, 6).font,
      color: { argb: COLOR.accent },
      size: 12,
    };
    r++;
    // Total invoiced (highlight band)
    const tot = ws.getRow(r);
    tot.values = ["", "", "", "", "TOTAL INVOICED", d.invoicedTotal];
    setRowStyle(tot, { bold: true, fillColor: COLOR.accent, fontColor: COLOR.white, size: 12 });
    ws.getCell(r, 5).alignment = { horizontal: "right", vertical: "middle" };
    ws.getCell(r, 6).numFmt = '"₹"#,##0.00';
    ws.getCell(r, 6).alignment = { horizontal: "right", vertical: "middle" };
    ws.getCell(r, 6).font = { ...ws.getCell(r, 6).font, size: 14 };
    ws.getRow(r).height = 24;
    r++;
  }

  r += 2; // gap

  // ── RECEIPTS section ──────────────────────────────────────────
  r = drawSectionHeader(ws, r, "RECEIPTS", "💵", COLOR.success, COLOR.successTint);

  const rcvHeader = ws.getRow(r);
  rcvHeader.values = ["Date", "Bucket", "Note", "", "", "Amount (₹)"];
  setRowStyle(rcvHeader, {
    bold: true,
    size: 10,
    fontColor: COLOR.textMuted,
    fillColor: COLOR.surfaceMuted,
    border: COLOR.border,
  });
  rcvHeader.alignment = { vertical: "middle" };
  ws.mergeCells(r, 3, r, 5); // Note spans C-E
  ws.getCell(r, 6).alignment = { horizontal: "right", vertical: "middle" };
  r++;

  if (d.receipts.length === 0) {
    ws.mergeCells(r, 1, r, 6);
    const empty = ws.getCell(r, 1);
    empty.value = "No receipts.";
    empty.font = { italic: true, color: { argb: COLOR.textMuted } };
    empty.alignment = { horizontal: "center", vertical: "middle" };
    setRowStyle(ws.getRow(r), { border: COLOR.border });
    r++;
  } else {
    for (const rec of d.receipts) {
      const label = d.bucketLabelById.get(rec.bucket_id) ?? "—";
      const pal = bucketColors(label);
      const row = ws.getRow(r);
      row.values = [rec.receipt_date, label, rec.note ?? "—", "", "", Number(rec.amount ?? 0)];
      setRowStyle(row, { size: 11, border: COLOR.border });
      ws.mergeCells(r, 3, r, 5);
      ws.getCell(r, 2).fill = fill(pal.bg);
      ws.getCell(r, 2).font = {
        ...ws.getCell(r, 2).font,
        bold: true,
        color: { argb: pal.fg },
      };
      ws.getCell(r, 2).alignment = { horizontal: "center", vertical: "middle" };
      ws.getCell(r, 3).font = { ...ws.getCell(r, 3).font, color: { argb: COLOR.textMuted } };
      ws.getCell(r, 6).numFmt = '"₹"#,##0.00';
      ws.getCell(r, 6).alignment = { horizontal: "right", vertical: "middle" };
      ws.getCell(r, 6).font = {
        ...ws.getCell(r, 6).font,
        bold: true,
        color: { argb: COLOR.success },
      };
      r++;
    }
    // Per-bucket subtotal rows
    const sectionBar = ws.getRow(r);
    sectionBar.values = ["", "", "RECEIVED · SPLIT BY BUCKET"];
    ws.mergeCells(r, 3, r, 5);
    setRowStyle(sectionBar, {
      bold: true,
      size: 10,
      fontColor: COLOR.textMuted,
      fillColor: COLOR.surfaceMuted,
      border: COLOR.border,
    });
    ws.getCell(r, 3).alignment = { horizontal: "left", vertical: "middle" };
    r++;
    const sorted = [...d.byBucket.entries()].sort((a, b) => b[1] - a[1]);
    for (const [label, total] of sorted) {
      const pal = bucketColors(label);
      const row = ws.getRow(r);
      row.values = ["", "Subtotal", label, "", "", total];
      ws.mergeCells(r, 3, r, 5);
      setRowStyle(row, { fillColor: COLOR.surfaceMuted, border: COLOR.border, size: 11 });
      ws.getCell(r, 2).font = { ...ws.getCell(r, 2).font, italic: true, color: { argb: COLOR.textMuted } };
      ws.getCell(r, 3).fill = fill(pal.bg);
      ws.getCell(r, 3).font = { ...ws.getCell(r, 3).font, bold: true, color: { argb: pal.fg } };
      ws.getCell(r, 3).alignment = { horizontal: "center", vertical: "middle" };
      ws.getCell(r, 6).numFmt = '"₹"#,##0.00';
      ws.getCell(r, 6).alignment = { horizontal: "right", vertical: "middle" };
      ws.getCell(r, 6).font = { ...ws.getCell(r, 6).font, bold: true, color: { argb: pal.fg } };
      r++;
    }
    // Total received (highlight band)
    const tot = ws.getRow(r);
    tot.values = ["", "", "", "", "TOTAL RECEIVED", d.receivedTotal];
    setRowStyle(tot, { bold: true, fillColor: COLOR.success, fontColor: COLOR.white, size: 12 });
    ws.getCell(r, 5).alignment = { horizontal: "right", vertical: "middle" };
    ws.getCell(r, 6).numFmt = '"₹"#,##0.00';
    ws.getCell(r, 6).alignment = { horizontal: "right", vertical: "middle" };
    ws.getCell(r, 6).font = { ...ws.getCell(r, 6).font, size: 14 };
    ws.getRow(r).height = 24;
    r++;
  }

  r += 2; // gap

  // ── OUTSTANDING callout box ──────────────────────────────────
  const cleared = d.outstanding === 0 && d.invoicedTotal > 0;
  const calloutColor = cleared ? COLOR.success : COLOR.warning;
  const calloutTint = cleared ? COLOR.successTint : COLOR.warningTint;

  ws.mergeCells(r, 1, r, 6);
  const calloutLabel = ws.getCell(r, 1);
  calloutLabel.value = cleared ? "STATUS · CLEARED" : "OUTSTANDING";
  calloutLabel.font = { bold: true, size: 11, color: { argb: COLOR.white } };
  calloutLabel.alignment = { horizontal: "left", vertical: "middle", indent: 1 };
  calloutLabel.fill = fill(calloutColor);
  ws.getRow(r).height = 22;
  r++;

  // Arithmetic line: invoiced − received = outstanding
  ws.mergeCells(r, 1, r, 6);
  const arith = ws.getCell(r, 1);
  arith.value = `₹${formatInr(d.invoicedTotal)}  −  ₹${formatInr(d.receivedTotal)}  =  ₹${formatInr(cleared ? 0 : d.outstanding)}`;
  arith.font = {
    name: "Consolas",
    size: 16,
    bold: true,
    color: { argb: calloutColor },
  };
  arith.alignment = { horizontal: "center", vertical: "middle" };
  arith.fill = fill(calloutTint);
  arith.border = thinBorder(calloutColor);
  ws.getRow(r).height = 36;
  r++;

  // Footnote
  ws.mergeCells(r, 1, r, 6);
  const foot = ws.getCell(r, 1);
  foot.value =
    "Outstanding = Total invoiced − Total received (across all buckets combined). Cancelled entries are excluded but kept in the audit trail.";
  foot.font = { italic: true, size: 9, color: { argb: COLOR.textMuted } };
  foot.alignment = { horizontal: "left", vertical: "top", wrapText: true };
  ws.getRow(r).height = 28;
  r++;
}

function drawSectionHeader(
  ws: ExcelJS.Worksheet,
  r: number,
  label: string,
  icon: string,
  bandColor: string,
  tintColor: string,
): number {
  ws.mergeCells(r, 1, r, 6);
  const cell = ws.getCell(r, 1);
  cell.value = `  ${icon}   ${label}`;
  cell.font = {
    name: "Calibri",
    size: 12,
    bold: true,
    color: { argb: COLOR.white },
  };
  cell.alignment = { horizontal: "left", vertical: "middle" };
  cell.fill = fill(bandColor);
  ws.getRow(r).height = 24;
  // Faint tinted strip below for visual continuity (the table that
  // follows will sit inside this implied "box").
  // Just rely on the band + the table cells' own light fill.
  void tintColor;
  return r + 1;
}

function formatInr(n: number): string {
  return n.toLocaleString("en-IN", { maximumFractionDigits: 2 });
}

// ────────────────────────────────────────────────────────────────
// Sheet 2: Invoices — full detail with line items
// ────────────────────────────────────────────────────────────────

function buildInvoicesSheet(
  wb: ExcelJS.Workbook,
  d: {
    invoices: InvoiceRowDb[];
    invoicedSubtotal: number;
    invoicedTax: number;
    invoicedTotal: number;
  },
) {
  const ws = wb.addWorksheet("Invoices", {
    properties: { defaultRowHeight: 16 },
    views: [{ showGridLines: false, state: "frozen", ySplit: 2 }],
  });
  ws.columns = [
    { width: 14 }, // Invoice #
    { width: 12 }, // Date
    { width: 30 }, // Description
    { width: 16 }, // Stone
    { width: 8 },  // Unit
    { width: 10 }, // Qty
    { width: 12 }, // Rate
    { width: 14 }, // Line total
    { width: 14 }, // Net
    { width: 12 }, // Tax
    { width: 14 }, // Total
    { width: 30 }, // Notes
  ];

  // Title band
  ws.mergeCells(1, 1, 1, 12);
  const title = ws.getCell(1, 1);
  title.value = "📄  INVOICES · full detail";
  title.font = { name: "Calibri", size: 14, bold: true, color: { argb: COLOR.white } };
  title.alignment = { horizontal: "left", vertical: "middle", indent: 1 };
  title.fill = fill(COLOR.accent);
  ws.getRow(1).height = 28;

  const header = ws.getRow(2);
  header.values = [
    "Invoice #", "Date", "Description", "Stone", "Unit",
    "Qty", "Rate (₹)", "Line total (₹)",
    "Net (₹)", "Tax (₹)", "Total (₹)", "Notes",
  ];
  setRowStyle(header, {
    bold: true,
    size: 10,
    fontColor: COLOR.textMuted,
    fillColor: COLOR.surfaceMuted,
    border: COLOR.border,
  });
  header.alignment = { vertical: "middle" };
  // Number-column alignment
  [6, 7, 8, 9, 10, 11].forEach((c) => {
    ws.getCell(2, c).alignment = { horizontal: "right", vertical: "middle" };
  });
  ws.getCell(2, 5).alignment = { horizontal: "center", vertical: "middle" };

  let r = 3;
  if (d.invoices.length === 0) {
    ws.mergeCells(r, 1, r, 12);
    const empty = ws.getCell(r, 1);
    empty.value = "No invoices.";
    empty.font = { italic: true, color: { argb: COLOR.textMuted } };
    empty.alignment = { horizontal: "center", vertical: "middle" };
    setRowStyle(ws.getRow(r), { border: COLOR.border });
    r++;
  } else {
    for (const inv of d.invoices) {
      const items = Array.isArray(inv.items_json) ? (inv.items_json as InvoiceItem[]) : [];
      const unit = invoiceUnitOf(items);
      // Invoice header row
      const head = ws.getRow(r);
      head.values = [
        inv.invoice_no,
        inv.invoice_date,
        "(items below)",
        "",
        unit,
        "",
        "",
        "",
        Number(inv.subtotal ?? 0),
        Number(inv.gst_amount ?? 0),
        Number(inv.total ?? 0),
        inv.notes ?? "",
      ];
      setRowStyle(head, { bold: true, fillColor: COLOR.accentTint, border: COLOR.border, size: 11 });
      ws.getCell(r, 1).font = { ...ws.getCell(r, 1).font, color: { argb: COLOR.accent } };
      ws.getCell(r, 3).font = { ...ws.getCell(r, 3).font, italic: true, color: { argb: COLOR.textMuted }, bold: false };
      ws.getCell(r, 5).alignment = { horizontal: "center", vertical: "middle" };
      ws.getCell(r, 5).fill = fill(unit === "MIX" ? COLOR.warningLight : COLOR.accentLight);
      ws.getCell(r, 5).font = {
        ...ws.getCell(r, 5).font,
        color: { argb: unit === "MIX" ? COLOR.warning : COLOR.accent },
      };
      [9, 10, 11].forEach((c) => {
        ws.getCell(r, c).numFmt = '"₹"#,##0.00';
        ws.getCell(r, c).alignment = { horizontal: "right", vertical: "middle" };
      });
      ws.getCell(r, 11).font = { ...ws.getCell(r, 11).font, color: { argb: COLOR.accent }, size: 12 };
      r++;
      // Line items
      for (const it of items) {
        const ir = ws.getRow(r);
        ir.values = [
          "",
          "",
          String(it.description ?? ""),
          String(it.stone_type ?? ""),
          String((it.unit ?? "") as string).toUpperCase(),
          Number(it.quantity ?? 0),
          Number(it.rate ?? 0),
          Number(it.line_total ?? 0),
          "",
          "",
          "",
          "",
        ];
        setRowStyle(ir, { size: 11, border: COLOR.border });
        ws.getCell(r, 3).alignment = { horizontal: "left", vertical: "middle", indent: 1 };
        ws.getCell(r, 5).alignment = { horizontal: "center", vertical: "middle" };
        [6, 7, 8].forEach((c) => {
          ws.getCell(r, c).alignment = { horizontal: "right", vertical: "middle" };
          ws.getCell(r, c).numFmt = c === 6 ? "0.00" : '"₹"#,##0.00';
        });
        r++;
      }
    }
    // Footer subtotal
    const ft = ws.getRow(r);
    ft.values = [
      "TOTAL",
      "",
      "Subtotals",
      "",
      "",
      "",
      "",
      "",
      d.invoicedSubtotal,
      d.invoicedTax,
      d.invoicedTotal,
      "",
    ];
    setRowStyle(ft, { bold: true, fillColor: COLOR.accent, fontColor: COLOR.white, size: 12 });
    [9, 10, 11].forEach((c) => {
      ws.getCell(r, c).numFmt = '"₹"#,##0.00';
      ws.getCell(r, c).alignment = { horizontal: "right", vertical: "middle" };
    });
    ws.getRow(r).height = 24;
  }
}

// ────────────────────────────────────────────────────────────────
// Sheet 3: Receipts — flat list + per-bucket subtotals
// ────────────────────────────────────────────────────────────────

function buildReceiptsSheet(
  wb: ExcelJS.Workbook,
  d: {
    receipts: ReceiptRowDb[];
    bucketLabelById: Map<string, string>;
    byBucket: Map<string, number>;
    receivedTotal: number;
    outstanding: number;
  },
) {
  const ws = wb.addWorksheet("Receipts", {
    properties: { defaultRowHeight: 16 },
    views: [{ showGridLines: false, state: "frozen", ySplit: 2 }],
  });
  ws.columns = [
    { width: 14 }, // Date
    { width: 18 }, // Bucket
    { width: 14 }, // Amount
    { width: 40 }, // Note
  ];

  // Title band
  ws.mergeCells(1, 1, 1, 4);
  const title = ws.getCell(1, 1);
  title.value = "💵  RECEIPTS · full detail";
  title.font = { name: "Calibri", size: 14, bold: true, color: { argb: COLOR.white } };
  title.alignment = { horizontal: "left", vertical: "middle", indent: 1 };
  title.fill = fill(COLOR.success);
  ws.getRow(1).height = 28;

  const header = ws.getRow(2);
  header.values = ["Date", "Bucket", "Amount (₹)", "Note"];
  setRowStyle(header, {
    bold: true,
    size: 10,
    fontColor: COLOR.textMuted,
    fillColor: COLOR.surfaceMuted,
    border: COLOR.border,
  });
  header.alignment = { vertical: "middle" };
  ws.getCell(2, 3).alignment = { horizontal: "right", vertical: "middle" };

  let r = 3;
  if (d.receipts.length === 0) {
    ws.mergeCells(r, 1, r, 4);
    const empty = ws.getCell(r, 1);
    empty.value = "No receipts.";
    empty.font = { italic: true, color: { argb: COLOR.textMuted } };
    empty.alignment = { horizontal: "center", vertical: "middle" };
    setRowStyle(ws.getRow(r), { border: COLOR.border });
    r++;
  } else {
    for (const rec of d.receipts) {
      const label = d.bucketLabelById.get(rec.bucket_id) ?? "—";
      const pal = bucketColors(label);
      const row = ws.getRow(r);
      row.values = [rec.receipt_date, label, Number(rec.amount ?? 0), rec.note ?? "—"];
      setRowStyle(row, { size: 11, border: COLOR.border });
      ws.getCell(r, 2).fill = fill(pal.bg);
      ws.getCell(r, 2).font = { ...ws.getCell(r, 2).font, bold: true, color: { argb: pal.fg } };
      ws.getCell(r, 2).alignment = { horizontal: "center", vertical: "middle" };
      ws.getCell(r, 3).numFmt = '"₹"#,##0.00';
      ws.getCell(r, 3).alignment = { horizontal: "right", vertical: "middle" };
      ws.getCell(r, 3).font = { ...ws.getCell(r, 3).font, bold: true, color: { argb: COLOR.success } };
      ws.getCell(r, 4).font = { ...ws.getCell(r, 4).font, color: { argb: COLOR.textMuted } };
      r++;
    }
    // Section header
    ws.mergeCells(r, 1, r, 4);
    const sb = ws.getCell(r, 1);
    sb.value = "  RECEIVED · SPLIT BY BUCKET";
    sb.font = { bold: true, size: 10, color: { argb: COLOR.textMuted } };
    sb.alignment = { horizontal: "left", vertical: "middle" };
    sb.fill = fill(COLOR.surfaceMuted);
    setRowStyle(ws.getRow(r), { border: COLOR.border });
    sb.font = { bold: true, size: 10, color: { argb: COLOR.textMuted } };
    r++;
    const sorted = [...d.byBucket.entries()].sort((a, b) => b[1] - a[1]);
    for (const [label, total] of sorted) {
      const pal = bucketColors(label);
      const row = ws.getRow(r);
      row.values = ["Subtotal", label, total, ""];
      setRowStyle(row, { fillColor: COLOR.surfaceMuted, border: COLOR.border, size: 11 });
      ws.getCell(r, 1).font = { ...ws.getCell(r, 1).font, italic: true, color: { argb: COLOR.textMuted } };
      ws.getCell(r, 2).fill = fill(pal.bg);
      ws.getCell(r, 2).font = { ...ws.getCell(r, 2).font, bold: true, color: { argb: pal.fg } };
      ws.getCell(r, 2).alignment = { horizontal: "center", vertical: "middle" };
      ws.getCell(r, 3).numFmt = '"₹"#,##0.00';
      ws.getCell(r, 3).alignment = { horizontal: "right", vertical: "middle" };
      ws.getCell(r, 3).font = { ...ws.getCell(r, 3).font, bold: true, color: { argb: pal.fg } };
      r++;
    }
    // Total received band
    const tot = ws.getRow(r);
    tot.values = ["TOTAL RECEIVED", "", d.receivedTotal, ""];
    setRowStyle(tot, { bold: true, fillColor: COLOR.success, fontColor: COLOR.white, size: 12 });
    ws.mergeCells(r, 1, r, 2);
    ws.getCell(r, 1).alignment = { horizontal: "left", vertical: "middle", indent: 1 };
    ws.getCell(r, 3).numFmt = '"₹"#,##0.00';
    ws.getCell(r, 3).alignment = { horizontal: "right", vertical: "middle" };
    ws.getCell(r, 3).font = { ...ws.getCell(r, 3).font, size: 14 };
    ws.getRow(r).height = 24;
    r++;
    // Outstanding callout row
    r++;
    const cleared = d.outstanding === 0;
    const oc = ws.getRow(r);
    oc.values = [cleared ? "STATUS · CLEARED" : "OUTSTANDING", "", cleared ? 0 : d.outstanding, "Invoiced − Received"];
    setRowStyle(oc, {
      bold: true,
      fillColor: cleared ? COLOR.success : COLOR.warning,
      fontColor: COLOR.white,
      size: 12,
    });
    ws.mergeCells(r, 1, r, 2);
    ws.getCell(r, 1).alignment = { horizontal: "left", vertical: "middle", indent: 1 };
    ws.getCell(r, 3).numFmt = '"₹"#,##0.00';
    ws.getCell(r, 3).alignment = { horizontal: "right", vertical: "middle" };
    ws.getCell(r, 3).font = { ...ws.getCell(r, 3).font, size: 14 };
    ws.getRow(r).height = 24;
  }
}
