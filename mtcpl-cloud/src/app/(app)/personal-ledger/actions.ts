"use server";

/**
 * Migration 055 — server actions for the personal ledger.
 *
 * Daksh's private accounts-receivable scratchpad. All actions:
 *   1. requireAuth + canUsePersonalLedger gate
 *   2. DB writes scoped to owner_profile_id = profile.id (insert
 *      sets it; every UPDATE / DELETE includes it in WHERE)
 *   3. audit_logs entry prefixed `personal_ledger_*`
 *
 * Mig 056 follow-on — per-party 4-digit PIN: addPartyAction now
 * accepts a `pin` field (required for new parties), setPartyPinAction
 * lets users set / change a party's PIN, and verifyPartyPinAction
 * checks the PIN and issues a session unlock cookie.
 */

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";
import { canUsePersonalLedger } from "@/lib/personal-ledger-permissions";
import {
  buildUnlockToken,
  hashPin,
  unlockCookieName,
  verifyPin,
} from "@/lib/personal-ledger-party-auth";

type ActionResult = { ok: true } | { ok: false; error: string };

function refreshLedgerPaths(partyId?: string) {
  revalidatePath("/personal-ledger");
  revalidatePath("/personal-ledger/buckets");
  if (partyId) revalidatePath(`/personal-ledger/${partyId}`);
}

function txt(fd: FormData, key: string): string {
  const v = fd.get(key);
  return typeof v === "string" ? v.trim() : "";
}

function numOrNaN(fd: FormData, key: string): number {
  const raw = fd.get(key);
  const n = Number(raw);
  return Number.isFinite(n) ? n : NaN;
}

// ── Parties ──────────────────────────────────────────────────────

export async function addPartyAction(formData: FormData): Promise<ActionResult> {
  const { profile } = await requireAuth();
  if (!canUsePersonalLedger(profile)) {
    return { ok: false, error: "Personal ledger access denied." };
  }
  const name = txt(formData, "name");
  const pin = txt(formData, "pin");
  if (!name) return { ok: false, error: "Party name required." };
  if (name.length > 200) return { ok: false, error: "Name too long (max 200)." };
  // Mig 056 — PIN required on every new party. 4 digits only.
  if (!/^\d{4}$/.test(pin)) {
    return { ok: false, error: "Enter a 4-digit PIN." };
  }

  const pinHash = await hashPin(pin);
  const supabase = createAdminSupabaseClient();
  const { data: row, error } = await supabase
    .from("personal_ledger_parties")
    .insert({
      owner_profile_id: profile.id,
      name,
      entry_pin_hash: pinHash,
    })
    .select("id")
    .single();
  if (error) return { ok: false, error: error.message };

  void logAudit(
    profile.id,
    "personal_ledger_party_added",
    "personal_ledger_party",
    row.id,
    // Never log the PIN. Only log that a PIN was set at creation.
    { name, pin_set: true },
  );
  refreshLedgerPaths(row.id);
  return { ok: true };
}

/** Mig 056 — set or replace the PIN for an existing party. Used
 *  for the legacy "BN" party that pre-dates the PIN requirement,
 *  and for any future "change my PIN" UI. */
export async function setPartyPinAction(
  formData: FormData,
): Promise<ActionResult> {
  const { profile } = await requireAuth();
  if (!canUsePersonalLedger(profile)) {
    return { ok: false, error: "Personal ledger access denied." };
  }
  const id = txt(formData, "id");
  const pin = txt(formData, "pin");
  if (!id) return { ok: false, error: "Missing party id." };
  if (!/^\d{4}$/.test(pin)) {
    return { ok: false, error: "Enter a 4-digit PIN." };
  }

  const pinHash = await hashPin(pin);
  const supabase = createAdminSupabaseClient();
  const { data: updated, error } = await supabase
    .from("personal_ledger_parties")
    .update({ entry_pin_hash: pinHash })
    .eq("id", id)
    .eq("owner_profile_id", profile.id)
    .select("id")
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!updated) return { ok: false, error: "Party not found or not yours." };

  // Immediately issue an unlock cookie so the user doesn't have to
  // re-type the PIN they JUST set.
  const cookieStore = await cookies();
  cookieStore.set({
    name: unlockCookieName(id),
    value: buildUnlockToken(profile.id, id),
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    // No maxAge / expires → session cookie → clears on browser close.
  });

  void logAudit(
    profile.id,
    "personal_ledger_party_pin_set",
    "personal_ledger_party",
    id,
    { pin_set: true },
  );
  refreshLedgerPaths(id);
  return { ok: true };
}

