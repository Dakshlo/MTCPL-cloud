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
  // Mig 053 — final_auditor stands in for the owner when dad isn't
  // available. Full owner backup includes bill approval.
  if (p.role === "accountant_star") return true;
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
  // Mig 053 — final_auditor confirms proposed payments as owner
  // backup. Daksh: "approve proposed bills to go to ready to pay
  // like owner (if owner is not available)."
  if (p.role === "accountant_star") return true;
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
  // Mig 053 — final_auditor has full accountant access.
  if (p.role === "accountant_star") return true;
  return false;
}

/** Records a payment as paid — writes paid_amount, payment_method,
 *  payment_reference, paid_at, paid_by onto the bill_payments row.
 *
 *  Mig 042 follow-on: Daksh wants the owner to be able to mark paid
 *  too (small business; sometimes the owner does the final bank
 *  step themselves). Originally locked to accountant + dev to
 *  enforce segregation of duties; that segregation is now a soft
 *  preference, not a hard rule.
 *
 *  The amount itself is still LOCKED to whatever the owner
 *  confirmed at proposal-time — markPaymentPaidAction re-reads
 *  proposed_amount from the DB row, so even an owner clicking
 *  Mark Paid can't change the number without going through the
 *  send-back flow. */
export function canMarkPaid(p: Pick<Profile, "role">): boolean {
  if (p.role === "developer") return true;
  if (p.role === "owner") return true;
  if (p.role === "accountant") return true;
  // Mig 053 — final_auditor has full accountant access.
  if (p.role === "accountant_star") return true;
  return false;
}

/** Full bill_vendors CRUD — list, create, edit, archive. Used by
 *  the server actions that mutate vendor rows. Page-level read
 *  access uses canViewBillVendors below (broader). */
export function canManageBillVendors(p: Pick<Profile, "role">): boolean {
  if (p.role === "developer") return true;
  if (p.role === "owner") return true;
  if (p.role === "accountant") return true;
  // Mig 053 — final_auditor (now accountant_star) has full
  // accountant access including vendor CRUD.
  if (p.role === "accountant_star") return true;
  return false;
}

/** Read-only access to /accounts/vendors + per-vendor detail. Daksh:
 *  crosscheck should be able to open vendor accounts to verify
 *  private data (GSTIN, bank, address, ledger) while reviewing a
 *  bill — but NOT edit/archive vendor rows. So we widen the page
 *  guard via this helper and keep the action guards on
 *  canManageBillVendors. */
export function canViewBillVendors(p: Pick<Profile, "role">): boolean {
  if (canManageBillVendors(p)) return true;
  if (p.role === "crosscheck") return true;
  return false;
}

/** Mig 053 — Final Audit gate. Verifies / flags PAID payments
 *  against the bank statement. Not an approval — the money has
 *  already moved; this is a recheck step. Flag captures a reason
 *  surfaced to the owner without reversing anything. */
export function canFinalAudit(p: Pick<Profile, "role">): boolean {
  if (p.role === "developer") return true;
  if (p.role === "owner") return true;
  if (p.role === "accountant_star") return true;
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
