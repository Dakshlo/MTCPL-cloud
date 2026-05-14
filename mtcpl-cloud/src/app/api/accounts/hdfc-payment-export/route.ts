// ──────────────────────────────────────────────────────────────────
// HDFC ENet bulk-payment Excel export
// ──────────────────────────────────────────────────────────────────
// Generates an .xlsx for HDFC ENet's bulk-upload screen. Initial
// attempt used a generic name/account/IFSC structure which HDFC's
// parser rejected — every row came back amount=0 + blank beneficiary
// because the column headers didn't match.
//
// Column layout (mirrors HDFC's working salary file template exactly;
// some columns we fill, some we leave blank for the bank or the
// upload dialog to stamp):
//
//   1. CBX Reference number   — BANK GENERATED. Column kept, empty.
//                               HDFC writes C{seq}{DDMMYY}{HHMMSS}.
//   2. Transfer From          — Column kept, empty. Daksh confirmed
//                               the debit account is picked from the
//                               dropdown on the Upload File dialog at
//                               submit time. We don't write a value
//                               but keep the column so the file's
//                               structure matches HDFC's template
//                               exactly (defensive — some parsers
//                               key off column position).
//   3. Transfer To            — vendor's bank account number (we fill)
//   4. Amount                 — plain number (we fill)
//   5. Initiation date        — DD/MM/YYYY HH:MM:SS AM/PM (we fill)
//   6. Value date             — DD-MM-YYYY (we fill)
//   7. Beneficiary name       — uppercase, must match the registered
//                               Beneficiary Master entry (we fill)
//   8. Input user             — BANK STAMPED. Column kept, empty.
//   9. Input Date time        — BANK STAMPED. Column kept, empty.
//
// NOT in the file at all:
//   • IFSC — HDFC looks it up from the pre-registered Beneficiary
//     Master by account number. Each vendor MUST be added to ENet's
//     Beneficiary Master one-time (30-min cooling period for new
//     entries) before the bulk file can pay them.
//   • Payment mode (NEFT/RTGS) — set by the "Business Product"
//     dropdown at upload time. Mixed-mode files aren't supported;
//     large payments (≥ ₹2L → RTGS) need a separate upload.
// ──────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import {
  canConfirmPayments,
  canManageAccounts,
} from "@/lib/accounts-permissions";
import * as XLSX from "xlsx";

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

/** DDMMYY without separators — used for the download filename. */
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
  const sheetRows = rawRows.map((r) => {
    const b = r.bills;
    const v = b
      ? Array.isArray(b.bill_vendors)
        ? b.bill_vendors[0] ?? null
        : b.bill_vendors
      : null;
    const amount = Number(r.proposed_amount) || 0;
    return {
      // CBX Reference: HDFC generates on upload (C{seq}{DDMMYY}{HHMMSS}).
      // Column kept, value blank.
      "CBX Reference number": "",
      // Transfer From: picked from the dropdown at upload time.
      // Column kept, value blank, so the file structure matches
      // HDFC's template exactly.
      "Transfer From": "",
      "Transfer To": (v?.bank_account ?? "").trim(),
      Amount: amount,
      "Initiation date": initiation,
      "Value date": valueDate,
      // Beneficiary name is UPPERCASED to match the convention in
      // HDFC's working salary file. Must also match the name
      // registered in the ENet Beneficiary Master — if HDFC's parser
      // is strict about case/spacing on lookup, the row will reject.
      "Beneficiary name": (v?.name ?? "").trim().toUpperCase(),
      // Bank-stamped at upload — column present, value empty.
      "Input user": "",
      "Input Date time": "",
    };
  });

  // Always emit at least one row so the header shows up even when
  // there's nothing to pay. Useful for sanity-checking the format.
  const headerOnly: Record<string, string | number> = {
    "CBX Reference number": "",
    "Transfer From": "",
    "Transfer To": "",
    Amount: 0,
    "Initiation date": "",
    "Value date": "",
    "Beneficiary name": "",
    "Input user": "",
    "Input Date time": "",
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
        "Input user",
        "Input Date time",
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
    { wch: 14 }, // Input user
    { wch: 22 }, // Input Date time
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
