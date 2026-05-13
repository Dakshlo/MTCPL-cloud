import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { canSubmitBills } from "@/lib/accounts-permissions";
import { submitBillAction, upsertBillVendorAction } from "../../actions";
import { BillEntryForm, type BillVendorOption } from "./bill-entry-form";
import { AccountsHero, BUTTON_STYLES } from "../../_ui/components";

export default async function NewBillPage() {
  const { profile } = await requireAuth();
  if (!canSubmitBills(profile)) {
    redirect("/accounts");
  }

  const supabase = createAdminSupabaseClient();
  const { data: vendorRows } = await supabase
    .from("bill_vendors")
    .select("id, name, category, gstin")
    .eq("is_active", true)
    .order("name");

  const vendors: BillVendorOption[] = (vendorRows ?? []) as BillVendorOption[];

  return (
    <section className="page-card">
      <AccountsHero
        title="New bill"
        description="Fill in the supplier's bill details. We'll auto-tag with a unique token and send it to the owner for audit."
        actions={
          <Link href="/accounts/bills" style={BUTTON_STYLES.secondary}>
            ← All bills
          </Link>
        }
      />

      <BillEntryForm
        vendors={vendors}
        submitAction={submitBillAction}
        addVendorAction={upsertBillVendorAction}
      />
    </section>
  );
}
