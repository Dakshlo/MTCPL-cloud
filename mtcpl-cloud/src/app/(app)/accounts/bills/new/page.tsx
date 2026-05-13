import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { canSubmitBills } from "@/lib/accounts-permissions";
import { submitBillAction, upsertBillVendorAction } from "../../actions";
import { BillEntryForm, type BillVendorOption } from "./bill-entry-form";

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
      <div className="record-head">
        <div>
          <h1>Enter a bill</h1>
          <p className="muted">
            Fill in the vendor's bill details. Once submitted, the bill is
            tagged with a unique token and sent to the owner for audit.
          </p>
        </div>
        <Link
          href="/accounts/bills"
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
          ← All bills
        </Link>
      </div>

      <div style={{ marginTop: 20 }}>
        <BillEntryForm
          vendors={vendors}
          submitAction={submitBillAction}
          addVendorAction={upsertBillVendorAction}
        />
      </div>
    </section>
  );
}
