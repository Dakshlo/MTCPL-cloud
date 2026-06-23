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
import { TempleClientsClient, type TempleRow } from "./temple-clients-client";

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
    .select("id, name, code_prefix, is_active, site_location, bill_gstin, bill_pan, bill_address, bill_email, bill_phone")
    .order("name");

  const templeRows: TempleRow[] = ((temples ?? []) as Array<{
    id: string; name: string; code_prefix: string | null; is_active: boolean | null;
    site_location: string | null; bill_gstin: string | null; bill_pan: string | null;
    bill_address: string | null; bill_email: string | null; bill_phone: string | null;
  }>).map((t) => ({
    id: t.id,
    name: t.name,
    code_prefix: t.code_prefix ?? "",
    is_active: t.is_active !== false,
    site_location: t.site_location ?? "",
    bill_gstin: t.bill_gstin ?? "",
    bill_pan: t.bill_pan ?? "",
    bill_address: t.bill_address ?? "",
    bill_email: t.bill_email ?? "",
    bill_phone: t.bill_phone ?? "",
  }));

  return (
    <section className="page-card">
      <AccountsHero
        title="Client billing"
        description="Each temple is its own client (name = temple name). Fill the billing details here — GSTIN, PAN, address, email, phone. A verified dispatch's invoicing challan bills to its temple and prints these on the tax invoice."
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
