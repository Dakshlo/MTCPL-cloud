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
  canApplyAdvanceToBill,
  canApproveBills,
  canConfirmPayments,
  canFinalAudit,
  canHoldBill,
  canManageAccounts,
  canManageBillVendors,
  canMarkPaid,
  canRecordAdvance,
  canRenameBillVendor,
  canSubmitBills,
  canUnapplyAdvance,
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

/**
 * Daksh May 2026 — sanity-check the bill_date before it lands in the
 * DB. The trigger came from a real incident: an accountant typed "22
 * Feb 102025" (six-digit year — typo for 2025) into the date input,
 * the form happily submitted it, and the bill came out tagged
 * `T-102025-523`. The amount + everything else was right; only the
 * year was junk, and by then the token was burned in.
 *
 * Three guards layered:
 *   1. Strict YYYY-MM-DD shape. Rejects 6-digit years outright
 *      (the regex demands exactly 4 digits before the first dash).
 *   2. Year in [2015, currentYear + 1]. 2015 floors out anything
 *      truly historic; currentYear+1 ceilings out the "year 102025"
 *      class of bugs without blocking accountants entering a bill in
 *      late December for an early-January date.
 *   3. The whole string must round-trip through Date — catches
 *      things like 2026-02-30 (no Feb 30th) that pass the regex.
 *
 * Returns null on success, or a user-facing error string on failure.
 */
