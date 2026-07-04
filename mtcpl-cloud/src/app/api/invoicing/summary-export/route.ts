/**
 * GET /api/invoicing/summary-export
 *
 * Colourful Excel exports for the Invoicing dashboard (Daksh, Jul 2026).
 *
 *   • ?kind=invoices|challans[&scope=pending|all][&from&to]
 *       Full-tab workbook: Detail + Party summary + Items sheets.
 *       For challans, scope=pending (the tab's default) exports ONLY documents
 *       still being challans (not yet invoiced / running-billed).
 *
 *   • ?party=<name>[&from&to]
 *       ONE party's workbook — exactly 3 sheets:
 *         1. Combined       (challan docs + invoices, newest first)
 *         2. Only challans  (still-challan documents)
 *         3. Only invoices  (issued invoices)
 *
 * Styling: exceljs — title band, coloured header rows, zebra striping, thin
 * borders, ₹ number formats, bold TOTAL rows, frozen headers. Per the repo
 * gotcha: NO worksheet pageSetup/outlineProperties combo, and all free text is
 * control-char sanitised.
 */

import { NextRequest } from "next/server";
import ExcelJS from "exceljs";

import { requireAuth } from "@/lib/auth";
import { canUseInvoicing } from "@/lib/invoicing-permissions";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { gatherInvoiced, gatherChallans, type InvoiceSource, type ChallanStatus, type InvoiceSummaryRow, type ChallanSummaryRow } from "@/lib/invoicing-summary";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

type Admin = ReturnType<typeof createAdminSupabaseClient>;
type Cell = string | number;

const round2 = (n: number) => Math.round(n * 100) / 100;
// eslint-disable-next-line no-control-regex
const clean = (v: unknown): string => String(v ?? "").replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, " ").trim();

const SRC_LABEL: Record<InvoiceSource, string> = { purchase: "Purchase", work_order: "Work order", running: "Running bill", other: "Other Sales" };
const STATUS_LABEL: Record<ChallanStatus, string> = { open: "Open", in_approval: "In approval", in_bulk: "In bulk", invoiced: "Invoiced", running: "Running bill" };

// ── exceljs styling helpers ─────────────────────────────────────────

const NAVY = "FF0F2540";
const BORDER = "FFD3DAE3";
const thin: Partial<ExcelJS.Borders> = {
  top: { style: "thin", color: { argb: BORDER } },
  left: { style: "thin", color: { argb: BORDER } },
  bottom: { style: "thin", color: { argb: BORDER } },
  right: { style: "thin", color: { argb: BORDER } },
};
const fill = (argb: string): ExcelJS.Fill => ({ type: "pattern", pattern: "solid", fgColor: { argb } });

type Col = { header: string; width: number; align?: "left" | "right" | "center"; numFmt?: string };
const MONEY = "#,##0.00";
const QTY = "#,##0.00";

