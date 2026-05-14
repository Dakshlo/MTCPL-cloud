// ──────────────────────────────────────────────────────────────────
// HDFC ENet bulk-payment Excel export
// ──────────────────────────────────────────────────────────────────
// Generates an .xlsx in the exact column layout HDFC's ENet bulk-
// upload screen expects. The first attempt (initial commit) used a
// generic "name / account / IFSC" structure which HDFC's parser
// rejected — every row came back amount=0 + blank beneficiary
// because the column headers didn't match.
//
// The real format, confirmed from a working salary upload at
// MTCPL's actual ENet, is 7 columns in this exact order:
//
//   1. CBX Reference number   — unique reference per row, must be
//                               non-empty and unique within the file
//   2. Transfer From          — MTCPL's HDFC debit account number
//   3. Transfer To            — vendor's bank account number (lookup
//                               into ENet Beneficiary Master)
//   4. Amount                 — plain number, no commas / no symbol
//   5. Initiation date        — DD/MM/YYYY HH:MM:SS AM/PM
//   6. Value date             — DD-MM-YYYY  (note: dashes, not slashes)
//   7. Beneficiary name       — vendor name (uppercase, must match
//                               the name registered in the ENet
//                               Beneficiary Master)
//
// IFSC is NOT in the file — HDFC looks it up from the pre-registered
// beneficiary by account number. This means each vendor MUST be
// added to the ENet Beneficiary Master first (one-time per vendor)
// before the bulk file can pay them. New beneficiaries also have a
// 30-min cooling period in ENet.
//
// Payment mode (NEFT vs RTGS) is NOT a column either — it's set by
// the "Business Product" dropdown at upload time. Mixing modes in
// one file isn't supported; large payments (>= ₹2L typically RTGS)
// need a separate file upload.
//
// MTCPL's debit account is currently hardcoded below — move to an
// env var (or a system_settings row) when convenient.
// ──────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import {
  canConfirmPayments,
  canManageAccounts,
} from "@/lib/accounts-permissions";
import * as XLSX from "xlsx";

// MTCPL's HDFC current account that funds these payouts. Sourced
// from the working salary file Rohit uploaded on 06-Apr-2026
// (Transfer From column was 50200034844082 in every row). Update
// this if Daksh switches accounts.
const MTCPL_DEBIT_ACCOUNT =
  process.env.MTCPL_HDFC_DEBIT_ACCOUNT?.trim() || "50200034844082";

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

/** DD/MM/YYYY HH:MM:SS AM/PM — matches HDFC's "Initiation date" column. */
function formatInitiationDate(d: Date): string {
  const dd = pad2(d.getDate());
  const mm = pad2(d.getMonth() + 1);
  const yyyy = d.getFullYear();
  let hh = d.getHours();
  const ampm = hh >= 12 ? "PM" : "AM";
  hh = hh % 12;
  if (hh === 0) hh = 12;
  return `${dd}/${mm}/${yyyy} ${pad2(hh)}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())} ${ampm}`;
}

/** DD-MM-YYYY — matches HDFC's "Value date" column. */
function formatValueDate(d: Date): string {
  return `${pad2(d.getDate())}-${pad2(d.getMonth() + 1)}-${d.getFullYear()}`;
}

/** DDMMYY without separators — used to build the CBX Reference. */
function formatDDMMYY(d: Date): string {
  return `${pad2(d.getDate())}${pad2(d.getMonth() + 1)}${String(d.getFullYear()).slice(2)}`;
}