function validateBillDate(billDate: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(billDate)) {
    return "Bill date must be in YYYY-MM-DD format (4-digit year).";
  }
  const year = parseInt(billDate.slice(0, 4), 10);
  const currentYear = new Date().getFullYear();
  const MIN_YEAR = 2015;
  const MAX_YEAR = currentYear + 1;
  if (year < MIN_YEAR || year > MAX_YEAR) {
    return `Bill date year ${year} looks wrong — use a year between ${MIN_YEAR} and ${MAX_YEAR}.`;
  }
  const parsed = new Date(`${billDate}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) {
    return "Bill date is not a valid calendar date.";
  }
  // Re-render the parsed date back to YYYY-MM-DD and compare. Catches
  // shape-valid but calendar-invalid combos that JS silently rolls
  // forward (e.g. 2026-02-30 → 2026-03-02).
  const roundtrip = parsed.toISOString().slice(0, 10);
  if (roundtrip !== billDate) {
    return `Bill date ${billDate} isn't a real calendar date (closest valid: ${roundtrip}).`;
  }
  return null;
}

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

  // Mig 062 — bills.block_cft. Only meaningful for block-purchase
  // vendors; ignored otherwise (the form only sends it when the
  // selected vendor's category lies in the Block Purchase group).
  // Empty string / 0 means "no CFT recorded" → null in DB.
  const blockCftRaw = String(formData.get("block_cft") || "").trim();
  const blockCftNum = blockCftRaw === "" ? null : Number(blockCftRaw);
  const blockCft =
    blockCftNum != null && Number.isFinite(blockCftNum) && blockCftNum > 0
      ? blockCftNum
      : null;

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
  // Daksh May 2026 — catches the "22 Feb 102025" class of typo
  // before the token (T-YYYY-N) bakes a 6-digit year into the row.
  {
    const dateErr = validateBillDate(billDate);
    if (dateErr) return { ok: false, error: dateErr };
  }
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
        block_cft: blockCft,
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
        // Mig 058 follow-on (Daksh): added accountant + final_auditor
        // so the originating submitter (now the accountant under the
        // mig 037 model — biller stays for legacy compat) gets the
        // notification bell ping. They previously had to scroll
        // All Bills to find a rejected one.
        targetRoles: ["biller", "developer", "accountant", "accountant_star"],
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
    .select("id, token, status, submitted_by, bill_date, vendor_bill_no")
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
    // Daksh (Mig 058 follow-on): widened so the accountant /
    // submitter can fix a typo while the bill is still in audit —
    // the owner shouldn't have to reject + re-edit for every
    // small correction.
    //
    // BUT: bill_date and vendor_bill_no are locked. The token
    // (T-YYYY-N) embeds the bill_date year, and the natural-key
    // UNIQUE constraint includes vendor_bill_no — both fields
    // define the bill's identity. If the accountant needs to
    // change either, they cancel + recreate so the token regenerates
    // cleanly (a new sequence number, the right year).
    if (!isApprover && !isSubmitter && !isBillerLike) {
      return {
        ok: false,
        error:
          "You don't have permission to edit this bill while it's pending approval.",
      };
    }
    const newDateRaw = String(formData.get("bill_date") || "").trim();
    const newVendorBillNoRaw = String(formData.get("vendor_bill_no") || "").trim();
    const currentDateStr = bill.bill_date ? String(bill.bill_date) : "";
    const currentVendorNo = bill.vendor_bill_no ? String(bill.vendor_bill_no) : "";
    if (newDateRaw && newDateRaw !== currentDateStr) {
      return {
        ok: false,
        error:
          "Bill date is locked while pending approval — it's part of the token (" +
          (bill.token || "T-?") +
          "). To use a different date, cancel this bill and create a new one.",
      };
    }
    if (newVendorBillNoRaw && newVendorBillNoRaw !== currentVendorNo) {
      return {
        ok: false,
        error:
          "Vendor invoice number is locked while pending approval. To change it, cancel this bill and create a new one.",
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

  // Mig 062 — block CFT (only set for block-purchase bills).
  const blockCftRawEdit = String(formData.get("block_cft") || "").trim();
  const blockCftNumEdit = blockCftRawEdit === "" ? null : Number(blockCftRawEdit);
  const blockCftEdit =
    blockCftNumEdit != null && Number.isFinite(blockCftNumEdit) && blockCftNumEdit > 0
      ? blockCftNumEdit
      : null;

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
  // Same date sanity-check as the submit path. Edits on rejected
  // bills typically reuse the original date (which is already valid),
  // but a biller re-keying the date during a fix could still hit the
  // 6-digit-year typo — so guard it here too.
  {
    const dateErr = validateBillDate(billDate);
    if (dateErr) return { ok: false, error: dateErr };
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
    block_cft: blockCftEdit,
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
  // Daksh (Mig 058 follow-on): widened so accountants / billers
  // can cancel their own pending/rejected bills. Use case: typo'd
  // the bill date → token has wrong year. Cancel + recreate is
  // the documented workaround for date/vendor_bill_no changes.
  // Owner / dev keep full reach (any status not already paid).
  const isPrivileged =
    profile.role === "developer" || profile.role === "owner";
  if (!isPrivileged && !canSubmitBills(profile)) {
    return { ok: false, error: "You don't have permission to cancel bills." };
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
  // Paid bills are always off-limits — money moved, cancel is a
  // book-keeping problem that needs a real correction, not a status
  // flip. Owner / dev should reverse the payment first.
  if (bill.status === "fully_paid") {
    return {
      ok: false,
      error:
        "This bill is fully paid — cancel is blocked. " +
        "If the payment was wrong, reverse it from Payment History first, " +
        "then the bill can be cancelled.",
    };
  }
  // Daksh May 2026 — owner / developer can now cancel APPROVED bills
  // (the due-bills queue). Use case: a wrong bill landed in the queue
  // — wrong vendor / wrong amount / wrong token year — and editing
  // doesn't regenerate the token. They cancel and the accountant
  // submits a fresh row with correct details. Non-paid bills only;
  // the payment-row check below blocks cancel when a payment is
  // in flight.
  if (bill.status === "approved" && !isPrivileged) {
    return {
      ok: false,
      error:
        "Only the owner or a developer can cancel a bill once it's in the due-bills queue. " +
        "Ask them to do it from the bill detail page.",
    };
  }
  // Non-privileged users can only cancel pending / rejected bills.
  // Privileged users (owner / dev) also reach approved bills above.
  if (
    !isPrivileged &&
    bill.status !== "pending_approval" &&
    bill.status !== "rejected"
  ) {
    return {
      ok: false,
      error: `Bills in '${bill.status}' state can only be cancelled by an owner or developer.`,
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
// Bill hold-amount (mig 072, Daksh May 2026)
// ──────────────────────────────────────────────────────────────────
//
// Owner withholds a slice of an approved bill's payable amount.
// Accountant can then only propose the un-held portion. Hold is
// idempotent — re-holding overwrites (audit log keeps history).
// ──────────────────────────────────────────────────────────────────

export async function holdBillAmountAction(
  formData: FormData,
): Promise<ActionResult> {
  const { profile } = await requireAuth();
  if (!canHoldBill(profile)) {
    return { ok: false, error: "Only owner / developer can hold a bill." };
  }
  const supabase = createAdminSupabaseClient();

  const billId = String(formData.get("bill_id") ?? "").trim();
  const amountRaw = String(formData.get("amount") ?? "").trim();
  const reason = String(formData.get("reason") ?? "").trim() || null;
  if (!billId) return { ok: false, error: "Missing bill id." };
  const amount = Number(amountRaw);
  if (!Number.isFinite(amount) || amount <= 0) {
    return { ok: false, error: "Hold amount must be a positive number." };
  }

  // Load the current state — outstanding is our cap (we can't hold
  // more than what's still owed), and we need amount_total for the
  // schema-level check the trigger enforces too.
  const { data: bill, error: loadErr } = await supabase
    .from("bills")
    .select(
      "id, token, status, amount_total, amount_paid, amount_outstanding, held_amount, cancelled_at",
    )
    .eq("id", billId)
    .maybeSingle();
  if (loadErr) return { ok: false, error: loadErr.message };
  if (!bill) return { ok: false, error: "Bill not found." };
  const b = bill as {
    id: string;
    token: string;
    status: string;
    amount_total: number | string;
    amount_paid: number | string;
    amount_outstanding: number | string;
    held_amount: number | string;
    cancelled_at: string | null;
  };
  if (b.cancelled_at) {
    return { ok: false, error: "Cannot hold a cancelled bill." };
  }
  if (b.status !== "approved" && b.status !== "pending_approval") {
    return {
      ok: false,
      error: `Hold only applies to approved or pending bills (this one is ${b.status}).`,
    };
  }
  const outstanding = Number(b.amount_outstanding ?? 0);
  if (amount > outstanding + 0.005) {
    return {
      ok: false,
      error: `Hold (₹${amount.toLocaleString("en-IN")}) cannot exceed outstanding (₹${outstanding.toLocaleString("en-IN")}).`,
    };
  }

  const now = new Date().toISOString();
  const previousHeld = Number(b.held_amount ?? 0);
  const { error: updErr } = await supabase
    .from("bills")
    .update({
      held_amount: amount,
      held_reason: reason,
      held_at: now,
      held_by: profile.id,
    })
    .eq("id", billId);
  if (updErr) return { ok: false, error: updErr.message };

  await logAudit(profile.id, "bill_held", "bill", billId, {
    token: b.token,
    previous_held: previousHeld,
    new_held: amount,
    reason,
  });
  await refreshAccountsPaths();
  return { ok: true };
}

export async function releaseBillHoldAction(
  formData: FormData,
): Promise<ActionResult> {
  const { profile } = await requireAuth();
  if (!canHoldBill(profile)) {
    return { ok: false, error: "Only owner / developer can release a hold." };
  }
  const supabase = createAdminSupabaseClient();

  const billId = String(formData.get("bill_id") ?? "").trim();
  const releaseNote = String(formData.get("release_note") ?? "").trim() || null;
  if (!billId) return { ok: false, error: "Missing bill id." };

  const { data: bill, error: loadErr } = await supabase
    .from("bills")
    .select("id, token, held_amount, held_reason")
    .eq("id", billId)
    .maybeSingle();
  if (loadErr) return { ok: false, error: loadErr.message };
  if (!bill) return { ok: false, error: "Bill not found." };
  const b = bill as {
    id: string;
    token: string;
    held_amount: number | string;
    held_reason: string | null;
  };
  if (Number(b.held_amount ?? 0) <= 0) {
    return { ok: false, error: "Bill has no active hold to release." };
  }

  const { error: updErr } = await supabase
    .from("bills")
    .update({
      held_amount: 0,
      held_reason: null,
      held_at: null,
      held_by: null,
    })
    .eq("id", billId);
  if (updErr) return { ok: false, error: updErr.message };

  await logAudit(profile.id, "bill_hold_released", "bill", billId, {
    token: b.token,
    released_amount: Number(b.held_amount ?? 0),
    previous_reason: b.held_reason,
    release_note: releaseNote,
  });
  await refreshAccountsPaths();
  return { ok: true };
}

// Form-action wrappers so the buttons can <form action={...}> without
// the client-component overhead. Mirrors approveBillFormAction etc.
export async function holdBillAmountFormAction(formData: FormData) {
  const res = await holdBillAmountAction(formData);
  if (!res.ok) {
    const billId = String(formData.get("bill_id") ?? "");
    redirect(`/accounts/bills/${billId}?error=${encodeURIComponent(res.error)}`);
  }
  const billId = String(formData.get("bill_id") ?? "");
  redirect(`/accounts/bills/${billId}?toast=Hold+applied`);
}

export async function releaseBillHoldFormAction(formData: FormData) {
  const res = await releaseBillHoldAction(formData);
  if (!res.ok) {
    const billId = String(formData.get("bill_id") ?? "");
    redirect(`/accounts/bills/${billId}?error=${encodeURIComponent(res.error)}`);
  }
  const billId = String(formData.get("bill_id") ?? "");
  redirect(`/accounts/bills/${billId}?toast=Hold+released`);
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
  // Mig 072 — also pull held_amount so we can clamp the proposable
  // amount to (outstanding - held) and refuse proposals on bills
  // where the entire outstanding is held.
  const { data: bills, error: loadErr } = await supabase
    .from("bills")
    .select("id, token, status, amount_outstanding, held_amount")
    .in("id", billIds);
  if (loadErr) return { ok: false, error: loadErr.message };

  // Daksh May 2026 — same fix as the Due Bills page query. Was
  // `.in("status", ["proposed", "confirmed"])`, which missed
  // bank_rejected (mig 052) and would have missed any future
  // not-paid-not-cancelled status. Negative filter is future-proof
  // and is the right safety posture for the duplicate-payment guard
  // — we'd rather refuse a valid retry than allow a double-pay.
  const { data: openPayments } = await supabase
    .from("bill_payments")
    .select("bill_id")
    .in("bill_id", billIds)
    .not("status", "in", "(paid,cancelled)");
  const billsWithOpen = new Set((openPayments ?? []).map((r) => r.bill_id as string));

  const batchId = randomUUID();
  const now = new Date().toISOString();
  const rowsToInsert: Array<Record<string, unknown>> = [];
  const skipped: string[] = [];

  for (const b of bills ?? []) {
    const billId = b.id as string;
    const token = b.token as string;
    const outstanding = Number(b.amount_outstanding ?? 0);
    // Mig 072 — proposable = outstanding minus the owner-held slice.
    // A bill with held >= outstanding is paused entirely until owner
    // releases (or reduces) the hold.
    const held = Number(b.held_amount ?? 0);
    const proposable = Math.max(0, outstanding - held);
    if (b.status !== "approved") {
      skipped.push(`${token} (not approved)`);
      continue;
    }
    if (outstanding <= 0) {
      skipped.push(`${token} (no outstanding)`);
      continue;
    }
    if (proposable <= 0) {
      skipped.push(`${token} (fully held by owner — release hold first)`);
      continue;
    }
    if (billsWithOpen.has(billId)) {
      skipped.push(`${token} (already has open payment)`);
      continue;
    }
    const requested = proposedAmounts[billId];
    // Clamp to the post-hold proposable ceiling, not raw outstanding,
    // so the accountant can never propose money that's been held.
    const amount =
      Number.isFinite(requested) && requested > 0
        ? Math.min(Number(requested), proposable)
        : proposable;
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
  // Mig 052 — Mark Paid is also the manual-rescue path for
  // bank_rejected rows. The vendor was paid by cash / RTGS done
  // outside HDFC bulk after the file bounced, and the accountant
  // wants to close the loop without re-proposing. Same paid_amount
  // (= proposed_amount), same audit trail.
  if (payment.status !== "confirmed" && payment.status !== "bank_rejected") {
    return {
      ok: false,
      error: `Payment is not in a markable state (current: ${payment.status}). Only confirmed or bank-rejected payments can be marked paid.`,
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

  // Mig 053 follow-on (Daksh, May 2026): the original `void
  // Promise.all([...])` fire-and-forget pattern silently killed the
  // email + audit on Vercel — serverless functions terminate the
  // request handler as soon as `return` fires, and any unawaited
  // promise dies with it. Now we AWAIT the cleanup work so logs +
  // emails actually run to completion. Adds ~300–800ms to Mark Paid
  // (PDF gen + Resend HTTP) but guarantees the audit row + the
  // vendor email both happen, and any failure is observable.
  try {
    await Promise.all([
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
      sendVendorPaymentEmail(paymentId, payment.bill_id as string, profile.id),
    ]);
  } catch (e) {
    // Cleanup failures must NOT bubble up — the payment is already
    // marked paid in the DB. Log + move on. The audit + email helpers
    // both internally catch their own errors; this catch is a final
    // safety net for the Promise.all wrapper itself.
    console.warn("[markPaymentPaidAction] cleanup failed", e);
  }

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
    // Mig 053 follow-on (Daksh, May 2026): beacon entry log so we can
    // SEE the function ran at all, even if everything else inside
    // silently dies. Plus all the audit logAudits below switched from
    // `void` (fire-and-forget) to `await` — on Vercel serverless the
    // `void` pattern silently dropped the audit rows the moment the
    // outer Promise.all resolved, leaving us blind to why no email
    // was firing. Now every code path records WHY.
    await logAudit(
      actorId,
      "vendor_payment_email_attempt",
      "bill_payment",
      paymentId,
      {
        bill_id: billId,
        has_resend_key: Boolean(process.env.RESEND_API_KEY),
        has_email_from: Boolean(process.env.EMAIL_FROM),
      },
    );

    // Early-return when the email provider isn't configured. Saves
    // ~100ms of pointless PDF generation per Mark Paid. The audit
    // entry still gets written so you can see how many emails
    // would have gone out once the API key lands.
    if (!process.env.RESEND_API_KEY) {
      await logAudit(
        actorId,
        "vendor_payment_email_skipped",
        "bill_payment",
        paymentId,
        { reason: "RESEND_API_KEY not configured" },
      );
      return;
    }

    const admin = createAdminSupabaseClient();
    const [{ data: paymentRow }, { data: billRow }, { data: actorRow }] = await Promise.all([
      admin
        .from("bill_payments")
        .select("paid_amount, payment_method, payment_reference, payment_note, paid_at, paid_by")
        .eq("id", paymentId)
        .maybeSingle(),
      admin
        .from("bills")
        .select(
          "token, vendor_bill_no, bill_date, description, cost_head, " +
            "bill_vendors(id, name, email, address, gstin, pan, bank_account, ifsc)",
        )
        .eq("id", billId)
        .maybeSingle(),
      admin
        .from("profiles")
        .select("full_name")
        .eq("id", actorId)
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
      pan: string | null;
      bank_account: string | null;
      ifsc: string | null;
    };
    const billRowAny = billRow as unknown as {
      token: string;
      vendor_bill_no: string;
      bill_date: string;
      description: string;
      cost_head: string | null;
      bill_vendors: VendorEmbed | VendorEmbed[] | null;
    };
    const vendor = Array.isArray(billRowAny.bill_vendors)
      ? billRowAny.bill_vendors[0]
      : billRowAny.bill_vendors;

    if (!vendor || !vendor.email) {
      // Vendor has no email — nothing to send. Quiet skip.
      await logAudit(actorId, "vendor_payment_email_skipped", "bill_payment", paymentId, {
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
        "Opposite Ajari Fatak",
        "Pindwara, Sirohi",
        "Rajasthan",
      ],
    };

    const actorName =
      (actorRow as { full_name?: string | null } | null)?.full_name ?? null;

    // ── Build the PDF attachment ─────────────────────────────────
    const pdfBytes = await buildVoucherPdf({
      company,
      vendor: {
        name: vendor.name,
        address: vendor.address,
        gstin: vendor.gstin,
        pan: vendor.pan,
        bankAccount: vendor.bank_account,
        ifsc: vendor.ifsc,
      },
      bill: {
        token: billRowAny.token,
        vendorBillNo: billRowAny.vendor_bill_no,
        billDate: billRowAny.bill_date,
        description: billRowAny.description,
        costHead: billRowAny.cost_head,
      },
      payment: {
        paymentId,
        paidAmount,
        paymentMethod:
          (paymentRow as { payment_method?: string | null }).payment_method ?? null,
        paymentReference:
          (paymentRow as { payment_reference?: string | null }).payment_reference ?? null,
        paymentNote:
          (paymentRow as { payment_note?: string | null }).payment_note ?? null,
        paidAt:
          (paymentRow as { paid_at?: string | null }).paid_at ?? null,
        paidByName: actorName,
      },
      amountInWords,
    });
    const pdfBase64 = Buffer.from(pdfBytes).toString("base64");

    // Daksh — the previous remote-URL approach (NEXT_PUBLIC_APP_URL +
    // /logo-dark.png) didn't render in mobile Gmail; the email
    // showed a broken-image placeholder. Switched to CID inline:
    // read the logo bytes from public/ here, attach as inline
    // content with content_id "mtcpl-logo", reference in the HTML
    // as <img src="cid:mtcpl-logo">. Works in every email client.
    let logoBase64: string | null = null;
    try {
      const { readFile } = await import("node:fs/promises");
      const { join } = await import("node:path");
      const bytes = await readFile(join(process.cwd(), "public", "logo-dark.png"));
      logoBase64 = Buffer.from(bytes).toString("base64");
    } catch (e) {
      console.warn("[vendor-email] logo not loaded, email will show first-letter chip", e);
    }
    const logoCid = logoBase64 ? "mtcpl-logo" : undefined;

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
      logoCid,
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
        // Inline logo (CID-referenced from the email HTML). Omitted
        // when the public/logo-dark.png file couldn't be read — the
        // body falls back to a first-letter chip in that case.
        ...(logoBase64
          ? [
              {
                filename: "mtcpl-logo.png",
                content: logoBase64,
                contentId: "mtcpl-logo",
              },
            ]
          : []),
      ],
    });

    await logAudit(
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
    // never sees an unhandled rejection. Also capture the failure
    // as an audit row so we can see WHY the email didn't go —
    // previously this just console.warn'd into Vercel logs that
    // most users can't see.
    console.warn("[sendVendorPaymentEmail] failed", e);
    try {
      await logAudit(
        actorId,
        "vendor_payment_email_failed",
        "bill_payment",
        paymentId,
        {
          error: e instanceof Error ? e.message : String(e),
          stack:
            e instanceof Error
              ? e.stack?.split("\n").slice(0, 5).join("\n")
              : undefined,
        },
      );
    } catch {
      // logAudit itself can fail — final swallow.
    }
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
    // Mig 052 — bank_rejected also goes back to due via this same
    // path. "↩ Send to due" on a rejected row is the final give-up
    // exit: row flips to cancelled, bill drops back into the
    // outstanding pool, accountant can re-propose later.
    .in("status", ["proposed", "confirmed", "bank_rejected"])
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
// Mig 052 — bank-rejected payment lifecycle
// ──────────────────────────────────────────────────────────────────
// Pattern: HDFC bulk file is uploaded. Bank processes each row
// independently. Some succeed, some fail (wrong IFSC, account
// closed, beneficiary-name mismatch, NSF, etc.). The accountant
// flags the failed rows here so they leave the "Confirmed" section
// without going all the way back to "due" (which would lose the
// proposal/confirm history). Rejected rows wait in a holding
// section on Pay Today until the accountant chooses: try again
// (re-propose), mark paid manually, or send back to due.
// ──────────────────────────────────────────────────────────────────

export async function bankRejectPaymentAction(
  formData: FormData,
): Promise<ActionResult> {
  const { profile } = await requireAuth();
  if (!canMarkPaid(profile)) {
    return {
      ok: false,
      error:
        "Only the accountant / owner can mark a payment bank-rejected.",
    };
  }
  const supabase = createAdminSupabaseClient();

  const paymentId = String(formData.get("payment_id") || "").trim();
  const reason = String(formData.get("rejection_reason") || "").trim();
  if (!paymentId) return { ok: false, error: "Missing payment_id." };
  if (reason.length < 3) {
    return {
      ok: false,
      error:
        "Tell us why the bank refused this payment (min 3 chars). e.g. 'Wrong IFSC', 'Account closed', 'Insufficient funds'.",
    };
  }

  // Confirm the row is currently 'confirmed' — bank can only refuse
  // a row that was actually sent. proposed rows haven't reached the
  // bank yet, paid rows are done, cancelled is cancelled.
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
      error: `Payment is not in 'confirmed' state (current: ${payment.status}). Only confirmed payments can be marked bank-rejected.`,
    };
  }

  const now = new Date().toISOString();
  const { error: updErr } = await supabase
    .from("bill_payments")
    .update({
      status: "bank_rejected",
      bank_rejected_at: now,
      bank_rejected_by: profile.id,
      bank_rejection_reason: reason,
      updated_at: now,
    })
    .eq("id", paymentId);

  if (updErr) return { ok: false, error: updErr.message };

  void logAudit(profile.id, "payment_bank_rejected", "bill_payment", paymentId, {
    bill_id: payment.bill_id,
    proposed_amount: Number(payment.proposed_amount),
    reason,
  });
  await refreshAccountsPaths();
  return { ok: true };
}

/** Create a fresh `proposed` payment row for the same bill, linked
 *  to the bank_rejected row via previous_payment_id. The new row
 *  joins the proposed pool — the owner confirms it in a future
 *  batch (the existing batching UI handles "which group" selection
 *  by ticking proposed rows together before confirming).
 *
 *  The original bank_rejected row stays as-is, preserving the
 *  rejection history. The retry chain can be walked via
 *  previous_payment_id (see migration 052 diagnostic notes). */
export async function retryBankRejectedPaymentAction(
  formData: FormData,
): Promise<ActionResult> {
  const { profile } = await requireAuth();
  if (!canMarkPaid(profile)) {
    return {
      ok: false,
      error: "Only the accountant / owner can re-propose a bank-rejected payment.",
    };
  }
  const supabase = createAdminSupabaseClient();

  const paymentId = String(formData.get("payment_id") || "").trim();
  if (!paymentId) return { ok: false, error: "Missing payment_id." };

  const { data: rejected, error: loadErr } = await supabase
    .from("bill_payments")
    .select("id, status, bill_id, proposed_amount")
    .eq("id", paymentId)
    .maybeSingle();
  if (loadErr) return { ok: false, error: loadErr.message };
  if (!rejected) return { ok: false, error: "Payment row not found." };
  if (rejected.status !== "bank_rejected") {
    return {
      ok: false,
      error: `Only bank-rejected payments can be retried (current: ${rejected.status}).`,
    };
  }

  // Sanity: don't propose more than the bill's current outstanding.
  // If another payment closed the bill between rejection and retry
  // (e.g. cash settlement), surface a clear error rather than
  // creating a phantom proposal.
  const { data: billRow } = await supabase
    .from("bills")
    .select("amount_outstanding, token")
    .eq("id", rejected.bill_id as string)
    .maybeSingle();
  const outstanding = Number(billRow?.amount_outstanding ?? 0);
  const proposedAmount = Number(rejected.proposed_amount);
  if (outstanding <= 0) {
    return {
      ok: false,
      error:
        "This bill has no outstanding balance — it was settled by another payment. Send the rejected row to due to clean it up.",
    };
  }
  const retryAmount = Math.min(proposedAmount, outstanding);

  const now = new Date().toISOString();
  const { data: created, error: insErr } = await supabase
    .from("bill_payments")
    .insert({
      bill_id: rejected.bill_id,
      status: "proposed",
      proposed_amount: retryAmount,
      proposed_by: profile.id,
      proposed_at: now,
      previous_payment_id: rejected.id,
    })
    .select("id")
    .single();
  if (insErr) return { ok: false, error: insErr.message };

  void logAudit(profile.id, "payment_retry_proposed", "bill_payment", created.id, {
    bill_id: rejected.bill_id,
    proposed_amount: retryAmount,
    previous_payment_id: rejected.id,
  });
  await refreshAccountsPaths();
  return { ok: true };
}

// ──────────────────────────────────────────────────────────────────
// Mig 053 — Final Audit (UTR / bank-statement recheck)
// ──────────────────────────────────────────────────────────────────
// After a payment is marked paid, the final auditor cross-checks
// the recorded UTR/reference against the actual bank statement.
// Two terminal actions: verify (all good) or flag (capture reason
// for owner attention; money already moved, so no reversal).
// ──────────────────────────────────────────────────────────────────

export async function verifyFinalAuditAction(
  formData: FormData,
): Promise<ActionResult> {
  const { profile } = await requireAuth();
  if (!canFinalAudit(profile)) {
    return {
      ok: false,
      error: "Only the final auditor, owner, or developer can verify payments.",
    };
  }
  const supabase = createAdminSupabaseClient();

  const paymentId = String(formData.get("payment_id") || "").trim();
  if (!paymentId) return { ok: false, error: "Missing payment_id." };

  const { data: payment, error: loadErr } = await supabase
    .from("bill_payments")
    .select("id, status, bill_id, final_audit_status, paid_amount, payment_reference")
    .eq("id", paymentId)
    .maybeSingle();
  if (loadErr) return { ok: false, error: loadErr.message };
  if (!payment) return { ok: false, error: "Payment row not found." };
  if (payment.status !== "paid") {
    return {
      ok: false,
      error: `Only paid payments can be verified (current: ${payment.status}).`,
    };
  }
  if (payment.final_audit_status !== "pending") {
    return {
      ok: false,
      error: `Payment is already ${payment.final_audit_status} — re-verification not supported.`,
    };
  }

  const now = new Date().toISOString();
  const { error: updErr } = await supabase
    .from("bill_payments")
    .update({
      final_audit_status: "verified",
      final_audit_at: now,
      final_audit_by: profile.id,
      updated_at: now,
    })
    .eq("id", paymentId);

  if (updErr) return { ok: false, error: updErr.message };

  void logAudit(
    profile.id,
    "payment_final_audit_verified",
    "bill_payment",
    paymentId,
    {
      bill_id: payment.bill_id,
      paid_amount: Number(payment.paid_amount ?? 0),
      payment_reference: payment.payment_reference,
    },
  );
  await refreshAccountsPaths();
  return { ok: true };
}

export async function flagFinalAuditAction(
  formData: FormData,
): Promise<ActionResult> {
  const { profile } = await requireAuth();
  if (!canFinalAudit(profile)) {
    return {
      ok: false,
      error: "Only the final auditor, owner, or developer can flag payments.",
    };
  }
  const supabase = createAdminSupabaseClient();

  const paymentId = String(formData.get("payment_id") || "").trim();
  const reason = String(formData.get("flag_reason") || "").trim();
  const note = String(formData.get("flag_note") || "").trim() || null;

  if (!paymentId) return { ok: false, error: "Missing payment_id." };
  if (reason.length < 3) {
    return {
      ok: false,
      error:
        "Flag reason required (min 3 chars). Tell us what you spotted — UTR mismatch, wrong amount, wrong vendor, etc.",
    };
  }

  const { data: payment, error: loadErr } = await supabase
    .from("bill_payments")
    .select("id, status, bill_id, final_audit_status, paid_amount, payment_reference")
    .eq("id", paymentId)
    .maybeSingle();
  if (loadErr) return { ok: false, error: loadErr.message };
  if (!payment) return { ok: false, error: "Payment row not found." };
  if (payment.status !== "paid") {
    return {
      ok: false,
      error: `Only paid payments can be flagged (current: ${payment.status}).`,
    };
  }
  if (payment.final_audit_status !== "pending") {
    return {
      ok: false,
      error: `Payment is already ${payment.final_audit_status} — re-audit not supported.`,
    };
  }

  const now = new Date().toISOString();
  const { error: updErr } = await supabase
    .from("bill_payments")
    .update({
      final_audit_status: "flagged",
      final_audit_at: now,
      final_audit_by: profile.id,
      final_audit_flag_reason: reason,
      final_audit_flag_note: note,
      updated_at: now,
    })
    .eq("id", paymentId);

  if (updErr) return { ok: false, error: updErr.message };

  void logAudit(
    profile.id,
    "payment_final_audit_flagged",
    "bill_payment",
    paymentId,
    {
      bill_id: payment.bill_id,
      paid_amount: Number(payment.paid_amount ?? 0),
      payment_reference: payment.payment_reference,
      reason,
      note,
    },
  );
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
    // Mig 066 — optional nickname (owner name / informal handle) so
    // multi-firm vendors are easy to identify. Capped at 100 chars
    // server-side as a belt-and-braces; the form caps at 100 too.
    nickname:
      String(formData.get("nickname") || "").trim().slice(0, 100) || null,
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
  // Mig 053 follow-on: final_auditor has full accountant powers and
  // also needs the private-notes / royalty view to do their job.
  // Mig 061 follow-on (Daksh): crosscheck added — they verify
  // pending bills and need to see vendor private notes + edit the
  // royalty program (royalty points received / paid). Same access
  // as accountant for this surface.
  return (
    p.role === "developer" ||
    p.role === "owner" ||
    p.role === "accountant" ||
    p.role === "accountant_star" ||
    p.role === "crosscheck"
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

// ──────────────────────────────────────────────────────────────────
// Vendor royalty entries (mig 051) — non-monetary unit tracking
// ──────────────────────────────────────────────────────────────────
// Per-vendor list of "received" / "given" entries with numeric
// amounts. Net balance computed on demand from sum of non-cancelled
// entries. Same passphrase gate as text notes — one auth, two
// features.
//
// AUDITABLE: every add / cancel writes value + vendor + actor to
// audit_logs. No hard delete from the UI; soft-cancel only.
// RECOVERABLE: backups + cancelled rows mean values are never
// truly lost.

type RoyaltyEntryRow = {
  id: string;
  bill_vendor_id: string;
  amount: number;
  entry_type: "received" | "given";
  description: string | null;
  // Mig 068 — explicit business date. NULL on legacy rows (the UI
  // falls back to created_at::date for display).
  entry_date: string | null;
  created_at: string;
  created_by: string | null;
  cancelled_at: string | null;
  cancelled_by: string | null;
  cancel_reason: string | null;
  // Mig 064 — owner approval gate. Owner / developer adds auto-
  // approve; everyone else (accountant / accountant_star / crosscheck)
  // lands in pending_approval and must be approved or rejected from
  // the Tasks-pill queue before counting toward the net balance.
  status: "pending_approval" | "approved" | "rejected";
  approved_at: string | null;
  approved_by: string | null;
  rejected_at: string | null;
  rejected_by: string | null;
};

/** Mig 064 — extra passphrase the owner enters to view the Royalty
 *  Approval queue. Distinct from the private-notes passphrase
 *  (which controls notes / royalty *content*) — this one controls
 *  the *approve / reject* surface. */
const ROYALTY_APPROVAL_PASSPHRASE = "125500";

export async function getVendorRoyaltyEntriesAction(
  formData: FormData,
): Promise<
  | {
      ok: true;
      entries: Array<{
        id: string;
        amount: number;
        entryType: "received" | "given";
        description: string | null;
        // Mig 068 — business date. NULL on legacy rows; client uses
        // createdAt::date as the display fallback.
        entryDate: string | null;
        createdAt: string;
        createdByName: string | null;
        cancelledAt: string | null;
        cancelReason: string | null;
        // Mig 064 — surface the approval state so the modal can
        // render a "PENDING APPROVAL" / "REJECTED" badge and the
        // totals can exclude pending/rejected rows.
        status: "pending_approval" | "approved" | "rejected";
      }>;
      netBalance: number;
      receivedTotal: number;
      givenTotal: number;
    }
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
  const { data, error } = await admin
    .from("vendor_royalty_entries")
    .select("*")
    .eq("bill_vendor_id", vendorId)
    .order("created_at", { ascending: false })
    .limit(500);
  if (error) return { ok: false, error: error.message };

  const rows = (data ?? []) as RoyaltyEntryRow[];

  // Resolve creator names in one round-trip
  const creatorIds = new Set<string>();
  for (const r of rows) {
    if (r.created_by) creatorIds.add(r.created_by);
  }
  const profilesMap = new Map<string, string>();
  if (creatorIds.size > 0) {
    const { data: profs } = await admin
      .from("profiles")
      .select("id, full_name")
      .in("id", Array.from(creatorIds));
    for (const p of (profs ?? []) as Array<{ id: string; full_name: string | null }>) {
      if (p.full_name) profilesMap.set(p.id, p.full_name);
    }
  }

  let receivedTotal = 0;
  let givenTotal = 0;
  for (const r of rows) {
    if (r.cancelled_at) continue;
    // Mig 064 — only approved entries count toward the running total.
    // Pending + rejected are visible in the list (with badges) but
    // never roll into the net balance until the owner approves.
    if (r.status !== "approved") continue;
    const v = Number(r.amount);
    if (r.entry_type === "received") receivedTotal += v;
    else if (r.entry_type === "given") givenTotal += v;
  }
  // Mig 053 follow-on (Daksh, May 2026): the parens-labels read
  //   Received (−)  ·  Paid (+)
  // so the net balance MUST be paid − received to match what the
  // sign on each row says. The earlier formula (received − paid)
  // inverted the convention — when you'd paid 10 and received 0
  // it showed -10 instead of +10.
  const netBalance = givenTotal - receivedTotal;

  void logAudit(
    profile.id,
    "vendor_royalty_entries_viewed",
    "bill_vendor",
    vendorId,
    { row_count: rows.length, net_balance: netBalance },
  );

  return {
    ok: true,
    entries: rows.map((r) => ({
      id: r.id,
      amount: Number(r.amount),
      entryType: r.entry_type,
      description: r.description,
      entryDate: r.entry_date,
      createdAt: r.created_at,
      createdByName: r.created_by ? profilesMap.get(r.created_by) ?? null : null,
      cancelledAt: r.cancelled_at,
      cancelReason: r.cancel_reason,
      status: r.status,
    })),
    netBalance,
    receivedTotal,
    givenTotal,
  };
}

export async function addVendorRoyaltyEntryAction(
  formData: FormData,
): Promise<ActionResult> {
  const { profile } = await requireAuth();
  if (!canAccessPrivateNotes(profile)) {
    return { ok: false, error: "Not authorised." };
  }
  const vendorId = String(formData.get("vendor_id") || "").trim();
  const entryType = String(formData.get("entry_type") || "").trim();
  const amountRaw = String(formData.get("amount") || "").trim();
  const description = String(formData.get("description") || "").trim() || null;
  const plain = String(formData.get("passphrase") || "");
  // Daksh May 2026 — mig 068. New first-class entry_date so people
  // stop encoding the date inside the description string. Empty
  // string from the form means "use today" (the modal usually
  // pre-fills today, so this branch mostly catches an explicit clear).
  const entryDateRaw = String(formData.get("entry_date") || "").trim();

  if (!vendorId) return { ok: false, error: "Missing vendor_id." };
  if (entryType !== "received" && entryType !== "given") {
    return { ok: false, error: "Entry type must be 'received' or 'given'." };
  }
  const amount = Number(amountRaw);
  if (!Number.isFinite(amount) || amount <= 0) {
    return { ok: false, error: "Amount must be a positive number." };
  }
  if (amount > 9_999_999_999.99) {
    return { ok: false, error: "Amount too large." };
  }
  if (description && description.length > 500) {
    return { ok: false, error: "Description too long (max 500 chars)." };
  }
  // Validate entry_date when supplied. Reuses the same sanity rules
  // as bill_date: strict YYYY-MM-DD, 4-digit year, range 2015..now+1,
  // round-trips through Date so 2026-02-30 doesn't slip through.
  // Empty string is fine — we fall back to today.
  let entryDate: string | null = null;
  if (entryDateRaw) {
    const dateErr = validateBillDate(entryDateRaw);
    if (dateErr) return { ok: false, error: dateErr };
    entryDate = entryDateRaw;
  } else {
    // Default to today (IST) in YYYY-MM-DD. Keeps existing form
    // submissions that don't yet send entry_date working with no
    // behaviour change.
    const istParts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Kolkata",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date());
    const y = istParts.find((p) => p.type === "year")?.value ?? "0000";
    const m = istParts.find((p) => p.type === "month")?.value ?? "01";
    const d = istParts.find((p) => p.type === "day")?.value ?? "01";
    entryDate = `${y}-${m}-${d}`;
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
  // Mig 064 — owner / developer auto-approve their own entries
  // (requiring self-approval would be theatre). Everyone else
  // (accountant / accountant_star / crosscheck) lands in
  // pending_approval and shows up on the owner's Tasks-pill
  // Royalty Approval queue.
  const isAutoApprove =
    profile.role === "owner" || profile.role === "developer";
  const nowIso = new Date().toISOString();
  const { data, error } = await admin
    .from("vendor_royalty_entries")
    .insert({
      bill_vendor_id: vendorId,
      amount,
      entry_type: entryType,
      description,
      entry_date: entryDate,
      created_by: profile.id,
      status: isAutoApprove ? "approved" : "pending_approval",
      approved_at: isAutoApprove ? nowIso : null,
      approved_by: isAutoApprove ? profile.id : null,
    })
    .select("id")
    .single();
  if (error) return { ok: false, error: error.message };

  void logAudit(
    profile.id,
    "vendor_royalty_entry_added",
    "bill_vendor",
    vendorId,
    {
      entry_id: (data as { id: string }).id,
      amount,
      entry_type: entryType,
      description,
      entry_date: entryDate,
      status: isAutoApprove ? "approved" : "pending_approval",
    },
  );
  return { ok: true };
}

export async function cancelVendorRoyaltyEntryAction(
  formData: FormData,
): Promise<ActionResult> {
  const { profile } = await requireAuth();
  // Mig 061 follow-on (Daksh): adding a royalty entry is open to
  // everyone with private-notes access (dev / owner / accountant /
  // accountant_star / crosscheck) — five hands enter; but DELETING
  // a posted entry is dev / owner only. Otherwise a careless cancel
  // erases another person's record. Cancelled rows still sit on the
  // audit log either way.
  if (profile.role !== "developer" && profile.role !== "owner") {
    return {
      ok: false,
      error: "Only developer or owner can cancel a royalty entry.",
    };
  }
  const entryId = String(formData.get("entry_id") || "").trim();
  const reason = String(formData.get("cancel_reason") || "").trim() || null;
  const plain = String(formData.get("passphrase") || "");
  if (!entryId) return { ok: false, error: "Missing entry_id." };

  const row = await readPassphraseRow();
  if (!row || row.hash === null) {
    return { ok: false, error: "Passphrase has not been set yet." };
  }
  const { verifyPassphrase } = await import("@/lib/private-notes");
  if (!verifyPassphrase(plain, row.salt, row.hash)) {
    return { ok: false, error: "Incorrect passphrase." };
  }

  const admin = createAdminSupabaseClient();
  // Fetch prior values for the audit row before cancelling.
  const { data: prior } = await admin
    .from("vendor_royalty_entries")
    .select("bill_vendor_id, amount, entry_type, cancelled_at")
    .eq("id", entryId)
    .maybeSingle();
  if (!prior) return { ok: false, error: "Entry not found." };
  if ((prior as { cancelled_at?: string | null }).cancelled_at) {
    return { ok: false, error: "Entry is already cancelled." };
  }

  const now = new Date().toISOString();
  const { error } = await admin
    .from("vendor_royalty_entries")
    .update({
      cancelled_at: now,
      cancelled_by: profile.id,
      cancel_reason: reason,
    })
    .eq("id", entryId);
  if (error) return { ok: false, error: error.message };

  void logAudit(
    profile.id,
    "vendor_royalty_entry_cancelled",
    "bill_vendor",
    (prior as { bill_vendor_id: string }).bill_vendor_id,
    {
      entry_id: entryId,
      amount: Number((prior as { amount: number }).amount),
      entry_type: (prior as { entry_type: string }).entry_type,
      reason,
    },
  );
  return { ok: true };
}

// ══════════════════════════════════════════════════════════════════
// Mig 064 — Royalty owner approval gate
// ══════════════════════════════════════════════════════════════════
//
// Non-owner additions (accountant / accountant_star / crosscheck)
// land in `status='pending_approval'`. Owner views the queue from
// the Tasks pill — after entering the ROYALTY_APPROVAL_PASSPHRASE
// ("125500") — and approves or rejects each entry. Approved =
// status flips to 'approved' + counts toward net balance. Rejected
// = soft-cancel with cancel_reason='owner_rejected' so the audit
// trail records who killed it and when.

/**
 * Daksh May 2026 — cross-vendor royalty summary for the owner /
 * developer dashboard peek. Aggregates approved entries by day,
 * week, or month within a date range. Used by /accounts/royalty-
 * summary so dad can scan a single screen instead of opening
 * every vendor's private-notes panel one-by-one.
 *
 * Gating: owner/developer only + ROYALTY_APPROVAL_PASSPHRASE
 * (same 125500 used by the approval queue). Only approved entries
 * count — pending + rejected are ignored. cancelled_at IS NULL so
 * soft-cancelled rows drop out too.
 *
 * entry_date is the source of truth (mig 068). Falls back to
 * created_at::date for legacy rows where entry_date is NULL.
 */
export async function getRoyaltySummaryAction(
  formData: FormData,
): Promise<
  | {
      ok: true;
      buckets: Array<{
        /** Bucket key — YYYY-MM-DD for day, YYYY-Www for week,
         *  YYYY-MM for month. */
        key: string;
        /** Human label — e.g. "Fri 22 May 2026", "Week 21 (18-24 May)",
         *  "May 2026". */
        label: string;
        received: number;
        given: number;
        net: number;
        entryCount: number;
        /** Per-vendor breakdown for THIS bucket. Sorted by net
         *  magnitude desc so the biggest movers float to the top. */
        vendors: Array<{
          id: string;
          name: string;
          received: number;
          given: number;
          net: number;
          entryCount: number;
        }>;
      }>;
      totals: {
        received: number;
        given: number;
        net: number;
        entryCount: number;
      };
      /** Per-vendor totals across the WHOLE range — separate from
       *  the per-bucket breakdown so dad can see "this month: vendor
       *  A net +X, vendor B net -Y" at a glance. */
      vendors: Array<{
        id: string;
        name: string;
        received: number;
        given: number;
        net: number;
        entryCount: number;
      }>;
    }
  | { ok: false; error: string }
> {
  const { profile } = await requireAuth();
  if (profile.role !== "owner" && profile.role !== "developer") {
    return { ok: false, error: "Only owner / developer." };
  }
  const passphrase = String(formData.get("passphrase") || "");
  if (passphrase !== ROYALTY_APPROVAL_PASSPHRASE) {
    return { ok: false, error: "Incorrect summary passphrase." };
  }

  const fromDate = String(formData.get("from_date") || "").trim();
  const toDate = String(formData.get("to_date") || "").trim();
  const granularityRaw = String(formData.get("granularity") || "day").trim();
  const granularity: "day" | "week" | "month" =
    granularityRaw === "week" || granularityRaw === "month"
      ? granularityRaw
      : "day";

  // Validate dates with the same shape guard used by bill_date.
  // Empty fromDate / toDate mean "no bound on that side" — open
  // range; the summary defaults the picker to current month but
  // a user can clear it for an unbounded query.
  function validateDate(s: string): string | null {
    if (!s) return null;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return "Date must be YYYY-MM-DD.";
    const y = parseInt(s.slice(0, 4), 10);
    const ny = new Date().getFullYear() + 1;
    if (y < 2015 || y > ny) return `Date year ${y} looks wrong.`;
    return null;
  }
  const fromErr = validateDate(fromDate);
  if (fromErr) return { ok: false, error: `From date: ${fromErr}` };
  const toErr = validateDate(toDate);
  if (toErr) return { ok: false, error: `To date: ${toErr}` };

  const admin = createAdminSupabaseClient();
  let q = admin
    .from("vendor_royalty_entries")
    .select(
      "amount, entry_type, entry_date, created_at, bill_vendor_id, bill_vendors!inner(name)",
    )
    .eq("status", "approved")
    .is("cancelled_at", null);
  if (fromDate) {
    // Match rows where the effective bucket date (entry_date or
    // created_at) is >= fromDate. Supabase can't OR across columns
    // easily without .or(), so use the conservative approach: if
    // entry_date is set, filter by it; if not, by created_at. Use
    // .or() with the postgrest syntax.
    q = q.or(
      `and(entry_date.gte.${fromDate}),and(entry_date.is.null,created_at.gte.${fromDate}T00:00:00.000Z)`,
    );
  }
  if (toDate) {
    q = q.or(
      `and(entry_date.lte.${toDate}),and(entry_date.is.null,created_at.lte.${toDate}T23:59:59.999Z)`,
    );
  }
  q = q.limit(5000); // hard cap so an unbounded query can't OOM.

  const { data, error } = await q;
  if (error) return { ok: false, error: error.message };

  type Row = {
    amount: number;
    entry_type: "received" | "given";
    entry_date: string | null;
    created_at: string;
    bill_vendor_id: string;
    bill_vendors: { name: string } | { name: string }[] | null;
  };

  // Bucket key per granularity. The "label" is a human-readable
  // version for the table column. Week labels use ISO week numbers
  // ("Week 21") with the Mon-Sun span attached for context.
  function keyAndLabel(iso: string): { key: string; label: string } {
    const d = new Date(`${iso}T00:00:00+05:30`);
    if (granularity === "day") {
      const dow = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getDay()];
      const month = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getMonth()];
      return {
        key: iso,
        label: `${dow} ${d.getDate()} ${month} ${d.getFullYear()}`,
      };
    }
    if (granularity === "month") {
      const month = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"][d.getMonth()];
      return {
        key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`,
        label: `${month} ${d.getFullYear()}`,
      };
    }
    // Week — ISO week number. Anchor to Monday of the week.
    const tmp = new Date(d);
    // JS getDay: 0=Sun, 1=Mon. Convert so Mon=0.
    const dayMonFirst = (tmp.getDay() + 6) % 7;
    tmp.setDate(tmp.getDate() - dayMonFirst);
    const monday = new Date(tmp);
    const sunday = new Date(tmp);
    sunday.setDate(monday.getDate() + 6);
    // ISO week computation
    const target = new Date(Date.UTC(monday.getFullYear(), monday.getMonth(), monday.getDate()));
    const dayNum = (target.getUTCDay() + 6) % 7;
    target.setUTCDate(target.getUTCDate() - dayNum + 3);
    const firstThursday = target.getTime();
    target.setUTCMonth(0, 1);
    if (target.getUTCDay() !== 4) {
      target.setUTCMonth(0, 1 + ((4 - target.getUTCDay()) + 7) % 7);
    }
    const weekNum =
      1 + Math.ceil((firstThursday - target.getTime()) / 604800000);
    const monthShort = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    return {
      key: `${monday.getFullYear()}-W${String(weekNum).padStart(2, "0")}`,
      label: `Week ${weekNum} · ${monday.getDate()} ${monthShort[monday.getMonth()]} – ${sunday.getDate()} ${monthShort[sunday.getMonth()]}`,
    };
  }

  type VendorTally = {
    id: string;
    name: string;
    received: number;
    given: number;
    entryCount: number;
  };
  const bucketMap = new Map<
    string,
    {
      label: string;
      received: number;
      given: number;
      entryCount: number;
      vendorMap: Map<string, VendorTally>;
    }
  >();
  // Whole-range per-vendor totals — independent of bucketing, so
  // each vendor appears once with their net across the entire
  // selected period.
  const overallVendorMap = new Map<string, VendorTally>();

  const rows = (data ?? []) as Row[];
  for (const r of rows) {
    const iso = r.entry_date ?? r.created_at.slice(0, 10);
    const { key, label } = keyAndLabel(iso);
    const bucket =
      bucketMap.get(key) ??
      {
        label,
        received: 0,
        given: 0,
        entryCount: 0,
        vendorMap: new Map<string, VendorTally>(),
      };
    const amt = Number(r.amount) || 0;
    if (r.entry_type === "received") bucket.received += amt;
    else bucket.given += amt;
    bucket.entryCount += 1;

    const vendorEmbed = Array.isArray(r.bill_vendors)
      ? r.bill_vendors[0] ?? null
      : r.bill_vendors;
    const vendorName = vendorEmbed?.name ?? "(unknown vendor)";

    // Bucket-level vendor tally
    const bv =
      bucket.vendorMap.get(r.bill_vendor_id) ?? {
        id: r.bill_vendor_id,
        name: vendorName,
        received: 0,
        given: 0,
        entryCount: 0,
      };
    if (r.entry_type === "received") bv.received += amt;
    else bv.given += amt;
    bv.entryCount += 1;
    bucket.vendorMap.set(r.bill_vendor_id, bv);

    // Overall vendor tally
    const ov =
      overallVendorMap.get(r.bill_vendor_id) ?? {
        id: r.bill_vendor_id,
        name: vendorName,
        received: 0,
        given: 0,
        entryCount: 0,
      };
    if (r.entry_type === "received") ov.received += amt;
    else ov.given += amt;
    ov.entryCount += 1;
    overallVendorMap.set(r.bill_vendor_id, ov);

    bucketMap.set(key, bucket);
  }

  function shapeVendors(m: Map<string, VendorTally>) {
    return [...m.values()]
      .map((v) => ({
        id: v.id,
        name: v.name,
        received: v.received,
        given: v.given,
        net: v.given - v.received,
        entryCount: v.entryCount,
      }))
      // Biggest movers first (by abs net), so dad's eye lands on
      // the vendors that matter; ties broken by name for stability.
      .sort(
        (a, b) =>
          Math.abs(b.net) - Math.abs(a.net) || a.name.localeCompare(b.name),
      );
  }

  // Sort buckets by key (which sorts chronologically because of
  // the ISO format on all three granularities).
  const buckets = [...bucketMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, b]) => ({
      key,
      label: b.label,
      received: b.received,
      given: b.given,
      // Net = given - received. Positive means we paid out more
      // (royalty points flowed FROM us TO vendors). Same
      // convention as the per-vendor net balance display.
      net: b.given - b.received,
      entryCount: b.entryCount,
      vendors: shapeVendors(b.vendorMap),
    }));

  const totals = buckets.reduce(
    (acc, b) => ({
      received: acc.received + b.received,
      given: acc.given + b.given,
      net: acc.net + b.net,
      entryCount: acc.entryCount + b.entryCount,
    }),
    { received: 0, given: 0, net: 0, entryCount: 0 },
  );

  const vendors = shapeVendors(overallVendorMap);

  void logAudit(
    profile.id,
    "royalty_summary_viewed",
    "bill_vendor",
    "",
    {
      from_date: fromDate || null,
      to_date: toDate || null,
      granularity,
      buckets: buckets.length,
      total_entries: totals.entryCount,
    },
  );

  return { ok: true, buckets, totals, vendors };
}

/** List every pending royalty entry across all vendors. Owner /
 *  developer only; passphrase 125500 required. */
export async function listPendingRoyaltyEntriesAction(
  formData: FormData,
): Promise<
  | {
      ok: true;
      entries: Array<{
        id: string;
        billVendorId: string;
        vendorName: string;
        amount: number;
        entryType: "received" | "given";
        description: string | null;
        // Mig 068 — business date the entry represents. NULL on
        // legacy rows; the queue UI falls back to createdAt for those.
        entryDate: string | null;
        createdAt: string;
        createdByName: string | null;
      }>;
    }
  | { ok: false; error: string }
> {
  const { profile } = await requireAuth();
  if (profile.role !== "owner" && profile.role !== "developer") {
    return { ok: false, error: "Only owner / developer." };
  }
  const passphrase = String(formData.get("passphrase") || "");
  if (passphrase !== ROYALTY_APPROVAL_PASSPHRASE) {
    return { ok: false, error: "Incorrect approval passphrase." };
  }

  const admin = createAdminSupabaseClient();
  const { data, error } = await admin
    .from("vendor_royalty_entries")
    .select(
      "id, bill_vendor_id, amount, entry_type, description, entry_date, created_at, created_by, bill_vendors!inner(name)",
    )
    .eq("status", "pending_approval")
    .is("cancelled_at", null)
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) return { ok: false, error: error.message };

  type Row = {
    id: string;
    bill_vendor_id: string;
    amount: number;
    entry_type: "received" | "given";
    description: string | null;
    // Mig 068 — business date the entry represents. NULL on legacy
    // rows; the approval-queue UI falls back to created_at for display.
    entry_date: string | null;
    created_at: string;
    created_by: string | null;
    bill_vendors: { name: string } | { name: string }[] | null;
  };
  const rows = (data ?? []) as unknown as Row[];

  // Resolve creator names
  const creatorIds = new Set<string>();
  for (const r of rows) if (r.created_by) creatorIds.add(r.created_by);
  const profilesMap = new Map<string, string>();
  if (creatorIds.size > 0) {
    const { data: profs } = await admin
      .from("profiles")
      .select("id, full_name")
      .in("id", Array.from(creatorIds));
    for (const p of (profs ?? []) as Array<{ id: string; full_name: string | null }>) {
      if (p.full_name) profilesMap.set(p.id, p.full_name);
    }
  }

  void logAudit(
    profile.id,
    "royalty_approval_queue_viewed",
    "bill_vendor",
    // Queue view isn't scoped to a single vendor — use empty string
    // as a sentinel so the audit row still lands cleanly.
    "",
    { row_count: rows.length },
  );

  return {
    ok: true,
    entries: rows.map((r) => {
      const vendor = Array.isArray(r.bill_vendors)
        ? r.bill_vendors[0] ?? null
        : r.bill_vendors;
      return {
        id: r.id,
        billVendorId: r.bill_vendor_id,
        vendorName: vendor?.name ?? "—",
        amount: Number(r.amount),
        entryType: r.entry_type,
        description: r.description,
        entryDate: r.entry_date,
        createdAt: r.created_at,
        createdByName: r.created_by ? profilesMap.get(r.created_by) ?? null : null,
      };
    }),
  };
}

/** Count pending royalty approvals — drives the Tasks-pill badge.
 *  Owner / developer only (returns 0 for everyone else so the
 *  layout's badge fetch stays silent for the wrong role). */
export async function countPendingRoyaltyApprovalsAction(): Promise<number> {
  const { profile } = await requireAuth();
  if (profile.role !== "owner" && profile.role !== "developer") {
    return 0;
  }
  const admin = createAdminSupabaseClient();
  const { count } = await admin
    .from("vendor_royalty_entries")
    .select("id", { count: "exact", head: true })
    .eq("status", "pending_approval")
    .is("cancelled_at", null);
  return count ?? 0;
}

/** Approve one pending royalty entry. Owner / developer only. The
 *  caller is assumed to have already passed the approval passphrase
 *  gate on the queue page — re-checking it on every approve click
 *  would be excessive. */
export async function approveRoyaltyEntryAction(
  formData: FormData,
): Promise<ActionResult> {
  const { profile } = await requireAuth();
  if (profile.role !== "owner" && profile.role !== "developer") {
    return { ok: false, error: "Only owner / developer." };
  }
  const entryId = String(formData.get("entry_id") || "").trim();
  if (!entryId) return { ok: false, error: "Missing entry_id." };

  const admin = createAdminSupabaseClient();
  // Load current row so we can refuse approving something that's
  // already approved / rejected / cancelled.
  const { data: prior } = await admin
    .from("vendor_royalty_entries")
    .select("id, bill_vendor_id, amount, entry_type, status, cancelled_at")
    .eq("id", entryId)
    .maybeSingle();
  if (!prior) return { ok: false, error: "Entry not found." };
  const p = prior as {
    bill_vendor_id: string;
    amount: number;
    entry_type: string;
    status: string;
    cancelled_at: string | null;
  };
  if (p.cancelled_at) return { ok: false, error: "Entry is cancelled." };
  if (p.status !== "pending_approval") {
    return { ok: false, error: `Entry is already ${p.status.replace(/_/g, " ")}.` };
  }

  const now = new Date().toISOString();
  const { error } = await admin
    .from("vendor_royalty_entries")
    .update({
      status: "approved",
      approved_at: now,
      approved_by: profile.id,
    })
    .eq("id", entryId)
    .eq("status", "pending_approval");
  if (error) return { ok: false, error: error.message };

  void logAudit(
    profile.id,
    "vendor_royalty_entry_approved",
    "bill_vendor",
    p.bill_vendor_id,
    {
      entry_id: entryId,
      amount: Number(p.amount),
      entry_type: p.entry_type,
    },
  );
  return { ok: true };
}

/** Reject one pending royalty entry. Soft-cancels the row with
 *  cancel_reason='owner_rejected_pending' so the audit log can
 *  distinguish a rejected pending entry from an ordinary cancel. */
export async function rejectRoyaltyEntryAction(
  formData: FormData,
): Promise<ActionResult> {
  const { profile } = await requireAuth();
  if (profile.role !== "owner" && profile.role !== "developer") {
    return { ok: false, error: "Only owner / developer." };
  }
  const entryId = String(formData.get("entry_id") || "").trim();
  if (!entryId) return { ok: false, error: "Missing entry_id." };

  const admin = createAdminSupabaseClient();
  const { data: prior } = await admin
    .from("vendor_royalty_entries")
    .select("id, bill_vendor_id, amount, entry_type, status, cancelled_at")
    .eq("id", entryId)
    .maybeSingle();
  if (!prior) return { ok: false, error: "Entry not found." };
  const p = prior as {
    bill_vendor_id: string;
    amount: number;
    entry_type: string;
    status: string;
    cancelled_at: string | null;
  };
  if (p.cancelled_at) return { ok: false, error: "Entry already cancelled." };
  if (p.status !== "pending_approval") {
    return {
      ok: false,
      error: `Entry is already ${p.status.replace(/_/g, " ")} — cannot reject.`,
    };
  }

  const now = new Date().toISOString();
  const { error } = await admin
    .from("vendor_royalty_entries")
    .update({
      status: "rejected",
      rejected_at: now,
      rejected_by: profile.id,
      // Daksh: "reject means direct delete" — soft-cancel preserves
      // the audit trail without leaking the deleted row into the
      // running totals (status='rejected' + cancelled_at both filter
      // it out of net-balance math).
      cancelled_at: now,
      cancelled_by: profile.id,
      cancel_reason: "owner_rejected_pending",
    })
    .eq("id", entryId)
    .eq("status", "pending_approval");
  if (error) return { ok: false, error: error.message };

  void logAudit(
    profile.id,
    "vendor_royalty_entry_rejected",
    "bill_vendor",
    p.bill_vendor_id,
    {
      entry_id: entryId,
      amount: Number(p.amount),
      entry_type: p.entry_type,
    },
  );
  return { ok: true };
}

// ══════════════════════════════════════════════════════════════════
// Vendor Advance Payment (mig 073, Daksh May 2026)
// ══════════════════════════════════════════════════════════════════
//
// Dad's mental model: vendor demands money before the bill arrives.
// Pay the advance now via the existing propose → confirm → HDFC →
// paid pipeline; the paid advance sits as a vendor credit balance.
// When the real bill arrives later, accountant applies some/all of
// that credit to the bill via a synthetic bill_payments row tagged
// is_advance_application=TRUE. The existing recalc trigger reduces
// the bill's amount_outstanding automatically.

/** Owner records a new vendor advance. Skips submit/approve gate —
 *  owner IS the submitter. Lands at status='proposed' so it rides
 *  the regular Pay Today / HDFC CSV / mark-paid flow. */
export async function recordAdvanceAction(
  formData: FormData,
): Promise<ActionResult> {
  const { profile } = await requireAuth();
  if (!canRecordAdvance(profile)) {
    return { ok: false, error: "Only owner / developer can record an advance." };
  }
  const supabase = createAdminSupabaseClient();

  const vendorId = String(formData.get("vendor_id") ?? "").trim();
  const amountRaw = String(formData.get("amount") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const note = String(formData.get("note") ?? "").trim() || null;

  if (!vendorId) return { ok: false, error: "Pick a vendor." };
  const amount = Number(amountRaw);
  if (!Number.isFinite(amount) || amount <= 0) {
    return { ok: false, error: "Advance amount must be greater than zero." };
  }
  if (!description) {
    return { ok: false, error: "Add a short reason for the advance." };
  }

  // Confirm vendor exists + is active. bill_vendors uses
  // is_active BOOLEAN (mig 028) — NOT an archived_at timestamp.
  const { data: vendor, error: vErr } = await supabase
    .from("bill_vendors")
    .select("id, name, is_active")
    .eq("id", vendorId)
    .maybeSingle();
  if (vErr) return { ok: false, error: vErr.message };
  if (!vendor) return { ok: false, error: "Vendor not found." };
  if ((vendor as { is_active: boolean }).is_active === false) {
    return { ok: false, error: "Vendor is archived." };
  }

  // Allocate the next ADV-N token. We compute it by scanning
  // existing tokens (vendor_advance_token_seq isn't easily callable
  // from PostgREST in a portable way). Concurrent inserts re-try
  // on UNIQUE collision via the safety loop below.
  async function nextToken(): Promise<string> {
    for (let attempt = 0; attempt < 5; attempt++) {
      const { data: maxRow } = await supabase
        .from("vendor_advances")
        .select("token")
        .like("token", "ADV-%")
        .order("created_at", { ascending: false })
        .limit(100);
      let maxN = 0;
      for (const r of (maxRow ?? []) as Array<{ token: string }>) {
        const m = r.token.match(/^ADV-(\d+)$/);
        if (m) maxN = Math.max(maxN, parseInt(m[1], 10));
      }
      const candidate = `ADV-${maxN + 1 + attempt}`;
      // Probe — does this token already exist? UNIQUE collisions
      // are vanishingly rare in this app (low concurrency) so the
      // probe is correctness insurance, not the hot path.
      const { data: exists } = await supabase
        .from("vendor_advances")
        .select("id")
        .eq("token", candidate)
        .maybeSingle();
      if (!exists) return candidate;
    }
    // Fallback: timestamp-suffixed token — collision-free but uglier.
    return `ADV-${Date.now()}`;
  }
  const token = await nextToken();

  const now = new Date().toISOString();
  const { data: inserted, error: insErr } = await supabase
    .from("vendor_advances")
    .insert({
      token,
      vendor_id: vendorId,
      amount,
      description,
      note,
      status: "proposed",
      proposed_by: profile.id,
      proposed_at: now,
      created_at: now,
      updated_at: now,
    })
    .select("id, token")
    .single();
  if (insErr) return { ok: false, error: insErr.message };

  await logAudit(profile.id, "vendor_advance_recorded", "vendor_advance", inserted.id, {
    token,
    vendor_id: vendorId,
    vendor_name: (vendor as { name: string }).name,
    amount,
    description,
  });

  void notify(
    "vendor_advance_recorded",
    `Advance ${token} for ${(vendor as { name: string }).name} · ₹${amount.toLocaleString("en-IN")}`,
    {
      message: "Awaiting confirmation on Pay Today.",
      entityType: "vendor_advance",
      entityId: inserted.id,
      actorId: profile.id,
      targetRoles: ["owner", "developer", "accountant"],
    },
  );

  await refreshAccountsPaths();
  return { ok: true };
}

/** Owner confirms a proposed advance (mirrors confirmPaymentsAction
 *  but for a single advance row — advances don't batch). */
export async function confirmAdvanceAction(
  formData: FormData,
): Promise<ActionResult> {
  const { profile } = await requireAuth();
  if (!canConfirmPayments(profile)) {
    return { ok: false, error: "You can't confirm advances." };
  }
  const supabase = createAdminSupabaseClient();

  const advanceId = String(formData.get("advance_id") ?? "").trim();
  if (!advanceId) return { ok: false, error: "Missing advance id." };

  const now = new Date().toISOString();
  const { data: updated, error } = await supabase
    .from("vendor_advances")
    .update({
      status: "confirmed",
      confirmed_by: profile.id,
      confirmed_at: now,
      updated_at: now,
    })
    .eq("id", advanceId)
    .eq("status", "proposed")
    .select("id, token, vendor_id, amount")
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!updated) {
    return { ok: false, error: "Advance is not in proposed state." };
  }

  await logAudit(profile.id, "vendor_advance_confirmed", "vendor_advance", advanceId, {
    token: (updated as { token: string }).token,
  });
  await refreshAccountsPaths();
  return { ok: true };
}

/** Accountant captures the bank reference + flips advance to paid.
 *  Mirrors markPaymentPaidAction — payment_method + reference are
 *  user-entered after the bank transfer actually goes through. */
export async function markAdvancePaidAction(
  formData: FormData,
): Promise<ActionResult> {
  const { profile } = await requireAuth();
  if (!canMarkPaid(profile)) {
    return { ok: false, error: "Only the accountant or a developer can mark advance paid." };
  }
  const supabase = createAdminSupabaseClient();

  const advanceId = String(formData.get("advance_id") ?? "").trim();
  const method = String(formData.get("payment_method") ?? "").trim();
  const reference = String(formData.get("payment_reference") ?? "").trim();
  if (!advanceId) return { ok: false, error: "Missing advance id." };
  if (!method) return { ok: false, error: "Pick a payment method (NEFT / cheque / cash / UPI)." };
  if (!reference) return { ok: false, error: "Enter the payment reference (UTR / cheque no)." };

  const now = new Date().toISOString();
  const { data: updated, error } = await supabase
    .from("vendor_advances")
    .update({
      status: "paid",
      paid_by: profile.id,
      paid_at: now,
      payment_method: method,
      payment_reference: reference,
      updated_at: now,
    })
    .eq("id", advanceId)
    .in("status", ["confirmed", "bank_rejected"])
    .select("id, token, vendor_id, amount")
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!updated) {
    return {
      ok: false,
      error: "Advance is not in confirmed (or bank-rejected) state.",
    };
  }

  await logAudit(profile.id, "vendor_advance_paid", "vendor_advance", advanceId, {
    token: (updated as { token: string }).token,
    payment_method: method,
    payment_reference: reference,
  });

  void notify(
    "vendor_advance_paid",
    `Advance ${(updated as { token: string }).token} paid`,
    {
      message: "Sits as vendor credit until applied to a bill.",
      entityType: "vendor_advance",
      entityId: advanceId,
      actorId: profile.id,
      targetRoles: ["owner", "developer", "accountant"],
    },
  );

  await refreshAccountsPaths();
  return { ok: true };
}

/** Owner cancels a pre-paid advance. After paid, the cancel is
 *  blocked — money has moved, refund must be chased manually + logged
 *  in vendor private notes. */
export async function cancelAdvanceAction(
  formData: FormData,
): Promise<ActionResult> {
  const { profile } = await requireAuth();
  if (!canRecordAdvance(profile)) {
    return { ok: false, error: "Only owner / developer can cancel an advance." };
  }
  const supabase = createAdminSupabaseClient();

  const advanceId = String(formData.get("advance_id") ?? "").trim();
  const reason = String(formData.get("reason") ?? "").trim() || null;
  if (!advanceId) return { ok: false, error: "Missing advance id." };

  // Load to gate-check status.
  const { data: row, error: loadErr } = await supabase
    .from("vendor_advances")
    .select("id, token, status, paid_at")
    .eq("id", advanceId)
    .maybeSingle();
  if (loadErr) return { ok: false, error: loadErr.message };
  if (!row) return { ok: false, error: "Advance not found." };
  const adv = row as { id: string; token: string; status: string; paid_at: string | null };
  if (adv.status === "paid") {
    return {
      ok: false,
      error:
        "Cannot cancel a paid advance — money has already moved. Chase the vendor for a refund and log it in their private notes.",
    };
  }
  if (adv.status === "cancelled") {
    return { ok: false, error: "Advance is already cancelled." };
  }

  const now = new Date().toISOString();
  const { error: updErr } = await supabase
    .from("vendor_advances")
    .update({
      status: "cancelled",
      cancelled_by: profile.id,
      cancelled_at: now,
      cancel_reason: reason,
      updated_at: now,
    })
    .eq("id", advanceId)
    .in("status", ["proposed", "confirmed", "bank_rejected"]);
  if (updErr) return { ok: false, error: updErr.message };

  await logAudit(profile.id, "vendor_advance_cancelled", "vendor_advance", advanceId, {
    token: adv.token,
    reason,
  });
  await refreshAccountsPaths();
  return { ok: true };
}

/** Apply some of a paid vendor advance to a specific bill. Inserts
 *  a tagged synthetic bill_payments row (is_advance_application=TRUE)
 *  + a vendor_advance_applications junction row. The existing
 *  recalc_bill_amount_paid trigger then reduces the bill's
 *  amount_outstanding for free. The synthetic row is filtered out
 *  of HDFC CSV + Final Audit (money already moved when the advance
 *  was paid). */
export async function applyAdvanceToBillAction(
  formData: FormData,
): Promise<ActionResult> {
  const { profile } = await requireAuth();
  if (!canApplyAdvanceToBill(profile)) {
    return { ok: false, error: "You can't apply an advance to a bill." };
  }
  const supabase = createAdminSupabaseClient();

  const billId = String(formData.get("bill_id") ?? "").trim();
  const advanceId = String(formData.get("advance_id") ?? "").trim();
  const amountRaw = String(formData.get("amount_applied") ?? "").trim();
  const note = String(formData.get("note") ?? "").trim() || null;
  if (!billId) return { ok: false, error: "Missing bill id." };
  if (!advanceId) return { ok: false, error: "Pick an advance to apply." };
  const amount = Number(amountRaw);
  if (!Number.isFinite(amount) || amount <= 0) {
    return { ok: false, error: "Amount to apply must be greater than zero." };
  }

  // Load both rows + the already-applied total for the advance.
  const [{ data: bill, error: billErr }, { data: adv, error: advErr }, { data: applied }] =
    await Promise.all([
      supabase
        .from("bills")
        .select("id, token, bill_vendor_id, amount_outstanding, status, cancelled_at")
        .eq("id", billId)
        .maybeSingle(),
      supabase
        .from("vendor_advances")
        .select("id, token, vendor_id, amount, status, cancelled_at")
        .eq("id", advanceId)
        .maybeSingle(),
      supabase
        .from("vendor_advance_applications")
        .select("amount_applied")
        .eq("vendor_advance_id", advanceId)
        .is("unapplied_at", null),
    ]);
  if (billErr) return { ok: false, error: billErr.message };
  if (advErr) return { ok: false, error: advErr.message };
  if (!bill) return { ok: false, error: "Bill not found." };
  if (!adv) return { ok: false, error: "Advance not found." };

  const b = bill as {
    id: string;
    token: string;
    bill_vendor_id: string;
    amount_outstanding: number | string;
    status: string;
    cancelled_at: string | null;
  };
  const a = adv as {
    id: string;
    token: string;
    vendor_id: string;
    amount: number | string;
    status: string;
    cancelled_at: string | null;
  };

  if (b.cancelled_at) return { ok: false, error: "Bill is cancelled." };
  if (b.status === "cancelled" || b.status === "rejected") {
    return { ok: false, error: `Bill is in ${b.status} state.` };
  }
  if (a.status !== "paid" || a.cancelled_at) {
    return { ok: false, error: "Advance is not in paid state." };
  }
  if (a.vendor_id !== b.bill_vendor_id) {
    return {
      ok: false,
      error: "Advance + bill vendor don't match.",
    };
  }

  const outstanding = Number(b.amount_outstanding ?? 0);
  if (outstanding <= 0) {
    return { ok: false, error: "Bill has no outstanding amount to apply against." };
  }

  const totalApplied = (applied ?? []).reduce(
    (s, r) => s + Number((r as { amount_applied: number }).amount_applied ?? 0),
    0,
  );
  const advanceRemaining = Number(a.amount) - totalApplied;
  if (advanceRemaining <= 0.005) {
    return { ok: false, error: "Advance is already fully consumed." };
  }

  // Clamp: can't apply more than (a) what's left on the advance, or
  // (b) what the bill still owes. Either gate fails loud rather
  // than silent-truncating — accountant should see the real numbers.
  if (amount > advanceRemaining + 0.005) {
    return {
      ok: false,
      error: `Can apply at most ₹${advanceRemaining.toLocaleString("en-IN")} from ${a.token} (already applied ₹${totalApplied.toLocaleString("en-IN")}).`,
    };
  }
  if (amount > outstanding + 0.005) {
    return {
      ok: false,
      error: `Bill outstanding is ₹${outstanding.toLocaleString("en-IN")} — can't apply more than that.`,
    };
  }

  const now = new Date().toISOString();

  // 1. Insert the synthetic bill_payments row — arrives PRE-PAID so
  //    no other action tries to propose / confirm / mark-paid it.
  //    payment_method='other' (the only enum value that fits a
  //    non-cash, non-bank-instrument transfer — mig 028 enum is
  //    strict: cash/cheque/neft/rtgs/upi/imps/card/other). The row
  //    is still uniquely identifiable by is_advance_application +
  //    source_advance_id + the 'ADV-LINK:' prefix in
  //    payment_reference, so UI / filters can tell it apart.
  const { data: paymentRow, error: payErr } = await supabase
    .from("bill_payments")
    .insert({
      bill_id: b.id,
      status: "paid",
      proposed_amount: amount,
      paid_amount: amount,
      payment_method: "other",
      payment_reference: `ADV-LINK:${a.token}`,
      payment_note: note,
      proposed_by: profile.id,
      proposed_at: now,
      confirmed_by: profile.id,
      confirmed_at: now,
      paid_by: profile.id,
      paid_at: now,
      is_advance_application: true,
      source_advance_id: a.id,
      updated_at: now,
    })
    .select("id")
    .single();
  if (payErr) return { ok: false, error: payErr.message };

  // 2. Insert the junction row pointing at the synthetic payment.
  //    The DB trigger enforces the application cap as a final guard.
  const { error: appErr } = await supabase
    .from("vendor_advance_applications")
    .insert({
      vendor_advance_id: a.id,
      bill_id: b.id,
      amount_applied: amount,
      payment_row_id: paymentRow.id,
      applied_by: profile.id,
      applied_at: now,
      note,
    });
  if (appErr) {
    // Roll back the payment row if the application insert fails so
    // we don't leave a synthetic payment with no junction record.
    await supabase
      .from("bill_payments")
      .update({
        status: "cancelled",
        cancelled_at: now,
        cancelled_by: profile.id,
        cancel_reason: "advance_application_rollback",
        updated_at: now,
      })
      .eq("id", paymentRow.id);
    return { ok: false, error: appErr.message };
  }

  await logAudit(profile.id, "vendor_advance_applied", "vendor_advance", a.id, {
    advance_token: a.token,
    bill_id: b.id,
    bill_token: b.token,
    amount_applied: amount,
    payment_row_id: paymentRow.id,
  });

  await refreshAccountsPaths();
  return { ok: true };
}

/** Owner reverses a previous application. Soft-cancels the synthetic
 *  payment row (bill outstanding goes back up via the recalc
 *  trigger) AND soft-cancels the junction (frees the credit). */
export async function unapplyAdvanceFromBillAction(
  formData: FormData,
): Promise<ActionResult> {
  const { profile } = await requireAuth();
  if (!canUnapplyAdvance(profile)) {
    return {
      ok: false,
      error: "Only owner / developer can reverse an advance application.",
    };
  }
  const supabase = createAdminSupabaseClient();

  const applicationId = String(formData.get("application_id") ?? "").trim();
  const reason = String(formData.get("reason") ?? "").trim() || null;
  if (!applicationId) return { ok: false, error: "Missing application id." };

  const { data: app, error: loadErr } = await supabase
    .from("vendor_advance_applications")
    .select("id, vendor_advance_id, bill_id, amount_applied, payment_row_id, unapplied_at")
    .eq("id", applicationId)
    .maybeSingle();
  if (loadErr) return { ok: false, error: loadErr.message };
  if (!app) return { ok: false, error: "Application not found." };
  const a = app as {
    id: string;
    vendor_advance_id: string;
    bill_id: string;
    amount_applied: number | string;
    payment_row_id: string;
    unapplied_at: string | null;
  };
  if (a.unapplied_at) {
    return { ok: false, error: "Application is already unapplied." };
  }

  const now = new Date().toISOString();

  // Soft-cancel the synthetic payment row first — the recalc trigger
  // on bill_payments will push bill.amount_outstanding back up by
  // amount_applied (cancelled rows are excluded from amount_paid).
  const { error: payErr } = await supabase
    .from("bill_payments")
    .update({
      status: "cancelled",
      cancelled_at: now,
      cancelled_by: profile.id,
      cancel_reason: reason ?? "advance_application_unapplied",
      updated_at: now,
    })
    .eq("id", a.payment_row_id);
  if (payErr) return { ok: false, error: payErr.message };

  // Then mark the application unapplied so the credit frees up.
  const { error: unapplyErr } = await supabase
    .from("vendor_advance_applications")
    .update({
      unapplied_at: now,
      unapplied_by: profile.id,
      unapply_reason: reason,
    })
    .eq("id", applicationId);
  if (unapplyErr) return { ok: false, error: unapplyErr.message };

  await logAudit(profile.id, "vendor_advance_unapplied", "vendor_advance", a.vendor_advance_id, {
    application_id: a.id,
    bill_id: a.bill_id,
    amount_applied: Number(a.amount_applied),
    reason,
  });
  await refreshAccountsPaths();
  return { ok: true };
}

// Form-action wrappers — server-redirect on result so the buttons
// can <form action={...}> without client-side overhead. Mirror
// holdBillAmountFormAction / releaseBillHoldFormAction.

export async function recordAdvanceFormAction(formData: FormData) {
  const res = await recordAdvanceAction(formData);
  if (!res.ok) {
    redirect(
      `/accounts/advances/new?error=${encodeURIComponent(res.error)}`,
    );
  }
  redirect("/accounts/advances?toast=Advance+recorded");
}

export async function confirmAdvanceFormAction(formData: FormData) {
  const res = await confirmAdvanceAction(formData);
  const advanceId = String(formData.get("advance_id") ?? "");
  if (!res.ok) {
    redirect(`/accounts/advances/${advanceId}?error=${encodeURIComponent(res.error)}`);
  }
  redirect(`/accounts/advances/${advanceId}?toast=Confirmed`);
}

export async function cancelAdvanceFormAction(formData: FormData) {
  const res = await cancelAdvanceAction(formData);
  const advanceId = String(formData.get("advance_id") ?? "");
  if (!res.ok) {
    redirect(`/accounts/advances/${advanceId}?error=${encodeURIComponent(res.error)}`);
  }
  redirect(`/accounts/advances?toast=Advance+cancelled`);
}

export async function applyAdvanceFormAction(formData: FormData) {
  const res = await applyAdvanceToBillAction(formData);
  const billId = String(formData.get("bill_id") ?? "");
  if (!res.ok) {
    redirect(`/accounts/bills/${billId}?error=${encodeURIComponent(res.error)}`);
  }
  redirect(`/accounts/bills/${billId}?toast=Advance+applied`);
}

export async function unapplyAdvanceFormAction(formData: FormData) {
  const res = await unapplyAdvanceFromBillAction(formData);
  const billId = String(formData.get("bill_id") ?? "");
  if (!res.ok) {
    redirect(`/accounts/bills/${billId}?error=${encodeURIComponent(res.error)}`);
  }
  redirect(`/accounts/bills/${billId}?toast=Advance+unapplied`);
}
