"use server";

// Migration 028 — Accounting / Finance server actions.
//
// All "use server" exports — Next.js refuses non-async exports here.
// Result shape `{ ok: true } | { ok: false; error: string }` matches
// the cutting-approval actions (commit 246f0e7). Form-action wrappers
// that need void semantics live alongside (suffixed `FormAction`)
// and just consume the result + redirect.
//
// State machines: see CLAUDE_HANDOFF/04_modules.md → Accounts.

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { randomUUID } from "node:crypto";
import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";
import { notify } from "@/lib/notifications";
import {
  canAddBillVendors,
  canApproveBills,
  canConfirmPayments,
  canManageAccounts,
  canManageBillVendors,
  canMarkPaid,
  canRenameBillVendor,
  canSubmitBills,
} from "@/lib/accounts-permissions";

type ActionResult = { ok: true } | { ok: false; error: string };

async function refreshAccountsPaths() {
  revalidatePath("/accounts");
  revalidatePath("/accounts/bills");
  revalidatePath("/accounts/approvals");
  revalidatePath("/accounts/pay-today");
  revalidatePath("/accounts/payments");
  revalidatePath("/accounts/vendors");
}

/** Postgres unique-violation code. Used to surface a friendly
 *  duplicate-bill error instead of leaking the raw constraint name. */
const PG_UNIQUE_VIOLATION = "23505";

// ──────────────────────────────────────────────────────────────────
// Bill submission
// ──────────────────────────────────────────────────────────────────

export async function submitBillAction(
  formData: FormData,
): Promise<
  | { ok: true; billId: string; token: string }
  // Mig 042 follow-on (Daksh): "don't show that duplicate bill
  // [banner] down when it's duplicate" — instead surface a small
  // centered peek. The action now tags the duplicate with an
  // errorCode so the client can render a focused modal rather than
  // the generic inline error banner.
  | { ok: false; error: string; errorCode?: "DUPLICATE_BILL" }
> {
  const { profile } = await requireAuth();
  if (!canSubmitBills(profile)) {
    return { ok: false, error: "You do not have permission to submit bills." };
  }
  const supabase = createAdminSupabaseClient();

  const billVendorId = String(formData.get("bill_vendor_id") || "").trim();
  const vendorBillNo = String(formData.get("vendor_bill_no") || "").trim();
  const billDate = String(formData.get("bill_date") || "").trim();
  const description = String(formData.get("description") || "").trim();
  const costHead = String(formData.get("cost_head") || "").trim() || null;
  const amountSubtotalRaw = String(formData.get("amount_subtotal") || "0");

  // Migration 042 — tax breakdown. The form sends CGST/SGST/IGST
  // separately; gst_percent is computed as their sum so the existing
  // amount_gst / amount_total generated columns keep working
  // unchanged. TDS/TCS percent are direct inputs gated on the
  // vendor's tds_applicable / tcs_applicable flags.
  const cgstPercent = Number(formData.get("cgst_percent") || 0);
  const sgstPercent = Number(formData.get("sgst_percent") || 0);
  const igstPercent = Number(formData.get("igst_percent") || 0);
  const tdsPercent = Number(formData.get("tds_percent") || 0);
  const tcsPercent = Number(formData.get("tcs_percent") || 0);

  const amountSubtotal = Number(amountSubtotalRaw);
  const taxOk = (n: number) => Number.isFinite(n) && n >= 0 && n <= 100;
  const gstPercent =
    Number.isFinite(cgstPercent) && Number.isFinite(sgstPercent) && Number.isFinite(igstPercent)
      ? cgstPercent + sgstPercent + igstPercent
      : Number(formData.get("gst_percent") || 0);

  if (!billVendorId) return { ok: false, error: "Pick a beneficiary." };
  if (!vendorBillNo) return { ok: false, error: "Vendor's bill number is required." };
  if (!billDate) return { ok: false, error: "Bill date is required." };
  if (!description) return { ok: false, error: "Description is required." };
  if (!Number.isFinite(amountSubtotal) || amountSubtotal <= 0) {
    return { ok: false, error: "Subtotal amount must be greater than zero." };
  }
  if (!taxOk(cgstPercent) || !taxOk(sgstPercent) || !taxOk(igstPercent)) {
    return { ok: false, error: "CGST / SGST / IGST must each be between 0 and 100." };
  }
  if (!Number.isFinite(gstPercent) || gstPercent < 0 || gstPercent > 100) {
    return { ok: false, error: "Total GST (CGST + SGST + IGST) must be between 0 and 100." };
  }
  if (!taxOk(tdsPercent)) {
    return { ok: false, error: "TDS% must be between 0 and 100." };
  }
  if (!taxOk(tcsPercent)) {
    return { ok: false, error: "TCS% must be between 0 and 100." };
  }

  try {
    const { data: inserted, error } = await supabase
      .from("bills")
      .insert({
        bill_vendor_id: billVendorId,
        vendor_bill_no: vendorBillNo,
        bill_date: billDate,
        description,
        cost_head: costHead,
        amount_subtotal: amountSubtotal,
        gst_percent: gstPercent,
        cgst_percent: cgstPercent,
        sgst_percent: sgstPercent,
        igst_percent: igstPercent,
        tds_percent: tdsPercent,
        tcs_percent: tcsPercent,
        status: "pending_approval",
        submitted_by: profile.id,
      })
      .select("id, token, amount_total")
      .single();

    if (error) {
      if (error.code === PG_UNIQUE_VIOLATION) {
        // Migration 039: uniqueness is scoped to (vendor, bill_no,
        // financial_year). The same bill_no IS allowed in a different
        // FY. Tagged with errorCode so the client renders a tight
        // center-peek instead of the long inline banner.
        return {
          ok: false,
          errorCode: "DUPLICATE_BILL",
          error: "Duplicate bill — already exists for this vendor in the same financial year.",
        };
      }
      return { ok: false, error: error.message };
    }
    if (!inserted) return { ok: false, error: "Bill creation returned no row." };

    const billId = inserted.id as string;
    const token = inserted.token as string;
    const totalAmount = Number(inserted.amount_total ?? 0);

    void Promise.all([
      logAudit(profile.id, "bill_submitted", "bill", billId, {
        token,
        bill_vendor_id: billVendorId,
        vendor_bill_no: vendorBillNo,
        amount_subtotal: amountSubtotal,
        gst_percent: gstPercent,
        cgst_percent: cgstPercent,
        sgst_percent: sgstPercent,
        igst_percent: igstPercent,
        tds_percent: tdsPercent,
        tcs_percent: tcsPercent,
        amount_total: totalAmount,
      }),
      notify(
        "bill_pending_approval",
        `Bill ${token} submitted — ₹${totalAmount.toLocaleString("en-IN")}`,
        {
          message: `Awaiting owner approval. Vendor bill no ${vendorBillNo}.`,
          entityType: "bill",
          entityId: billId,
          actorId: profile.id,
          targetRoles: ["owner", "developer"],
        },
      ),
    ]).catch((e) =>
      console.warn("[submitBillAction] audit/notify failed (non-fatal)", e),
    );

    await refreshAccountsPaths();
    return { ok: true, billId, token };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[submitBillAction] FAILED", { error: msg });
    return { ok: false, error: msg };
  }
}

// ──────────────────────────────────────────────────────────────────
// Owner approval / rejection
// ──────────────────────────────────────────────────────────────────

