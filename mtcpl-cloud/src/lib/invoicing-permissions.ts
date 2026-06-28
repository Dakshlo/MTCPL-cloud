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
  // Daksh (mig 168): plain accountant ("account") now also gets the invoicing
  // pages (challans / approval / invoices). Approval stays read-only for them —
  // only owner / developer / accountant_star ("account plus") can approve.
  if (p.role === "accountant") return true;
  return false;
}

/** Who may APPROVE / REJECT a priced challan on the Approval page (Mig 167/168):
 *  owner, developer, and accountant_star ("account plus"). Plain accountant can
 *  view the Approval page but not act. */
export function canApproveInvoice(p: Pick<Profile, "role">): boolean {
  return p.role === "owner" || p.role === "developer" || p.role === "accountant_star";
}
