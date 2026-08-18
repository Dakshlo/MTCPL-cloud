// ──────────────────────────────────────────────────────────────────
// Bill Statement — the "master copy" of one bill (Daksh, Aug 2026)
// ──────────────────────────────────────────────────────────────────
// A voucher covers ONE payment. Bills here are settled in parts — the
// Dudeshwar Transport bill ran to eleven ₹50,000 NEFTs — so there was
// no single sheet showing the whole story. This is that sheet: bill +
// vendor identity, the money breakdown, and every instalment with its
// date, method, reference, who did it and the balance left after it.
//
// INTERNAL ONLY (Daksh: "its just of us"). It is never emailed or sent
// on WhatsApp — no action wires it to either — and the page says so on
// its face so a printed copy can't be mistaken for a vendor document.
//
// Access mirrors the voucher: anyone who can work the accounts module.
// ──────────────────────────────────────────────────────────────────

import { notFound, redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { canManageAccounts, canConfirmPayments } from "@/lib/accounts-permissions";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { getProfilesMap } from "@/lib/profiles";
import { StatementView, type StatementPayment } from "./statement-view";

type Params = Promise<{ id: string }>;

export default async function BillStatementPage({ params }: { params: Params }) {
  const { profile } = await requireAuth();
  if (!canManageAccounts(profile) && !canConfirmPayments(profile)) {
    redirect("/accounts");
  }

  const { id } = await params;
  const supabase = createAdminSupabaseClient();

  const { data: bill } = await supabase
    .from("bills")
    .select("id, token, vendor_bill_no, bill_date, description, cost_head, status, amount_subtotal, gst_percent, amount_gst, amount_total, amount_tds, amount_tcs, amount_payable_to_vendor, amount_paid, amount_outstanding, held_amount, held_reason, partial_rejection_amount, approved_at, approved_by, submitted_at, submitted_by, bill_vendors(id, name, address, gstin, pan, phone, email, bank_name, bank_account, ifsc)")
    .eq("id", id)
    .maybeSingle();
  if (!bill) notFound();

  // Every payment row, oldest first — the statement reads as a ledger,
  // so the running balance builds down the page.
  const { data: payRows } = await supabase
    .from("bill_payments")
    .select("id, status, proposed_amount, paid_amount, payment_method, payment_reference, payment_note, paid_at, paid_by, cancelled_at, cancel_reason, is_settlement, settlement_reason, is_debit_settlement, is_advance_application")
    .eq("bill_id", id)
    .order("paid_at", { ascending: true, nullsFirst: false })
    .order("id", { ascending: true });

  const rows = (payRows ?? []) as Array<Record<string, unknown>>;

  const profilesMap = await getProfilesMap();

  // Only rows that actually moved the balance appear in the ledger;
  // cancelled/proposed ones would make the running total lie.
  const payments: StatementPayment[] = rows
    .filter((r) => r.status === "paid")
    .map((r) => ({
      id: String(r.id),
      amount: Number(r.paid_amount ?? 0),
      paidAt: (r.paid_at as string | null) ?? null,
      method: (r.payment_method as string | null) ?? null,
      reference: (r.payment_reference as string | null) ?? null,
      note: (r.payment_note as string | null) ?? null,
      who: r.paid_by ? profilesMap[r.paid_by as string] ?? null : null,
      kind: r.is_settlement
        ? "settlement"
        : r.is_debit_settlement
          ? "debit"
          : r.is_advance_application
            ? "advance"
            : "bank",
      reason: (r.settlement_reason as string | null) ?? null,
    }));

  const cancelled = rows.filter((r) => r.status === "cancelled").length;

  const v = Array.isArray(bill.bill_vendors) ? bill.bill_vendors[0] : bill.bill_vendors;

  return (
    <StatementView
      bill={{
        token: String(bill.token),
        vendorBillNo: (bill.vendor_bill_no as string | null) ?? null,
        billDate: (bill.bill_date as string | null) ?? null,
        description: (bill.description as string | null) ?? null,
        costHead: (bill.cost_head as string | null) ?? null,
        status: String(bill.status),
        subtotal: Number(bill.amount_subtotal ?? 0),
        gstPercent: Number(bill.gst_percent ?? 0),
        gst: Number(bill.amount_gst ?? 0),
        total: Number(bill.amount_total ?? 0),
        tds: Number(bill.amount_tds ?? 0),
        tcs: Number(bill.amount_tcs ?? 0),
        payable: Number(bill.amount_payable_to_vendor ?? bill.amount_total ?? 0),
        paid: Number(bill.amount_paid ?? 0),
        outstanding: Number(bill.amount_outstanding ?? 0),
        held: Number(bill.held_amount ?? 0),
        heldReason: (bill.held_reason as string | null) ?? null,
        partialRejection: Number(bill.partial_rejection_amount ?? 0),
        approvedAt: (bill.approved_at as string | null) ?? null,
        approvedBy: bill.approved_by ? profilesMap[bill.approved_by as string] ?? null : null,
        submittedAt: (bill.submitted_at as string | null) ?? null,
        submittedBy: bill.submitted_by ? profilesMap[bill.submitted_by as string] ?? null : null,
      }}
      vendor={{
        name: v?.name ?? "—",
        address: v?.address ?? null,
        gstin: v?.gstin ?? null,
        pan: v?.pan ?? null,
        phone: v?.phone ?? null,
        email: v?.email ?? null,
        bankName: v?.bank_name ?? null,
        bankAccount: v?.bank_account ?? null,
        ifsc: v?.ifsc ?? null,
      }}
      payments={payments}
      cancelledCount={cancelled}
      billId={id}
      generatedBy={profile.full_name ?? "—"}
    />
  );
}