export async function approveBillAction(formData: FormData): Promise<ActionResult> {
  const { profile } = await requireAuth();
  if (!canApproveBills(profile)) {
    return { ok: false, error: "You do not have permission to approve bills." };
  }
  const supabase = createAdminSupabaseClient();
  const billId = String(formData.get("bill_id") || "").trim();
  if (!billId) return { ok: false, error: "Missing bill_id." };

  const now = new Date().toISOString();
  const { data: updated, error } = await supabase
    .from("bills")
    .update({
      status: "approved",
      approved_by: profile.id,
      approved_at: now,
      rejection_note: null,
      rejected_by: null,
      rejected_at: null,
      updated_at: now,
    })
    .eq("id", billId)
    .eq("status", "pending_approval")
    .select("id, token, bill_vendor_id, submitted_by, amount_total")
    .single();

  if (error) return { ok: false, error: error.message };
  if (!updated) {
    return {
      ok: false,
      error: "Bill is no longer in pending_approval — refresh and retry.",
    };
  }

  const token = updated.token as string;
  const submitterId = (updated.submitted_by as string | null) ?? null;
  const total = Number(updated.amount_total ?? 0);

  void Promise.all([
    logAudit(profile.id, "bill_approved", "bill", billId, {
      token,
      amount_total: total,
    }),
    notify(
      "bill_approved",
      `Bill ${token} approved`,
      {
        message: `₹${total.toLocaleString("en-IN")} — now in the accountant's due list.`,
        entityType: "bill",
        entityId: billId,
        actorId: profile.id,
        targetRoles: submitterId
          ? ["accountant", "developer"]
          : ["accountant", "developer", "biller"],
      },
    ),
  ]).catch((e) => console.warn("[approveBillAction] cleanup failed", e));

  await refreshAccountsPaths();
  return { ok: true };
}

/** Form-action wrapper for `<form action>` usage on the detail page.
 *  Redirects on success or appends ?error= on failure — mirrors
 *  approveCutFormAction. */
export async function approveBillFormAction(formData: FormData) {
  const result = await approveBillAction(formData);
  const billId = String(formData.get("bill_id") || "");
  if (!result.ok) {
    redirect(
      `/accounts/bills/${encodeURIComponent(billId)}?error=${encodeURIComponent(result.error)}`,
    );
  }
  redirect("/accounts/approvals");
}

export async function rejectBillAction(formData: FormData): Promise<ActionResult> {
  const { profile } = await requireAuth();
  if (!canApproveBills(profile)) {
    return { ok: false, error: "You do not have permission to reject bills." };
  }
  const supabase = createAdminSupabaseClient();
  const billId = String(formData.get("bill_id") || "").trim();
  const note = String(formData.get("note") || "").trim() || null;
  if (!billId) return { ok: false, error: "Missing bill_id." };

  const now = new Date().toISOString();
  const { data: updated, error } = await supabase
    .from("bills")
    .update({
      status: "rejected",
      rejected_by: profile.id,
      rejected_at: now,
      rejection_note: note,
      updated_at: now,
    })
    .eq("id", billId)
    .eq("status", "pending_approval")
    .select("id, token, submitted_by")
    .single();

  if (error) return { ok: false, error: error.message };
  if (!updated) {
    return {
      ok: false,
      error: "Bill is no longer in pending_approval — refresh and retry.",
    };
  }

  void Promise.all([
    logAudit(profile.id, "bill_rejected", "bill", billId, {
      token: updated.token,
      note,
    }),
    notify(
      "bill_rejected",
      `Bill ${updated.token} sent back for edit`,
      {
        message: note ?? "Approver requested changes.",
        entityType: "bill",
        entityId: billId,
        actorId: profile.id,
        targetRoles: ["biller", "developer"],
      },
    ),
  ]).catch((e) => console.warn("[rejectBillAction] cleanup failed", e));

  await refreshAccountsPaths();
  return { ok: true };
}

// ──────────────────────────────────────────────────────────────────
// Bill edits
// ──────────────────────────────────────────────────────────────────

/**
 * Edit a bill in-flight. Three legal paths:
 *   1. The original biller (or any user with submit rights) editing
 *      their own bill while it sits in `rejected`. Save flips status
 *      back to `pending_approval` and clears the rejection note.
 *   2. An approver (crosscheck / owner / can_approve_bills) editing
 *      while the bill is in `pending_approval`. In-place edit, status
 *      unchanged — approver can edit-then-approve in one sitting.
 *   3. The owner (canConfirmPayments) editing while the bill is in
 *      `approved` — i.e. correcting a typo on a bill that's already
 *      in the due-bills list. Locked the moment any non-cancelled
 *      payment row exists. Mig 042 follow-on per Daksh: "even when
 *      any entry need to be edited in due bills only owner can edit
 *      it. and if account want to edit it will need to ask for
 *      permission from owner."
 *
 * Status is preserved on approved-bill edits (still 'approved' after
 * save). Only the rejected-edit path transitions back to
 * pending_approval.
 */
export async function editBillAction(
  formData: FormData,
): Promise<
  | { ok: true }
  | { ok: false; error: string; errorCode?: "DUPLICATE_BILL" }
> {
  const { profile } = await requireAuth();
  const supabase = createAdminSupabaseClient();
  const billId = String(formData.get("bill_id") || "").trim();
  if (!billId) return { ok: false, error: "Missing bill_id." };

  const { data: bill, error: loadErr } = await supabase
    .from("bills")
    .select("id, token, status, submitted_by")
    .eq("id", billId)
    .maybeSingle();
  if (loadErr) return { ok: false, error: loadErr.message };
  if (!bill) return { ok: false, error: "Bill not found." };

  const isApprover = canApproveBills(profile);
  const isSubmitter = bill.submitted_by === profile.id;
  const isBillerLike = canSubmitBills(profile);
  // canConfirmPayments == owner / dev / can_approve_bills override.
  // Accountant is intentionally excluded — they can't edit a due
  // bill on their own; they have to ask the owner.
  const isOwnerLike = canConfirmPayments(profile);

  let nextStatus: "pending_approval" | undefined;
  if (bill.status === "pending_approval") {
    if (!isApprover) {
      return {
        ok: false,
        error:
          "Bill is already with the approver. You can only edit it once they send it back for edit.",
      };
    }
    nextStatus = undefined; // stays in pending_approval
  } else if (bill.status === "rejected") {
    if (!isApprover && !isSubmitter && !isBillerLike) {
      return {
        ok: false,
        error: "Only the original biller or an approver can edit a rejected bill.",
      };
    }
    nextStatus = "pending_approval";
  } else if (bill.status === "approved") {
    if (!isOwnerLike) {
      return {
        ok: false,
        error:
          "Only the owner can edit a bill once it's in the due-bills list. Ask the owner to make the correction.",
      };
    }
    nextStatus = undefined; // stays in approved
  } else {
    return {
      ok: false,
      error: `Bill is not in an editable state (status: ${bill.status}).`,
    };
  }

  // Lock once any non-cancelled payment row exists.
  const { count: nonCancelledPayments } = await supabase
    .from("bill_payments")
    .select("*", { count: "exact", head: true })
    .eq("bill_id", billId)
    .neq("status", "cancelled");
  if ((nonCancelledPayments ?? 0) > 0) {
    return {
      ok: false,
      error:
        "Bill is locked because a payment has been proposed or made. Contact a developer if a correction is genuinely needed.",
    };
  }

  // Read updated fields. Empty strings mean "leave unchanged"? No —
  // require the form to send the full set; partial edits are not a
  // use-case yet.
  const vendorBillNo = String(formData.get("vendor_bill_no") || "").trim();
  const billDate = String(formData.get("bill_date") || "").trim();
  const description = String(formData.get("description") || "").trim();
  const costHead = String(formData.get("cost_head") || "").trim() || null;
  const amountSubtotal = Number(formData.get("amount_subtotal") || 0);
  const billVendorId = String(formData.get("bill_vendor_id") || "").trim();

  // Mig 042 — tax breakdown
  const cgstPercent = Number(formData.get("cgst_percent") || 0);
  const sgstPercent = Number(formData.get("sgst_percent") || 0);
  const igstPercent = Number(formData.get("igst_percent") || 0);
  const tdsPercent = Number(formData.get("tds_percent") || 0);
  const tcsPercent = Number(formData.get("tcs_percent") || 0);
  const taxOk = (n: number) => Number.isFinite(n) && n >= 0 && n <= 100;
  const gstPercent =
    Number.isFinite(cgstPercent) && Number.isFinite(sgstPercent) && Number.isFinite(igstPercent)
      ? cgstPercent + sgstPercent + igstPercent
      : Number(formData.get("gst_percent") || 0);

  if (!billVendorId || !vendorBillNo || !billDate || !description) {
    return { ok: false, error: "All fields are required to save the edit." };
  }
  if (!Number.isFinite(amountSubtotal) || amountSubtotal <= 0) {
    return { ok: false, error: "Subtotal must be greater than zero." };
  }
  if (!taxOk(cgstPercent) || !taxOk(sgstPercent) || !taxOk(igstPercent)) {
    return { ok: false, error: "CGST / SGST / IGST must each be between 0 and 100." };
  }
  if (!Number.isFinite(gstPercent) || gstPercent < 0 || gstPercent > 100) {
    return { ok: false, error: "Total GST (CGST + SGST + IGST) must be between 0 and 100." };
  }
  if (!taxOk(tdsPercent) || !taxOk(tcsPercent)) {
    return { ok: false, error: "TDS / TCS must each be between 0 and 100." };
  }

  const now = new Date().toISOString();
  const updatePayload: Record<string, unknown> = {
    bill_vendor_id: billVendorId,
    vendor_bill_no: vendorBillNo,
    bill_date: billDate,
    description,
    cost_head: costHead,
    amount_subtotal: amountSubtotal,
    gst_percent: gstPercent,
    cgst_percent: cgstPercent,
    sgst_percent: sgstPercent,
    igst_percent: igstPercent,
    tds_percent: tdsPercent,
    tcs_percent: tcsPercent,
    updated_at: now,
  };
  if (nextStatus) {
    updatePayload.status = nextStatus;
    updatePayload.rejection_note = null;
    updatePayload.rejected_by = null;
    updatePayload.rejected_at = null;
  }

  const { error: updErr } = await supabase
    .from("bills")
    .update(updatePayload)
    .eq("id", billId)
    .eq("status", bill.status);
  if (updErr) {
    if (updErr.code === PG_UNIQUE_VIOLATION) {
      return {
        ok: false,
        errorCode: "DUPLICATE_BILL",
        error: "Duplicate bill — already exists for this vendor in the same financial year.",
      };
    }
    return { ok: false, error: updErr.message };
  }

  void Promise.all([
    logAudit(profile.id, "bill_edited", "bill", billId, {
      token: bill.token,
      from_status: bill.status,
      to_status: nextStatus ?? bill.status,
    }),
    nextStatus === "pending_approval"
      ? notify(
          "bill_resubmitted",
          `Bill ${bill.token} resubmitted for approval`,
          {
            message: "Biller has applied edits.",
            entityType: "bill",
            entityId: billId,
            actorId: profile.id,
            targetRoles: ["owner", "developer"],
          },
        )
      : Promise.resolve(),
  ]).catch((e) => console.warn("[editBillAction] cleanup failed", e));

  await refreshAccountsPaths();
  return { ok: true };
}