/** Mig 056 — verify a party PIN. On success, sets a session
 *  unlock cookie scoped to (profile, party). */
export async function verifyPartyPinAction(
  formData: FormData,
): Promise<ActionResult> {
  const { profile } = await requireAuth();
  if (!canUsePersonalLedger(profile)) {
    return { ok: false, error: "Personal ledger access denied." };
  }
  const id = txt(formData, "id");
  const pin = txt(formData, "pin");
  if (!id) return { ok: false, error: "Missing party id." };
  if (!/^\d{4}$/.test(pin)) {
    return { ok: false, error: "Enter a 4-digit PIN." };
  }

  const supabase = createAdminSupabaseClient();
  const { data: row, error } = await supabase
    .from("personal_ledger_parties")
    .select("id, entry_pin_hash")
    .eq("id", id)
    .eq("owner_profile_id", profile.id)
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!row) return { ok: false, error: "Party not found or not yours." };

  const stored = (row as { entry_pin_hash: string | null }).entry_pin_hash;
  if (!stored) {
    return { ok: false, error: "This party has no PIN set yet." };
  }
  const ok = await verifyPin(pin, stored);
  if (!ok) {
    void logAudit(
      profile.id,
      "personal_ledger_party_pin_failed",
      "personal_ledger_party",
      id,
      {},
    );
    return { ok: false, error: "PIN doesn't match." };
  }

  const cookieStore = await cookies();
  cookieStore.set({
    name: unlockCookieName(id),
    value: buildUnlockToken(profile.id, id),
    httpOnly: true,
    sameSite: "lax",
    path: "/",
  });

  void logAudit(
    profile.id,
    "personal_ledger_party_unlocked",
    "personal_ledger_party",
    id,
    {},
  );
  return { ok: true };
}

export async function renamePartyAction(formData: FormData): Promise<ActionResult> {
  const { profile } = await requireAuth();
  if (!canUsePersonalLedger(profile)) {
    return { ok: false, error: "Personal ledger access denied." };
  }
  const id = txt(formData, "id");
  const name = txt(formData, "name");
  if (!id) return { ok: false, error: "Missing party id." };
  if (!name) return { ok: false, error: "Name required." };

  const supabase = createAdminSupabaseClient();
  const { data: updated, error } = await supabase
    .from("personal_ledger_parties")
    .update({ name })
    .eq("id", id)
    .eq("owner_profile_id", profile.id)
    .select("id, name")
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!updated) return { ok: false, error: "Party not found or not yours." };

  void logAudit(profile.id, "personal_ledger_party_renamed", "personal_ledger_party", id, {
    new_name: name,
  });
  refreshLedgerPaths(id);
  return { ok: true };
}

export async function archivePartyAction(formData: FormData): Promise<ActionResult> {
  const { profile } = await requireAuth();
  if (!canUsePersonalLedger(profile)) {
    return { ok: false, error: "Personal ledger access denied." };
  }
  const id = txt(formData, "id");
  if (!id) return { ok: false, error: "Missing party id." };

  const supabase = createAdminSupabaseClient();
  const { data: updated, error } = await supabase
    .from("personal_ledger_parties")
    .update({ archived_at: new Date().toISOString() })
    .eq("id", id)
    .eq("owner_profile_id", profile.id)
    .is("archived_at", null)
    .select("id")
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!updated) return { ok: false, error: "Party already archived or not yours." };

  void logAudit(profile.id, "personal_ledger_party_archived", "personal_ledger_party", id, {});
  refreshLedgerPaths();
  return { ok: true };
}

// ── Buckets ──────────────────────────────────────────────────────

/** Internal — seeds two default buckets "B" and "C" on first use.
 *  Idempotent: only seeds if the user has zero non-archived rows. */
