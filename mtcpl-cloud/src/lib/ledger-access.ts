/**
 * Personal-ledger access (mig 174 — Daksh, private feature).
 *
 *  • developer  → both accounts (Home + Office) — god-mode for testing/support.
 *  • owner Naresh → both accounts (Home is his; he also sees Office + approves).
 *  • crosscheck ("manager") → Office account only.
 *  • everyone else → no access.
 *
 * The owner gate is name-scoped to Naresh on purpose ("only naresh" — Daksh).
 * Used by BOTH the /ledger page and the server actions, plus to decide whether
 * to even mount the secret entry trigger.
 */

import type { AppRole } from "@/lib/types";

export type LedgerScope = "both" | "office" | null;

export function ledgerScope(profile: { role: AppRole; full_name: string | null }): LedgerScope {
  if (profile.role === "developer") return "both";
  if (profile.role === "crosscheck") return "office";
  if (profile.role === "owner" && /naresh/i.test(profile.full_name ?? "")) return "both";
  return null;
}
