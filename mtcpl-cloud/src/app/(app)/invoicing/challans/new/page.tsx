/**
 * Mig 058 — New challan page.
 *
 * Loads the active party list for the picker, then hands off to
 * the client form. Optional ?party=<id> pre-selects.
 */

import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { canUseInvoicing } from "@/lib/invoicing-permissions";
import { AccountsHero } from "../../../accounts/_ui/components";
import { createChallanAction } from "../../actions";
import { NewChallanForm, type PartyOption } from "./new-challan-form";

type SearchParams = Promise<{ party?: string }>;

export default async function NewChallanPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const { profile } = await requireAuth();
  if (!canUseInvoicing(profile)) redirect("/");
  const sp = await searchParams;

  const supabase = createAdminSupabaseClient();
  const { data: partiesRaw } = await supabase
    .from("invoice_parties")
    .select("id, name")
    .eq("is_active", true)
    .order("name");
  const parties: PartyOption[] = ((partiesRaw ?? []) as Array<{ id: string; name: string }>).map(
    (p) => ({ id: p.id, name: p.name }),
  );

  return (
    <section className="page-card">
      <AccountsHero
        title="New challan"
        description="Delivery note — pick a party + add items with quantity. No money at this stage."
        actions={
          <Link
            href="/invoicing/challans"
            style={{ fontSize: 12, color: "var(--muted)", textDecoration: "none" }}
          >
            ← All challans
          </Link>
        }
      />

      <div style={{ marginTop: 18 }}>
        <NewChallanForm
          action={createChallanAction}
          parties={parties}
          initialPartyId={sp.party ?? null}
        />
      </div>
    </section>
  );
}
