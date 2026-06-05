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
  // Top-level try/catch — without this, any runtime error inside the
  // route handler is rendered by Next.js as an HTML 500 error page.
  // The browser receives HTML when it expected an attachment, opens
  // it in a new window, and Daksh sees source code instead of a
  // download. With this wrapper, every failure path returns a JSON
  // body the user can at least see the error text from.
  try {
    return await handleHdfcExport(req);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    console.error("[/api/accounts/hdfc-export] crashed", e);
    return NextResponse.json(
      {
        error:
          "HDFC export failed: " +
          msg +
          ". Tell Daksh and screenshot — the route's catch-all caught this so the rest of the system is unaffected.",
      },
      { status: 500 },
    );
  }
}

async function handleHdfcExport(req: NextRequest) {
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
  // Mig 048 follow-on (Daksh, May 2026): the client buttons call
  // this route first with ?check_only=1 so they can show a nice
  // missing-fields panel instead of dumping raw JSON in a new tab.
  // check_only runs the same pre-flight validation but DOES NOT
  // generate the file, DOES NOT mark anything as downloaded.
  // Returns 200 { ok: true } when clean, 400 with missing[] when not.
  const checkOnly = sp.get("check_only") === "1";

  // Mig 048 download-lock semantics:
  //   xlsx (preview) → returns every CONFIRMED payment in scope,
  //                    including ones already downloaded. Doesn't
  //                    write to the lock columns. Idempotent.
  //   csv  (final)   → returns only CONFIRMED + NOT-yet-downloaded.
  //                    After the file is built, marks each included
  //                    payment with hdfc_csv_downloaded_at + _by so
  //                    a second click can't re-issue the same rows.
  //
  // Daksh June 2026 — RE-ENABLED. The one-shot lock had been
  // temporarily off, which let the same CSV be downloaded twice — and
  // a batch got paid into HDFC twice by accident. With this TRUE the
  // CSV endpoint returns only CONFIRMED + not-yet-downloaded rows and
  // stamps hdfc_csv_downloaded_at on every row it serves, so a second
  // download of the same batch returns "nothing new" and the next
  // confirmed batch becomes the one available to download.
  const LOCK_HDFC_CSV_DOWNLOAD = true;

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
      "id, status, proposed_amount, proposal_batch_id, bill_id, hdfc_csv_downloaded_at, " +
        "bills!inner(id, token, description, cost_head, partial_rejection_amount, amount_payable_to_vendor, amount_outstanding, " +
        "bill_vendors!inner(id, name, hdfc_bene_name, bank_account, ifsc, bank_name, email))",
    )
    .eq("status", "confirmed");

  if (batchId) {
    q = q.eq("proposal_batch_id", batchId);
  } else if (paymentIds.length > 0) {
    q = q.in("id", paymentIds);
  }

  // CSV mode: filter to rows that haven't been included in a prior
  // CSV download. Excel mode skips this filter on purpose (it's the
  // preview / verification view).
  if (wantsCsv && LOCK_HDFC_CSV_DOWNLOAD) {
    q = q.is("hdfc_csv_downloaded_at", null);
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
      {
        error: wantsCsv
          ? "Nothing new to download — every currently-confirmed payment has already been included in a previous CSV. Wait for new confirmations, or ask a developer to unlock specific rows."
          : "No confirmed payments to export. Confirm at least one proposal first.",
      },
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
    proposal_batch_id: string | null;
    bill_id: string;
    hdfc_csv_downloaded_at: string | null;
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

  // check_only mode: pre-flight passed, but we don't generate the
  // file. Tells the client "yes, you can download this safely" so
  // it can proceed to the real call (which will lock).
  if (checkOnly) {
    return NextResponse.json({
      ok: true,
      eligibleCount: validRows.length,
      totalInr: validRows.reduce(
        (s, r) => s + Number(r.payment.proposed_amount),
        0,
      ),
    });
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
  //
  // Earlier attempt parsed `new Date(toLocaleString)` which returned
  // Invalid Date on Vercel's Node ICU build and crashed the route
  // with "RangeError: Invalid time value" at the next .toISOString().
  // Now using direct UTC math: IST = UTC + 5:30. Bulletproof,
  // engine-agnostic.
  const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
  const DAY_MS = 24 * 60 * 60 * 1000;
  const nowMs = Date.now();
  const istNowMs = nowMs + IST_OFFSET_MS;
  const istMidnightMs = Math.floor(istNowMs / DAY_MS) * DAY_MS;
  const dayStartMs = istMidnightMs - IST_OFFSET_MS;
  const dayEndMs = dayStartMs + DAY_MS - 1;
  const dayStart = new Date(dayStartMs).toISOString();
  const dayEnd = new Date(dayEndMs).toISOString();
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
    // Mig 048 — lock every payment row included in this CSV so a
    // second click can't re-issue the same rows. Done BEFORE
    // streaming the file back so a network-cut response can't
    // leave the lock unset. Idempotent: the UPDATE is gated by
    // hdfc_csv_downloaded_at IS NULL, so concurrent requests for
    // the same set race-safely with each other.
    //
    // Daksh (May 2026): gated behind LOCK_HDFC_CSV_DOWNLOAD — when
    // false, we serve the CSV but skip the write-back so the same
    // rows stay re-downloadable. Flip the flag back to true to
    // restore the one-shot behaviour.
    if (LOCK_HDFC_CSV_DOWNLOAD) {
      const lockNow = new Date().toISOString();
      const lockIds = validRows.map((r) => r.payment.id);
      const { error: lockErr } = await admin
        .from("bill_payments")
        .update({
          hdfc_csv_downloaded_at: lockNow,
          hdfc_csv_downloaded_by: profile.id,
          updated_at: lockNow,
        })
        .in("id", lockIds)
        .is("hdfc_csv_downloaded_at", null);
      if (lockErr) {
        console.warn("[hdfc-export] lock update failed", lockErr);
        return NextResponse.json(
          {
            error:
              "Couldn't lock the payments after generating the file. Try again — if it keeps failing, contact a developer.",
          },
          { status: 500 },
        );
      }
    }

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