export async function cancelBillAction(formData: FormData): Promise<ActionResult> {
  const { profile } = await requireAuth();
  if (profile.role !== "developer" && profile.role !== "owner") {
    return { ok: false, error: "Only the owner or a developer can cancel a bill." };
  }
  const supabase = createAdminSupabaseClient();
  const billId = String(formData.get("bill_id") || "").trim();
  if (!billId) return { ok: false, error: "Missing bill_id." };

  const { data: bill } = await supabase
    .from("bills")
    .select("id, token, status")
    .eq("id", billId)
    .maybeSingle();
  if (!bill) return { ok: false, error: "Bill not found." };
  if (bill.status === "fully_paid" || bill.status === "approved") {
    return {
      ok: false,
      error: "Cannot cancel an approved or paid bill. Contact a developer.",
    };
  }

  const { count } = await supabase
    .from("bill_payments")
    .select("*", { count: "exact", head: true })
    .eq("bill_id", billId)
    .neq("status", "cancelled");
  if ((count ?? 0) > 0) {
    return { ok: false, error: "Cannot cancel a bill with active payment rows." };
  }

  const now = new Date().toISOString();
  const { error: updErr } = await supabase
    .from("bills")
    .update({
      status: "cancelled",
      cancelled_by: profile.id,
      cancelled_at: now,
      updated_at: now,
    })
    .eq("id", billId);
  if (updErr) return { ok: false, error: updErr.message };

  void logAudit(profile.id, "bill_cancelled", "bill", billId, { token: bill.token });
  await refreshAccountsPaths();
  return { ok: true };
}

// ──────────────────────────────────────────────────────────────────
// Partial rejection (debit-note math) — migration 045
// ──────────────────────────────────────────────────────────────────
// Use case: vendor invoiced ₹100k of material, only ₹60k is good.
// We mark a ₹40k partial rejection on the bill. The generated
// amount_payable_to_vendor + amount_outstanding columns recompute
// off the surviving ₹60k subtotal (factoring GST + TDS + TCS).
//
// Per Daksh: no new approval gate — the crosscheck role verifies
// rejections via the existing bill audit trail. Notification fans
// out to owner + crosscheck so Mafat sees it in his queue.

export async function markPartialRejectionAction(
  formData: FormData,
): Promise<ActionResult> {
  const { profile } = await requireAuth();
  if (!canManageAccounts(profile)) {
    return {
      ok: false,
      error: "Only the owner / accountant / developer can mark a partial rejection.",
    };
  }
  const supabase = createAdminSupabaseClient();

  const billId = String(formData.get("bill_id") || "").trim();
  const amtRaw = String(formData.get("partial_rejection_amount") || "").trim();
  const note = String(formData.get("partial_rejection_note") || "").trim();
  const amount = Number(amtRaw);

  if (!billId) return { ok: false, error: "Missing bill_id." };
  if (!Number.isFinite(amount) || amount <= 0) {
    return { ok: false, error: "Rejection amount must be greater than zero." };
  }
  if (!note || note.length < 3) {
    return {
      ok: false,
      error: "Please add a short note explaining why this material was rejected.",
    };
  }

  // Race-guard: bill must be 'approved' AND have no 'paid' payments.
  // (We allow 'pending_approval' too — if the rejection is known
  // before the bill is approved, the approver should be able to see
  // the adjusted payable while reviewing.)
  const { data: bill } = await supabase
    .from("bills")
    .select("id, token, status, amount_subtotal, partial_rejection_amount")
    .eq("id", billId)
    .maybeSingle();
  if (!bill) return { ok: false, error: "Bill not found." };
  if (!["approved", "pending_approval"].includes(bill.status)) {
    return {
      ok: false,
      error: `Cannot mark rejection on a ${bill.status} bill. Only approved or pending bills.`,
    };
  }
  if (amount > Number(bill.amount_subtotal)) {
    return {
      ok: false,
      error: `Rejection (₹${amount.toLocaleString("en-IN")}) cannot exceed the bill subtotal (₹${Number(
        bill.amount_subtotal,
      ).toLocaleString("en-IN")}).`,
    };
  }

  // Lock: once any payment has hit 'paid', the rejection is frozen.
  const { count: paidCount } = await supabase
    .from("bill_payments")
    .select("*", { count: "exact", head: true })
    .eq("bill_id", billId)
    .eq("status", "paid");
  if ((paidCount ?? 0) > 0) {
    return {
      ok: false,
      error: "Cannot change rejection — a payment has already been marked paid.",
    };
  }

  const now = new Date().toISOString();
  const { error: updErr } = await supabase
    .from("bills")
    .update({
      partial_rejection_amount: amount,
      partial_rejection_note: note,
      partial_rejection_at: now,
      partial_rejection_by: profile.id,
      updated_at: now,
    })
    .eq("id", billId);
  if (updErr) return { ok: false, error: updErr.message };

  const wasUpdate = Number(bill.partial_rejection_amount ?? 0) > 0;
  void logAudit(
    profile.id,
    wasUpdate ? "bill_partial_rejection_updated" : "bill_partial_rejection_marked",
    "bill",
    billId,
    {
      token: bill.token,
      amount_rejected: amount,
      previous_amount: Number(bill.partial_rejection_amount ?? 0),
      note,
    },
  );
  void notify(
    "bill_partial_rejection",
    `Partial rejection on ${bill.token}`,
    {
      message: `₹${amount.toLocaleString("en-IN")} marked as rejected. ${note}`,
      entityType: "bill",
      entityId: billId,
      actorId: profile.id,
      // Crosscheck + owner see it. Accountant doesn't need a notif —
      // they're typically the one marking it.
      targetRoles: ["crosscheck", "owner", "developer"],
    },
  );
  await refreshAccountsPaths();
  return { ok: true };
}