async function ensureDefaultBuckets(profileId: string): Promise<void> {
  const supabase = createAdminSupabaseClient();
  const { data: existing } = await supabase
    .from("personal_ledger_buckets")
    .select("id")
    .eq("owner_profile_id", profileId)
    .is("archived_at", null)
    .limit(1);
  if ((existing ?? []).length > 0) return;
  await supabase.from("personal_ledger_buckets").insert([
    { owner_profile_id: profileId, label: "B", sort_order: 0 },
    { owner_profile_id: profileId, label: "C", sort_order: 1 },
  ]);
}

export async function addBucketAction(formData: FormData): Promise<ActionResult> {
  const { profile } = await requireAuth();
  if (!canUsePersonalLedger(profile)) {
    return { ok: false, error: "Personal ledger access denied." };
  }
  const label = txt(formData, "label");
  if (!label) return { ok: false, error: "Bucket label required." };
  if (label.length > 60) return { ok: false, error: "Label too long (max 60)." };

  const supabase = createAdminSupabaseClient();
  // Compute next sort_order based on current max.
  const { data: rows } = await supabase
    .from("personal_ledger_buckets")
    .select("sort_order")
    .eq("owner_profile_id", profile.id)
    .order("sort_order", { ascending: false })
    .limit(1);
  const nextOrder = ((rows ?? [])[0]?.sort_order ?? -1) + 1;

  const { data: row, error } = await supabase
    .from("personal_ledger_buckets")
    .insert({ owner_profile_id: profile.id, label, sort_order: nextOrder })
    .select("id")
    .single();
  if (error) return { ok: false, error: error.message };

  void logAudit(profile.id, "personal_ledger_bucket_added", "personal_ledger_bucket", row.id, {
    label,
  });
  refreshLedgerPaths();
  return { ok: true };
}

export async function renameBucketAction(formData: FormData): Promise<ActionResult> {
  const { profile } = await requireAuth();
  if (!canUsePersonalLedger(profile)) {
    return { ok: false, error: "Personal ledger access denied." };
  }
  const id = txt(formData, "id");
  const label = txt(formData, "label");
  if (!id) return { ok: false, error: "Missing bucket id." };
  if (!label) return { ok: false, error: "Label required." };

  const supabase = createAdminSupabaseClient();
  const { data: updated, error } = await supabase
    .from("personal_ledger_buckets")
    .update({ label })
    .eq("id", id)
    .eq("owner_profile_id", profile.id)
    .select("id")
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!updated) return { ok: false, error: "Bucket not found or not yours." };

  void logAudit(profile.id, "personal_ledger_bucket_renamed", "personal_ledger_bucket", id, {
    new_label: label,
  });
  refreshLedgerPaths();
  return { ok: true };
}

export async function archiveBucketAction(formData: FormData): Promise<ActionResult> {
  const { profile } = await requireAuth();
  if (!canUsePersonalLedger(profile)) {
    return { ok: false, error: "Personal ledger access denied." };
  }
  const id = txt(formData, "id");
  if (!id) return { ok: false, error: "Missing bucket id." };

  const supabase = createAdminSupabaseClient();
  const { data: updated, error } = await supabase
    .from("personal_ledger_buckets")
    .update({ archived_at: new Date().toISOString() })
    .eq("id", id)
    .eq("owner_profile_id", profile.id)
    .is("archived_at", null)
    .select("id")
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!updated) return { ok: false, error: "Bucket already archived or not yours." };

  void logAudit(profile.id, "personal_ledger_bucket_archived", "personal_ledger_bucket", id, {});
  refreshLedgerPaths();
  return { ok: true };
}

// Public helper called from the buckets page server component to
// auto-seed defaults on first visit.
export async function ensureDefaultBucketsAction(): Promise<ActionResult> {
  const { profile } = await requireAuth();
  if (!canUsePersonalLedger(profile)) {
    return { ok: false, error: "Personal ledger access denied." };
  }
  await ensureDefaultBuckets(profile.id);
  refreshLedgerPaths();
  return { ok: true };
}

// ── Invoices ─────────────────────────────────────────────────────

type InvoiceItem = {
  description: string;
  stone_type: string;
  unit: "sft" | "cft";
  quantity: number;
  rate: number;
  line_total: number;
};

