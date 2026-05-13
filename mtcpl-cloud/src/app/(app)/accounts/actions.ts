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
  | { ok: false; error: string }
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
  const gstPercentRaw = String(formData.get("gst_percent") || "0");

  const amountSubtotal = Number(amountSubtotalRaw);
  const gstPercent = Number(gstPercentRaw);

  if (!billVendorId) return { ok: false, error: "Pick a beneficiary." };
  if (!vendorBillNo) return { ok: false, error: "Vendor's bill number is required." };
  if (!billDate) return { ok: false, error: "Bill date is required." };
  if (!description) return { ok: false, error: "Description is required." };
  if (!Number.isFinite(amountSubtotal) || amountSubtotal <= 0) {
    return { ok: false, error: "Subtotal amount must be greater than zero." };
  }
  if (!Number.isFinite(gstPercent) || gstPercent < 0 || gstPercent > 100) {
    return { ok: false, error: "GST% must be between 0 and 100." };
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
        status: "pending_approval",
        submitted_by: profile.id,
      })
      .select("id, token, amount_total")
      .single();

    if (error) {
      if (error.code === PG_UNIQUE_VIOLATION) {
        return {
          ok: false,
          error: `This bill number is already on file for this vendor. Pick a different bill number or open the existing entry.`,
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
 * Edit a bill in-flight. Two legal paths:
 *   1. The original biller (or any user with submit rights) editing
 *      their own bill while it sits in `rejected`. Save flips status
 *      back to `pending_approval` and clears the rejection note.
 *   2. An approver editing while the bill is in `pending_approval`.
 *      In-place edit, status unchanged — approver can edit-then-
 *      approve in one sitting.
 *
 * Locked the moment ANY non-cancelled `bill_payments` row exists —
 * preserves audit integrity once money has begun moving.
 */
export async function editBillAction(formData: FormData): Promise<ActionResult> {
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
  const gstPercent = Number(formData.get("gst_percent") || 0);
  const billVendorId = String(formData.get("bill_vendor_id") || "").trim();

  if (!billVendorId || !vendorBillNo || !billDate || !description) {
    return { ok: false, error: "All fields are required to save the edit." };
  }
  if (!Number.isFinite(amountSubtotal) || amountSubtotal <= 0) {
    return { ok: false, error: "Subtotal must be greater than zero." };
  }
  if (!Number.isFinite(gstPercent) || gstPercent < 0 || gstPercent > 100) {
    return { ok: false, error: "GST% must be between 0 and 100." };
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
        error: "Another bill from this vendor already uses this bill number.",
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
  const paidAmount = Number(formData.get("paid_amount") || 0);
  const methodRaw = String(formData.get("payment_method") || "").trim();
  const reference = String(formData.get("payment_reference") || "").trim() || null;
  const note = String(formData.get("payment_note") || "").trim() || null;

  if (!paymentId) return { ok: false, error: "Missing payment_id." };
  if (!Number.isFinite(paidAmount) || paidAmount <= 0) {
    return { ok: false, error: "Paid amount must be greater than zero." };
  }
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

  // Sanity check: paid_amount cannot exceed (current outstanding + this row's
  // own proposal contribution). The proposal hasn't reduced outstanding yet —
  // outstanding only goes down once status flips to paid — so we just need
  // paid_amount ≤ bill.amount_outstanding.
  const { data: billRow } = await supabase
    .from("bills")
    .select("amount_outstanding, token")
    .eq("id", payment.bill_id as string)
    .maybeSingle();
  const outstanding = Number(billRow?.amount_outstanding ?? 0);
  if (paidAmount > outstanding) {
    return {
      ok: false,
      error: `Paid amount ₹${paidAmount.toLocaleString("en-IN")} exceeds the bill's current outstanding ₹${outstanding.toLocaleString("en-IN")}.`,
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
  ]).catch((e) => console.warn("[markPaymentPaidAction] cleanup failed", e));

  await refreshAccountsPaths();
  return { ok: true };
}

export async function cancelPaymentAction(formData: FormData): Promise<ActionResult> {
  const { profile } = await requireAuth();
  if (!canManageAccounts(profile) && !canConfirmPayments(profile)) {
    return { ok: false, error: "You do not have permission to cancel a payment." };
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
    upi_id: String(formData.get("upi_id") || "").trim() || null,
    notes: String(formData.get("notes") || "").trim() || null,
    updated_at: new Date().toISOString(),
    updated_by: profile.id,
  };

  try {
    if (id) {
      const { error } = await supabase
        .from("bill_vendors")
        .update(payload)
        .eq("id", id);
      if (error) {
        if (error.code === PG_UNIQUE_VIOLATION) {
          return { ok: false, error: "Another vendor already uses this name." };
        }
        return { ok: false, error: error.message };
      }
      void logAudit(profile.id, "bill_vendor_updated", "bill_vendor", id, { name });
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

export async function archiveBillVendorFormAction(formData: FormData) {
  const result = await archiveBillVendorAction(formData);
  if (!result.ok) {
    redirect(`/accounts/vendors?error=${encodeURIComponent(result.error)}`);
  }
  redirect("/accounts/vendors");
}