export async function clearPartialRejectionAction(
  formData: FormData,
): Promise<ActionResult> {
  const { profile } = await requireAuth();
  if (!canManageAccounts(profile)) {
    return {
      ok: false,
      error: "Only the owner / accountant / developer can clear a partial rejection.",
    };
  }
  const supabase = createAdminSupabaseClient();

  const billId = String(formData.get("bill_id") || "").trim();
  if (!billId) return { ok: false, error: "Missing bill_id." };

  const { data: bill } = await supabase
    .from("bills")
    .select("id, token, partial_rejection_amount")
    .eq("id", billId)
    .maybeSingle();
  if (!bill) return { ok: false, error: "Bill not found." };
  if (Number(bill.partial_rejection_amount ?? 0) === 0) {
    return { ok: false, error: "Nothing to clear — bill has no partial rejection." };
  }

  // Same paid-lock check as the marking action — once cash has
  // moved, the rejection event is frozen.
  const { count: paidCount } = await supabase
    .from("bill_payments")
    .select("*", { count: "exact", head: true })
    .eq("bill_id", billId)
    .eq("status", "paid");
  if ((paidCount ?? 0) > 0) {
    return {
      ok: false,
      error: "Cannot clear rejection — a payment has already been marked paid.",
    };
  }

  const previousAmount = Number(bill.partial_rejection_amount);
  const now = new Date().toISOString();
  const { error: updErr } = await supabase
    .from("bills")
    .update({
      partial_rejection_amount: 0,
      partial_rejection_note: null,
      partial_rejection_at: null,
      partial_rejection_by: null,
      updated_at: now,
    })
    .eq("id", billId);
  if (updErr) return { ok: false, error: updErr.message };

  void logAudit(
    profile.id,
    "bill_partial_rejection_cleared",
    "bill",
    billId,
    { token: bill.token, previous_amount: previousAmount },
  );
  void notify(
    "bill_partial_rejection_cleared",
    `Partial rejection cleared on ${bill.token}`,
    {
      message: `Previous rejection of ₹${previousAmount.toLocaleString("en-IN")} cleared.`,
      entityType: "bill",
      entityId: billId,
      actorId: profile.id,
      targetRoles: ["crosscheck", "owner", "developer"],
    },
  );
  await refreshAccountsPaths();
  return { ok: true };
}

// ──────────────────────────────────────────────────────────────────
// Payment proposal / confirmation / execution
// ──────────────────────────────────────────────────────────────────

export async function proposePaymentsAction(formData: FormData): Promise<
  | { ok: true; batchId: string; rowsCreated: number; skipped: string[] }
  | { ok: false; error: string }
> {
  const { profile } = await requireAuth();
  if (!canManageAccounts(profile)) {
    return { ok: false, error: "You do not have permission to propose payments." };
  }
  const supabase = createAdminSupabaseClient();

  let billIds: string[];
  let proposedAmounts: Record<string, number>;
  try {
    billIds = JSON.parse(String(formData.get("bill_ids") || "[]")) as string[];
    proposedAmounts = JSON.parse(
      String(formData.get("proposed_amounts") || "{}"),
    ) as Record<string, number>;
  } catch {
    return { ok: false, error: "Bad payload — expected JSON bill_ids + proposed_amounts." };
  }
  if (!Array.isArray(billIds) || billIds.length === 0) {
    return { ok: false, error: "Pick at least one bill to propose." };
  }

  // Pull each bill's current state + check no open payment row already.
  const { data: bills, error: loadErr } = await supabase
    .from("bills")
    .select("id, token, status, amount_outstanding")
    .in("id", billIds);
  if (loadErr) return { ok: false, error: loadErr.message };

  const { data: openPayments } = await supabase
    .from("bill_payments")
    .select("bill_id")
    .in("bill_id", billIds)
    .in("status", ["proposed", "confirmed"]);
  const billsWithOpen = new Set((openPayments ?? []).map((r) => r.bill_id as string));

  const batchId = randomUUID();
  const now = new Date().toISOString();
  const rowsToInsert: Array<Record<string, unknown>> = [];
  const skipped: string[] = [];

  for (const b of bills ?? []) {
    const billId = b.id as string;
    const token = b.token as string;
    const outstanding = Number(b.amount_outstanding ?? 0);
    if (b.status !== "approved") {
      skipped.push(`${token} (not approved)`);
      continue;
    }
    if (outstanding <= 0) {
      skipped.push(`${token} (no outstanding)`);
      continue;
    }
    if (billsWithOpen.has(billId)) {
      skipped.push(`${token} (already has open payment)`);
      continue;
    }
    const requested = proposedAmounts[billId];
    const amount =
      Number.isFinite(requested) && requested > 0
        ? Math.min(Number(requested), outstanding)
        : outstanding;
    rowsToInsert.push({
      bill_id: billId,
      status: "proposed",
      proposed_amount: amount,
      proposed_by: profile.id,
      proposed_at: now,
      proposal_batch_id: batchId,
    });
  }

  if (rowsToInsert.length === 0) {
    return {
      ok: false,
      error:
        skipped.length > 0
          ? `Nothing to propose — ${skipped.join("; ")}.`
          : "No bills matched the proposal criteria.",
    };
  }

  const { error: insErr } = await supabase.from("bill_payments").insert(rowsToInsert);
  if (insErr) return { ok: false, error: insErr.message };

  void Promise.all([
    logAudit(profile.id, "payments_proposed", "bill_payments_batch", batchId, {
      rows_created: rowsToInsert.length,
      bill_ids: rowsToInsert.map((r) => r.bill_id),
      skipped,
    }),
    notify(
      "payments_proposed",
      `${rowsToInsert.length} bill(s) proposed for payment`,
      {
        message: "Awaiting owner confirmation on the Pay Today screen.",
        entityType: "bill_payments_batch",
        entityId: batchId,
        actorId: profile.id,
        targetRoles: ["owner", "developer"],
      },
    ),
  ]).catch((e) => console.warn("[proposePaymentsAction] cleanup failed", e));

  await refreshAccountsPaths();
  return { ok: true, batchId, rowsCreated: rowsToInsert.length, skipped };
}

export async function confirmPaymentsAction(formData: FormData): Promise<ActionResult> {
  const { profile } = await requireAuth();
  if (!canConfirmPayments(profile)) {
    return { ok: false, error: "You do not have permission to confirm payments." };
  }
  const supabase = createAdminSupabaseClient();

  const batchId = String(formData.get("batch_id") || "").trim();
  if (!batchId) return { ok: false, error: "Missing batch_id." };

  let confirmedIds: string[];
  try {
    confirmedIds = JSON.parse(String(formData.get("confirmed_payment_ids") || "[]")) as string[];
  } catch {
    return { ok: false, error: "Bad payload — expected JSON confirmed_payment_ids." };
  }

  const { data: batchRows, error: loadErr } = await supabase
    .from("bill_payments")
    .select("id, status, bill_id")
    .eq("proposal_batch_id", batchId)
    .eq("status", "proposed");
  if (loadErr) return { ok: false, error: loadErr.message };
  if (!batchRows || batchRows.length === 0) {
    return { ok: false, error: "No proposed rows found for this batch." };
  }

  const now = new Date().toISOString();
  const confirmSet = new Set(confirmedIds);
  const toConfirm = batchRows.filter((r) => confirmSet.has(r.id as string));
  const toCancel = batchRows.filter((r) => !confirmSet.has(r.id as string));

  if (toConfirm.length > 0) {
    const { error } = await supabase
      .from("bill_payments")
      .update({
        status: "confirmed",
        confirmed_by: profile.id,
        confirmed_at: now,
        updated_at: now,
      })
      .in(
        "id",
        toConfirm.map((r) => r.id as string),
      )
      .eq("status", "proposed");
    if (error) return { ok: false, error: error.message };
  }

  if (toCancel.length > 0) {
    await supabase
      .from("bill_payments")
      .update({
        status: "cancelled",
        cancelled_by: profile.id,
        cancelled_at: now,
        cancel_reason: "owner_unticked",
        updated_at: now,
      })
      .in(
        "id",
        toCancel.map((r) => r.id as string),
      )
      .eq("status", "proposed");
  }

  void Promise.all([
    logAudit(profile.id, "payments_confirmed", "bill_payments_batch", batchId, {
      confirmed_ids: toConfirm.map((r) => r.id),
      cancelled_ids: toCancel.map((r) => r.id),
    }),
    notify(
      "payments_confirmed",
      `Owner confirmed ${toConfirm.length} payment(s)`,
      {
        message:
          toCancel.length > 0
            ? `${toCancel.length} proposal(s) un-ticked. Process the confirmed list.`
            : "Process the confirmed list.",
        entityType: "bill_payments_batch",
        entityId: batchId,
        actorId: profile.id,
        targetRoles: ["accountant", "developer"],
      },
    ),
  ]).catch((e) => console.warn("[confirmPaymentsAction] cleanup failed", e));

  await refreshAccountsPaths();
  return { ok: true };
}