/** Title band + meta + styled header + zebra rows + optional bold TOTAL row. */
function addStyledTable(
  ws: ExcelJS.Worksheet,
  opts: { title: string; meta: string; accent: string; zebra: string; cols: Col[]; rows: Cell[][]; totalRow?: Cell[] },
) {
  const { title, meta, accent, zebra, cols, rows, totalRow } = opts;
  ws.columns = cols.map((c) => ({ width: c.width }));

  // Title band (merged) + meta line.
  const last = String.fromCharCode(64 + Math.min(26, cols.length));
  ws.mergeCells(`A1:${last}1`);
  const t = ws.getCell("A1");
  t.value = title;
  t.font = { bold: true, size: 14, color: { argb: "FFFFFFFF" } };
  t.fill = fill(NAVY);
  t.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
  ws.getRow(1).height = 26;
  ws.mergeCells(`A2:${last}2`);
  const m = ws.getCell("A2");
  m.value = meta;
  m.font = { italic: true, size: 9.5, color: { argb: "FF667085" } };
  ws.getRow(2).height = 14;

  // Header row (row 4).
  const hr = ws.getRow(4);
  cols.forEach((c, i) => {
    const cell = hr.getCell(i + 1);
    cell.value = c.header;
    cell.font = { bold: true, size: 10.5, color: { argb: "FFFFFFFF" } };
    cell.fill = fill(accent);
    cell.border = thin;
    cell.alignment = { horizontal: c.align ?? "left", vertical: "middle" };
  });
  hr.height = 20;

  // Data rows with zebra striping.
  rows.forEach((r, ri) => {
    const row = ws.getRow(5 + ri);
    r.forEach((v, ci) => {
      const cell = row.getCell(ci + 1);
      cell.value = v;
      cell.border = thin;
      cell.font = { size: 10 };
      const col = cols[ci];
      cell.alignment = { horizontal: col.align ?? "left", vertical: "middle" };
      if (col.numFmt && typeof v === "number") cell.numFmt = col.numFmt;
      if (ri % 2 === 1) cell.fill = fill(zebra);
    });
  });

  // Bold TOTAL row.
  if (totalRow) {
    const row = ws.getRow(5 + rows.length);
    totalRow.forEach((v, ci) => {
      const cell = row.getCell(ci + 1);
      cell.value = v;
      cell.font = { bold: true, size: 10.5 };
      cell.fill = fill(zebra);
      cell.border = { ...thin, top: { style: "double", color: { argb: accent } } };
      const col = cols[ci];
      cell.alignment = { horizontal: col.align ?? "left", vertical: "middle" };
      if (col.numFmt && typeof v === "number") cell.numFmt = col.numFmt;
    });
    row.height = 18;
  }

  // Freeze title + header.
  ws.views = [{ state: "frozen", ySplit: 4 }];
}

/** Sum helper for total rows. */
const sum = <T,>(rows: T[], f: (r: T) => number) => round2(rows.reduce((a, r) => a + f(r), 0));

// ── Raw line items (Items sheet) ────────────────────────────────────

async function rawItems(admin: Admin, table: string, parentCol: string, ids: string[]): Promise<Array<Record<string, unknown>>> {
  const out: Array<Record<string, unknown>> = [];
  for (let i = 0; i < ids.length; i += 300) {
    const chunk = ids.slice(i, i + 300);
    if (!chunk.length) break;
    const { data, error } = await admin.from(table).select("*").in(parentCol, chunk);
    if (error) break;
    out.push(...((data ?? []) as Array<Record<string, unknown>>));
  }
  return out;
}

const ITEM_COLS: Col[] = [
  { header: "Doc no", width: 14 }, { header: "Invoice no", width: 14 }, { header: "Party", width: 26 },
  { header: "Type / status", width: 13 }, { header: "Item", width: 22 }, { header: "Description", width: 26 },
  { header: "Codes", width: 24 }, { header: "HSN", width: 10 },
  { header: "L", width: 6, align: "right" }, { header: "W", width: 6, align: "right" }, { header: "H", width: 6, align: "right" },
  { header: "Unit", width: 7 }, { header: "Qty", width: 8, align: "right", numFmt: QTY }, { header: "Measure qty", width: 11, align: "right", numFmt: QTY },
  { header: "Rate", width: 10, align: "right", numFmt: MONEY }, { header: "Amount", width: 13, align: "right", numFmt: MONEY },
];

function itemCells(it: Record<string, unknown>, meta: { code: string; invCode: string; party: string; badge: string }): Cell[] {
  const num = (k: string): Cell => (it[k] != null && it[k] !== "" ? Number(it[k]) || 0 : "");
  const label = clean(it.label ?? it.particulars ?? "");
  const desc = clean([it.description, it.additional_description].filter(Boolean).join(" — "));
  const cat = clean([it.component_section, it.component_element].filter(Boolean).join(" — "));
  return [
    meta.code, meta.invCode, meta.party, meta.badge,
    label || cat, desc, clean(it.codes), clean(it.hsn),
    num("length_ft"), num("width_ft"), num("thickness_ft"),
    clean(it.measure_unit ?? it.unit), num("quantity"), num("measure_qty"),
    num("rate"),
    it.amount != null ? Number(it.amount) || 0 : round2((Number(it.rate) || 0) * (Number(it.measure_qty ?? it.quantity) || 0)),
  ];
}

