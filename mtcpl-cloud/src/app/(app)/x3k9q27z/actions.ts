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
import { chunkIds } from "@/lib/paginate";

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
  if (scope === "office" && account !== "office") redirect("/x3k9q27z");
  if (account === "home" && scope !== "both") redirect("/x3k9q27z");

  // Direction is now a REQUIRED explicit choice (no default receive).
  const direction = txt(formData, "direction");
  if (direction !== "receive" && direction !== "pay") {
    redirect(`/x3k9q27z?toast=${encodeURIComponent("Choose Receive or Pay")}`);
  }
  // The amount field arrives Indian-grouped (e.g. "1,00,000.50") — strip commas.
  const amount = Math.round((Number(txt(formData, "amount").replace(/,/g, "")) || 0) * 100) / 100;
  // Lower + upper bound (numeric(14,2) max) + finiteness — a bad value must never
  // slip through to a failed insert that we'd otherwise report as success.
  if (!Number.isFinite(amount) || amount <= 0 || amount > 999999999999.99) {
    redirect(`/x3k9q27z?toast=${encodeURIComponent("Enter a valid amount")}`);
  }
  const counterparty = txt(formData, "counterparty").trim();
  if (!counterparty) {
    redirect(`/x3k9q27z?toast=${encodeURIComponent("Choose who this is with")}`);
  }
  // Note is MANDATORY now (Naresh) — every entry must say what it's for.
  const note = txt(formData, "note").trim();
  if (!note) {
    redirect(`/x3k9q27z?toast=${encodeURIComponent("Write a note — it's required")}`);
  }

  // Transfer when "to whom" is the OTHER account keyword.
  const cp = counterparty.toUpperCase();
  const isTransfer = (account === "home" && cp === "OFFICE") || (account === "office" && cp === "HOME");

  // ANY entry made by the MANAGER (office scope) needs owner approval — receive
  // OR pay, transfer OR local (Daksh). Owner/developer entries are immediate.
  const needsApproval = scope === "office";

  if (!isTransfer) {
    const status = needsApproval ? "pending" : "confirmed";
    const { error } = await admin.from("personal_ledger_entries").insert({
      account, direction, amount,
      counterparty: counterparty || "—",
      note, status, is_transfer: false, requires_approval: needsApproval, created_by: profile.id,
    });
    if (error) redirect(`/x3k9q27z?toast=${encodeURIComponent("Could not save — try again")}`);
    void logAudit(profile.id, "ledger_entry_add", "personal_ledger", account, { direction, amount, needsApproval });
    revalidatePath("/x3k9q27z");
    redirect(`/x3k9q27z?toast=${encodeURIComponent(needsApproval ? "Sent for owner approval" : "Entry added")}`);
  }

  // --- Home <-> Office transfer (a linked pair). ---
  const other = account === "home" ? "office" : "home";
  const peerDirection = direction === "pay" ? "receive" : "pay";
  // counterparty shown on each half = the OTHER account's name.
  const thisCp = account === "home" ? "OFFICE" : "HOME";
  const peerCp = account === "home" ? "HOME" : "OFFICE";

  const status = needsApproval ? "pending" : "confirmed";
  const group = crypto.randomUUID();

  const { error } = await admin.from("personal_ledger_entries").insert([
    { account, direction, amount, counterparty: thisCp, note, status, is_transfer: true, transfer_group: group, requires_approval: needsApproval, created_by: profile.id },
    { account: other, direction: peerDirection, amount, counterparty: peerCp, note, status, is_transfer: true, transfer_group: group, requires_approval: needsApproval, created_by: profile.id },
  ]);
  if (error) redirect(`/x3k9q27z?toast=${encodeURIComponent("Could not save — try again")}`);
  void logAudit(profile.id, "ledger_transfer_add", "personal_ledger", group, { from: account, direction, amount, needsApproval });
  revalidatePath("/x3k9q27z");
  redirect(`/x3k9q27z?toast=${encodeURIComponent(needsApproval ? "Sent for owner approval" : "Transfer recorded")}`);
}

