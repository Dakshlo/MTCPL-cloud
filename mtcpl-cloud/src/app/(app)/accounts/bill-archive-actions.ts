"use server";

/**
 * Archive a settled vendor bill — owner only, OTP-confirmed (mig 226).
 *
 * Daksh, Sep 2026, for his dad: once a bill is 100% paid — by payment
 * or by the ⚖ Settle route — he wants it out of the accounts. Off the
 * bill list, out of the vendor's totals, gone from "total paid".
 *
 * The word is ARCHIVE, not delete, and that is the honest word for what
 * happens: the row, its payments, its vouchers and its audit trail all
 * stay exactly where they are. Only its visibility changes. Deleting
 * was never on the table — bill_payments and the final-audit trail
 * reference these rows, so a real delete would either fail on the
 * foreign keys or leave a paid voucher pointing at nothing, which is a
 * hole in the books.
 *
 * Three gates, deliberately:
 *   1. role must be owner (or developer, who can also restore)
 *   2. the bill must be fully_paid with nothing outstanding and nothing
 *      held back — checked here AND by a CHECK constraint in the
 *      database, so a bug in this file still cannot archive a bill that
 *      owes money
 *   3. a short code sent to the owner's own phone. Not a second
 *      confirm dialog: those become muscle memory in a week.
 *
 * Restore is developer-only, has no expiry, and is a single UPDATE back
 * to NULL. Nothing is ever purged.
 */

import { revalidatePath } from "next/cache";
import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";
import { issueActionOtp, verifyActionOtp } from "@/lib/action-otp";

const ACTION = "bill_archive";

type BillRow = {
  id: string;
  token: string;
  status: string;
  amount_total: number | null;
  amount_outstanding: number | null;
  held_amount: number | null;
  archived_at: string | null;
  bill_vendor_id: string;
};

/** The one place that decides whether a bill may be archived. Both the
 *  request-code step and the archive step ask it, so they can never
 *  disagree about what is eligible. */
async function loadArchivable(billId: string): Promise<
  { ok: true; bill: BillRow } | { ok: false; error: string }
> {
  const admin = createAdminSupabaseClient();
  const { data } = await admin
    .from("bills")
    .select("id, token, status, amount_total, amount_outstanding, held_amount, archived_at, bill_vendor_id")
    .eq("id", billId)
    .maybeSingle();
  const bill = data as BillRow | null;
  if (!bill) return { ok: false, error: "Bill not found." };
  if (bill.archived_at) return { ok: false, error: "That bill is already archived." };
  if (bill.status !== "fully_paid") {
    return { ok: false, error: "Only a fully paid bill can be archived." };
  }
  if (Number(bill.amount_outstanding ?? 0) !== 0) {
    return { ok: false, error: "That bill still has an outstanding amount." };
  }
  // A held amount means the company is deliberately withholding part of
  // the payment. Status may say fully_paid, but the money conversation
  // is not over, so it does not leave the books.
  if (Number(bill.held_amount ?? 0) !== 0) {
    return { ok: false, error: "That bill has an amount held back — release or clear it first." };
  }
  return { ok: true, bill };
}

export type ArchiveStepResult = { ok: true; message: string } | { ok: false; error: string };

/** Step 1 — owner asks to archive; a code goes to his own phone. */
export async function requestBillArchiveOtpAction(billId: string): Promise<ArchiveStepResult> {
  const { profile } = await requireAuth(["owner", "developer"]);
  const gate = await loadArchivable(billId);
  if (!gate.ok) return { ok: false, error: gate.error };

  // The code goes to the phone on the ACTING profile, never to a number
  // supplied by the page — otherwise the OTP would prove nothing.
  const admin = createAdminSupabaseClient();
  const { data: me } = await admin
    .from("profiles")
    .select("phone, full_name")
    .eq("id", profile.id)
    .maybeSingle();
  const phone = (me as { phone: string | null } | null)?.phone ?? "";
  if (!phone) {
    return { ok: false, error: "There is no mobile number on your account, so a code cannot be sent." };
  }

  const issued = await issueActionOtp({
    action: ACTION,
    subjectId: billId,
    requestedBy: profile.id,
    phone,
  });
  if (!issued.ok) return { ok: false, error: issued.error };

  await logAudit(profile.id, "bill_archive_code_sent", "bill", gate.bill.token, {
    bill_id: billId,
    sent_to: issued.sentTo,
  });
  return { ok: true, message: `Code sent to ${issued.sentTo}. It expires in 10 minutes.` };
}

