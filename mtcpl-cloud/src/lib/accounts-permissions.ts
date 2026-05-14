import type { Profile } from "@/lib/types";

/**
 * Finance permission gates.
 *
 * Migration 028 set up the original flow: biller submits, owner
 * approves, accountant pays. Migration 037 collapses biller into
 * accountant and inserts a new "crosscheck" role as the verification
 * gate before bills go to "outstanding":
 *
 *   accountant → submitBillAction → pending_approval
 *      │
 *      └─► crosscheck (or owner) → approveBillAction → approved
 *               │
 *               └─► accountant → proposePaymentsAction
 *                        │
 *                        └─► owner → confirmPaymentsAction
 *                                 │
 *                                 └─► accountant → markPaymentPaidAction → paid
 *
 * The biller role stays in the enum so any historical biller-role
 * profile keeps working, but new role assignments should pick
 * accountant. Owner can still approve bills as a fallback to the
 * crosscheck step.
 */

/** Bill-entry form + own submissions list.
 *  Mig 037: accountant now does bill entry alongside payments.
 *  biller stays valid for historical profiles. */
export function canSubmitBills(p: Pick<Profile, "role">): boolean {
  if (p.role === "developer") return true;
  if (p.role === "owner") return true;
  if (p.role === "accountant") return true;
  if (p.role === "biller") return true; // legacy compatibility
  return false;
}

/** Approve / reject a submitted bill (moves it from pending_approval
 *  → approved, i.e. into "outstanding").
 *
 *  Mig 037: crosscheck role added as the default verifier. Owner +
 *  developer still approve as a fallback (Daksh: "but still owner can
 *  also approve"). Per-profile `can_approve_bills` override is kept
 *  for the legacy Naresh path. */
export function canApproveBills(
  p: Pick<Profile, "role" | "can_approve_bills">,
): boolean {
  if (p.role === "developer") return true;
  if (p.role === "owner") return true;
  if (p.role === "crosscheck") return true;
  if (p.can_approve_bills === true) return true;
  return false;
}

/** Owner's tick on the pay-today screen.
 *
 *  Deliberately decoupled from canApproveBills as of Mig 037 — the
 *  crosscheck role verifies BILLS but does NOT participate in the
 *  payment-confirm step. That stays owner-only (plus developer and
 *  the per-profile can_approve_bills override for Naresh). */
export function canConfirmPayments(
  p: Pick<Profile, "role" | "can_approve_bills">,
): boolean {
  if (p.role === "developer") return true;
  if (p.role === "owner") return true;
  if (p.can_approve_bills === true) return true;
  return false;
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

/** Full bill_vendors CRUD — list, create, edit, archive. Powers the
 *  /accounts/vendors page in its entirety. */
export function canManageBillVendors(p: Pick<Profile, "role">): boolean {
  if (p.role === "developer") return true;
  if (p.role === "owner") return true;
  if (p.role === "accountant") return true;
  return false;
}

/** Add a NEW bill vendor. Broader than canManageBillVendors — anyone
 *  who can submit a bill can also create a vendor mid-flow, because
 *  the "+ Add new vendor" button on the bill-entry page needs to work
 *  when entering a bill from a never-before-seen supplier. Edit and
 *  archive on existing vendors still require canManageBillVendors. */
export function canAddBillVendors(p: Pick<Profile, "role">): boolean {
  if (canManageBillVendors(p)) return true;
  if (canSubmitBills(p)) return true;
  return false;
}

/** Change the vendor NAME on an existing profile. Locked to
 *  developer + owner only. The accountant can edit every other field
 *  (phone, GSTIN, bank details, address, notes) but the name is the
 *  vendor's canonical identifier — renaming mid-stream creates
 *  confusion in audit logs and the bill list (where the vendor
 *  shows up next to its existing bills). */
export function canRenameBillVendor(p: Pick<Profile, "role">): boolean {
  if (p.role === "developer") return true;
  if (p.role === "owner") return true;
  return false;
}
