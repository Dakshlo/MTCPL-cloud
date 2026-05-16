/**
 * Migration 055 — plain server-side helper for seeding default
 * buckets ("B" and "C") on the user's first visit.
 *
 * Lives in src/lib (not in actions.ts) because actions.ts is
 * marked "use server" — every export from that file must be a
 * server action and any call into one triggers Next.js's action
 * machinery (including revalidatePath). Calling that from inside
 * a Server Component render path is unsafe — it can throw a
 * "Cannot revalidate during render" error in Next.js 15.
 *
 * The action wrapper still exists in actions.ts for clients that
 * want to trigger the seed explicitly (it just calls this helper +
 * revalidates). Server components call THIS helper directly.
 */

import { createAdminSupabaseClient } from "./supabase/admin";

/** Seed two default buckets ("B" + "C") if this profile has none
 *  yet. Idempotent — no-op on every subsequent call.
 *
 *  Safe to call from a Server Component render path (no
 *  revalidate, no audit-log write — the seed is invisible
 *  background plumbing). */
export async function ensureDefaultBucketsForOwner(
  profileId: string,
): Promise<void> {
  const supabase = createAdminSupabaseClient();
  const { data: existing } = await supabase
    .from("personal_ledger_buckets")
    .select("id")
    .eq("owner_profile_id", profileId)
    .is("archived_at", null)
    .limit(1);
  if ((existing ?? []).length > 0) return;
  await supabase.from("personal_ledger_buckets").insert([
    { owner_profile_id: profileId, label: "B", sort_order: 0 },
    { owner_profile_id: profileId, label: "C", sort_order: 1 },
  ]);
}
