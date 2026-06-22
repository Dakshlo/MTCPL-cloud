// Mig 154 (relocated) — Temple → Client (billing) map, in Invoicing.
//
// Per-temple picker for the invoice party that an approved dispatch's
// auto-challan bills to (temples.invoice_party_id). Moved off Settings so
// the starred accountant owns the customer mapping. The dispatch→invoicing
// bridge (dispatch/actions.ts) reads the same column.

import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { canUseInvoicing } from "@/lib/invoicing-permissions";
import { allowedDepartmentsForRole } from "@/lib/departments";
import { AccountsHero, BUTTON_STYLES } from "../../accounts/_ui/components";
import { TempleClientsClient, type TempleRow, type PartyOpt } from "./temple-clients-client";

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
  const [{ data: temples }, { data: parties }] = await Promise.all([
    supabase.from("temples").select("id, name, code_prefix, is_active, invoice_party_id").order("name"),
    supabase.from("invoice_parties").select("id, name").eq("is_active", true).order("name"),
  ]);

  const templeRows: TempleRow[] = ((temples ?? []) as Array<{
    id: string; name: string; code_prefix: string | null; is_active: boolean | null; invoice_party_id: string | null;
  }>).map((t) => ({
    id: t.id,
    name: t.name,
    code_prefix: t.code_prefix ?? "",
    is_active: t.is_active !== false,
    invoice_party_id: t.invoice_party_id ?? null,
  }));
  const partyOpts: PartyOpt[] = ((parties ?? []) as Array<{ id: string; name: string }>).map((p) => ({ id: p.id, name: p.name }));

  return (
    <section className="page-card">
      <AccountsHero
        title="Temple → Client"
        description="Which customer each temple bills to. When a dispatch for a temple is approved, its invoicing challan is auto-created for the client set here."
        actions={
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Link href="/invoicing" style={BUTTON_STYLES.secondary}>← Invoicing</Link>
            <Link href="/invoicing/parties" style={BUTTON_STYLES.secondary}>👤 Parties</Link>
          </div>
        }
      />
      <TempleClientsClient temples={templeRows} parties={partyOpts} />
    </section>
  );
}
