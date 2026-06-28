// Mig 158 — Client billing (per temple), in Invoicing.
//
// The temple IS the client. Production roles edit the temple's operational
// fields in Settings; here the accountant fills the billing-only fields
// (GSTIN, PAN, address, email, phone). Client name = temple name (read-only).
// A verified dispatch's invoicing challan bills to the temple, reading these.

import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { canUseInvoicing } from "@/lib/invoicing-permissions";
import { allowedDepartmentsForRole } from "@/lib/departments";
import { AccountsHero, BUTTON_STYLES } from "../../accounts/_ui/components";
import { TempleClientsClient, ALL_FIELDS, type Field, type TempleRow } from "./temple-clients-client";

export const dynamic = "force-dynamic";

export default async function TempleClientsPage() {
  const { profile } = await requireAuth();
  if (!canUseInvoicing(profile)) {
    if (allowedDepartmentsForRole(profile.role).includes("invoicing")) {
      redirect("/invoicing/work-order-doc");
    }
    redirect("/");
  }

  const supabase = createAdminSupabaseClient();
  const { data: temples } = await supabase
    .from("temples")
    .select(["id", "name", "code_prefix", "is_active", "site_location", ...ALL_FIELDS].join(", "))
    .order("name");

  const templeRows: TempleRow[] = ((temples ?? []) as unknown as Array<Record<string, unknown>>).map((t) => {
    const fields = {} as Record<Field, string>;
    for (const k of ALL_FIELDS) fields[k] = ((t[k] as string | null) ?? "");
    return {
      id: t.id as string,
      name: t.name as string,
      code_prefix: (t.code_prefix as string | null) ?? "",
      is_active: t.is_active !== false,
      site_location: (t.site_location as string | null) ?? "",
      ...fields,
    };
  });

  return (
    <section className="page-card">
      <AccountsHero
        title="Client billing"
        description="Each temple is its own client. Click one to fill its Billing + Shipping details (name, address, city, state, state code, GSTIN, PAN, phone, email) plus optional vendor code / work order no — all printed on the tax invoice (leave Shipping blank to reuse Billing). You can also rename a temple here."
        actions={
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Link href="/invoicing" style={BUTTON_STYLES.secondary}>← Invoicing</Link>
          </div>
        }
      />
      <TempleClientsClient temples={templeRows} />
    </section>
  );
}
