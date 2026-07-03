/**
 * Temple production-name → BILLING name map (Daksh, Jul 2026).
 *
 * Temple names are set in the production department the way ground staff know
 * them; accountants in the invoicing department know a party by its real
 * document / billing name. So wherever the invoicing department shows a temple
 * AS THE CLIENT, use its bill_name once one is set (the tax-invoice prints
 * already do this via fetchTempleBilling). Display-only — the stored temple name
 * is unchanged.
 *
 * Only temples whose bill_name is set are returned; callers fall back to the
 * temple name via `displayNameFor`.
 */

import type { createAdminSupabaseClient } from "@/lib/supabase/admin";

export async function fetchTempleBillNames(
  admin: ReturnType<typeof createAdminSupabaseClient>,
): Promise<Map<string, string>> {
  const m = new Map<string, string>();
  const { data, error } = await admin.from("temples").select("name, bill_name");
  if (error) return m; // pre-mig / column absent → callers just use the temple name
  for (const t of (data ?? []) as Array<{ name: string | null; bill_name: string | null }>) {
    const bn = (t.bill_name ?? "").trim();
    if (bn && t.name) m.set(t.name, bn);
  }
  return m;
}

/** temple name → its billing name if set, else the temple name unchanged. */
export function displayNameFor(map: Map<string, string>, temple: string | null | undefined): string {
  const t = (temple ?? "").trim();
  return map.get(t) ?? t ?? "—";
}