// ── Route ───────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const { profile } = await requireAuth();
  if (!canUseInvoicing(profile)) return new Response("Forbidden", { status: 403 });

  const sp = req.nextUrl.searchParams;
  const party = (sp.get("party") ?? "").trim();
  const kind = sp.get("kind") === "challans" ? "challans" : "invoices";
  const scope = sp.get("scope") === "pending" ? "pending" : "all";
  const from = (sp.get("from") ?? "").trim();
  const to = (sp.get("to") ?? "").trim();
  const inRange = (d: string) => (!from || d >= from) && (!to || d <= to);
  const rangeLabel = from || to ? `${from || "…"} to ${to || "…"}` : "all dates";
  const stamp = new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });
  const meta = `Range: ${rangeLabel} · generated ${stamp} · MTCPL Invoicing`;

  const admin = createAdminSupabaseClient();
  const wb = new ExcelJS.Workbook();
  wb.creator = "MTCPL Cloud";

  const isPending = (r: ChallanSummaryRow) => r.status !== "invoiced" && r.status !== "running";

  // Shared column sets.
  const CH_COLS: Col[] = [
    { header: "#", width: 5, align: "right" }, { header: "Challan no", width: 14 }, { header: "Invoice no", width: 14 },
    { header: "Party", width: 30 }, { header: "Status", width: 13 }, { header: "Date", width: 11 },
    { header: "CFT", width: 10, align: "right", numFmt: QTY }, { header: "SFT", width: 10, align: "right", numFmt: QTY }, { header: "NOS", width: 8, align: "right", numFmt: QTY },
    { header: "Taxable ₹", width: 14, align: "right", numFmt: MONEY }, { header: "GST ₹", width: 12, align: "right", numFmt: MONEY }, { header: "Total ₹", width: 15, align: "right", numFmt: MONEY },
  ];
  const INV_COLS: Col[] = [
    { header: "#", width: 5, align: "right" }, { header: "Invoice no", width: 15 }, { header: "Party", width: 30 },
    { header: "Type", width: 13 }, { header: "Date", width: 11 },
    { header: "CFT", width: 10, align: "right", numFmt: QTY }, { header: "SFT", width: 10, align: "right", numFmt: QTY }, { header: "NOS", width: 8, align: "right", numFmt: QTY },
    { header: "Taxable ₹", width: 14, align: "right", numFmt: MONEY }, { header: "GST ₹", width: 12, align: "right", numFmt: MONEY }, { header: "Total ₹", width: 15, align: "right", numFmt: MONEY },
  ];

  const chRow = (r: ChallanSummaryRow, i: number): Cell[] => [i + 1, r.code, r.invCode ?? "", clean(r.party), STATUS_LABEL[r.status], r.date, round2(r.cft), round2(r.sft), round2(r.nos), round2(r.amount - r.taxed), round2(r.taxed), round2(r.amount)];
  const invRow = (r: InvoiceSummaryRow, i: number): Cell[] => [i + 1, r.code, clean(r.party), SRC_LABEL[r.source], r.date, round2(r.cft), round2(r.sft), round2(r.nos), round2(r.amount - r.taxed), round2(r.taxed), round2(r.amount)];
  const chTotal = (rows: ChallanSummaryRow[]): Cell[] => ["", "TOTAL", "", `${rows.length} challans`, "", "", sum(rows, (r) => r.cft), sum(rows, (r) => r.sft), sum(rows, (r) => r.nos), sum(rows, (r) => r.amount - r.taxed), sum(rows, (r) => r.taxed), sum(rows, (r) => r.amount)];
  const invTotal = (rows: InvoiceSummaryRow[]): Cell[] => ["", "TOTAL", `${rows.length} invoices`, "", "", sum(rows, (r) => r.cft), sum(rows, (r) => r.sft), sum(rows, (r) => r.nos), sum(rows, (r) => r.amount - r.taxed), sum(rows, (r) => r.taxed), sum(rows, (r) => r.amount)];

  let fname: string;

  if (party) {
    // ── PARTY workbook — exactly 3 sheets: Combined / Only challans / Only invoices.
    const [allCh, allInv] = await Promise.all([gatherChallans(admin), gatherInvoiced(admin)]);
    const ch = allCh.filter((r) => clean(r.party) === clean(party) && inRange(r.date));
    const inv = allInv.filter((r) => clean(r.party) === clean(party) && inRange(r.date));
    const pend = ch.filter(isPending);

    // 1 — Combined (gold): every challan doc + every invoice, newest first.
    {
      const COMB_COLS: Col[] = [
        { header: "#", width: 5, align: "right" }, { header: "Kind", width: 10 }, { header: "Doc no", width: 14 }, { header: "Invoice no", width: 14 },
        { header: "Status / type", width: 14 }, { header: "Date", width: 11 },
        { header: "CFT", width: 10, align: "right", numFmt: QTY }, { header: "SFT", width: 10, align: "right", numFmt: QTY }, { header: "NOS", width: 8, align: "right", numFmt: QTY },
        { header: "Taxable ₹", width: 14, align: "right", numFmt: MONEY }, { header: "GST ₹", width: 12, align: "right", numFmt: MONEY }, { header: "Total ₹", width: 15, align: "right", numFmt: MONEY },
      ];
      type Comb = { kind: string; code: string; invCode: string; badge: string; date: string; cft: number; sft: number; nos: number; taxable: number; taxed: number; amount: number };
      const rows: Comb[] = [
        ...ch.map((r) => ({ kind: "CHALLAN", code: r.code, invCode: r.invCode ?? "", badge: STATUS_LABEL[r.status], date: r.date, cft: r.cft, sft: r.sft, nos: r.nos, taxable: r.amount - r.taxed, taxed: r.taxed, amount: r.amount })),
        ...inv.map((r) => ({ kind: "INVOICE", code: r.code, invCode: r.code, badge: SRC_LABEL[r.source], date: r.date, cft: r.cft, sft: r.sft, nos: r.nos, taxable: r.amount - r.taxed, taxed: r.taxed, amount: r.amount })),
      ].sort((a, b) => (a.date < b.date ? 1 : -1));
      const ws = wb.addWorksheet("Combined");
      addStyledTable(ws, {
        title: `${clean(party)} — Combined (challans + invoices)`,
        meta, accent: "FFB45309", zebra: "FFFBF3E6", cols: COMB_COLS,
        rows: rows.map((r, i) => [i + 1, r.kind, r.code, r.invCode, r.badge, r.date, round2(r.cft), round2(r.sft), round2(r.nos), round2(r.taxable), round2(r.taxed), round2(r.amount)]),
        totalRow: ["", "TOTAL", `${rows.length} docs`, "", "", "", sum(rows, (r) => r.cft), sum(rows, (r) => r.sft), sum(rows, (r) => r.nos), sum(rows, (r) => r.taxable), sum(rows, (r) => r.taxed), sum(rows, (r) => r.amount)],
      });
    }
    // 2 — Only challans (blue) — still-challan documents.
    {
      const ws = wb.addWorksheet("Only challans");
      addStyledTable(ws, {
        title: `${clean(party)} — Only challans (not yet invoiced)`,
        meta, accent: "FF2563EB", zebra: "FFEFF4FE", cols: CH_COLS,
        rows: pend.map(chRow), totalRow: chTotal(pend),
      });
    }
    // 3 — Only invoices (green).
    {
      const ws = wb.addWorksheet("Only invoices");
      addStyledTable(ws, {
        title: `${clean(party)} — Only invoices`,
        meta, accent: "FF15803D", zebra: "FFEFF7F1", cols: INV_COLS,
        rows: inv.map(invRow), totalRow: invTotal(inv),
      });
    }
    fname = `${clean(party).replace(/[^A-Za-z0-9 _-]+/g, "").slice(0, 40) || "party"}-summary.xlsx`;
  } else if (kind === "challans") {
    // ── CHALLANS workbook: Detail (scope-aware) + Party summary + Items.
    const all = (await gatherChallans(admin)).filter((r) => inRange(r.date));
    const rows = scope === "pending" ? all.filter(isPending) : all;

    const ws = wb.addWorksheet("Challans");
    addStyledTable(ws, {
      title: `Challans — ${scope === "pending" ? "only challans (not yet invoiced)" : "all (incl. invoiced)"}`,
      meta, accent: "FF2563EB", zebra: "FFEFF4FE", cols: CH_COLS,
      rows: rows.map(chRow), totalRow: chTotal(rows),
    });

    addPartySummary(wb, meta, rows.map((r) => ({ party: clean(r.party), cft: r.cft, sft: r.sft, nos: r.nos, taxed: r.taxed, amount: r.amount })), "challans");

    // Items — temple challan items (custom fallback) + other-sales items.
    const itemsRows: Cell[][] = [];
    {
      const temple = rows.filter((r) => !r.id.startsWith("other:"));
      const other = rows.filter((r) => r.id.startsWith("other:"));
      const tMeta = new Map(temple.map((r) => [r.id, r] as const));
      const seen = new Set<string>();
      for (const it of await rawItems(admin, "challan_items", "challan_id", [...tMeta.keys()])) {
        const r = tMeta.get(String(it.challan_id));
        if (!r) continue;
        seen.add(String(it.challan_id));
        itemsRows.push(itemCells(it, { code: r.code, invCode: r.invCode ?? "", party: clean(r.party), badge: STATUS_LABEL[r.status] }));
      }
      for (const it of await rawItems(admin, "challan_custom_items", "challan_id", [...tMeta.keys()].filter((id) => !seen.has(id)))) {
        const r = tMeta.get(String(it.challan_id));
        if (r) itemsRows.push(itemCells(it, { code: r.code, invCode: r.invCode ?? "", party: clean(r.party), badge: STATUS_LABEL[r.status] }));
      }
      const oMeta = new Map(other.map((r) => [r.id.replace(/^other:/, ""), r] as const));
      for (const it of await rawItems(admin, "other_challan_items", "other_challan_id", [...oMeta.keys()])) {
        const r = oMeta.get(String(it.other_challan_id));
        if (r) itemsRows.push(itemCells(it, { code: r.code, invCode: r.invCode ?? "", party: clean(r.party), badge: STATUS_LABEL[r.status] }));
      }
    }
    const wsI = wb.addWorksheet("Items");
    addStyledTable(wsI, { title: "Line items — full detail", meta, accent: "FF0F766E", zebra: "FFECF7F6", cols: ITEM_COLS, rows: itemsRows });
    fname = `challans-${scope}-summary.xlsx`;
  } else {
    // ── INVOICES workbook: Detail + Party summary + Items.
    const rows = (await gatherInvoiced(admin)).filter((r) => inRange(r.date));

    const ws = wb.addWorksheet("Invoices");
    addStyledTable(ws, { title: "Invoices — full detail", meta, accent: "FF15803D", zebra: "FFEFF7F1", cols: INV_COLS, rows: rows.map(invRow), totalRow: invTotal(rows) });

    addPartySummary(wb, meta, rows.map((r) => ({ party: clean(r.party), cft: r.cft, sft: r.sft, nos: r.nos, taxed: r.taxed, amount: r.amount })), "invoices");

    const itemsRows: Cell[][] = [];
    const bySource: Record<InvoiceSource, { table: string; col: string }> = {
      purchase: { table: "challan_items", col: "challan_id" },
      work_order: { table: "bulk_invoice_items", col: "bulk_invoice_id" },
      running: { table: "challan_custom_items", col: "challan_id" },
      other: { table: "other_challan_items", col: "other_challan_id" },
    };
    for (const source of Object.keys(bySource) as InvoiceSource[]) {
      const { table, col } = bySource[source];
      const srcRows = rows.filter((r) => r.source === source);
      const metaMap = new Map(srcRows.map((r) => [r.id.replace(/^other:/, ""), r] as const));
      for (const it of await rawItems(admin, table, col, [...metaMap.keys()])) {
        const r = metaMap.get(String(it[col]));
        if (r) itemsRows.push(itemCells(it, { code: r.code, invCode: r.code, party: clean(r.party), badge: SRC_LABEL[r.source] }));
      }
    }
    const wsI = wb.addWorksheet("Items");
    addStyledTable(wsI, { title: "Line items — full detail", meta, accent: "FF0F766E", zebra: "FFECF7F6", cols: ITEM_COLS, rows: itemsRows });
    fname = "invoices-summary.xlsx";
  }

  const buf = await wb.xlsx.writeBuffer();
  return new Response(Buffer.from(buf as ArrayBuffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${fname}"`,
      "Cache-Control": "no-store",
    },
  });
}

