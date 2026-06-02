/**
 * Mig 082 follow-on (Daksh, June 2026) — dedicated "Verified
 * bills" list view. Reached from the Verified KPI tile on the
 * main Final Audit page. Same card layout as the audit queue,
 * read-only (no Verify / Flag buttons), with a date filter
 * (Today / Yesterday / Last 7 days / All) driven client-side.
 *
 * Server fetches the latest 500 verified rows; the client
 * component then buckets by audited_at against IST midnight.
 * 500 is a generous cap that should comfortably cover even the
 * "All time" view for a year of activity.
 */

import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { getProfilesMap } from "@/lib/profiles";
import { canFinalAudit } from "@/lib/accounts-permissions";
import {
  AccountsHero,
  BUTTON_STYLES,
} from "../../_ui/components";
import { AuditHistoryClient } from "../audit-history-client";
import type { FinalAuditRow } from "../final-audit-client";

export default async function VerifiedAuditPage() {
  const { profile } = await requireAuth();
  if (!canFinalAudit(profile)) {
    redirect("/accounts");
  }

  const supabase = createAdminSupabaseClient();
  const profilesMap = await getProfilesMap();

  // Latest 500 verified payments. Index-backed by final_audit_at.
  const { data: raw } = await supabase
    .from("bill_payments")
    .select(
      "id, bill_id, status, final_audit_status, paid_amount, payment_method, payment_reference, payment_note, paid_by, paid_at, final_audit_at, final_audit_by, final_audit_flag_reason, final_audit_flag_note, bills(id, token, vendor_bill_no, bill_vendor_id, bill_vendors(id, name))",
    )
    .eq("status", "paid")
    .eq("final_audit_status", "verified")
    .eq("is_advance_application", false)
    .order("final_audit_at", { ascending: false })
    .limit(500);

  type Raw = {
    id: string;
    bill_id: string;
    paid_amount: number;
    payment_method: string | null;
    payment_reference: string | null;
    payment_note: string | null;
    paid_by: string | null;
    paid_at: string | null;
    final_audit_at: string | null;
    final_audit_by: string | null;
    final_audit_flag_reason: string | null;
    final_audit_flag_note: string | null;
    bills:
      | {
          id: string;
          token: string;
          vendor_bill_no: string;
          bill_vendor_id: string;
          bill_vendors:
            | { id: string; name: string }
            | { id: string; name: string }[]
            | null;
        }
      | null;
  };

  const rows: FinalAuditRow[] = ((raw ?? []) as unknown as Raw[]).map((r) => {
    const b = r.bills;
    const v = b
      ? Array.isArray(b.bill_vendors)
        ? b.bill_vendors[0] ?? null
        : b.bill_vendors
      : null;
    return {
      id: r.id,
      billId: r.bill_id,
      billToken: b?.token ?? "—",
      vendorBillNo: b?.vendor_bill_no ?? "—",
      vendorName: v?.name ?? "—",
      vendorBankName: null,
      vendorBankAccount: null,
      vendorIfsc: null,
      vendorHdfcBeneName: null,
      paidAmount: Number(r.paid_amount ?? 0),
      paymentMethod: r.payment_method,
      paymentReference: r.payment_reference,
      paymentNote: r.payment_note,
      paidByName: r.paid_by ? profilesMap[r.paid_by] ?? "Unknown" : null,
      paidAt: r.paid_at,
      auditStatus: "verified",
      auditedAt: r.final_audit_at,
      auditedByName: r.final_audit_by ? profilesMap[r.final_audit_by] ?? "Unknown" : null,
      flagReason: r.final_audit_flag_reason,
      flagNote: r.final_audit_flag_note,
      // Outstanding chip not used on the history view — leave at 0.
      vendorTotalOutstanding: 0,
      vendorId: b?.bill_vendor_id ?? null,
    };
  });

  return (
    <section className="page-card">
      <AccountsHero
        title="Verified payments"
        description="Every payment that's been cross-checked against the bank statement and signed off. Use the date filter below to scope the view."
        actions={
          <Link href="/accounts/final-audit" style={BUTTON_STYLES.secondary}>
            ← Back to Final Audit
          </Link>
        }
      />
      <AuditHistoryClient rows={rows} variant="verified" />
    </section>
  );
}
