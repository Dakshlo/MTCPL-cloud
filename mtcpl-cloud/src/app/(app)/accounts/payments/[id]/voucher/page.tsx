// ──────────────────────────────────────────────────────────────────
// Migration 042 — Payment voucher (downloadable / printable)
// ──────────────────────────────────────────────────────────────────
// Print-optimised page rendered after a payment is marked paid.
// Layout mirrors HDFC's "Payment Advice" PDF (the format Daksh
// shared) — company header, two-column key/value list, amount in
// words, signature line.
//
// Access: anyone who can view the accounts module. The route is one
// click from the pay-today screen and the bill detail page.
// ──────────────────────────────────────────────────────────────────

import { notFound, redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { canManageAccounts, canConfirmPayments } from "@/lib/accounts-permissions";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { getProfilesMap } from "@/lib/profiles";
import { VoucherView } from "./voucher-view";

type Params = Promise<{ id: string }>;

export default async function PaymentVoucherPage({ params }: { params: Params }) {
  const { profile } = await requireAuth();
  if (!canManageAccounts(profile) && !canConfirmPayments(profile)) {
    redirect("/accounts");
  }

  const { id } = await params;
  const supabase = createAdminSupabaseClient();
  const { data: paymentRaw } = await supabase
    .from("bill_payments")
    .select(
      "id, status, proposed_amount, paid_amount, payment_method, payment_reference, payment_note, paid_at, paid_by, confirmed_by, proposed_by, bill_id, bills(id, token, vendor_bill_no, bill_date, description, amount_subtotal, amount_total, amount_payable_to_vendor, amount_tds, amount_tcs, cost_head, bill_vendor_id, bill_vendors(id, name, address, gstin, pan, phone, email, bank_name, bank_account, ifsc, upi_id))",
    )
    .eq("id", id)
    .maybeSingle();

  if (!paymentRaw) notFound();

  type BillVendor = {
    id: string;
    name: string;
    address: string | null;
    gstin: string | null;
    pan: string | null;
    phone: string | null;
    email: string | null;
    bank_name: string | null;
    bank_account: string | null;
    ifsc: string | null;
    upi_id: string | null;
  };
  type Bill = {
    id: string;
    token: string;
    vendor_bill_no: string;
    bill_date: string;
    description: string;
    amount_subtotal: number;
    amount_total: number;
    amount_payable_to_vendor: number | null;
    amount_tds: number | null;
    amount_tcs: number | null;
    cost_head: string | null;
    bill_vendor_id: string;
    bill_vendors: BillVendor | BillVendor[] | null;
  };
  type Payment = {
    id: string;
    status: string;
    proposed_amount: number;
    paid_amount: number | null;
    payment_method: string | null;
    payment_reference: string | null;
    payment_note: string | null;
    paid_at: string | null;
    paid_by: string | null;
    confirmed_by: string | null;
    proposed_by: string | null;
    bill_id: string;
    bills: Bill | Bill[] | null;
  };
  const payment = paymentRaw as unknown as Payment;
  const bill = Array.isArray(payment.bills) ? payment.bills[0] ?? null : payment.bills;
  if (!bill) notFound();
  const vendor = Array.isArray(bill.bill_vendors)
    ? bill.bill_vendors[0] ?? null
    : bill.bill_vendors;
  if (!vendor) notFound();

  // Only paid rows generate a voucher.
  if (payment.status !== "paid") {
    redirect(`/accounts/bills/${bill.id}?error=Voucher+is+only+available+after+payment+is+marked+paid.`);
  }

  const profilesMap = await getProfilesMap();
  const paidByName = payment.paid_by ? profilesMap[payment.paid_by] ?? null : null;

  return (
    <VoucherView
      payment={{
        id: payment.id,
        paidAmount: Number(payment.paid_amount ?? 0),
        paymentMethod: payment.payment_method,
        paymentReference: payment.payment_reference,
        paymentNote: payment.payment_note,
        paidAt: payment.paid_at,
        paidByName,
      }}
      bill={{
        id: bill.id,
        token: bill.token,
        vendorBillNo: bill.vendor_bill_no,
        billDate: bill.bill_date,
        description: bill.description,
        amountSubtotal: Number(bill.amount_subtotal),
        amountTotal: Number(bill.amount_total),
        amountPayableToVendor: Number(
          bill.amount_payable_to_vendor ?? bill.amount_total,
        ),
        amountTds: Number(bill.amount_tds ?? 0),
        amountTcs: Number(bill.amount_tcs ?? 0),
        costHead: bill.cost_head,
      }}
      vendor={vendor}
    />
  );
}