function parseItems(raw: unknown): InvoiceItem[] | string {
  if (typeof raw !== "string") return "Missing items.";
  let arr: unknown;
  try {
    arr = JSON.parse(raw);
  } catch {
    return "Items JSON malformed.";
  }
  if (!Array.isArray(arr)) return "Items must be an array.";
  if (arr.length === 0) return "At least one item required.";
  const out: InvoiceItem[] = [];
  for (const it of arr) {
    if (typeof it !== "object" || it == null) return "Invalid item entry.";
    const o = it as Record<string, unknown>;
    const description = typeof o.description === "string" ? o.description.trim() : "";
    const stone_type = typeof o.stone_type === "string" ? o.stone_type.trim() : "";
    const unit = o.unit === "sft" || o.unit === "cft" ? o.unit : null;
    const quantity = Number(o.quantity);
    const rate = Number(o.rate);
    if (!description) return "Item description required.";
    if (!unit) return "Unit must be sft or cft.";
    if (!Number.isFinite(quantity) || quantity <= 0) return "Quantity must be > 0.";
    if (!Number.isFinite(rate) || rate < 0) return "Rate must be ≥ 0.";
    const line_total = Number((quantity * rate).toFixed(2));
    out.push({ description, stone_type, unit, quantity, rate, line_total });
  }
  return out;
}

export async function addInvoiceAction(formData: FormData): Promise<ActionResult> {
  const { profile } = await requireAuth();
  if (!canUsePersonalLedger(profile)) {
    return { ok: false, error: "Personal ledger access denied." };
  }

  const partyId = txt(formData, "party_id");
  const invoiceNo = txt(formData, "invoice_no");
  const invoiceDate = txt(formData, "invoice_date");
  const gstAmount = numOrNaN(formData, "gst_amount");
  const notes = txt(formData, "notes") || null;

  if (!partyId) return { ok: false, error: "Missing party id." };
  if (!invoiceNo) return { ok: false, error: "Invoice number required." };
  if (!invoiceDate || !/^\d{4}-\d{2}-\d{2}$/.test(invoiceDate)) {
    return { ok: false, error: "Invoice date required (YYYY-MM-DD)." };
  }
  if (!Number.isFinite(gstAmount) || gstAmount < 0) {
    return { ok: false, error: "GST amount must be ≥ 0 (use 0 if not applicable)." };
  }

  const items = parseItems(formData.get("items_json"));
  if (typeof items === "string") return { ok: false, error: items };
  const subtotal = Number(items.reduce((s, it) => s + it.line_total, 0).toFixed(2));

  // Confirm the party belongs to this user before inserting.
  const supabase = createAdminSupabaseClient();
  const { data: party, error: partyErr } = await supabase
    .from("personal_ledger_parties")
    .select("id, name")
    .eq("id", partyId)
    .eq("owner_profile_id", profile.id)
    .maybeSingle();
  if (partyErr) return { ok: false, error: partyErr.message };
  if (!party) return { ok: false, error: "Party not found or not yours." };

  const { data: row, error: insErr } = await supabase
    .from("personal_ledger_invoices")
    .insert({
      party_id: partyId,
      owner_profile_id: profile.id,
      invoice_no: invoiceNo,
      invoice_date: invoiceDate,
      items_json: items,
      subtotal,
      gst_amount: gstAmount,
      notes,
    })
    .select("id")
    .single();
  if (insErr) return { ok: false, error: insErr.message };

  void logAudit(
    profile.id,
    "personal_ledger_invoice_added",
    "personal_ledger_invoice",
    row.id,
    {
      party_id: partyId,
      party_name: (party as { name?: string }).name,
      invoice_no: invoiceNo,
      subtotal,
      gst_amount: gstAmount,
      total: subtotal + gstAmount,
    },
  );
  refreshLedgerPaths(partyId);
  return { ok: true };
}

export async function cancelInvoiceAction(formData: FormData): Promise<ActionResult> {
  const { profile } = await requireAuth();
  if (!canUsePersonalLedger(profile)) {
    return { ok: false, error: "Personal ledger access denied." };
  }
  const id = txt(formData, "id");
  const reason = txt(formData, "reason") || null;
  if (!id) return { ok: false, error: "Missing invoice id." };

  const supabase = createAdminSupabaseClient();
  const { data: updated, error } = await supabase
    .from("personal_ledger_invoices")
    .update({
      cancelled_at: new Date().toISOString(),
      cancel_reason: reason,
    })
    .eq("id", id)
    .eq("owner_profile_id", profile.id)
    .is("cancelled_at", null)
    .select("id, party_id, invoice_no, total")
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!updated) return { ok: false, error: "Invoice already cancelled or not yours." };

  void logAudit(
    profile.id,
    "personal_ledger_invoice_cancelled",
    "personal_ledger_invoice",
    id,
    {
      party_id: (updated as { party_id?: string }).party_id,
      invoice_no: (updated as { invoice_no?: string }).invoice_no,
      total: Number((updated as { total?: number }).total ?? 0),
      reason,
    },
  );
  refreshLedgerPaths((updated as { party_id?: string }).party_id);
  return { ok: true };
}

