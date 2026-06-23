/**
 * Dispatch incharge resolution (Mig 159).
 *
 * The incharge printed on a challan is resolved in priority order:
 *   1. the dispatch's own override (dispatches.incharge_id) — set on Check & verify,
 *   2. else the temple's linked incharge (temples.dispatch_incharge_id),
 *   3. else the legacy single global handling man (app_settings 'dispatch_handling_man').
 */

import type { createAdminSupabaseClient } from "@/lib/supabase/admin";

export type Incharge = { id: string | null; name: string; phone: string | null };

type Admin = ReturnType<typeof createAdminSupabaseClient>;

async function inchargeById(admin: Admin, id: string): Promise<Incharge | null> {
  const { data } = await admin
    .from("dispatch_incharges")
    .select("id, name, phone")
    .eq("id", id)
    .maybeSingle();
  if (!data) return null;
  const r = data as { id: string; name: string; phone: string | null };
  return { id: r.id, name: r.name, phone: r.phone };
}

export async function resolveDispatchIncharge(
  admin: Admin,
  opts: { inchargeId?: string | null; temple?: string | null },
): Promise<Incharge | null> {
  // 1. explicit per-dispatch override
  if (opts.inchargeId) {
    const i = await inchargeById(admin, opts.inchargeId);
    if (i) return i;
  }
  // 2. temple's linked incharge
  if (opts.temple) {
    const { data: t } = await admin
      .from("temples")
      .select("dispatch_incharge_id")
      .eq("name", opts.temple)
      .maybeSingle();
    const tid = (t as { dispatch_incharge_id?: string | null } | null)?.dispatch_incharge_id ?? null;
    if (tid) {
      const i = await inchargeById(admin, tid);
      if (i) return i;
    }
  }
  // 3. legacy global handling man
  const { data: g } = await admin
    .from("app_settings")
    .select("value")
    .eq("key", "dispatch_handling_man")
    .maybeSingle();
  const v = (g as { value?: { name?: string; phone?: string } } | null)?.value;
  if (v?.name) return { id: null, name: v.name, phone: v.phone ?? null };
  return null;
}

/** Active incharge roster for the pickers (Check override + manager). */
export async function fetchInchargeOptions(admin: Admin): Promise<Incharge[]> {
  const { data } = await admin
    .from("dispatch_incharges")
    .select("id, name, phone")
    .eq("is_active", true)
    .order("name");
  return ((data ?? []) as Array<{ id: string; name: string; phone: string | null }>).map((r) => ({
    id: r.id,
    name: r.name,
    phone: r.phone,
  }));
}