export async function markPaymentPaidAction(formData: FormData): Promise<ActionResult> {
  const { profile } = await requireAuth();
  if (!canMarkPaid(profile)) {
    return { ok: false, error: "Only the accountant or a developer can mark a payment paid." };
  }
  const supabase = createAdminSupabaseClient();

  const paymentId = String(formData.get("payment_id") || "").trim();
  // Mig 042 follow-on (Daksh): paid_amount is no longer trusted from
  // the form. We re-read proposed_amount from the DB row below and
  // use that as the actual paid_amount. The form field is kept so
  // legacy clients don't error, but its value is intentionally
  // ignored — defense in depth against a hand-crafted POST that
  // tries to bypass the locked Mark Paid input.
  const _formPaidAmountIgnored = formData.get("paid_amount");
  void _formPaidAmountIgnored;
  const methodRaw = String(formData.get("payment_method") || "").trim();
  const referenceTrimmed = String(formData.get("payment_reference") || "").trim();
  const reference = referenceTrimmed || null;
  const note = String(formData.get("payment_note") || "").trim() || null;

  if (!paymentId) return { ok: false, error: "Missing payment_id." };
  const validMethods = new Set([
    "cash",
    "cheque",
    "neft",
    "rtgs",
    "upi",
    "imps",
    "card",
    "other",
  ]);
  if (!validMethods.has(methodRaw)) {
    return { ok: false, error: "Pick a valid payment method." };
  }
  // Mig 042 — per Daksh: UTR / reference is mandatory for every
  // non-cash payment method. Cash legitimately has no reference, so
  // it's the one exception. The voucher won't print without a
  // reference, so enforce at the action level too.
  if (methodRaw !== "cash" && !referenceTrimmed) {
    const methodLabel = methodRaw.toUpperCase();
    return {
      ok: false,
      error: `${methodLabel} requires a reference (UTR / cheque no / UPI txn id). Cash is the only method that can leave the field blank.`,
    };
  }

  const { data: payment, error: loadErr } = await supabase
    .from("bill_payments")
    .select("id, status, bill_id, proposed_amount")
    .eq("id", paymentId)
    .maybeSingle();
  if (loadErr) return { ok: false, error: loadErr.message };
  if (!payment) return { ok: false, error: "Payment row not found." };
  if (payment.status !== "confirmed") {
    return {
      ok: false,
      error: `Payment is not in 'confirmed' state (current: ${payment.status}).`,
    };
  }

  // Mig 042 follow-on — paid_amount equals proposed_amount, period.
  // Owner confirmed an amount; that's what gets paid. To pay any
  // different value, the only legal path is:
  //   1. Owner sends the proposal back to due (cancelPaymentAction).
  //   2. Accountant proposes again with the corrected amount.
  //   3. Owner re-confirms.
  //   4. Accountant marks paid (and lands back here with the new
  //      proposed_amount).
  const paidAmount = Number(payment.proposed_amount);
  if (!Number.isFinite(paidAmount) || paidAmount <= 0) {
    return {
      ok: false,
      error: "Proposed amount is invalid — refresh and ask the owner to re-confirm.",
    };
  }

  // Sanity check kept for safety: paid_amount cannot exceed the
  // bill's current outstanding. With the lock above, this should
  // only trip if another payment marked the bill fully-paid first.
  const { data: billRow } = await supabase
    .from("bills")
    .select("amount_outstanding, token")
    .eq("id", payment.bill_id as string)
    .maybeSingle();
  const outstanding = Number(billRow?.amount_outstanding ?? 0);
  if (paidAmount > outstanding) {
    return {
      ok: false,
      error: `Proposal ₹${paidAmount.toLocaleString("en-IN")} exceeds the bill's current outstanding ₹${outstanding.toLocaleString("en-IN")}. Another payment may have already settled this bill — refresh.`,
    };
  }

  const now = new Date().toISOString();
  const { error: updErr } = await supabase
    .from("bill_payments")
    .update({
      status: "paid",
      paid_amount: paidAmount,
      payment_method: methodRaw,
      payment_reference: reference,
      payment_note: note,
      paid_by: profile.id,
      paid_at: now,
      updated_at: now,
    })
    .eq("id", paymentId)
    .eq("status", "confirmed");
  if (updErr) return { ok: false, error: updErr.message };

  void Promise.all([
    logAudit(profile.id, "payment_paid", "bill_payment", paymentId, {
      bill_id: payment.bill_id,
      paid_amount: paidAmount,
      method: methodRaw,
      reference,
      token: billRow?.token ?? null,
    }),
    notify(
      "payment_paid",
      `Payment recorded — ₹${paidAmount.toLocaleString("en-IN")}`,
      {
        message: billRow?.token
          ? `Against bill ${billRow.token}. Method: ${methodRaw.toUpperCase()}.`
          : `Method: ${methodRaw.toUpperCase()}.`,
        entityType: "bill_payment",
        entityId: paymentId,
        actorId: profile.id,
        targetRoles: ["owner", "developer"],
      },
    ),
    // Mig 050 follow-on (Daksh, May 2026): send the vendor an
    // email with the payment voucher attached as PDF. Fire-and-
    // forget — if email fails, payment is still successfully
    // marked paid. Helper silently no-ops if RESEND_API_KEY is
    // missing, so the system works without the email config too.
    sendVendorPaymentEmail(paymentId, payment.bill_id as string, profile.id),
  ]).catch((e) => console.warn("[markPaymentPaidAction] cleanup failed", e));

  await refreshAccountsPaths();
  return { ok: true };
}

// ──────────────────────────────────────────────────────────────────
// Vendor payment email — sends after successful Mark Paid
// ──────────────────────────────────────────────────────────────────
// Fetches bill + vendor + payment, builds the HTML body + PDF
// attachment, calls Resend. Logs to audit_logs whether the email
// went through or was skipped. NEVER throws — outer caller is
// fire-and-forget.

