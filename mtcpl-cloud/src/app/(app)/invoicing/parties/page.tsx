/**
 * Mig 058 — Invoice parties list.
 *
 * Mirrors src/app/(app)/accounts/vendors/page.tsx layout: hero +
 * table of parties + "+ Add party" SidePanel trigger. Per-party
 * row shows name (with avatar), GSTIN, phone, and a count of
 * challans + invoices on the right.
 */

import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { canUseInvoicing } from "@/lib/invoicing-permissions";
import {
  ACCOUNTS_TOKENS,
  AccountsHero,
  EmptyState,
  SectionHeader,
} from "../../accounts/_ui/components";
import {
  upsertInvoicePartyAction,
  archiveInvoicePartyAction,
} from "../actions";
import { PartiesClient, type PartyRow } from "./parties-client";

export default async function PartiesListPage() {
  const { profile } = await requireAuth();
  if (!canUseInvoicing(profile)) redirect("/");

  const supabase = createAdminSupabaseClient();

  const [{ data: partiesRaw }, { data: challanCounts }, { data: invoiceCounts }] = await Promise.all([
    supabase
      .from("invoice_parties")
      .select("id, name, gstin, pan, address, phone, email, notes, is_active, created_at")
      .order("is_active", { ascending: false })
      .order("name"),
    supabase
      .from("challans")
      .select("invoice_party_id")
      .is("cancelled_at", null),
    supabase
      .from("invoices")
      .select("invoice_party_id"),
  ]);

  const challanByParty = new Map<string, number>();
  for (const r of (challanCounts ?? []) as Array<{ invoice_party_id: string | null }>) {
    if (!r.invoice_party_id) continue;
    challanByParty.set(r.invoice_party_id, (challanByParty.get(r.invoice_party_id) ?? 0) + 1);
  }
  const invoiceByParty = new Map<string, number>();
  for (const r of (invoiceCounts ?? []) as Array<{ invoice_party_id: string | null }>) {
    if (!r.invoice_party_id) continue;
    invoiceByParty.set(r.invoice_party_id, (invoiceByParty.get(r.invoice_party_id) ?? 0) + 1);
  }

  const parties: PartyRow[] = ((partiesRaw ?? []) as Array<{
    id: string;
    name: string;
    gstin: string | null;
    pan: string | null;
    address: string | null;
    phone: string | null;
    email: string | null;
    notes: string | null;
    is_active: boolean;
    created_at: string;
  }>).map((p) => ({
    id: p.id,
    name: p.name,
    gstin: p.gstin,
    pan: p.pan,
    address: p.address,
    phone: p.phone,
    email: p.email,
    notes: p.notes,
    isActive: p.is_active,
    challanCount: challanByParty.get(p.id) ?? 0,
    invoiceCount: invoiceByParty.get(p.id) ?? 0,
  }));

  return (
    <section className="page-card">
      <AccountsHero
        title="Parties"
        description="Customer master — reusable across challans + invoices."
        actions={
          <Link href="/invoicing" style={{ fontSize: 12, color: "var(--muted)", textDecoration: "none" }}>
            ← Dashboard
          </Link>
        }
      />

      <div style={{ marginTop: 18 }}>
        <SectionHeader
          title="All parties"
          count={parties.length}
          action={
            <PartiesClient.AddTrigger
              upsertAction={upsertInvoicePartyAction}
              archiveAction={archiveInvoicePartyAction}
            />
          }
        />

        {parties.length === 0 ? (
          <EmptyState
            icon="👤"
            title="No parties yet"
            description="Add a party (customer) to start creating challans and invoices against them."
            action={
              <PartiesClient.AddTrigger
                upsertAction={upsertInvoicePartyAction}
                archiveAction={archiveInvoicePartyAction}
                buttonLabel="+ Add your first party"
              />
            }
          />
        ) : (
          <div
            style={{
              background: "var(--surface, #fff)",
              border: `1px solid ${ACCOUNTS_TOKENS.border}`,
              borderRadius: 12,
              overflow: "hidden",
              boxShadow: ACCOUNTS_TOKENS.shadow,
            }}
          >
            <PartiesClient.List
              parties={parties}
              upsertAction={upsertInvoicePartyAction}
              archiveAction={archiveInvoicePartyAction}
            />
          </div>
        )}
      </div>
    </section>
  );
}
