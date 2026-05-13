import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import {
  canApproveBills,
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

type Params = Promise<{ id: string }>;

export default async function EditBillPage({ params }: { params: Params }) {
  const { profile } = await requireAuth();
  const { id } = await params;

  const supabase = createAdminSupabaseClient();
  const { data: bill } = await supabase
    .from("bills")
    .select(
      "id, bill_vendor_id, vendor_bill_no, bill_date, description, cost_head, amount_subtotal, gst_percent, status, submitted_by",
    )
    .eq("id", id)
    .maybeSingle();

  if (!bill) notFound();

  // Visibility / permission check before rendering.
  const isApprover = canApproveBills(profile);
  const isSubmitter = bill.submitted_by === profile.id;
  const isBillerLike = canSubmitBills(profile);
  const canEditNow =
    (bill.status === "pending_approval" && isApprover) ||
    (bill.status === "rejected" && (isApprover || isSubmitter || isBillerLike));
  if (!canEditNow) {
    redirect(`/accounts/bills/${id}`);
  }

  // Block edit if any non-cancelled payment row exists.
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
    .select("id, name, category, gstin")
    .eq("is_active", true)
    .order("name");
  const vendors: BillVendorOption[] = (vendorRows ?? []) as BillVendorOption[];

  // Wrap editBillAction so the form sees the same return shape as submitBillAction.
  async function editAndReturn(formData: FormData) {
    "use server";
    const result = await editBillAction(formData);
    if (!result.ok) return { ok: false as const, error: result.error };
    return { ok: true as const, billId: id, token: "" };
  }

  return (
    <section className="page-card">
      <div className="record-head">
        <div>
          <h1>Edit bill</h1>
          <p className="muted">
            {bill.status === "rejected"
              ? "This bill was sent back for edit. Fix the entry and resave — the bill goes back to the audit queue."
              : "You're editing a bill that's still in audit. Save in-place; the status stays the same."}
          </p>
        </div>
        <Link
          href={`/accounts/bills/${id}`}
          style={{
            textDecoration: "none",
            fontSize: 13,
            padding: "6px 14px",
            background: "var(--bg)",
            border: "1px solid var(--border)",
            borderRadius: 6,
            color: "var(--muted)",
            fontWeight: 500,
            whiteSpace: "nowrap",
            alignSelf: "flex-start",
          }}
        >
          ← Bill detail
        </Link>
      </div>

      <div style={{ marginTop: 20 }}>
        <BillEntryForm
          vendors={vendors}
          submitAction={editAndReturn}
          addVendorAction={upsertBillVendorAction}
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
          }}
        />
      </div>
    </section>
  );
}
