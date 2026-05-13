import type { Profile } from "@/lib/types";

/**
 * Migration 028 — accounting module gates.
 *
 * Mirror of cutting-permissions.ts. Two new roles (`biller`,
 * `accountant`) handle most of the day-to-day; owner stays the
 * approver-of-record; developer is the superuser bypass everywhere.
 *
 * The flow:
 *
 *   biller → submitBillAction → pending_approval
 *      │
 *      └─► owner → approveBillAction → approved
 *               │
 *               └─► accountant → proposePaymentsAction
 *                        │
 *                        └─► owner → confirmPaymentsAction
 *                                 │
 *                                 └─► accountant → markPaymentPaidAction → paid
 *
 * `can_approve_bills` on `profiles` is the future-proof bit (mirrors
 * `can_approve_cuts` from migration 027). Today only Naresh has it
 * flipped on; tomorrow a senior team_head might handle bill review
 * on the owner's behalf without needing a code change.
 */

/** Bill-entry form + own submissions list. Open to dev, owner, biller.
 *  Owner is included because a small shop will sometimes have the
 *  owner himself fill the form when no biller is on duty. */
export function canSubmitBills(p: Pick<Profile, "role">): boolean {
  if (p.role === "developer") return true;
  if (p.role === "owner") return true;
  if (p.role === "biller") return true;
  return false;
}

/** Approve / reject a submitted bill + the topbar "Bills Audit"
 *  badge. Developer + Owner always; per-profile override via
 *  `can_approve_bills` (Naresh's row gets this flipped to TRUE
 *  post-migration). */
export function canApproveBills(
  p: Pick<Profile, "role" | "can_approve_bills">,
): boolean {
  if (p.role === "developer") return true;
  if (p.role === "owner") return true;
  if (p.can_approve_bills === true) return true;
  return false;
}

/** Owner's tick on the pay-today screen. Same set as approvers — the
 *  finance audit chain stays in the same hands across both gates. */
export function canConfirmPayments(
  p: Pick<Profile, "role" | "can_approve_bills">,
): boolean {
  return canApproveBills(p);
}

/** Accountant duties: propose pay-today, view due-bills dashboard,
 *  manage bill_vendors. Owner has read access too (and confirms on
 *  the pay-today screen) but does NOT propose or mark paid. */
export function canManageAccounts(p: Pick<Profile, "role">): boolean {
  if (p.role === "developer") return true;
  if (p.role === "owner") return true;
  if (p.role === "accountant") return true;
  return false;
}

/** Strict: only the accountant (or developer) actually marks a
 *  payment paid. Keeps the segregation explicit — owner confirms,
 *  accountant executes. The bank reference + method live on this
 *  row, written by whoever has hands on the actual payment. */
export function canMarkPaid(p: Pick<Profile, "role">): boolean {
  if (p.role === "developer") return true;
  if (p.role === "accountant") return true;
  return false;
}

/** bill_vendors CRUD. Accountant-managed, but owner + developer can
 *  edit too (small team — easier than gatekeeping vendor adds). */
export function canManageBillVendors(p: Pick<Profile, "role">): boolean {
  if (p.role === "developer") return true;
  if (p.role === "owner") return true;
  if (p.role === "accountant") return true;
  return false;
}