/** Party summary sheet (purple) — per-party aggregates + grand total. */
function addPartySummary(wb: ExcelJS.Workbook, meta: string, rows: Array<{ party: string; cft: number; sft: number; nos: number; taxed: number; amount: number }>, noun: string) {
  const agg = new Map<string, { count: number; cft: number; sft: number; nos: number; taxed: number; amount: number }>();
  for (const r of rows) {
    const a = agg.get(r.party) ?? { count: 0, cft: 0, sft: 0, nos: 0, taxed: 0, amount: 0 };
    a.count += 1; a.cft += r.cft; a.sft += r.sft; a.nos += r.nos; a.taxed += r.taxed; a.amount += r.amount;
    agg.set(r.party, a);
  }
  const parties = [...agg.entries()].sort((a, b) => b[1].amount - a[1].amount || b[1].count - a[1].count);
  const COLS: Col[] = [
    { header: "Party", width: 32 }, { header: noun === "challans" ? "Challans" : "Invoices", width: 10, align: "right" },
    { header: "CFT", width: 11, align: "right", numFmt: QTY }, { header: "SFT", width: 11, align: "right", numFmt: QTY }, { header: "NOS", width: 8, align: "right", numFmt: QTY },
    { header: "Taxable ₹", width: 14, align: "right", numFmt: MONEY }, { header: "GST ₹", width: 13, align: "right", numFmt: MONEY }, { header: "Total ₹", width: 15, align: "right", numFmt: MONEY },
  ];
  const g = [...agg.values()].reduce((s, a) => ({ count: s.count + a.count, cft: s.cft + a.cft, sft: s.sft + a.sft, nos: s.nos + a.nos, taxed: s.taxed + a.taxed, amount: s.amount + a.amount }), { count: 0, cft: 0, sft: 0, nos: 0, taxed: 0, amount: 0 });
  const ws = wb.addWorksheet("Party summary");
  addStyledTable(ws, {
    title: "Party summary",
    meta, accent: "FF6D28D9", zebra: "FFF4EFFB", cols: COLS,
    rows: parties.map(([party, a]) => [party, a.count, round2(a.cft), round2(a.sft), round2(a.nos), round2(a.amount - a.taxed), round2(a.taxed), round2(a.amount)]),
    totalRow: ["GRAND TOTAL", g.count, round2(g.cft), round2(g.sft), round2(g.nos), round2(g.amount - g.taxed), round2(g.taxed), round2(g.amount)],
  });
}
