/**
 * Migration 055 — Personal Ledger landing page.
 *
 * Lists Daksh's parties + per-party outstanding balance. Owner-
 * scoped (every query filters by `owner_profile_id = profile.id`).
 *
 * Hard "PERSONAL — NOT COMPANY BOOKS" banner so the surface
 * is never confused for a Finance feature.
 */

import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { canUsePersonalLedger } from "@/lib/personal-ledger-permissions";
import { addPartyAction } from "./actions";
import { PersonalLedgerClient, type PartySummary } from "./personal-ledger-client";

export default async function PersonalLedgerPage() {
  const { profile } = await requireAuth();
  if (!canUsePersonalLedger(profile)) redirect("/");

  const supabase = createAdminSupabaseClient();

  const [{ data: parties }, { data: invoices }, { data: receipts }] = await Promise.all([
    supabase
      .from("personal_ledger_parties")
      .select("id, name, created_at")
      .eq("owner_profile_id", profile.id)
      .is("archived_at", null)
      .order("name"),
    supabase
      .from("personal_ledger_invoices")
      .select("party_id, total")
      .eq("owner_profile_id", profile.id)
      .is("cancelled_at", null),
    supabase
      .from("personal_ledger_receipts")
      .select("party_id, amount")
      .eq("owner_profile_id", profile.id)
      .is("cancelled_at", null),
  ]);

  // Aggregate per-party totals in-memory. Small N (typically <50).
  const invByParty = new Map<string, number>();
  for (const r of (invoices ?? []) as Array<{ party_id: string; total: number | string }>) {
    invByParty.set(r.party_id, (invByParty.get(r.party_id) ?? 0) + Number(r.total ?? 0));
  }
  const rcvByParty = new Map<string, number>();
  for (const r of (receipts ?? []) as Array<{ party_id: string; amount: number | string }>) {
    rcvByParty.set(r.party_id, (rcvByParty.get(r.party_id) ?? 0) + Number(r.amount ?? 0));
  }

  const summaries: PartySummary[] = ((parties ?? []) as Array<{
    id: string;
    name: string;
    created_at: string;
  }>).map((p) => {
    const invoiced = invByParty.get(p.id) ?? 0;
    const received = rcvByParty.get(p.id) ?? 0;
    return {
      id: p.id,
      name: p.name,
      createdAt: p.created_at,
      invoiced,
      received,
      outstanding: invoiced - received,
    };
  });

  return (
    <PersonalLedgerClient parties={summaries} addAction={addPartyAction} />
  );
}
