import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { getProfilesMap } from "@/lib/profiles";
import { canApproveBills } from "@/lib/accounts-permissions";
import { ApprovalsClient, type ApprovalBillRow } from "./approvals-client";
import { approveBillAction, rejectBillAction } from "../actions";
import { AccountsHero, BUTTON_STYLES } from "../_ui/components";

export default async function BillsAuditPage() {
  const { profile } = await requireAuth();
  if (!canApproveBills(profile)) {
    redirect("/accounts");
  }

  const supabase = createAdminSupabaseClient();
  const profilesMap = await getProfilesMap();

  const { data: rowsRaw, error } = await supabase
    .from("bills")
    .select(
      "id, token, vendor_bill_no, bill_date, description, cost_head, amount_subtotal, gst_percent, amount_total, status, rejection_note, submitted_by, submitted_at, rejected_by, rejected_at, bill_vendor_id, bill_vendors(id, name, gstin)",
    )
    .in("status", ["pending_approval", "rejected"])
    .order("submitted_at", { ascending: false })
    .limit(500);
  if (error) throw new Error(error.message);

  type DbRow = {
    id: string;
    token: string;
    vendor_bill_no: string;
    bill_date: string;
    description: string;
    cost_head: string | null;
    amount_subtotal: number;
    gst_percent: number;
    amount_total: number;
    status: string;
    rejection_note: string | null;
    submitted_by: string | null;
    submitted_at: string | null;
    rejected_by: string | null;
    rejected_at: string | null;
    bill_vendor_id: string;
    bill_vendors:
      | { id: string; name: string; gstin: string | null }
      | { id: string; name: string; gstin: string | null }[]
      | null;
  };

  const dbRows = ((rowsRaw ?? []) as unknown) as DbRow[];

  const rows: ApprovalBillRow[] = dbRows.map((r) => {
    const v = Array.isArray(r.bill_vendors) ? r.bill_vendors[0] ?? null : r.bill_vendors;
    return {
      id: r.id,
      token: r.token,
      vendorName: v?.name ?? "—",
      vendorGstin: v?.gstin ?? null,
      vendorBillNo: r.vendor_bill_no,
      billDate: r.bill_date,
      description: r.description,
      costHead: r.cost_head,
      amountSubtotal: Number(r.amount_subtotal),
      gstPercent: Number(r.gst_percent),
      amountTotal: Number(r.amount_total),
      status: r.status as "pending_approval" | "rejected",
      rejectionNote: r.rejection_note,
      submittedByName: r.submitted_by ? profilesMap[r.submitted_by] ?? "Unknown" : null,
      submittedAt: r.submitted_at,
      rejectedByName: r.rejected_by ? profilesMap[r.rejected_by] ?? "Unknown" : null,
      rejectedAt: r.rejected_at,
    };
  });

  const awaiting = rows.filter((r) => r.status === "pending_approval");
  const rejected = rows.filter((r) => r.status === "rejected");

  return (
    <section className="page-card">
      <AccountsHero
        title="Bills Audit"
        description="Review every bill submission before it lands in the accountant's due list. Approve as-is or send back to the biller with a note."
        actions={
          <Link href="/accounts" style={BUTTON_STYLES.secondary}>
            ← Accounts
          </Link>
        }
      />

      <ApprovalsClient
        awaiting={awaiting}
        rejected={rejected}
        approveAction={approveBillAction}
        rejectAction={rejectBillAction}
      />
    </section>
  );
}
