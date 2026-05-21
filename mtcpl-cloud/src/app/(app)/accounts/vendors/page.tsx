import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { canManageBillVendors, canViewBillVendors } from "@/lib/accounts-permissions";
import { upsertBillVendorAction } from "../actions";
import { VendorForm } from "./vendor-form";
import {
  AccountsHero,
  ACCOUNTS_TOKENS,
  EmptyState,
  Money,
} from "../_ui/components";
import { VendorsTable, type VendorRow } from "./vendors-table";

export default async function BillVendorsPage() {
  const { profile } = await requireAuth();
  if (!canViewBillVendors(profile)) {
    redirect("/accounts");
  }
  const canEdit = canManageBillVendors(profile);
  const supabase = createAdminSupabaseClient();
  const { data: vendorsRaw } = await supabase
    .from("bill_vendors")
    .select("id, name, category, gstin, phone, email, is_active, created_at")
    .order("is_active", { ascending: false })
    .order("name");
  const vendors = (vendorsRaw ?? []) as Array<{
    id: string;
    name: string;
    category: string | null;
    gstin: string | null;
    phone: string | null;
    email: string | null;
    is_active: boolean;
    created_at: string;
  }>;

  const { data: outstandingRaw } = await supabase
    .from("bills")
    .select("bill_vendor_id, amount_outstanding")
    .eq("status", "approved")
    .gt("amount_outstanding", 0);
  const outstandingByVendor = new Map<string, number>();
  for (const r of outstandingRaw ?? []) {
    const id = r.bill_vendor_id as string;
    const amt = Number(r.amount_outstanding ?? 0);
    outstandingByVendor.set(id, (outstandingByVendor.get(id) ?? 0) + amt);
  }

  const activeCount = vendors.filter((v) => v.is_active).length;
  const archivedCount = vendors.length - activeCount;
  const totalOutstandingAcrossVendors = [...outstandingByVendor.values()].reduce((s, n) => s + n, 0);

  return (
    <section className="page-card">
      <AccountsHero
        title="Vendor Account"
        description="The beneficiary master for Finance. Distinct from carving vendors. Bank details + GST info live here so the bill-entry form stays light."
        badge={
          <span
            style={{
              fontSize: 12,
              fontWeight: 600,
              color: "var(--muted)",
              padding: "3px 10px",
              background: ACCOUNTS_TOKENS.surfaceMuted,
              border: `1px solid ${ACCOUNTS_TOKENS.border}`,
              borderRadius: 999,
            }}
          >
            {activeCount} active · {archivedCount} archived
          </span>
        }
        actions={canEdit ? <VendorForm action={upsertBillVendorAction} mode="create" /> : null}
      />

      {vendors.length === 0 ? (
        <EmptyState
          icon="🏢"
          title="No bill vendors yet"
          description="Add your suppliers (cement / steel / scaffolding / tools / etc) here so they show up in the bill-entry form."
          action={canEdit ? <VendorForm action={upsertBillVendorAction} mode="create" /> : undefined}
        />
      ) : (
        <VendorsTable
          vendors={
            vendors.map<VendorRow>((v) => ({
              id: v.id,
              name: v.name,
              category: v.category,
              gstin: v.gstin,
              phone: v.phone,
              email: v.email,
              isActive: v.is_active,
            }))
          }
          outstandingByVendor={Object.fromEntries(outstandingByVendor)}
          canEdit={canEdit}
        />
      )}

      {/* Mig 064 follow-on (Daksh): hide the grand "Total outstanding
          across all vendors" line for non dev/owner roles. It reads
          as company cash position at a glance — accountants /
          accountant_star / crosscheck don't need it on this list
          page. */}
      {totalOutstandingAcrossVendors > 0 &&
        (profile.role === "developer" || profile.role === "owner") && (
          <p
            style={{
              margin: "12px 0 0",
              fontSize: 12,
              color: "var(--muted)",
              textAlign: "right",
            }}
          >
            Total outstanding across all vendors:{" "}
            <Money value={totalOutstandingAcrossVendors} size="small" tone="warning" />
          </p>
        )}
    </section>
  );
}
