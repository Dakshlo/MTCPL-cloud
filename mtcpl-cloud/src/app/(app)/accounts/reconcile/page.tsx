/**
 * Mig 082 follow-on (Daksh, June 2026) — Reconcile page for the
 * starred accountant (Govind / accountant_star). Designed for
 * cross-checking MTCPL's outstanding against the external
 * accounting software (Tally / etc.).
 *
 * READ-ONLY by construction:
 *   • No server actions imported on this page.
 *   • Client component only renders + filters + selects rows —
 *     no mutations of any kind.
 *   • Source data: bills with amount_outstanding > 0. Same shape
 *     as /accounts/page.tsx but stripped to just what reconciliation
 *     needs (no proposed-payment join, no royalty data, no
 *     hold metadata). Daksh: "this will be read only page" + "make
 *     sure you dont touch any data on due bills as the new page
 *     is read only."
 *
 * Layout pattern: two-pane spreadsheet. Vendor list on the left
 * (one row per vendor with their grand outstanding); selected
 * vendor's individual bills on the right. Mirrors Tally's vendor-
 * drill-down ergonomics so the accountant's mental model carries
 * over without retraining.
 */

import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import {
  AccountsHero,
  BUTTON_STYLES,
} from "../_ui/components";
import { ReconcileClient, type ReconcileBillRow } from "./reconcile-client";

export default async function ReconcilePage() {
  const { profile } = await requireAuth();
  // Same audience as Final Audit — accountant_star is the primary
  // user; owner / developer see it for oversight.
  const allowed =
    profile.role === "developer" ||
    profile.role === "owner" ||
    profile.role === "accountant_star";
  if (!allowed) {
    redirect("/accounts");
  }

  const supabase = createAdminSupabaseClient();

  // Pull every approved bill that still owes something. Same filter
  // the Due Bills page uses for its main set; we omit the proposed-
  // payment join (we don't care which slice is pending) — for
  // reconciliation, raw amount_outstanding is the truth.
  const { data: billRows } = await supabase
    .from("bills")
    .select(
      "id, token, vendor_bill_no, bill_date, description, cost_head, amount_total, amount_paid, amount_outstanding, held_amount, bill_vendor_id, bill_vendors(id, name, nickname, category)",
    )
    .gt("amount_outstanding", 0)
    .eq("status", "approved")
    .is("cancelled_at", null)
    .order("bill_date", { ascending: false })
    .limit(5000);

  type Raw = {
    id: string;
    token: string;
    vendor_bill_no: string;
    bill_date: string;
    description: string;
    cost_head: string | null;
    amount_total: number | string;
    amount_paid: number | string;
    amount_outstanding: number | string;
    held_amount: number | string | null;
    bill_vendor_id: string;
    bill_vendors:
      | { id: string; name: string; nickname: string | null; category: string | null }
      | { id: string; name: string; nickname: string | null; category: string | null }[]
      | null;
  };

  const bills: ReconcileBillRow[] = ((billRows ?? []) as Raw[]).map((r) => {
    const v = Array.isArray(r.bill_vendors)
      ? r.bill_vendors[0] ?? null
      : r.bill_vendors;
    return {
      id: r.id,
      token: r.token,
      vendorBillNo: r.vendor_bill_no,
      billDate: r.bill_date,
      description: r.description,
      costHead: r.cost_head,
      amountTotal: Number(r.amount_total ?? 0),
      amountPaid: Number(r.amount_paid ?? 0),
      amountOutstanding: Number(r.amount_outstanding ?? 0),
      heldAmount: Number(r.held_amount ?? 0),
      vendorId: r.bill_vendor_id,
      vendorName: v?.name ?? "—",
      vendorNickname: v?.nickname ?? null,
      vendorCategory: v?.category ?? null,
    };
  });

  return (
    <section className="page-card">
      <AccountsHero
        title="Reconcile"
        description="Spreadsheet-style read-only view of outstanding bills. Use it to cross-check MTCPL against your external books (Tally / etc). Arrow keys navigate; Enter expands a vendor; nothing on this page writes to the database."
        actions={
          <Link href="/accounts/final-audit" style={BUTTON_STYLES.secondary}>
            ← Final Audit
          </Link>
        }
      />

      <ReconcileClient bills={bills} />
    </section>
  );
}
