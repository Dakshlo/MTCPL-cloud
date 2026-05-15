// ──────────────────────────────────────────────────────────────────
// /api/accounts/hdfc-export — generate HDFC bulk-payment .001 CSV
// ──────────────────────────────────────────────────────────────────
// Auth: developer / owner / accountant (via canManageAccounts).
//
// Query params:
//   batch_id     — payment proposal_batch_id to export
//   payment_ids  — JSON-array of specific bill_payment ids (alt to
//                  batch_id). When both passed, batch_id wins.
//
// Picks every bill_payment row in status='confirmed' (owner has
// approved, accountant hasn't marked paid yet). For each, joins the
// bill + bill_vendor. Runs a pre-flight check that every vendor has
// the HDFC fields filled (hdfc_bene_name, bank_account, ifsc,
// bank_name). If anything's missing the route returns 400 with a
// machine-readable list the UI can render as a fix list.
//
// On success: returns the file as text/csv with a
// Content-Disposition header that names it per HDFC spec.

import { NextResponse, type NextRequest } from "next/server";
import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { canManageAccounts } from "@/lib/accounts-permissions";
import { logAudit } from "@/lib/audit";
import {
  buildHdfcCsvFile,
  buildHdfcFilename,
  type HdfcExportRow,
} from "@/lib/hdfc-export";

type MissingFieldReason = {
  paymentId: string;
  billToken: string;
  vendorId: string;
  vendorName: string;
  missing: string[];
};

export async function GET(req: NextRequest) {
  const { profile } = await requireAuth();
  if (!canManageAccounts(profile)) {
    return NextResponse.json(
      { error: "Only developer / owner / accountant can export HDFC files." },
      { status: 403 },
    );
  }

  const sp = req.nextUrl.searchParams;
  const batchId = sp.get("batch_id") || "";
  const paymentIdsParam = sp.get("payment_ids") || "";

  let paymentIds: string[] = [];
  if (paymentIdsParam) {
    try {
      const parsed = JSON.parse(paymentIdsParam);
      if (Array.isArray(parsed)) {
        paymentIds = parsed.map((x) => String(x)).filter(Boolean);
      }
    } catch {
      return NextResponse.json(
        { error: "Bad payment_ids — expected JSON array." },
        { status: 400 },
      );
    }
  }

  if (!batchId && paymentIds.length === 0) {
    return NextResponse.json(
      { error: "Pass either batch_id or payment_ids[]." },
      { status: 400 },
    );
  }

  const admin = createAdminSupabaseClient();

  // ── Load the confirmed payments + their bills + vendors ──────────
  // Embedded PostgREST joins keep this to one round-trip.
  let q = admin
    .from("bill_payments")
    .select(
      "id, status, proposed_amount, proposed_batch_id, bill_id, " +
        "bills!inner(id, token, description, cost_head, partial_rejection_amount, amount_payable_to_vendor, amount_outstanding, " +
        "bill_vendors!inner(id, name, hdfc_bene_name, bank_account, ifsc, bank_name, email))",
    )
    .eq("status", "confirmed");

  if (batchId) {
    q = q.eq("proposed_batch_id", batchId);
  } else {
    q = q.in("id", paymentIds);
  }

  const { data: rawRows, error } = await q;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!rawRows || rawRows.length === 0) {
    return NextResponse.json(
      { error: "No confirmed payments found for this batch." },
      { status: 404 },
    );
  }

  // PostgREST embedded-relation typing is too loose for TS, hand-shape.
  type Vendor = {
    id: string;
    name: string;
    hdfc_bene_name: string | null;
    bank_account: string | null;
    ifsc: string | null;
    bank_name: string | null;
    email: string | null;
  };
  type Bill = {
    id: string;
    token: string;
    description: string;
    cost_head: string | null;
    partial_rejection_amount: number | null;
    amount_payable_to_vendor: number;
    amount_outstanding: number;
    bill_vendors: Vendor | Vendor[] | null;
  };
  type Row = {
    id: string;
    status: string;
    proposed_amount: number;
    proposed_batch_id: string | null;
    bill_id: string;
    bills: Bill | Bill[] | null;
  };
  const rows = rawRows as unknown as Row[];

  // ── Pre-flight validation ────────────────────────────────────────
  const missing: MissingFieldReason[] = [];
  const validRows: Array<{
    payment: Row;
    bill: Bill;
    vendor: Vendor;
  }> = [];

  for (const p of rows) {
    const bill = Array.isArray(p.bills) ? p.bills[0] : p.bills;
    if (!bill) {
      missing.push({
        paymentId: p.id,
        billToken: "?",
        vendorId: "?",
        vendorName: "Unknown",
        missing: ["bill row not found"],
      });
      continue;
    }
    const v = Array.isArray(bill.bill_vendors)
      ? bill.bill_vendors[0]
      : bill.bill_vendors;
    if (!v) {
      missing.push({
        paymentId: p.id,
        billToken: bill.token,
        vendorId: "?",
        vendorName: "Unknown",
        missing: ["vendor row not found"],
      });
      continue;
    }
    const lacks: string[] = [];
    if (!v.hdfc_bene_name) lacks.push("HDFC Beneficiary Name");
    if (!v.bank_account) lacks.push("Bank Account Number");
    if (!v.ifsc) lacks.push("IFSC code");
    if (!v.bank_name) lacks.push("Bank Name");
    if (lacks.length > 0) {
      missing.push({
        paymentId: p.id,
        billToken: bill.token,
        vendorId: v.id,
        vendorName: v.name,
        missing: lacks,
      });
      continue;
    }
    validRows.push({ payment: p, bill, vendor: v });
  }

  if (missing.length > 0) {
    return NextResponse.json(
      {
        error:
          missing.length === 1
            ? `Vendor "${missing[0].vendorName}" is missing required fields. Open the vendor record and add: ${missing[0].missing.join(", ")}.`
            : `${missing.length} vendors are missing required fields. Fix each one in /accounts/vendors before exporting.`,
        missing,
      },
      { status: 400 },
    );
  }

  // ── Build the CSV ────────────────────────────────────────────────
  const now = new Date();
  const exportRows: HdfcExportRow[] = validRows.map(
    ({ payment, bill, vendor }, idx) => ({
      seq: idx + 1,
      hdfcBeneName: vendor.hdfc_bene_name!,
      accountNumber: vendor.bank_account!,
      ifsc: vendor.ifsc!,
      bankName: vendor.bank_name!,
      beneEmail: vendor.email,
      amountInr: Number(payment.proposed_amount),
      billToken: bill.token,
      costHead: bill.cost_head,
      description: bill.description,
      valueDate: now,
    }),
  );

  const csv = buildHdfcCsvFile(exportRows);
  const filename = buildHdfcFilename(now);

  // ── Audit trail (event only — never write file contents) ─────────
  const totalInr = exportRows.reduce((s, r) => s + r.amountInr, 0);
  void logAudit(
    profile.id,
    "hdfc_export_generated",
    "bill_payment_batch",
    batchId || `payments_${exportRows.length}`,
    {
      filename,
      row_count: exportRows.length,
      total_inr: totalInr,
      payment_ids: validRows.map((r) => r.payment.id),
      vendor_count: new Set(validRows.map((r) => r.vendor.id)).size,
    },
  );

  // ── Return as a downloadable file ────────────────────────────────
  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      // No-cache so a re-export always pulls fresh data + writes a
      // fresh audit row.
      "Cache-Control": "no-store, must-revalidate",
    },
  });
}
