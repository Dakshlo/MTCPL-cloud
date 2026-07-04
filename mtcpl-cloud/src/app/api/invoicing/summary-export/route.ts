/**
 * GET /api/invoicing/summary-export?kind=invoices|challans&from=YYYY-MM-DD&to=…
 *
 * Full-detail Excel for the Invoicing dashboard's Challans / Invoices tabs
 * (Daksh, Jul 2026). Three sheets:
 *   1. Detail        — one row per document: numbers, party, stage/type, date,
 *                      CFT / SFT / NOS, taxable, GST, total (+ grand total row).
 *   2. Party summary — per-party aggregates (docs · CFT · SFT · NOS · ₹).
 *   3. Items         — EVERY line item across all documents (label/particulars,
 *                      description, codes, HSN, dims, unit, qty, rate, amount).
 *
 * Date range (from/to, inclusive) mirrors the on-screen filter. Uses the stock
 * `xlsx` package like the other exports (exceljs sheetPr gotcha avoided).
 */

import { NextRequest } from "next/server";
import * as XLSX from "xlsx";

import { requireAuth } from "@/lib/auth";
import { canUseInvoicing } from "@/lib/invoicing-permissions";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { gatherInvoiced, gatherChallans, type InvoiceSource, type ChallanStatus } from "@/lib/invoicing-summary";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Admin = ReturnType<typeof createAdminSupabaseClient>;
type Cell = string | number;

const round2 = (n: number) => Math.round(n * 100) / 100;
// Sanitize free text for Excel cells (control chars corrupt workbooks).
// eslint-disable-next-line no-control-regex
const clean = (v: unknown): string => String(v ?? "").replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, " ").trim();

const SRC_LABEL: Record<InvoiceSource, string> = { purchase: "Purchase", work_order: "Work order", running: "Running bill", other: "Other Sales" };
const STATUS_LABEL: Record<ChallanStatus, string> = { open: "Open", in_approval: "In approval", in_bulk: "In bulk", invoiced: "Invoiced", running: "Running bill" };

/** Raw line items for a set of parent ids (chunked, select * so every source
 *  table's own columns come through; mapped defensively). */
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

const ITEM_HEADER: Cell[] = ["Doc no", "Invoice no", "Party", "Type / status", "Item", "Description", "Codes", "HSN", "L", "W", "H", "Unit", "Qty", "Measure qty", "Rate", "Amount"];

/** Normalise one raw item row into the shared Items-sheet shape. */
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

