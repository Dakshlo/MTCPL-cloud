import type { Profile } from "./personal-ledger-types";

/**
 * Mig 055 — Personal Ledger access gate.
 *
 * Daksh's private accounts-receivable scratchpad. Developer + owner
 * roles only. Data is owner-scoped at the row level (every action
 * sets `owner_profile_id = profile.id` on insert, and reads
 * always filter by `owner_profile_id = current.id`) so each user
 * sees only their own parties / invoices / receipts.
 *
 * Hard not-a-parallel-ledger guard rails:
 *   • No new app_role added — sticking to dev / owner so nobody is
 *     specifically created to maintain "books" no one else can see.
 *   • Every mutation audit-logged via the existing logAudit helper.
 *   • Banner + sidebar label + Excel filename all clearly say
 *     "PERSONAL — NOT COMPANY BOOKS" so a glance at the screen
 *     never confuses this for a company-finance feature.
 */
export function canUsePersonalLedger(p: Pick<Profile, "role">): boolean {
  if (p.role === "developer") return true;
  if (p.role === "owner") return true;
  return false;
}