async function sendVendorPaymentEmail(
  paymentId: string,
  billId: string,
  actorId: string,
): Promise<void> {
  try {
    const admin = createAdminSupabaseClient();
    const [{ data: paymentRow }, { data: billRow }] = await Promise.all([
      admin
        .from("bill_payments")
        .select("paid_amount, payment_method, payment_reference, payment_note, paid_at")
        .eq("id", paymentId)
        .maybeSingle(),
      admin
        .from("bills")
        .select(
          "token, vendor_bill_no, bill_date, description, " +
            "bill_vendors(id, name, email, address, gstin)",
        )
        .eq("id", billId)
        .maybeSingle(),
    ]);

    if (!paymentRow || !billRow) {
      console.warn("[sendVendorPaymentEmail] missing rows", { paymentId, billId });
      return;
    }

    type VendorEmbed = {
      id: string;
      name: string;
      email: string | null;
      address: string | null;
      gstin: string | null;
    };
    const billRowAny = billRow as unknown as {
      token: string;
      vendor_bill_no: string;
      bill_date: string;
      description: string;
      bill_vendors: VendorEmbed | VendorEmbed[] | null;
    };
    const vendor = Array.isArray(billRowAny.bill_vendors)
      ? billRowAny.bill_vendors[0]
      : billRowAny.bill_vendors;

    if (!vendor || !vendor.email) {
      // Vendor has no email — nothing to send. Quiet skip.
      void logAudit(actorId, "vendor_payment_email_skipped", "bill_payment", paymentId, {
        reason: vendor ? "vendor has no email on record" : "vendor row missing",
      });
      return;
    }

    const { sendEmail, buildVoucherEmailHtml, buildVoucherEmailText } =
      await import("@/lib/email");
    const { buildVoucherPdf } = await import("@/lib/voucher-pdf");
    const { numberToIndianWords } = await import(
      "@/app/(app)/accounts/payments/[id]/voucher/number-to-words"
    );

    const paidAmount = Number(
      (paymentRow as { paid_amount?: number | null }).paid_amount ?? 0,
    );
    const amountInWords = numberToIndianWords(paidAmount);

    // Company info — kept in sync with the on-screen voucher
    // (src/app/(app)/accounts/payments/[id]/voucher/voucher-view.tsx).
    // If MTCPL's registered office moves, update BOTH places.
    const company = {
      name: "MATESHWARI TEMPLE CONSTRUCTION PVT LTD",
      addressLines: [
        "C-109, RIICO Industrial Area 1/A",
        "Sirohi Road, Pindwara",
        "Rajasthan — 307022",
      ],
    };

    // ── Build the PDF attachment ─────────────────────────────────
    const pdfBytes = await buildVoucherPdf({
      company,
      vendor: {
        name: vendor.name,
        address: vendor.address,
        gstin: vendor.gstin,
      },
      bill: {
        token: billRowAny.token,
        vendorBillNo: billRowAny.vendor_bill_no,
        billDate: billRowAny.bill_date,
        description: billRowAny.description,
      },
      payment: {
        paidAmount,
        paymentMethod:
          (paymentRow as { payment_method?: string | null }).payment_method ?? null,
        paymentReference:
          (paymentRow as { payment_reference?: string | null }).payment_reference ?? null,
        paymentNote:
          (paymentRow as { payment_note?: string | null }).payment_note ?? null,
        paidAt:
          (paymentRow as { paid_at?: string | null }).paid_at ?? null,
      },
      amountInWords,
    });
    const pdfBase64 = Buffer.from(pdfBytes).toString("base64");

    // ── Send ────────────────────────────────────────────────────
    const html = buildVoucherEmailHtml({
      vendorName: vendor.name,
      billToken: billRowAny.token,
      vendorBillNo: billRowAny.vendor_bill_no,
      paidAmount,
      amountInWords,
      paymentMethod:
        (paymentRow as { payment_method?: string | null }).payment_method ?? null,
      paymentReference:
        (paymentRow as { payment_reference?: string | null }).payment_reference ?? null,
      paidAtIso:
        (paymentRow as { paid_at?: string | null }).paid_at ?? null,
      companyName: company.name,
      companyAddressLines: company.addressLines,
    });
    const text = buildVoucherEmailText({
      vendorName: vendor.name,
      billToken: billRowAny.token,
      vendorBillNo: billRowAny.vendor_bill_no,
      paidAmount,
      amountInWords,
      paymentMethod:
        (paymentRow as { payment_method?: string | null }).payment_method ?? null,
      paymentReference:
        (paymentRow as { payment_reference?: string | null }).payment_reference ?? null,
      paidAtIso:
        (paymentRow as { paid_at?: string | null }).paid_at ?? null,
      companyName: company.name,
    });

    const result = await sendEmail({
      to: vendor.email,
      subject: `Payment received — Bill ${billRowAny.token} — ₹${paidAmount.toLocaleString("en-IN")}`,
      html,
      text,
      attachments: [
        {
          filename: `voucher-${billRowAny.token}.pdf`,
          content: pdfBase64,
        },
      ],
    });

    void logAudit(
      actorId,
      result.ok
        ? "vendor_payment_email_sent"
        : result.skipped
          ? "vendor_payment_email_skipped"
          : "vendor_payment_email_failed",
      "bill_payment",
      paymentId,
      {
        to: vendor.email,
        provider_id: result.ok ? result.id : null,
        error: !result.ok ? result.error : null,
        skipped: !result.ok && result.skipped ? true : false,
      },
    );
  } catch (e) {
    // Catch-all so the markPaymentPaidAction outer Promise.all
    // never sees an unhandled rejection.
    console.warn("[sendVendorPaymentEmail] failed", e);
  }
}

export async function cancelPaymentAction(formData: FormData): Promise<ActionResult> {
  const { profile } = await requireAuth();
  // Mig 042 follow-on — only owner / dev can send a proposed or
  // confirmed payment back to due. The accountant used to be able
  // to abort their own proposal; Daksh removed that to close the
  // "shady work" gate (once proposed, only owner decides).
  if (!canConfirmPayments(profile)) {
    return {
      ok: false,
      error:
        "Only the owner can send a payment back to due. Ask the owner to send it back, then re-propose with the corrected amount.",
    };
  }
  const supabase = createAdminSupabaseClient();
  const paymentId = String(formData.get("payment_id") || "").trim();
  const reason = String(formData.get("cancel_reason") || "").trim() || null;
  if (!paymentId) return { ok: false, error: "Missing payment_id." };

  const now = new Date().toISOString();
  const { data: updated, error } = await supabase
    .from("bill_payments")
    .update({
      status: "cancelled",
      cancelled_by: profile.id,
      cancelled_at: now,
      cancel_reason: reason,
      updated_at: now,
    })
    .eq("id", paymentId)
    .in("status", ["proposed", "confirmed"])
    .select("id, bill_id")
    .single();

  if (error) return { ok: false, error: error.message };
  if (!updated) {
    return {
      ok: false,
      error: "Payment is no longer cancellable (likely already paid or cancelled).",
    };
  }

  void logAudit(profile.id, "payment_cancelled", "bill_payment", paymentId, {
    bill_id: updated.bill_id,
    reason,
  });
  await refreshAccountsPaths();
  return { ok: true };
}

// ──────────────────────────────────────────────────────────────────
// Bill-vendor CRUD
// ──────────────────────────────────────────────────────────────────

export async function upsertBillVendorAction(formData: FormData): Promise<
  | { ok: true; vendorId: string }
  | { ok: false; error: string }