export async function approveLedgerTransferAction(formData: FormData): Promise<void> {
  const { profile } = await requireAuth();
  if (ledgerScope(profile) !== "both") redirect("/"); // owner / developer only
  const admin = createAdminSupabaseClient();
  const group = txt(formData, "group");
  const id = txt(formData, "id");
  if (!group && !id) redirect("/x3k9q27z");
  const base = admin
    .from("personal_ledger_entries")
    .update({ status: "confirmed", approved_by: profile.id, approved_at: new Date().toISOString() })
    .eq("status", "pending");
  const { error } = group ? await base.eq("transfer_group", group) : await base.eq("id", id);
  if (error) redirect(`/x3k9q27z?toast=${encodeURIComponent("Could not approve — try again")}`);
  void logAudit(profile.id, "ledger_transfer_approve", "personal_ledger", group, {});
  revalidatePath("/x3k9q27z");
  redirect(`/x3k9q27z?toast=${encodeURIComponent("Approved")}`);
}

/** Cancel (permanently delete) an entry — owner/developer only. If it's part of
 *  a transfer, BOTH halves go so the two balances stay consistent. */
export async function deleteLedgerEntryAction(formData: FormData): Promise<void> {
  const { profile } = await requireAuth();
  if (ledgerScope(profile) !== "both") redirect("/"); // owner / developer only
  const admin = createAdminSupabaseClient();
  const id = txt(formData, "id");
  if (!id) redirect("/x3k9q27z");
  const { data: row } = await admin.from("personal_ledger_entries").select("transfer_group").eq("id", id).maybeSingle();
  const group = (row as { transfer_group: string | null } | null)?.transfer_group ?? null;
  const { error } = group
    ? await admin.from("personal_ledger_entries").delete().eq("transfer_group", group)
    : await admin.from("personal_ledger_entries").delete().eq("id", id);
  if (error) redirect(`/x3k9q27z?toast=${encodeURIComponent("Could not cancel — try again")}`);
  void logAudit(profile.id, "ledger_entry_delete", "personal_ledger", group ?? id, {});
  revalidatePath("/x3k9q27z");
  redirect(`/x3k9q27z?toast=${encodeURIComponent("Entry cancelled")}`);
}

export async function rejectLedgerTransferAction(formData: FormData): Promise<void> {
  const { profile } = await requireAuth();
  if (ledgerScope(profile) !== "both") redirect("/");
  const admin = createAdminSupabaseClient();
  const group = txt(formData, "group");
  const id = txt(formData, "id");
  if (!group && !id) redirect("/x3k9q27z");
  const base = admin
    .from("personal_ledger_entries")
    .update({ status: "rejected", rejected_by: profile.id, rejected_at: new Date().toISOString() })
    .eq("status", "pending");
  const { error } = group ? await base.eq("transfer_group", group) : await base.eq("id", id);
  if (error) redirect(`/x3k9q27z?toast=${encodeURIComponent("Could not reject — try again")}`);
  void logAudit(profile.id, "ledger_transfer_reject", "personal_ledger", group, {});
  revalidatePath("/x3k9q27z");
  redirect(`/x3k9q27z?toast=${encodeURIComponent("Rejected")}`);
}

/**
 * Wipe the ledger's HISTORY, keep its truth (Daksh, Aug 2026): "delete
 * all details — entries to 0 in both Office and Home — but the current
 * balance in both stays the same."
 *
 * A balance here is nothing but the sum of confirmed entries, so
 * "no entries + same balance" is squared by NETTING: each account gets
 * ONE fresh confirmed "Balance carried forward" entry equal to its
 * confirmed balance today, and every OLDER row — confirmed, pending,
 * transfer halves, all of it — is permanently deleted. After the wipe
 * each card shows exactly one line and the same figure it showed
 * before.
 *
 * Safety, in layers:
 *  • owner-Naresh / developer only (scope "both") — the manager never
 *    sees or reaches this;
 *  • the SERVER requires the typed word WIPE (the UI's three-step
 *    confirmation ends in it) — a stray form post without it bounces;
 *  • carry-forward rows are inserted BEFORE the old rows are deleted,
 *    and the delete targets only ids captured at the start. If it
 *    fails halfway the balance reads high (old + carry) — ugly but
 *    recoverable: running the wipe again converges, because the next
 *    run recomputes the true balance and its captured-id list includes
 *    the earlier carry row. Deleting first could lose the balance
 *    forever; that order is never acceptable here.
 *  • the audit log records counts + both balances.
 */
