// ──────────────────────────────────────────────────────────────────
// /api/accounts/hdfc-export — generate HDFC bulk-payment file
// ──────────────────────────────────────────────────────────────────
// Auth: developer / owner / accountant.
//
// Query params:
//   batch_id      — payment proposal_batch_id (defaults to "today's
//                   confirmed batch" if omitted)
//   payment_ids   — JSON array of bill_payment ids (alt to batch_id)
//   format        — "xlsx" (default, testing) or "csv" (production
//                   .001 — no header per HDFC spec)
//
// Picks every bill_payment in status='confirmed' (owner approved,
// awaiting paid). Joins bill + bill_vendor. Pre-flight refuses if
// any vendor is missing hdfc_bene_name / account / IFSC / bank
// name.
//
// Filename: HDFC client-code prefix + DDMM + 3-digit seq within
// today. Seq is calculated from prior audit_logs entries with
// action='hdfc_export_generated' that happened today.

import { NextResponse, type NextRequest } from "next/server";
import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { canManageAccounts } from "@/lib/accounts-permissions";
import { logAudit } from "@/lib/audit";
import {
  buildHdfcCsvFile,
  buildHdfcFilename,
  buildHdfcXlsxBuffer,
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
  const formatParam = (sp.get("format") || "xlsx").toLowerCase();
  const wantsCsv = formatParam === "csv" || formatParam === "001";

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

  const admin = createAdminSupabaseClient();

  // ── Load the confirmed payments + their bills + vendors ──────────
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
  } else if (paymentIds.length > 0) {
    q = q.in("id", paymentIds);
  }
  // If neither filter is set, exports ALL currently-confirmed
  // payments — which is what Daksh wants when he clicks the
  // header-level "Download HDFC payment file" button on Pay Today.

  const { data: rawRows, error } = await q;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!rawRows || rawRows.length === 0) {
    return NextResponse.json(
      { error: "No confirmed payments to export. Confirm at least one proposal first." },
      { status: 404 },
    );
  }

  // PostgREST embedded relations widen to a union; hand-shape.
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

  // ── Build the export rows ────────────────────────────────────────
  const now = new Date();
  const exportRows: HdfcExportRow[] = validRows.map(
    ({ payment, vendor }) => ({
      hdfcBeneName: vendor.hdfc_bene_name!,
      accountNumber: vendor.bank_account!,
      ifsc: vendor.ifsc!,
      bankName: vendor.bank_name!,
      beneEmail: vendor.email,
      amountInr: Number(payment.proposed_amount),
      valueDate: now,
    }),
  );

  // ── Sequence number — count prior exports today (IST) ────────────
  // Filename suffix increments per file generated within the same
  // calendar day. Driven off audit_logs so anyone on the team using
  // a different browser still sees a fresh sequence number.
  const todayIST = new Date(
    new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" }),
  );
  const istY = todayIST.getFullYear();
  const istM = todayIST.getMonth();
  const istD = todayIST.getDate();
  const dayStart = new Date(istY, istM, istD, 0, 0, 0).toISOString();
  const dayEnd = new Date(istY, istM, istD, 23, 59, 59).toISOString();
  const { count: priorTodayCount } = await admin
    .from("audit_logs")
    .select("id", { count: "exact", head: true })
    .eq("action", "hdfc_export_generated")
    .gte("created_at", dayStart)
    .lte("created_at", dayEnd);
  const daySequence = (priorTodayCount ?? 0) + 1;

  const filename = buildHdfcFilename(
    now,
    daySequence,
    wantsCsv ? "001" : "xlsx",
  );

  // ── Audit log (event only — never write file contents) ───────────
  const totalInr = exportRows.reduce((s, r) => s + r.amountInr, 0);
  void logAudit(
    profile.id,
    "hdfc_export_generated",
    "bill_payment_batch",
    batchId || `payments_${exportRows.length}`,
    {
      filename,
      format: wantsCsv ? "csv_001" : "xlsx_test",
      day_sequence: daySequence,
      row_count: exportRows.length,
      total_inr: totalInr,
      payment_ids: validRows.map((r) => r.payment.id),
      vendor_count: new Set(validRows.map((r) => r.vendor.id)).size,
    },
  );

  // ── Return file ──────────────────────────────────────────────────
  if (wantsCsv) {
    const csv = buildHdfcCsvFile(exportRows);
    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store, must-revalidate",
      },
    });
  }

  // Default: xlsx with header (Daksh's verification mode).
  // NextResponse's BodyInit doesn't accept Node Buffer directly in
  // Next 15 — wrap as Uint8Array which IS valid BodyInit.
  const buf = buildHdfcXlsxBuffer(exportRows);
  return new NextResponse(new Uint8Array(buf), {
    status: 200,
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store, must-revalidate",
    },
  });
}
