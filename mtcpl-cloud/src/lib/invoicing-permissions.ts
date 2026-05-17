import type { Profile } from "@/lib/types";

/**
 * Mig 058 — Invoicing v2 access gate.
 *
 * Daksh's spec: "still all will be accessible by role final-auditor
 * which is govind right now". So /invoicing (parties + challans +
 * invoices) is widened from the previous dev/owner-only gate to
 * include final_auditor — the starred accountant. Plain accountant
 * stays out: that's the deliberate crosscheck distinction
 * (final_auditor is the accountant-with-extra-powers; plain
 * accountant doesn't get invoicing surfaces).
 *
 * Used by every server component under /invoicing AND every server
 * action in invoicing/actions.ts.
 */
export function canUseInvoicing(p: Pick<Profile, "role">): boolean {
  if (p.role === "developer") return true;
  if (p.role === "owner") return true;
  if (p.role === "accountant_star") return true;
  return false;
}
