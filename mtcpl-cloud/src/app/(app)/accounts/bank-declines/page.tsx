// Mig 090 — Owner's Bank Decline approval queue.
//
// When the accountant presses "Bank declined" on a DOWNLOADED Pay
// Today row, a request lands here. The owner either:
//   • Approve → the payment is cancelled and its bill goes back to Due.
//   • Reject  → nothing changes, the payment stays confirmed.
//
// Owner-only (canConfirmPayments). Surfaced in the topbar tasks
// dropdown with a pending count + linked from the Finance sidebar.

import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { getProfilesMap } from "@/lib/profiles";
import { canConfirmPayments } from "@/lib/accounts-permissions";
import {
  approveBankDeclineAction,
  rejectBankDeclineAction,
} from "../actions";
import { BankDeclinesClient, type BankDeclineRow } from "./bank-declines-client";

export const dynamic = "force-dynamic";

export default async function BankDeclinesPage() {
  const { profile } = await requireAuth();
  if (!canConfirmPayments(profile)) {
    redirect("/accounts");
  }

  const supabase = createAdminSupabaseClient();
  const profilesMap = await getProfilesMap();

  // Pending requests (still confirmed, awaiting the owner) + a recent
  // history of resolved ones so the owner can see what's gone back to
  // due (approved) or been kept (rejected).
  const [{ data: pendingRaw }, { data: resolvedRaw }] = await Promise.all([
    supabase
      .from("bill_payments")
      .select(
        "id, bill_id, proposed_amount, bank_decline_status, bank_decline_reason, bank_decline_requested_at, bank_decline_requested_by, bills(id, token, vendor_bill_no, bill_date, amount_outstanding, bill_vendors(id, name))",
      )
      .eq("bank_decline_status", "pending")
      .order("bank_decline_requested_at", { ascending: true }),
    supabase
      .from("bill_payments")
      .select(
        "id, bill_id, proposed_amount, status, bank_decline_status, bank_decline_reason, bank_decline_requested_at, bank_decline_requested_by, bank_decline_resolved_at, bank_decline_resolved_by, bills(id, token, vendor_bill_no, bill_date, bill_vendors(id, name))",
      )
      .in("bank_decline_status", ["approved", "rejected"])
      .order("bank_decline_resolved_at", { ascending: false })
      .limit(60),
  ]);

  type Raw = {
    id: string;
    bill_id: string;
    proposed_amount: number;
    status?: string;
    bank_decline_status: string | null;
    bank_decline_reason: string | null;
    bank_decline_requested_at: string | null;
    bank_decline_requested_by: string | null;
    bank_decline_resolved_at?: string | null;
    bank_decline_resolved_by?: string | null;
    bills:
      | {
          id: string;
          token: string;
          vendor_bill_no: string;
          bill_date: string;
          amount_outstanding?: number;
          bill_vendors:
            | { id: string; name: string }
            | { id: string; name: string }[]
            | null;
        }
      | null;
  };

  function shape(r: Raw): BankDeclineRow {
    const b = r.bills;
    const v = b ? (Array.isArray(b.bill_vendors) ? b.bill_vendors[0] ?? null : b.bill_vendors) : null;
    return {
      paymentId: r.id,
      billId: r.bill_id,
      billToken: b?.token ?? "—",
      vendorBillNo: b?.vendor_bill_no ?? "—",
      vendorName: v?.name ?? "—",
      amount: Number(r.proposed_amount ?? 0),
      reason: r.bank_decline_reason ?? "",
      requestedAt: r.bank_decline_requested_at,
      requestedByName: r.bank_decline_requested_by
        ? profilesMap[r.bank_decline_requested_by] ?? "Unknown"
        : null,
      resolvedAt: r.bank_decline_resolved_at ?? null,
      resolvedByName: r.bank_decline_resolved_by
        ? profilesMap[r.bank_decline_resolved_by] ?? "Unknown"
        : null,
      declineStatus: (r.bank_decline_status ?? null) as
        | "pending"
        | "approved"
        | "rejected"
        | null,
    };
  }

  const pending = ((pendingRaw ?? []) as unknown as Raw[]).map(shape);
  const resolved = ((resolvedRaw ?? []) as unknown as Raw[]).map(shape);

  return (
    <BankDeclinesClient
      pending={pending}
      resolved={resolved}
      approveAction={approveBankDeclineAction}
      rejectAction={rejectBankDeclineAction}
    />
  );
}