export async function wipeLedgerHistoryAction(formData: FormData): Promise<void> {
  const { profile } = await requireAuth();
  if (ledgerScope(profile) !== "both") redirect("/"); // owner / developer only

  if (txt(formData, "confirm").trim().toUpperCase() !== "WIPE") {
    redirect(`/x3k9q27z?toast=${encodeURIComponent("Wipe not confirmed — type WIPE to proceed")}`);
  }

  const admin = createAdminSupabaseClient();

  // Everything as of THIS moment — the delete below touches only these
  // ids, never rows added while the wipe runs.
  const { data: rowsRaw, error: loadErr } = await admin
    .from("personal_ledger_entries")
    .select("id, account, direction, amount, status");
  if (loadErr) redirect(`/x3k9q27z?toast=${encodeURIComponent("Could not load entries — nothing was changed")}`);
  const rows = (rowsRaw ?? []) as Array<{
    id: string;
    account: "home" | "office";
    direction: "receive" | "pay";
    amount: number | string;
    status: string;
  }>;
  if (rows.length === 0) {
    redirect(`/x3k9q27z?toast=${encodeURIComponent("Nothing to wipe — the ledger is already empty")}`);
  }

  const balanceOf = (acc: "home" | "office") =>
    Math.round(
      rows
        .filter((r) => r.account === acc && r.status === "confirmed")
        .reduce((s, r) => s + (r.direction === "receive" ? Number(r.amount) : -Number(r.amount)), 0) * 100,
    ) / 100;
  const balances = { home: balanceOf("home"), office: balanceOf("office") };

  const todayIst = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());

  // The dev-bypass mock id is not a uuid — created_by must not 22P02
  // the one insert this whole feature depends on.
  const uid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(profile.id)
    ? profile.id
    : null;

  const carries = (["home", "office"] as const)
    .filter((acc) => Math.abs(balances[acc]) >= 0.005)
    .map((acc) => ({
      account: acc,
      direction: balances[acc] >= 0 ? ("receive" as const) : ("pay" as const),
      amount: Math.abs(balances[acc]),
      counterparty: "—",
      note: `Balance carried forward (old entries wiped ${todayIst})`,
      status: "confirmed" as const,
      is_transfer: false,
      requires_approval: false,
      created_by: uid,
    }));

  if (carries.length > 0) {
    const { error: insErr } = await admin.from("personal_ledger_entries").insert(carries);
    if (insErr) {
      redirect(`/x3k9q27z?toast=${encodeURIComponent("Could not write the carried-forward balance — NOTHING was deleted")}`);
    }
  }

  // Old rows only, in URL-safe chunks. A chunk failure leaves the rest
  // for a re-run (see header note on convergence).
  for (const chunk of chunkIds(rows.map((r) => r.id))) {
    const { error: delErr } = await admin.from("personal_ledger_entries").delete().in("id", chunk);
    if (delErr) {
      redirect(
        `/x3k9q27z?toast=${encodeURIComponent("Wipe stopped partway — balances are safe but some old entries remain. Run it again.")}`,
      );
    }
  }

  void logAudit(profile.id, "ledger_history_wipe", "personal_ledger", "all", {
    deleted: rows.length,
    home_balance: balances.home,
    office_balance: balances.office,
  });
  revalidatePath("/x3k9q27z");
  redirect(
    `/x3k9q27z?toast=${encodeURIComponent(
      `History wiped — ${rows.length} entries removed, both balances carried forward`,
    )}`,
  );
}
