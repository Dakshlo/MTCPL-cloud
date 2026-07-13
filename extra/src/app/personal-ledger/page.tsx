/**
 * Migration 055 — Personal Ledger landing page.
 * Migration 056 follow-on — per-party 4-digit PIN gating.
 *
 * Lists Daksh's parties + per-party outstanding balance. Owner-
 * scoped (every query filters by `owner_profile_id = profile.id`).
 *
 * Mig 056: every new party requires a PIN at creation; existing
 * parties without a PIN show a "Set PIN" prompt on entry. Per-row
 * amounts are blurred client-side so the list view never leaks
 * actual numbers. Unlock state is a session cookie set by the
 * verifyPartyPinAction.
 */

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";
import { canUsePersonalLedger } from "@/lib/personal-ledger-permissions";
import {
  unlockCookieName,
  verifyUnlockToken,
} from "@/lib/personal-ledger-party-auth";
import {
  addPartyAction,
  setPartyPinAction,
  verifyPartyPinAction,
} from "./actions";
import { PersonalLedgerClient, type PartySummary } from "./personal-ledger-client";

export default async function PersonalLedgerPage() {
  const { profile } = await requireAuth();
  if (!canUsePersonalLedger(profile)) redirect("/");

  const supabase = createAdminSupabaseClient();

  const [{ data: parties }, { data: invoices }, { data: receipts }] = await Promise.all([
    supabase
      .from("personal_ledger_parties")
      .select("id, name, created_at, entry_pin_hash")
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

  const cookieStore = await cookies();

  const summaries: PartySummary[] = ((parties ?? []) as Array<{
    id: string;
    name: string;
    created_at: string;
    entry_pin_hash: string | null;
  }>).map((p) => {
    const invoiced = invByParty.get(p.id) ?? 0;
    const received = rcvByParty.get(p.id) ?? 0;
    const hasPin = !!p.entry_pin_hash;
    const unlockToken = cookieStore.get(unlockCookieName(p.id))?.value;
    // A party is "unlocked" if it has a PIN AND the cookie token
    // verifies for THIS profile + party. Parties without a PIN are
    // never auto-unlocked — the user must set a PIN on first entry.
    const unlocked =
      hasPin && verifyUnlockToken(unlockToken, profile.id, p.id);
    return {
      id: p.id,
      name: p.name,
      createdAt: p.created_at,
      invoiced,
      received,
      outstanding: invoiced - received,
      hasPin,
      unlocked,
    };
  });

  return (
    <PersonalLedgerClient
      parties={summaries}
      addAction={addPartyAction}
      setPinAction={setPartyPinAction}
      verifyPinAction={verifyPartyPinAction}
    />
  );
}