export async function GET(_req: NextRequest) {
  const { profile } = await requireAuth();
  // Either an approver (owner / dev / can_approve_bills) or the
  // accountant — both have a legitimate reason to download. Crosscheck
  // is excluded (they verify bills, not payments).
  if (!canConfirmPayments(profile) && !canManageAccounts(profile)) {
    return NextResponse.json(
      { error: "Not authorised to export bank payment file." },
      { status: 403 },
    );
  }

  const supabase = createAdminSupabaseClient();
  const { data, error } = await supabase
    .from("bill_payments")
    .select(
      "id, status, proposed_amount, confirmed_at, bills(id, token, bill_vendor_id, bill_vendors(id, name, bank_account))",
    )
    .eq("status", "confirmed")
    .order("confirmed_at", { ascending: true });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  type Row = {
    id: string;
    proposed_amount: number;
    bills:
      | {
          id: string;
          token: string;
          bill_vendors:
            | { id: string; name: string; bank_account: string | null }
            | { id: string; name: string; bank_account: string | null }[]
            | null;
        }
      | null;
  };
  const rawRows = ((data ?? []) as unknown) as Row[];

  const now = new Date();
  const initiation = formatInitiationDate(now);
  const valueDate = formatValueDate(now);
  const dateStamp = formatDDMMYY(now);

  // Build rows in HDFC's exact column order. xlsx writes columns in
  // the order keys appear in the FIRST row of json_to_sheet input, so
  // we keep this object literal order consistent across all rows.
  const sheetRows = rawRows.map((r, idx) => {
    const b = r.bills;
    const v = b
      ? Array.isArray(b.bill_vendors)
        ? b.bill_vendors[0] ?? null
        : b.bill_vendors
      : null;
    const amount = Number(r.proposed_amount) || 0;
    // CBX Reference: HDFC's sample used C{seq}{DDMMYY}{HHMMSS}. We
    // emit MT-{first8of payment uuid}-{DDMMYY}-{seq} so each row is
    // unique AND traceable back to our bill_payment row from a bank
    // statement.
    const refSeq = String(idx + 1).padStart(4, "0");
    const ref = `MT-${r.id.slice(0, 8)}-${dateStamp}-${refSeq}`;
    return {
      "CBX Reference number": ref,
      "Transfer From": MTCPL_DEBIT_ACCOUNT,
      "Transfer To": (v?.bank_account ?? "").trim(),
      Amount: amount,
      "Initiation date": initiation,
      "Value date": valueDate,
      // Beneficiary name is UPPERCASED to match the convention in
      // HDFC's working salary file. Must also match the name
      // registered in the ENet Beneficiary Master — if HDFC's parser
      // is strict about case/spacing on lookup, the row will reject.
      "Beneficiary name": (v?.name ?? "").trim().toUpperCase(),
    };
  });

  // Always emit at least one row so the header shows up even when
  // there's nothing to pay. Useful for sanity-checking the format.
  const headerOnly: Record<string, string | number> = {
    "CBX Reference number": "",
    "Transfer From": MTCPL_DEBIT_ACCOUNT,
    "Transfer To": "",
    Amount: 0,
    "Initiation date": "",
    "Value date": "",
    "Beneficiary name": "",
  };

  const ws = XLSX.utils.json_to_sheet(
    sheetRows.length > 0 ? sheetRows : [headerOnly],
    {
      header: [
        "CBX Reference number",
        "Transfer From",
        "Transfer To",
        "Amount",
        "Initiation date",
        "Value date",
        "Beneficiary name",
      ],
    },
  );

  ws["!cols"] = [
    { wch: 22 }, // CBX Reference
    { wch: 18 }, // Transfer From
    { wch: 18 }, // Transfer To
    { wch: 12 }, // Amount
    { wch: 22 }, // Initiation date
    { wch: 14 }, // Value date
    { wch: 30 }, // Beneficiary name
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Bulk Payment");

  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

  // Filename mirrors HDFC's own naming pattern from the rejection
  // file — DDMMYY-HHMMSS — so multiple downloads in a day are easy
  // to tell apart in Downloads.
  const filename = `mtcpl-hdfc-bulk-payment-${dateStamp}-${pad2(now.getHours())}${pad2(now.getMinutes())}${pad2(now.getSeconds())}.xlsx`;

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
