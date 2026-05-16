/**
 * Migration 055 — per-party Excel export.
 *
 * GET /api/personal-ledger/[partyId]/export.xlsx
 *
 * Three sheets:
 *   1. Invoices  — one row per live (non-cancelled) invoice, plus
 *                  expanded line-items below their parent invoice
 *   2. Receipts  — one row per live receipt, bucket-tagged
 *   3. Summary   — totals + per-bucket breakdown + outstanding
 *
 * Auth: developer / owner only (canUsePersonalLedger). Owner-scoped:
 * the route refuses if the party doesn't belong to the caller. Audit
 * log entry written on every successful download so Daksh can
 * see who exported what.
 *
 * Filename: Personal_Ledger_<party-name>_<YYYY-MM-DD>.xlsx
 */

import { NextResponse, type NextRequest } from "next/server";
import * as XLSX from "xlsx";
import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { canUsePersonalLedger } from "@/lib/personal-ledger-permissions";
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

function todayIso(): string {
  const t = Date.now() + 5.5 * 60 * 60 * 1000;
  const d = new Date(t);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

/** Slugify the party name for a filesystem-safe filename, keeping
 *  letters / digits / hyphens, collapsing the rest. Empty → "Party". */
function slugify(name: string): string {
  const cleaned = name
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return cleaned || "Party";
}

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

  const supabase = createAdminSupabaseClient();

  // Confirm party belongs to caller, then pull invoices + receipts
  // + buckets (separate query so we don't depend on PostgREST's
  // relational-embed schema cache for the new mig-055 FK).
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

  // ── Sheet 1: Invoices ─────────────────────────────────────────────
  //
  // Layout: one header row per invoice, then one indented row per
  // line-item underneath. Easier to read in Excel than a flat-items
  // sheet because the user can mentally group items by invoice.
  //
  // Mig 055 follow-on (Daksh): invoice header rows now carry a
  // derived Unit cell (SFT / CFT / MIX) plus the full Net/Tax/Total
  // triple so the sheet is scannable without expanding the line
  // items below.
  const invoiceRows: Array<Record<string, string | number>> = [];
  let invoicedTotal = 0;
  let invoicedSubtotal = 0;
  let invoicedTax = 0;
  for (const inv of invoices) {
    const subtotal = Number(inv.subtotal ?? 0);
    const tax = Number(inv.gst_amount ?? 0);
    const total = Number(inv.total ?? 0);
    invoicedTotal += total;
    invoicedSubtotal += subtotal;
    invoicedTax += tax;
    const items = Array.isArray(inv.items_json)
      ? (inv.items_json as InvoiceItem[])
      : [];
    const unitsSet = new Set(
      items
        .map((it) => String(it.unit ?? "").toUpperCase())
        .filter((u) => u),
    );
    const unitLabel =
      unitsSet.size === 0
        ? "—"
        : unitsSet.size === 1
        ? Array.from(unitsSet)[0]
        : "MIX";

    invoiceRows.push({
      "Invoice #": inv.invoice_no,
      "Date": inv.invoice_date,
      "Description": "(items below)",
      "Stone": "",
      "Unit": unitLabel,
      "Qty": "",
      "Rate (₹)": "",
      "Line total (₹)": "",
      "Net (₹)": subtotal,
      "Tax (₹)": tax,
      "Total (₹)": total,
      "Notes": inv.notes ?? "",
    });
    for (const it of items) {
      invoiceRows.push({
        "Invoice #": "",
        "Date": "",
        "Description": String(it.description ?? ""),
        "Stone": String(it.stone_type ?? ""),
        "Unit": String((it.unit ?? "") as string).toUpperCase(),
        "Qty": Number(it.quantity ?? 0),
        "Rate (₹)": Number(it.rate ?? 0),
        "Line total (₹)": Number(it.line_total ?? 0),
        "Net (₹)": "",
        "Tax (₹)": "",
        "Total (₹)": "",
        "Notes": "",
      });
    }
  }
  // Footer subtotals so Excel readers see Net + Tax + Total at the bottom.
  if (invoices.length > 0) {
    invoiceRows.push({
      "Invoice #": "",
      "Date": "",
      "Description": "",
      "Stone": "",
      "Unit": "",
      "Qty": "",
      "Rate (₹)": "",
      "Line total (₹)": "",
      "Net (₹)": "",
      "Tax (₹)": "",
      "Total (₹)": "",
      "Notes": "",
    });
    invoiceRows.push({
      "Invoice #": "TOTAL",
      "Date": "",
      "Description": "Subtotals",
      "Stone": "",
      "Unit": "",
      "Qty": "",
      "Rate (₹)": "",
      "Line total (₹)": "",
      "Net (₹)": invoicedSubtotal,
      "Tax (₹)": invoicedTax,
      "Total (₹)": invoicedTotal,
      "Notes": "",
    });
  }
  // Always have at least one row so XLSX can derive headers.
  if (invoiceRows.length === 0) {
    invoiceRows.push({
      "Invoice #": "",
      "Date": "",
      "Description": "(no invoices)",
      "Stone": "",
      "Unit": "",
      "Qty": "",
      "Rate (₹)": "",
      "Line total (₹)": "",
      "Net (₹)": "",
      "Tax (₹)": "",
      "Total (₹)": "",
      "Notes": "",
    });
  }
  const wsInvoices = XLSX.utils.json_to_sheet(invoiceRows);
  wsInvoices["!cols"] = [
    { wch: 14 }, // Invoice #
    { wch: 12 }, // Date
    { wch: 30 }, // Description
    { wch: 14 }, // Stone
    { wch: 8 },  // Unit
    { wch: 8 },  // Qty
    { wch: 12 }, // Rate
    { wch: 14 }, // Line total
    { wch: 14 }, // Net
    { wch: 12 }, // Tax
    { wch: 14 }, // Total
    { wch: 32 }, // Notes
  ];

  // ── Sheet 2: Receipts ─────────────────────────────────────────────
  // Mig 055 follow-on (Daksh): add per-bucket subtotal rows at the
  // bottom of the sheet + a final TOTAL RECEIVED row, so the sheet
  // is "Excel-complete" without the reader having to pivot.
  const receivedTotal = receipts.reduce((s, r) => s + Number(r.amount ?? 0), 0);
  const receiptRows: Array<Record<string, string | number>> = receipts.map(
    (r) => ({
      "Date": r.receipt_date,
      "Bucket": bucketLabelById.get(r.bucket_id) ?? "—",
      "Amount (₹)": Number(r.amount ?? 0),
      "Note": r.note ?? "",
    }),
  );
  if (receipts.length > 0) {
    // Per-bucket subtotals (sorted desc by total — biggest receiver
    // bubbles to the top of the subtotal block).
    const byBucketLocal = new Map<string, number>();
    for (const r of receipts) {
      const label = bucketLabelById.get(r.bucket_id) ?? "—";
      byBucketLocal.set(
        label,
        (byBucketLocal.get(label) ?? 0) + Number(r.amount ?? 0),
      );
    }
    receiptRows.push({ "Date": "", "Bucket": "", "Amount (₹)": "", "Note": "" });
    for (const [label, total] of [...byBucketLocal.entries()].sort(
      (a, b) => b[1] - a[1],
    )) {
      receiptRows.push({
        "Date": "",
        "Bucket": `Subtotal · ${label}`,
        "Amount (₹)": Number(total.toFixed(2)),
        "Note": "",
      });
    }
    receiptRows.push({
      "Date": "",
      "Bucket": "TOTAL RECEIVED",
      "Amount (₹)": Number(receivedTotal.toFixed(2)),
      "Note": "",
    });
    receiptRows.push({ "Date": "", "Bucket": "", "Amount (₹)": "", "Note": "" });
    receiptRows.push({
      "Date": "",
      "Bucket": "OUTSTANDING",
      "Amount (₹)": Number((invoicedTotal - receivedTotal).toFixed(2)),
      "Note": "Total invoiced − Total received",
    });
  }
  if (receiptRows.length === 0) {
    receiptRows.push({
      "Date": "",
      "Bucket": "(no receipts)",
      "Amount (₹)": "",
      "Note": "",
    });
  }
  const wsReceipts = XLSX.utils.json_to_sheet(receiptRows);
  wsReceipts["!cols"] = [
    { wch: 14 }, // Date
    { wch: 22 }, // Bucket
    { wch: 14 }, // Amount
    { wch: 40 }, // Note
  ];

  // ── Sheet 3: Summary ──────────────────────────────────────────────
  //
  // Per-bucket aggregation so the user sees a clear "ICICI: ₹15,000 ·
  // Cash: ₹3,000" breakdown alongside the combined total + outstanding.
  const byBucket = new Map<string, number>();
  for (const r of receipts) {
    const label = bucketLabelById.get(r.bucket_id) ?? "—";
    byBucket.set(label, (byBucket.get(label) ?? 0) + Number(r.amount ?? 0));
  }
  const summaryRows: Array<Record<string, string | number>> = [
    { "Metric": "Party", "Value": partyName },
    { "Metric": "Exported on (IST)", "Value": todayIso() },
    { "Metric": "", "Value": "" },
    { "Metric": "── Invoices ──", "Value": "" },
    { "Metric": "Live invoices", "Value": invoices.length },
    { "Metric": "Net (₹)", "Value": Number(invoicedSubtotal.toFixed(2)) },
    { "Metric": "Tax / GST (₹)", "Value": Number(invoicedTax.toFixed(2)) },
    { "Metric": "Total invoiced (₹)", "Value": invoicedTotal },
    { "Metric": "", "Value": "" },
    { "Metric": "── Receipts ──", "Value": "" },
    { "Metric": "Live receipts", "Value": receipts.length },
    { "Metric": "Total received (₹)", "Value": receivedTotal },
    { "Metric": "", "Value": "" },
    {
      "Metric": "OUTSTANDING (₹)",
      "Value": Number((invoicedTotal - receivedTotal).toFixed(2)),
    },
    { "Metric": "  (Invoiced − Received)", "Value": "" },
    { "Metric": "", "Value": "" },
    { "Metric": "── Received by bucket ──", "Value": "" },
  ];
  if (byBucket.size === 0) {
    summaryRows.push({ "Metric": "(no buckets received yet)", "Value": "" });
  } else {
    for (const [label, total] of [...byBucket.entries()].sort(
      (a, b) => b[1] - a[1],
    )) {
      summaryRows.push({ "Metric": label, "Value": Number(total.toFixed(2)) });
    }
  }
  const wsSummary = XLSX.utils.json_to_sheet(summaryRows);
  wsSummary["!cols"] = [
    { wch: 28 }, // Metric
    { wch: 28 }, // Value
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, wsSummary, "Summary");
  XLSX.utils.book_append_sheet(wb, wsInvoices, "Invoices");
  XLSX.utils.book_append_sheet(wb, wsReceipts, "Receipts");

  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;

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
