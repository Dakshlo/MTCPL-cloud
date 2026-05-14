// ──────────────────────────────────────────────────────────────────
// HDFC bulk-payment Excel export
// ──────────────────────────────────────────────────────────────────
// Builds an .xlsx of every CONFIRMED bill_payment (owner has ticked,
// accountant hasn't paid yet) in roughly the column layout that HDFC's
// "Bulk Payment Upload" template expects:
//
//   Payment Type | Beneficiary Name | Beneficiary Account Number |
//   IFSC Code   | Beneficiary Bank | Amount | Customer Reference |
//   Narration   | Beneficiary Email | Mobile Number
//
// Different HDFC products (NetBanking bulk, PayCheckPlus, etc.) use
// slightly different header names — Daksh can tweak the column names
// in this file once he sees the actual sheet his bank provides. The
// data shape is what matters.
//
// Payment type heuristic:
//   • Amount ≥ ₹2 lakh → RTGS (mandatory for large transfers)
//   • Amount  < ₹2 lakh → NEFT
//   Accountant can edit the cells before uploading if any specific
//   row needs IMPS, same-day RTGS, etc.
//
// Auth: same gate as the Pay Today page. Crosscheck role is
// intentionally excluded (canConfirmPayments deliberately doesn't
// include crosscheck — they only verify bills, not payments).

import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import {
  canConfirmPayments,
  canManageAccounts,
} from "@/lib/accounts-permissions";
import * as XLSX from "xlsx";

const RTGS_THRESHOLD = 200_000; // ₹2 lakh — RBI's RTGS floor for bulk

export async function GET(_req: NextRequest) {
  const { profile } = await requireAuth();
  // Either an approver (owner / dev / can_approve_bills) or the
  // accountant — both have a legitimate reason to download.
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
      "id, status, proposed_amount, confirmed_at, bills(id, token, vendor_bill_no, bill_vendor_id, bill_vendors(id, name, bank_account, ifsc, bank_name, email, phone))",
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
          vendor_bill_no: string | null;
          bill_vendors:
            | {
                id: string;
                name: string;
                bank_account: string | null;
                ifsc: string | null;
                bank_name: string | null;
                email: string | null;
                phone: string | null;
              }
            | {
                id: string;
                name: string;
                bank_account: string | null;
                ifsc: string | null;
                bank_name: string | null;
                email: string | null;
                phone: string | null;
              }[]
            | null;
        }
      | null;
  };
  const rawRows = ((data ?? []) as unknown) as Row[];

  // Map into HDFC-flavoured spreadsheet rows.
  const sheetRows = rawRows.map((r) => {
    const b = r.bills;
    const v = b
      ? Array.isArray(b.bill_vendors)
        ? b.bill_vendors[0] ?? null
        : b.bill_vendors
      : null;
    const amount = Number(r.proposed_amount) || 0;
    // Customer Reference is what shows up in the bank statement +
    // the vendor's view. Combine our internal token with the
    // vendor's own bill number so both sides can trace it. HDFC
    // typically caps this at ~35 chars — clip to be safe.
    const refRaw = b
      ? `${b.token}${b.vendor_bill_no ? "/" + b.vendor_bill_no : ""}`
      : "";
    const ref = refRaw.slice(0, 35);
    return {
      "Payment Type": amount >= RTGS_THRESHOLD ? "RTGS" : "NEFT",
      "Beneficiary Name": v?.name ?? "",
      "Beneficiary Account Number": v?.bank_account ?? "",
      "IFSC Code": v?.ifsc ?? "",
      "Beneficiary Bank": v?.bank_name ?? "",
      Amount: amount,
      "Customer Reference": ref,
      Narration: b ? `MTCPL bill ${b.token}` : "MTCPL payment",
      "Beneficiary Email": v?.email ?? "",
      "Mobile Number": v?.phone ?? "",
    };
  });

  // Build the sheet — even if there are zero confirmed payments,
  // emit the header row so the accountant can sanity-check the
  // format and see exactly what fields the bank file needs.
  const headerOnly = [
    {
      "Payment Type": "",
      "Beneficiary Name": "",
      "Beneficiary Account Number": "",
      "IFSC Code": "",
      "Beneficiary Bank": "",
      Amount: "",
      "Customer Reference": "",
      Narration: "",
      "Beneficiary Email": "",
      "Mobile Number": "",
    },
  ];
  const ws = XLSX.utils.json_to_sheet(
    sheetRows.length > 0 ? sheetRows : headerOnly,
    {
      // Force the column order — without this xlsx picks alphabetical.
      header: [
        "Payment Type",
        "Beneficiary Name",
        "Beneficiary Account Number",
        "IFSC Code",
        "Beneficiary Bank",
        "Amount",
        "Customer Reference",
        "Narration",
        "Beneficiary Email",
        "Mobile Number",
      ],
    },
  );

  ws["!cols"] = [
    { wch: 12 }, // Payment Type
    { wch: 28 }, // Beneficiary Name
    { wch: 22 }, // Beneficiary Account Number
    { wch: 14 }, // IFSC Code
    { wch: 22 }, // Beneficiary Bank
    { wch: 14 }, // Amount
    { wch: 22 }, // Customer Reference
    { wch: 28 }, // Narration
    { wch: 24 }, // Email
    { wch: 14 }, // Mobile
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Bulk Payment");

  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

  const stamp = new Date()
    .toLocaleString("en-IN", {
      timeZone: "Asia/Kolkata",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    })
    .replace(/[/:\s,]+/g, "-");
  const filename = `mtcpl-hdfc-bulk-payment-${stamp}.xlsx`;

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