// ── Receipts ─────────────────────────────────────────────────────

export async function addReceiptAction(formData: FormData): Promise<ActionResult> {
  const { profile } = await requireAuth();
  if (!canUsePersonalLedger(profile)) {
    return { ok: false, error: "Personal ledger access denied." };
  }

  const partyId = txt(formData, "party_id");
  const bucketId = txt(formData, "bucket_id");
  const amount = numOrNaN(formData, "amount");
  const receiptDate = txt(formData, "receipt_date");
  const note = txt(formData, "note") || null;

  if (!partyId) return { ok: false, error: "Missing party id." };
  if (!bucketId) return { ok: false, error: "Pick a bucket." };
  if (!Number.isFinite(amount) || amount <= 0) {
    return { ok: false, error: "Amount must be > 0." };
  }
  if (!receiptDate || !/^\d{4}-\d{2}-\d{2}$/.test(receiptDate)) {
    return { ok: false, error: "Receipt date required (YYYY-MM-DD)." };
  }

  const supabase = createAdminSupabaseClient();
  // Confirm party + bucket both belong to this user.
  const [{ data: party }, { data: bucket }] = await Promise.all([
    supabase
      .from("personal_ledger_parties")
      .select("id, name")
      .eq("id", partyId)
      .eq("owner_profile_id", profile.id)
      .maybeSingle(),
    supabase
      .from("personal_ledger_buckets")
      .select("id, label")
      .eq("id", bucketId)
      .eq("owner_profile_id", profile.id)
      .maybeSingle(),
  ]);
  if (!party) return { ok: false, error: "Party not found or not yours." };
  if (!bucket) return { ok: false, error: "Bucket not found or not yours." };

  const { data: row, error: insErr } = await supabase
    .from("personal_ledger_receipts")
    .insert({
      party_id: partyId,
      owner_profile_id: profile.id,
      bucket_id: bucketId,
      amount,
      receipt_date: receiptDate,
      note,
    })
    .select("id")
    .single();
  if (insErr) return { ok: false, error: insErr.message };

  void logAudit(
    profile.id,
    "personal_ledger_receipt_added",
    "personal_ledger_receipt",
    row.id,
    {
      party_id: partyId,
      party_name: (party as { name?: string }).name,
      bucket_id: bucketId,
      bucket_label: (bucket as { label?: string }).label,
      amount,
      receipt_date: receiptDate,
    },
  );
  refreshLedgerPaths(partyId);
  return { ok: true };
}

export async function cancelReceiptAction(formData: FormData): Promise<ActionResult> {
  const { profile } = await requireAuth();
  if (!canUsePersonalLedger(profile)) {
    return { ok: false, error: "Personal ledger access denied." };
  }
  const id = txt(formData, "id");
  const reason = txt(formData, "reason") || null;
  if (!id) return { ok: false, error: "Missing receipt id." };

  const supabase = createAdminSupabaseClient();
  const { data: updated, error } = await supabase
    .from("personal_ledger_receipts")
    .update({
      cancelled_at: new Date().toISOString(),
      cancel_reason: reason,
    })
    .eq("id", id)
    .eq("owner_profile_id", profile.id)
    .is("cancelled_at", null)
    .select("id, party_id, amount")
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!updated) return { ok: false, error: "Receipt already cancelled or not yours." };

  void logAudit(
    profile.id,
    "personal_ledger_receipt_cancelled",
    "personal_ledger_receipt",
    id,
    {
      party_id: (updated as { party_id?: string }).party_id,
      amount: Number((updated as { amount?: number }).amount ?? 0),
      reason,
    },
  );
  refreshLedgerPaths((updated as { party_id?: string }).party_id);
  return { ok: true };
}