> {
  const { profile } = await requireAuth();
  const id = String(formData.get("id") || "").trim() || null;

  // Create vs update have different permission gates:
  //   • CREATE — biller can add a new vendor mid-bill-entry, so the
  //     gate is the broader canAddBillVendors.
  //   • UPDATE — editing an existing vendor still requires the full
  //     canManageBillVendors (dev / owner / accountant). Billers
  //     don't have UI access to edit vendors anyway.
  const isCreate = !id;
  const allowed = isCreate
    ? canAddBillVendors(profile)
    : canManageBillVendors(profile);
  if (!allowed) {
    return { ok: false, error: "You do not have permission to manage bill vendors." };
  }
  const supabase = createAdminSupabaseClient();
  const name = String(formData.get("name") || "").trim();
  if (!name) return { ok: false, error: "Vendor name is required." };

  // Migration 040 — parse payment_terms_days. Empty string or invalid
  // input falls back to NULL (= use app-level default). Negative or
  // unreasonably large values are clamped to NULL too.
  const rawTermsDays = String(formData.get("payment_terms_days") || "").trim();
  let paymentTermsDays: number | null = null;
  if (rawTermsDays !== "") {
    const parsed = Number(rawTermsDays);
    if (Number.isFinite(parsed) && parsed >= 0 && parsed <= 365) {
      paymentTermsDays = Math.round(parsed);
    }
  }

  // Migration 042 — TDS / TCS applicability.
  // Follow-on (Daksh): the two flags are MUTUALLY EXCLUSIVE per
  // vendor and the default percent is no longer stored on the
  // vendor row. The accountant enters the rate on each bill. Form
  // already enforces single-pick; this is the server-side guard.
  const tdsApplicable = String(formData.get("tds_applicable") || "") === "1";
  const tcsApplicable = String(formData.get("tcs_applicable") || "") === "1";
  if (tdsApplicable && tcsApplicable) {
    return {
      ok: false,
      error:
        "A vendor can be flagged for TDS or TCS, but not both. Pick one.",
    };
  }
  // Defaults are always NULL'd — no per-vendor default rate.
  const defaultTdsPercent = null;
  const defaultTcsPercent = null;

  const payload: Record<string, unknown> = {
    name,
    category: String(formData.get("category") || "").trim() || null,
    gstin: String(formData.get("gstin") || "").trim() || null,
    pan: String(formData.get("pan") || "").trim() || null,
    address: String(formData.get("address") || "").trim() || null,
    phone: String(formData.get("phone") || "").trim() || null,
    email: String(formData.get("email") || "").trim() || null,
    bank_name: String(formData.get("bank_name") || "").trim() || null,
    bank_account: String(formData.get("bank_account") || "").trim() || null,
    ifsc: String(formData.get("ifsc") || "").trim() || null,
    // Mig 047 — HDFC's bulk payment file requires the bene name to
    // match what HDFC has registered. Server-side belt-and-braces: cap
    // to 20 chars (the form already truncates to 20 client-side).
    hdfc_bene_name:
      String(formData.get("hdfc_bene_name") || "").trim().slice(0, 20) || null,
    upi_id: String(formData.get("upi_id") || "").trim() || null,
    notes: String(formData.get("notes") || "").trim() || null,
    tds_applicable: tdsApplicable,
    tcs_applicable: tcsApplicable,
    default_tds_percent: defaultTdsPercent,
    default_tcs_percent: defaultTcsPercent,
    payment_terms_days: paymentTermsDays,
    updated_at: new Date().toISOString(),
    updated_by: profile.id,
  };

  try {
    if (id) {
      // Strip `name` from the UPDATE payload when the actor can't
      // rename. Server is the source of truth — even if a client
      // sent the old name in the form, we don't trust it here.
      // Owner + developer can rename; accountant cannot. (Biller
      // can't even reach this branch — they can only CREATE.)
      const updatePayload: Record<string, unknown> = { ...payload };
      if (!canRenameBillVendor(profile)) {
        delete updatePayload.name;
      }
      const { error } = await supabase
        .from("bill_vendors")
        .update(updatePayload)
        .eq("id", id);
      if (error) {
        if (error.code === PG_UNIQUE_VIOLATION) {
          return { ok: false, error: "Another vendor already uses this name." };
        }
        return { ok: false, error: error.message };
      }
      void logAudit(profile.id, "bill_vendor_updated", "bill_vendor", id, {
        name,
        renamed: canRenameBillVendor(profile),
      });
      await refreshAccountsPaths();
      return { ok: true, vendorId: id };
    }

    payload.created_by = profile.id;
    payload.is_active = true;
    const { data: inserted, error } = await supabase
      .from("bill_vendors")
      .insert(payload)
      .select("id")
      .single();
    if (error) {
      if (error.code === PG_UNIQUE_VIOLATION) {
        return { ok: false, error: "A vendor with this name already exists." };
      }
      return { ok: false, error: error.message };
    }
    const newId = inserted!.id as string;
    void logAudit(profile.id, "bill_vendor_created", "bill_vendor", newId, { name });
    await refreshAccountsPaths();
    return { ok: true, vendorId: newId };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg };
  }
}

export async function archiveBillVendorAction(formData: FormData): Promise<ActionResult> {
  const { profile } = await requireAuth();
  if (!canManageBillVendors(profile)) {
    return { ok: false, error: "You do not have permission to archive bill vendors." };
  }
  const supabase = createAdminSupabaseClient();
  const id = String(formData.get("id") || "").trim();
  const reactivate = String(formData.get("reactivate") || "") === "1";
  if (!id) return { ok: false, error: "Missing vendor id." };

  const { error } = await supabase
    .from("bill_vendors")
    .update({
      is_active: reactivate,
      updated_at: new Date().toISOString(),
      updated_by: profile.id,
    })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };

  void logAudit(
    profile.id,
    reactivate ? "bill_vendor_reactivated" : "bill_vendor_archived",
    "bill_vendor",
    id,
    {},
  );
  await refreshAccountsPaths();
  return { ok: true };
}

// ──────────────────────────────────────────────────────────────────
// Void form-action wrappers for direct `<form action={...}>` usage.
// Server actions that return result tuples can't be passed directly
// because the form-action prop wants `void | Promise<void>`. These
// wrappers call the underlying action + redirect on the appropriate
// path (with `?error=...` on failure so the toast banner can surface
// the message).
// ──────────────────────────────────────────────────────────────────

export async function cancelBillFormAction(formData: FormData) {
  const result = await cancelBillAction(formData);
  const billId = String(formData.get("bill_id") || "");
  if (!result.ok) {
    redirect(
      `/accounts/bills/${encodeURIComponent(billId)}?error=${encodeURIComponent(result.error)}`,
    );
  }
  redirect("/accounts/bills");
}

/** Form-action wrapper around clearPartialRejectionAction — keeps the
 *  bill detail page's `<form action={...}>` happy (those need void
 *  returns). Stays on the bill page so the user sees the cleared
 *  state inline. */
export async function clearPartialRejectionFormAction(formData: FormData) {
  const result = await clearPartialRejectionAction(formData);
  const billId = String(formData.get("bill_id") || "");
  if (!result.ok) {
    redirect(
      `/accounts/bills/${encodeURIComponent(billId)}?error=${encodeURIComponent(result.error)}`,
    );
  }
  // Stay on the bill page — user just cleared an attribute, not
  // archived the bill.
  redirect(`/accounts/bills/${encodeURIComponent(billId)}`);
}

export async function archiveBillVendorFormAction(formData: FormData) {
  const result = await archiveBillVendorAction(formData);
  if (!result.ok) {
    redirect(`/accounts/vendors?error=${encodeURIComponent(result.error)}`);
  }
  redirect("/accounts/vendors");
}

// ──────────────────────────────────────────────────────────────────
// Vendor private notes (mig 050) — passphrase-gated scratchpad
// ──────────────────────────────────────────────────────────────────
// Text-only per-vendor notes. Role-gated to developer/owner, with a
// passphrase prompt before content is loaded or saved. Each action
// logs to audit_logs so the feature is auditable end-to-end.

type Profile = Awaited<ReturnType<typeof requireAuth>>["profile"];

function canAccessPrivateNotes(p: Profile): boolean {
  // Daksh (May 2026): accountant added — they manage vendors day-to-day
  // and need parity with owner/dev access for private notes.
  return (
    p.role === "developer" ||
    p.role === "owner" ||
    p.role === "accountant"
  );
}

type PassphraseRow = {
  algo: string;
  salt: string;
  hash: string | null;
};

async function readPassphraseRow(): Promise<PassphraseRow | null> {
  const admin = createAdminSupabaseClient();
  const { data } = await admin
    .from("system_settings")
    .select("value")
    .eq("key", "vendor_notes_password")
    .maybeSingle();
  if (!data) return null;
  const v = (data as { value: unknown }).value;
  if (!v || typeof v !== "object") return null;
  const cast = v as Record<string, unknown>;
  if (typeof cast.algo !== "string" || typeof cast.salt !== "string") {
    return null;
  }
  return {
    algo: cast.algo,
    salt: cast.salt,
    hash: typeof cast.hash === "string" ? cast.hash : null,
  };
}

/** Returns whether the passphrase has been set yet. Used by the
 *  modal to decide between "SET passphrase" and "ENTER passphrase"
 *  modes. Doesn't reveal the hash itself. */
export async function getVendorNotesPassphraseStatusAction(): Promise<
  { ok: true; isSet: boolean } | { ok: false; error: string }
> {
  const { profile } = await requireAuth();
  if (!canAccessPrivateNotes(profile)) {
    return { ok: false, error: "Not authorised." };
  }
  const row = await readPassphraseRow();
  if (!row) return { ok: false, error: "Passphrase row not seeded — run migration 050." };
  return { ok: true, isSet: row.hash !== null };
}

/** Sets (or rotates) the passphrase. When the existing hash is
 *  non-null, the caller must supply `current_plain` and it must
 *  verify. When existing hash is null (first-use), `current_plain`
 *  is ignored — the very first set is open to whoever has
 *  developer/owner access. */
