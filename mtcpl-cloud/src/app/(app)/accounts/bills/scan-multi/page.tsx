import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { canSubmitBills } from "@/lib/accounts-permissions";
import { submitBillAction } from "../../actions";
import type { BillVendorOption } from "../new/bill-entry-form";
import { MultiBillScanner } from "./multi-bill-scanner";
import { AccountsHero, BUTTON_STYLES } from "../../_ui/components";

// Multi-bill AI scan (Daksh, June 2026). Upload up to 8 vendor bills,
// the AI reads each (read-only), and the user reviews + adds them one
// by one. Saving reuses submitBillAction — the same audited path as the
// single Add-Bill form — so no other data flow changes.
export default async function ScanMultiBillsPage() {
  const { profile } = await requireAuth();
  if (!canSubmitBills(profile)) {
    redirect("/accounts");
  }

  const supabase = createAdminSupabaseClient();
  const { data: vendorRows } = await supabase
    .from("bill_vendors")
    .select(
      "id, name, category, gstin, tds_applicable, default_tds_percent, tcs_applicable, default_tcs_percent",
    )
    .eq("is_active", true)
    .order("name");

  const vendors: BillVendorOption[] = (vendorRows ?? []) as BillVendorOption[];

  return (
    <section className="page-card">
      <AccountsHero
        title="Add multiple bills"
        description="Upload up to 8 bills at once. The AI reads each one, then you review and add them one by one. Nothing is saved until you press Add on a bill."
        actions={
          <>
            <Link href="/accounts/bills/new" style={BUTTON_STYLES.secondary}>
              + Single bill
            </Link>
            <Link href="/accounts/bills" style={BUTTON_STYLES.secondary}>
              ← All bills
            </Link>
          </>
        }
      />

      <MultiBillScanner vendors={vendors} submitAction={submitBillAction} />
    </section>
  );
}
