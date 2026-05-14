import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import {
  canApproveBills,
  canConfirmPayments,
  canSubmitBills,
} from "@/lib/accounts-permissions";
import {
  editBillAction,
  upsertBillVendorAction,
} from "../../../actions";
import {
  BillEntryForm,
  type BillVendorOption,
} from "../../new/bill-entry-form";
import { AddVendorButton } from "../../new/add-vendor-button";
import { AccountsHero, BUTTON_STYLES } from "../../../_ui/components";

type Params = Promise<{ id: string }>;

export default async function EditBillPage({ params }: { params: Params }) {
  const { profile } = await requireAuth();
  const { id } = await params;

  const supabase = createAdminSupabaseClient();
  const { data: bill } = await supabase
    .from("bills")
    .select(
      "id, bill_vendor_id, vendor_bill_no, bill_date, description, cost_head, amount_subtotal, gst_percent, cgst_percent, sgst_percent, igst_percent, tds_percent, tcs_percent, status, submitted_by",
    )
    .eq("id", id)
    .maybeSingle();

  if (!bill) notFound();

  const isApprover = canApproveBills(profile);
  const isSubmitter = bill.submitted_by === profile.id;
  const isBillerLike = canSubmitBills(profile);
  // Mig 042 — owner can also edit an approved (due) bill so long as
  // no payments have started yet. The actions.ts editBillAction
  // enforces the same gate server-side.
  const isOwnerLike = canConfirmPayments(profile);
  const canEditNow =
    (bill.status === "pending_approval" && isApprover) ||
    (bill.status === "rejected" && (isApprover || isSubmitter || isBillerLike)) ||
    (bill.status === "approved" && isOwnerLike);
  if (!canEditNow) {
    redirect(`/accounts/bills/${id}`);
  }

  const { count: lockedPayments } = await supabase
    .from("bill_payments")
    .select("*", { count: "exact", head: true })
    .eq("bill_id", id)
    .neq("status", "cancelled");
  if ((lockedPayments ?? 0) > 0) {
    redirect(`/accounts/bills/${id}?error=Bill+is+locked+%E2%80%94+a+payment+has+been+proposed+or+made.`);
  }

  const { data: vendorRows } = await supabase
    .from("bill_vendors")
    .select(
      "id, name, category, gstin, tds_applicable, default_tds_percent, tcs_applicable, default_tcs_percent",
    )
    .eq("is_active", true)
    .order("name");
  const vendors: BillVendorOption[] = (vendorRows ?? []) as BillVendorOption[];

  async function editAndReturn(formData: FormData) {
    "use server";
    const result = await editBillAction(formData);
    if (!result.ok) return { ok: false as const, error: result.error };
    return { ok: true as const, billId: id, token: "" };
  }

  return (
    <section className="page-card">
      <AccountsHero
        title="Edit bill"
        description={
          bill.status === "rejected"
            ? "This bill was sent back for edit. Fix the entry and resave — it goes back to the audit queue."
            : bill.status === "approved"
              ? "Owner-only edit. The bill stays in 'approved' (due) status; only the entry details change. Locked once any payment is proposed."
              : "You're editing a bill while it's still in audit. The status stays the same after save."
        }
        actions={
          <>
            <AddVendorButton action={upsertBillVendorAction} />
            <Link href={`/accounts/bills/${id}`} style={BUTTON_STYLES.secondary}>
              ← Bill detail
            </Link>
          </>
        }
      />

      <BillEntryForm
        vendors={vendors}
        submitAction={editAndReturn}
        mode="edit"
        billId={id}
        initialValues={{
          bill_vendor_id: bill.bill_vendor_id,
          vendor_bill_no: bill.vendor_bill_no,
          bill_date: bill.bill_date,
          description: bill.description,
          cost_head: bill.cost_head,
          amount_subtotal: Number(bill.amount_subtotal),
          gst_percent: Number(bill.gst_percent),
          cgst_percent: Number(bill.cgst_percent ?? 0),
          sgst_percent: Number(bill.sgst_percent ?? 0),
          igst_percent: Number(bill.igst_percent ?? 0),
          tds_percent: Number(bill.tds_percent ?? 0),
          tcs_percent: Number(bill.tcs_percent ?? 0),
        }}
      />
    </section>
  );
}