export async function setVendorNotesPassphraseAction(
  formData: FormData,
): Promise<ActionResult> {
  const { profile } = await requireAuth();
  if (!canAccessPrivateNotes(profile)) {
    return { ok: false, error: "Not authorised." };
  }
  const newPlain = String(formData.get("new_plain") || "").trim();
  const currentPlain = String(formData.get("current_plain") || "").trim();

  if (newPlain.length < 6) {
    return { ok: false, error: "Passphrase must be at least 6 characters." };
  }
  if (newPlain.length > 200) {
    return { ok: false, error: "Passphrase too long (max 200 characters)." };
  }

  const row = await readPassphraseRow();
  if (!row) {
    return { ok: false, error: "Passphrase row missing — contact a developer." };
  }

  const { verifyPassphrase, hashPassphrase } = await import("@/lib/private-notes");

  // If a hash already exists, the caller must verify the current
  // passphrase before rotation. First-time set (hash === null) is
  // allowed without verification.
  if (row.hash !== null) {
    if (!currentPlain) {
      return { ok: false, error: "Enter the current passphrase to rotate it." };
    }
    if (!verifyPassphrase(currentPlain, row.salt, row.hash)) {
      return { ok: false, error: "Current passphrase is incorrect." };
    }
  }

  const newHash = hashPassphrase(newPlain, row.salt);
  const admin = createAdminSupabaseClient();
  const { error } = await admin
    .from("system_settings")
    .update({
      value: { algo: row.algo, salt: row.salt, hash: newHash },
      updated_at: new Date().toISOString(),
      updated_by: profile.id,
    })
    .eq("key", "vendor_notes_password");
  if (error) return { ok: false, error: error.message };

  void logAudit(
    profile.id,
    row.hash === null
      ? "vendor_notes_passphrase_set"
      : "vendor_notes_passphrase_rotated",
    "system_setting",
    "vendor_notes_password",
    {},
  );
  return { ok: true };
}

/** Verifies the supplied passphrase. Doesn't touch any notes; pure
 *  authn check. Returns ok:true if valid. */
export async function verifyVendorNotesPassphraseAction(
  formData: FormData,
): Promise<ActionResult> {
  const { profile } = await requireAuth();
  if (!canAccessPrivateNotes(profile)) {
    return { ok: false, error: "Not authorised." };
  }
  const plain = String(formData.get("plain") || "");
  if (!plain) return { ok: false, error: "Passphrase required." };

  const row = await readPassphraseRow();
  if (!row || row.hash === null) {
    return { ok: false, error: "Passphrase has not been set yet." };
  }

  const { verifyPassphrase } = await import("@/lib/private-notes");
  if (!verifyPassphrase(plain, row.salt, row.hash)) {
    return { ok: false, error: "Incorrect passphrase." };
  }
  return { ok: true };
}

/** Reads a vendor's private note. Caller must re-prove the
 *  passphrase on every read (not just the unlock-once-per-session
 *  flag on the client) so a stolen auth cookie alone can't pull
 *  content. */
export async function getVendorPrivateNoteAction(
  formData: FormData,
): Promise<
  | { ok: true; content: string; updatedAt: string | null; updatedByName: string | null }
  | { ok: false; error: string }
> {
  const { profile } = await requireAuth();
  if (!canAccessPrivateNotes(profile)) {
    return { ok: false, error: "Not authorised." };
  }
  const vendorId = String(formData.get("vendor_id") || "").trim();
  const plain = String(formData.get("passphrase") || "");
  if (!vendorId) return { ok: false, error: "Missing vendor_id." };

  const row = await readPassphraseRow();
  if (!row || row.hash === null) {
    return { ok: false, error: "Passphrase has not been set yet." };
  }
  const { verifyPassphrase } = await import("@/lib/private-notes");
  if (!verifyPassphrase(plain, row.salt, row.hash)) {
    return { ok: false, error: "Incorrect passphrase." };
  }

  const admin = createAdminSupabaseClient();
  const { data: note } = await admin
    .from("vendor_private_notes")
    .select("content, updated_at, updated_by")
    .eq("bill_vendor_id", vendorId)
    .maybeSingle();
  const content = (note as { content?: string } | null)?.content ?? "";
  const updatedAt = (note as { updated_at?: string } | null)?.updated_at ?? null;
  const updatedById = (note as { updated_by?: string | null } | null)?.updated_by ?? null;

  let updatedByName: string | null = null;
  if (updatedById) {
    const { data: prof } = await admin
      .from("profiles")
      .select("full_name")
      .eq("id", updatedById)
      .maybeSingle();
    updatedByName = (prof as { full_name?: string } | null)?.full_name ?? null;
  }

  void logAudit(profile.id, "vendor_note_viewed", "bill_vendor", vendorId, {
    content_length: content.length,
  });
  return { ok: true, content, updatedAt, updatedByName };
}

/** Saves (insert or update) a vendor's private note. Re-checks
 *  passphrase. Audit log captures content_length only, never the
 *  actual content. */
export async function saveVendorPrivateNoteAction(
  formData: FormData,
): Promise<ActionResult> {
  const { profile } = await requireAuth();
  if (!canAccessPrivateNotes(profile)) {
    return { ok: false, error: "Not authorised." };
  }
  const vendorId = String(formData.get("vendor_id") || "").trim();
  const content = String(formData.get("content") || "");
  const plain = String(formData.get("passphrase") || "");
  if (!vendorId) return { ok: false, error: "Missing vendor_id." };
  if (content.length > 10000) {
    return { ok: false, error: "Note is too long (max 10,000 characters)." };
  }

  const row = await readPassphraseRow();
  if (!row || row.hash === null) {
    return { ok: false, error: "Passphrase has not been set yet." };
  }
  const { verifyPassphrase } = await import("@/lib/private-notes");
  if (!verifyPassphrase(plain, row.salt, row.hash)) {
    return { ok: false, error: "Incorrect passphrase." };
  }

  const admin = createAdminSupabaseClient();
  const now = new Date().toISOString();
  // Upsert by bill_vendor_id (UNIQUE constraint guarantees one row).
  const { error } = await admin
    .from("vendor_private_notes")
    .upsert(
      {
        bill_vendor_id: vendorId,
        content,
        updated_at: now,
        updated_by: profile.id,
      },
      { onConflict: "bill_vendor_id" },
    );
  if (error) return { ok: false, error: error.message };

  void logAudit(profile.id, "vendor_note_saved", "bill_vendor", vendorId, {
    content_length: content.length,
  });
  return { ok: true };
}

/** Clears a vendor's private note (sets content to empty string).
 *  The row stays in place for forensic recovery from backups.
 *  Logged in audit_logs with the pre-clear content length so
 *  there's a record of how much was removed. */
export async function clearVendorPrivateNoteAction(
  formData: FormData,
): Promise<ActionResult> {
  const { profile } = await requireAuth();
  if (!canAccessPrivateNotes(profile)) {
    return { ok: false, error: "Not authorised." };
  }
  const vendorId = String(formData.get("vendor_id") || "").trim();
  const plain = String(formData.get("passphrase") || "");
  if (!vendorId) return { ok: false, error: "Missing vendor_id." };

  const row = await readPassphraseRow();
  if (!row || row.hash === null) {
    return { ok: false, error: "Passphrase has not been set yet." };
  }
  const { verifyPassphrase } = await import("@/lib/private-notes");
  if (!verifyPassphrase(plain, row.salt, row.hash)) {
    return { ok: false, error: "Incorrect passphrase." };
  }

  const admin = createAdminSupabaseClient();
  // Read prior length for audit before clearing.
  const { data: prior } = await admin
    .from("vendor_private_notes")
    .select("content")
    .eq("bill_vendor_id", vendorId)
    .maybeSingle();
  const priorLength = (prior as { content?: string } | null)?.content?.length ?? 0;

  const now = new Date().toISOString();
  const { error } = await admin
    .from("vendor_private_notes")
    .upsert(
      {
        bill_vendor_id: vendorId,
        content: "",
        updated_at: now,
        updated_by: profile.id,
      },
      { onConflict: "bill_vendor_id" },
    );
  if (error) return { ok: false, error: error.message };

  void logAudit(profile.id, "vendor_note_cleared", "bill_vendor", vendorId, {
    cleared_length: priorLength,
  });
  return { ok: true };
}