export async function GET(req: NextRequest) {
  const { profile } = await requireAuth();
  if (!canUseInvoicing(profile)) return new Response("Forbidden", { status: 403 });

  const sp = req.nextUrl.searchParams;
  const kind = sp.get("kind") === "challans" ? "challans" : "invoices";
  const from = (sp.get("from") ?? "").trim();
  const to = (sp.get("to") ?? "").trim();
  const inRange = (d: string) => (!from || d >= from) && (!to || d <= to);

  const admin = createAdminSupabaseClient();
  const wb = XLSX.utils.book_new();
  const rangeLabel = from || to ? `${from || "…"} → ${to || "…"}` : "all dates";
  const stamp = new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });

  // Shared per-party aggregation.
  type Agg = { count: number; cft: number; sft: number; nos: number; taxed: number; amount: number };
  const partyAgg = new Map<string, Agg>();
  const bump = (party: string, r: { cft: number; sft: number; nos: number; taxed: number; amount: number }) => {
    const a = partyAgg.get(party) ?? { count: 0, cft: 0, sft: 0, nos: 0, taxed: 0, amount: 0 };
    a.count += 1; a.cft += r.cft; a.sft += r.sft; a.nos += r.nos; a.taxed += r.taxed; a.amount += r.amount;
    partyAgg.set(party, a);
  };

  const itemsAoa: Cell[][] = [["Line items — full detail"], [`Range: ${rangeLabel} · generated ${stamp}`], [], ITEM_HEADER];

  if (kind === "invoices") {
    const rows = (await gatherInvoiced(admin)).filter((r) => inRange(r.date));

    // 1 — Detail sheet.
    const aoa: Cell[][] = [
      ["Invoices — full detail"], [`Range: ${rangeLabel} · generated ${stamp}`], [],
      ["#", "Invoice no", "Party", "Type", "Date", "CFT", "SFT", "NOS", "Taxable ₹", "GST ₹", "Total ₹"],
    ];
    let i = 0;
    for (const r of rows) {
      aoa.push([++i, r.code, clean(r.party), SRC_LABEL[r.source], r.date, round2(r.cft), round2(r.sft), round2(r.nos), round2(r.amount - r.taxed), round2(r.taxed), round2(r.amount)]);
      bump(clean(r.party), r);
    }
    aoa.push([]);
    aoa.push(["", "TOTAL", "", "", "", round2(rows.reduce((a, r) => a + r.cft, 0)), round2(rows.reduce((a, r) => a + r.sft, 0)), round2(rows.reduce((a, r) => a + r.nos, 0)), round2(rows.reduce((a, r) => a + (r.amount - r.taxed), 0)), round2(rows.reduce((a, r) => a + r.taxed, 0)), round2(rows.reduce((a, r) => a + r.amount, 0))]);
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws["!cols"] = [{ wch: 5 }, { wch: 15 }, { wch: 30 }, { wch: 13 }, { wch: 11 }, { wch: 10 }, { wch: 10 }, { wch: 8 }, { wch: 13 }, { wch: 12 }, { wch: 14 }];
    XLSX.utils.book_append_sheet(wb, ws, "Invoices");

    // 3 — Items sheet (per source table).
    const metaOf = (r: (typeof rows)[number]) => ({ code: r.code, invCode: r.code, party: clean(r.party), badge: SRC_LABEL[r.source] });
    const bySource: Record<InvoiceSource, { table: string; col: string }> = {
      purchase: { table: "challan_items", col: "challan_id" },
      work_order: { table: "bulk_invoice_items", col: "bulk_invoice_id" },
      running: { table: "challan_custom_items", col: "challan_id" },
      other: { table: "other_challan_items", col: "other_challan_id" },
    };
    for (const source of Object.keys(bySource) as InvoiceSource[]) {
      const { table, col } = bySource[source];
      const srcRows = rows.filter((r) => r.source === source);
      const meta = new Map(srcRows.map((r) => [r.id.replace(/^other:/, ""), r] as const));
      const items = await rawItems(admin, table, col, [...meta.keys()]);
      for (const it of items) {
        const pid = String(it[col]);
        const r = meta.get(pid);
        if (r) itemsAoa.push(itemCells(it, metaOf(r)));
      }
    }
  } else {
    const rows = (await gatherChallans(admin)).filter((r) => inRange(r.date));

    // 1 — Detail sheet.
    const aoa: Cell[][] = [
      ["Challans — full detail"], [`Range: ${rangeLabel} · generated ${stamp}`], [],
      ["#", "Challan no", "Invoice no", "Party", "Status", "Date", "CFT", "SFT", "NOS", "Taxable ₹", "GST ₹", "Total ₹"],
    ];
    let i = 0;
    for (const r of rows) {
      aoa.push([++i, r.code, r.invCode ?? "", clean(r.party), STATUS_LABEL[r.status], r.date, round2(r.cft), round2(r.sft), round2(r.nos), round2(r.amount - r.taxed), round2(r.taxed), round2(r.amount)]);
      bump(clean(r.party), r);
    }
    aoa.push([]);
    aoa.push(["", "TOTAL", "", "", "", "", round2(rows.reduce((a, r) => a + r.cft, 0)), round2(rows.reduce((a, r) => a + r.sft, 0)), round2(rows.reduce((a, r) => a + r.nos, 0)), round2(rows.reduce((a, r) => a + (r.amount - r.taxed), 0)), round2(rows.reduce((a, r) => a + r.taxed, 0)), round2(rows.reduce((a, r) => a + r.amount, 0))]);
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws["!cols"] = [{ wch: 5 }, { wch: 14 }, { wch: 14 }, { wch: 30 }, { wch: 12 }, { wch: 11 }, { wch: 10 }, { wch: 10 }, { wch: 8 }, { wch: 13 }, { wch: 12 }, { wch: 14 }];
    XLSX.utils.book_append_sheet(wb, ws, "Challans");

    // 3 — Items: temple challans (challan_items, custom fallback) + other.
    const temple = rows.filter((r) => !r.id.startsWith("other:"));
    const other = rows.filter((r) => r.id.startsWith("other:"));
    const tMeta = new Map(temple.map((r) => [r.id, r] as const));
    const seen = new Set<string>();
    for (const it of await rawItems(admin, "challan_items", "challan_id", [...tMeta.keys()])) {
      const pid = String(it.challan_id);
      const r = tMeta.get(pid);
      if (!r) continue;
      seen.add(pid);
      itemsAoa.push(itemCells(it, { code: r.code, invCode: r.invCode ?? "", party: clean(r.party), badge: STATUS_LABEL[r.status] }));
    }
    for (const it of await rawItems(admin, "challan_custom_items", "challan_id", [...tMeta.keys()].filter((id) => !seen.has(id)))) {
      const pid = String(it.challan_id);
      const r = tMeta.get(pid);
      if (r) itemsAoa.push(itemCells(it, { code: r.code, invCode: r.invCode ?? "", party: clean(r.party), badge: STATUS_LABEL[r.status] }));
    }
    const oMeta = new Map(other.map((r) => [r.id.replace(/^other:/, ""), r] as const));
    for (const it of await rawItems(admin, "other_challan_items", "other_challan_id", [...oMeta.keys()])) {
      const pid = String(it.other_challan_id);
      const r = oMeta.get(pid);
      if (r) itemsAoa.push(itemCells(it, { code: r.code, invCode: r.invCode ?? "", party: clean(r.party), badge: STATUS_LABEL[r.status] }));
    }
  }

  // 2 — Party summary sheet (shared shape).
  {
    const docNoun = kind === "invoices" ? "Invoices" : "Challans";
    const aoa: Cell[][] = [
      [`Party summary — ${docNoun.toLowerCase()}`], [`Range: ${rangeLabel}`], [],
      ["Party", docNoun, "CFT", "SFT", "NOS", "Taxable ₹", "GST ₹", "Total ₹"],
    ];
    const parties = [...partyAgg.entries()].sort((a, b) => b[1].amount - a[1].amount || b[1].count - a[1].count);
    for (const [party, a] of parties) {
      aoa.push([party, a.count, round2(a.cft), round2(a.sft), round2(a.nos), round2(a.amount - a.taxed), round2(a.taxed), round2(a.amount)]);
    }
    aoa.push([]);
    const g = [...partyAgg.values()].reduce((s, a) => ({ count: s.count + a.count, cft: s.cft + a.cft, sft: s.sft + a.sft, nos: s.nos + a.nos, taxed: s.taxed + a.taxed, amount: s.amount + a.amount }), { count: 0, cft: 0, sft: 0, nos: 0, taxed: 0, amount: 0 });
    aoa.push(["GRAND TOTAL", g.count, round2(g.cft), round2(g.sft), round2(g.nos), round2(g.amount - g.taxed), round2(g.taxed), round2(g.amount)]);
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws["!cols"] = [{ wch: 32 }, { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 8 }, { wch: 13 }, { wch: 12 }, { wch: 14 }];
    XLSX.utils.book_append_sheet(wb, ws, "Party summary");
  }

  {
    const ws = XLSX.utils.aoa_to_sheet(itemsAoa);
    ws["!cols"] = [{ wch: 14 }, { wch: 14 }, { wch: 26 }, { wch: 12 }, { wch: 22 }, { wch: 26 }, { wch: 24 }, { wch: 10 }, { wch: 6 }, { wch: 6 }, { wch: 6 }, { wch: 7 }, { wch: 7 }, { wch: 11 }, { wch: 9 }, { wch: 12 }];
    XLSX.utils.book_append_sheet(wb, ws, "Items");
  }

  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  const fname = `${kind}-summary${from || to ? `-${from || "start"}-to-${to || "today"}` : ""}.xlsx`;
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${fname}"`,
      "Cache-Control": "no-store",
    },
  });
}