/** Step 2 — the code is typed; the bill leaves the accounts. */
export async function archiveBillAction(
  billId: string,
  code: string,
): Promise<ArchiveStepResult> {
  const { profile } = await requireAuth(["owner", "developer"]);
  const gate = await loadArchivable(billId);
  if (!gate.ok) return { ok: false, error: gate.error };

  const check = await verifyActionOtp({ action: ACTION, subjectId: billId, code });
  if (!check.ok) {
    return {
      ok: false,
      error: check.attemptsLeft != null ? `${check.error} ${check.attemptsLeft} left.` : check.error,
    };
  }

  const admin = createAdminSupabaseClient();
  // .select() so a zero-row update is caught rather than reported as
  // success — Supabase treats "matched nothing" as fine, and a silent
  // no-op here would tell the owner a bill was archived when it wasn't.
  // The archived_at IS NULL guard also makes a double-submit harmless.
  const { data, error } = await admin
    .from("bills")
    .update({
      archived_at: new Date().toISOString(),
      archived_by: profile.id,
      // No reason field any more (Daksh: "remove reason form"). The
      // column stays — the audit row below already records who and
      // when, and the archived-bills page renders a reason if an older
      // row carries one.
      archive_reason: null,
    } as never)
    .eq("id", billId)
    .is("archived_at", null)
    .select("id");
  if (error) return { ok: false, error: error.message };
  if (!data || data.length === 0) return { ok: false, error: "Nothing was archived — reload and try again." };

  await logAudit(profile.id, "bill_archived", "bill", gate.bill.token, {
    bill_id: billId,
    vendor_id: gate.bill.bill_vendor_id,
    amount_total: gate.bill.amount_total,
  });

  revalidatePath("/accounts");
  revalidatePath("/accounts/bills");
  revalidatePath(`/accounts/bills/${billId}`);
  revalidatePath(`/accounts/vendors/${gate.bill.bill_vendor_id}`);
  revalidatePath("/accounts/vendors");
  return { ok: true, message: `Bill ${gate.bill.token} archived.` };
}

/** Developer-only restore. No window, no expiry — an archived bill can
 *  come back years later. No OTP either: putting a bill BACK cannot
 *  lose anything, and the developer is the safety net for the owner's
 *  mistake, so the net should not need a code to reach. */
export async function restoreBillAction(billId: string): Promise<ArchiveStepResult> {
  const { profile } = await requireAuth(["developer"]);
  const admin = createAdminSupabaseClient();

  const { data: found } = await admin
    .from("bills")
    .select("id, token, bill_vendor_id, archived_at")
    .eq("id", billId)
    .maybeSingle();
  const bill = found as { id: string; token: string; bill_vendor_id: string; archived_at: string | null } | null;
  if (!bill) return { ok: false, error: "Bill not found." };
  if (!bill.archived_at) return { ok: false, error: "That bill is not archived." };

  const { data, error } = await admin
    .from("bills")
    .update({ archived_at: null, archived_by: null, archive_reason: null } as never)
    .eq("id", billId)
    .not("archived_at", "is", null)
    .select("id");
  if (error) return { ok: false, error: error.message };
  if (!data || data.length === 0) return { ok: false, error: "Nothing was restored — reload and try again." };

  await logAudit(profile.id, "bill_archive_restored", "bill", bill.token, { bill_id: billId });

  revalidatePath("/accounts");
  revalidatePath("/accounts/bills");
  revalidatePath(`/accounts/bills/${billId}`);
  revalidatePath(`/accounts/vendors/${bill.bill_vendor_id}`);
  revalidatePath("/accounts/vendors");
  revalidatePath("/accounts/archived-bills");
  return { ok: true, message: `Bill ${bill.token} restored.` };
}
