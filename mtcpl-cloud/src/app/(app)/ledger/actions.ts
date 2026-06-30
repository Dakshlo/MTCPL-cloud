"use server";

/**
 * Personal-ledger actions (mig 174 — Daksh, private).
 *
 * addLedgerEntryAction — one receive/pay on Home or Office. If "to whom" is the
 * other account (OFFICE on a Home entry, HOME on an Office entry) it becomes a
 * Home<->Office TRANSFER: a linked pair (one entry per account). A MANAGER
 * receiving from Home debits Home → needs owner approval (both halves stay
 * pending). Everything else is immediate.
 *
 * approve/rejectLedgerTransferAction — owner (or developer) signs off / declines
 * a pending transfer; approve flips both halves to confirmed.
 */

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";
import { ledgerScope } from "@/lib/ledger-access";

function txt(fd: FormData, k: string): string {
  const v = fd.get(k);
  return v == null ? "" : String(v);
}

export async function addLedgerEntryAction(formData: FormData): Promise<void> {
  const { profile } = await requireAuth();
  const scope = ledgerScope(profile);
  if (!scope) redirect("/");
  const admin = createAdminSupabaseClient();

  const account = txt(formData, "account") === "home" ? "home" : "office";
  // Scope gate: a manager (office scope) may only touch the Office account; the
  // Home account is owner/developer (both) only.
  if (scope === "office" && account !== "office") redirect("/ledger");
  if (account === "home" && scope !== "both") redirect("/ledger");

  const direction = txt(formData, "direction") === "pay" ? "pay" : "receive";
  const amount = Math.round((Number(txt(formData, "amount")) || 0) * 100) / 100;
  // Lower + upper bound (numeric(14,2) max) + finiteness — a bad value must never
  // slip through to a failed insert that we'd otherwise report as success.
  if (!Number.isFinite(amount) || amount <= 0 || amount > 999999999999.99) {
    redirect(`/ledger?toast=${encodeURIComponent("Enter a valid amount")}`);
  }
  const counterparty = txt(formData, "counterparty").trim();
  const note = txt(formData, "note").trim() || null;

  // Transfer when "to whom" is the OTHER account keyword.
  const cp = counterparty.toUpperCase();
  const isTransfer = (account === "home" && cp === "OFFICE") || (account === "office" && cp === "HOME");

  if (!isTransfer) {
    const { error } = await admin.from("personal_ledger_entries").insert({
      account, direction, amount,
      counterparty: counterparty || "—",
      note, status: "confirmed", is_transfer: false, created_by: profile.id,
    });
    if (error) redirect(`/ledger?toast=${encodeURIComponent("Could not save — try again")}`);
    void logAudit(profile.id, "ledger_entry_add", "personal_ledger", account, { direction, amount });
    revalidatePath("/ledger");
    redirect(`/ledger?toast=${encodeURIComponent("Entry added")}`);
  }

  // --- Home <-> Office transfer (a linked pair). ---
  const other = account === "home" ? "office" : "home";
  const peerDirection = direction === "pay" ? "receive" : "pay";
  // counterparty shown on each half = the OTHER account's name.
  const thisCp = account === "home" ? "OFFICE" : "HOME";
  const peerCp = account === "home" ? "HOME" : "OFFICE";

  // Approval needed ONLY when the MANAGER (office scope) is RECEIVING from Home —
  // that debits Home, which is the owner's money. Owner/developer transfers and
  // the manager paying INTO home are immediate.
  const needsApproval = scope === "office" && account === "office" && direction === "receive";
  const status = needsApproval ? "pending" : "confirmed";
  const group = crypto.randomUUID();

  const { error } = await admin.from("personal_ledger_entries").insert([
    { account, direction, amount, counterparty: thisCp, note, status, is_transfer: true, transfer_group: group, requires_approval: needsApproval, created_by: profile.id },
    { account: other, direction: peerDirection, amount, counterparty: peerCp, note, status, is_transfer: true, transfer_group: group, requires_approval: needsApproval, created_by: profile.id },
  ]);
  if (error) redirect(`/ledger?toast=${encodeURIComponent("Could not save — try again")}`);
  void logAudit(profile.id, "ledger_transfer_add", "personal_ledger", group, { from: account, direction, amount, needsApproval });
  revalidatePath("/ledger");
  redirect(`/ledger?toast=${encodeURIComponent(needsApproval ? "Sent for owner approval" : "Transfer recorded")}`);
}

export async function approveLedgerTransferAction(formData: FormData): Promise<void> {
  const { profile } = await requireAuth();
  if (ledgerScope(profile) !== "both") redirect("/"); // owner / developer only
  const admin = createAdminSupabaseClient();
  const group = txt(formData, "group");
  if (!group) redirect("/ledger");
  const { error } = await admin
    .from("personal_ledger_entries")
    .update({ status: "confirmed", approved_by: profile.id, approved_at: new Date().toISOString() })
    .eq("transfer_group", group)
    .eq("status", "pending");
  if (error) redirect(`/ledger?toast=${encodeURIComponent("Could not approve — try again")}`);
  void logAudit(profile.id, "ledger_transfer_approve", "personal_ledger", group, {});
  revalidatePath("/ledger");
  redirect(`/ledger?toast=${encodeURIComponent("Approved")}`);
}

export async function rejectLedgerTransferAction(formData: FormData): Promise<void> {
  const { profile } = await requireAuth();
  if (ledgerScope(profile) !== "both") redirect("/");
  const admin = createAdminSupabaseClient();
  const group = txt(formData, "group");
  if (!group) redirect("/ledger");
  const { error } = await admin
    .from("personal_ledger_entries")
    .update({ status: "rejected", rejected_by: profile.id, rejected_at: new Date().toISOString() })
    .eq("transfer_group", group)
    .eq("status", "pending");
  if (error) redirect(`/ledger?toast=${encodeURIComponent("Could not reject — try again")}`);
  void logAudit(profile.id, "ledger_transfer_reject", "personal_ledger", group, {});
  revalidatePath("/ledger");
  redirect(`/ledger?toast=${encodeURIComponent("Rejected")}`);
}
