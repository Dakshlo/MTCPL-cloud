/**
 * Mig 082 follow-on (Daksh, June 2026) — dedicated "Flagged
 * bills" list view. Reached from the Flagged KPI tile on the
 * main Final Audit page. Same shape as the verified list; just
 * filtered to final_audit_status='flagged' and tinted red.
 *
 * The reason + note from when the auditor flagged the payment
 * are rendered on each row so the owner can scan the list and
 * decide which to drill into first.
 */

import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { getProfilesMap } from "@/lib/profiles";
import { canFinalAudit, canSettleWithDebit } from "@/lib/accounts-permissions";
import {
  AccountsHero,
  BUTTON_STYLES,
} from "../../_ui/components";
import { AuditHistoryClient } from "../audit-history-client";
import type { FinalAuditRow } from "../final-audit-client";

export default async function FlaggedAuditPage() {
  const { profile } = await requireAuth();
  if (!canFinalAudit(profile)) {
    redirect("/accounts");
  }

  const supabase = createAdminSupabaseClient();
  const profilesMap = await getProfilesMap();

  const { data: raw } = await supabase
    .from("bill_payments")
    .select(
      "id, bill_id, status, final_audit_status, paid_amount, payment_method, payment_reference, payment_note, paid_by, paid_at, final_audit_at, final_audit_by, final_audit_flag_reason, final_audit_flag_note, debit_settled_at, bills(id, token, vendor_bill_no, bill_vendor_id, bill_vendors(id, name))",
    )
    .eq("status", "paid")
    .eq("final_audit_status", "flagged")
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
    debit_settled_at: string | null;
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
      auditStatus: "flagged",
      auditedAt: r.final_audit_at,
      auditedByName: r.final_audit_by ? profilesMap[r.final_audit_by] ?? "Unknown" : null,
      flagReason: r.final_audit_flag_reason,
      flagNote: r.final_audit_flag_note,
      vendorTotalOutstanding: 0,
      vendorId: b?.bill_vendor_id ?? null,
      debitSettledAt: r.debit_settled_at,
    };
  });

  // Mig 085 follow-on (Daksh, June 2026) — attach each flagged
  // payment's ACTIVE debit-settlement state so the list shows the
  // right thing:
  //   • pending_approval → "Debit in approval" chip (no Settle button,
  //     so the same flag can't be sent for a second debit by mistake).
  //   • approved         → moves to the "Settled with debit" tab.
  // There can be at most one active row per source payment (DB partial-
  // unique index bds_one_active_per_source_idx), so a 1:1 map is safe.
  const paymentIds = rows.map((r) => r.id);
  if (paymentIds.length > 0) {
    const { data: settles } = await supabase
      .from("bill_debit_settlements")
      .select("source_payment_id, status, amount")
      .in("source_payment_id", paymentIds)
      .in("status", ["pending_approval", "approved"]);
    const byPayment = new Map<string, { status: string; amount: number }>();
    for (const s of (settles ?? []) as Array<{
      source_payment_id: string;
      status: string;
      amount: number | string;
    }>) {
      byPayment.set(s.source_payment_id, {
        status: s.status,
        amount: Number(s.amount ?? 0),
      });
    }
    for (const r of rows) {
      const d = byPayment.get(r.id);
      if (d) {
        r.debitState = d.status === "approved" ? "settled" : "pending";
        r.debitAmount = d.amount;
      }
    }
  }

  return (
    <section className="page-card">
      <AccountsHero
        title="Flagged payments"
        description="Payments the auditor flagged for owner attention. The flag captures the auditor's reason; the owner reads + acts. No reversal happens here — money has already moved."
        actions={
          <Link href="/accounts/final-audit" style={BUTTON_STYLES.secondary}>
            ← Back to Final Audit
          </Link>
        }
      />
      <AuditHistoryClient
        rows={rows}
        variant="flagged"
        canSettle={canSettleWithDebit(profile)}
      />
    </section>
  );
}
