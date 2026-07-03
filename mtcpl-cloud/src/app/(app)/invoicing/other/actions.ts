"use server";

/**
 * "Other Sales" server actions (mig 176) — non-temple challans that convert to
 * invoices. A row in `other_challans` is the challan; converting stamps an INV
 * number from the SHARED per-FY INV counter (doc_counters / next_doc_seq), so
 * every invoice (temple + bulk + other) stays on one continuous series.
 */

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";
import { canUseInvoicing } from "@/lib/invoicing-permissions";
import { financialYear } from "@/lib/doc-code";
import { freeInvoiceNumber } from "@/lib/invoice-numbers";

function txt(fd: FormData, key: string): string {
  const v = fd.get(key);
  return typeof v === "string" ? v.trim() : "";
}

function refresh(id?: string) {
  revalidatePath("/invoicing/other");
  revalidatePath("/invoicing/invoices");
  revalidatePath("/invoicing");
  if (id) revalidatePath(`/invoicing/other/${id}/print`);
}

type ItemIn = { particulars: string | null; hsn: string | null; unit: string | null; quantity: number | null; rate: number | null; amount: number | null; section_index: number; section_head: string | null };

/** Parse the JSON line-item array; drop wholly-empty rows; recompute amount.
 *  Carries the table/head grouping (mig 183). */
function parseItems(fd: FormData): ItemIn[] {
  let raw: unknown = [];
  try { raw = JSON.parse(txt(fd, "items") || "[]"); } catch { raw = []; }
  const out: ItemIn[] = [];
  for (const r of Array.isArray(raw) ? raw : []) {
    const it = r as Record<string, unknown>;
    const particulars = String(it?.particulars ?? "").trim();
    const qty = Number(it?.quantity) || 0;
    const rate = Number(it?.rate) || 0;
    const amount = Math.round((Number(it?.amount) || qty * rate) * 100) / 100;
    if (!particulars && !amount && !qty) continue; // skip blank line
    out.push({
      particulars: particulars || null,
      hsn: String(it?.hsn ?? "").trim() || null,
      unit: String(it?.unit ?? "").trim() || null,
      quantity: qty || null,
      rate: rate || null,
      amount: amount || null,
      section_index: Number(it?.section_index) || 0,
      section_head: String(it?.section_head ?? "").trim() || null,
    });
  }
  return out;
}

function readGst(fd: FormData) {
  const gm = txt(fd, "gst_mode");
  const gstMode = gm === "igst" || gm === "cgst_sgst" ? gm : null;
  return {
    gst_mode: gstMode,
    igst_percent: gstMode === "igst" ? Number(txt(fd, "igst_percent")) || 0 : null,
    cgst_percent: gstMode === "cgst_sgst" ? Number(txt(fd, "cgst_percent")) || 0 : null,
    sgst_percent: gstMode === "cgst_sgst" ? Number(txt(fd, "sgst_percent")) || 0 : null,
  };
}

async function writeItems(admin: ReturnType<typeof createAdminSupabaseClient>, challanId: string, items: ItemIn[]) {
  if (items.length === 0) return;
  const rows = items.map((it, i) => ({ other_challan_id: challanId, position: i, ...it }));
  const { error } = await admin.from("other_challan_items").insert(rows);
  // Fall back without the section cols if mig 183 isn't applied yet.
  if (error) await admin.from("other_challan_items").insert(rows.map(({ section_index: _si, section_head: _sh, ...rest }) => rest));
}

/** Create a new "other" challan (CH-<fy>-<n>, shared series) with line items. */
export async function createOtherChallanAction(formData: FormData) {
  const { profile } = await requireAuth();
  if (!canUseInvoicing(profile)) redirect("/invoicing?toast=Access+denied");
  const admin = createAdminSupabaseClient();

  const partyId = txt(formData, "party_id");
  if (!partyId) redirect("/invoicing/other?toast=Pick+a+client");
  const items = parseItems(formData);
  if (items.length === 0) redirect("/invoicing/other?toast=Add+at+least+one+line+item");

  const challanDate = txt(formData, "challan_date") || null;
  const fy = financialYear(challanDate || new Date());
  // Share the SAME per-FY challan counter as dispatch challans (mig 168), so the
  // number continues the CH-<fy>-n series instead of a separate OC one (Daksh).
  let docSeq: number | null = null;
  try {
    const { data: seq } = await admin.rpc("next_doc_seq", { p_fy: fy });
    if (typeof seq === "number") docSeq = seq;
  } catch { /* counter unavailable — leave null */ }

  const { data: row, error } = await admin
    .from("other_challans")
    .insert({
      party_id: partyId,
      challan_date: challanDate ?? undefined,
      doc_fy: docSeq != null ? fy : null,
      doc_seq: docSeq,
      ...readGst(formData),
      notes: txt(formData, "notes") || null,
      created_by: profile.id,
    })
    .select("id")
    .single();
  if (error || !row) redirect(`/invoicing/other?toast=${encodeURIComponent(error?.message || "Failed to create challan")}`);
  const id = (row as { id: string }).id;
  await writeItems(admin, id, items);

  await logAudit(profile.id, "other_challan_created", "other_challan", id, { fy, docSeq });
  refresh(id);
  redirect(`/invoicing/other?toast=${encodeURIComponent(`Challan created — CH-${fy}-${String(docSeq ?? 0).padStart(2, "0")}`)}`);
}

/** Edit an unconverted challan (replaces its line items). */
export async function updateOtherChallanAction(formData: FormData) {
  const { profile } = await requireAuth();
  if (!canUseInvoicing(profile)) redirect("/invoicing?toast=Access+denied");
  const admin = createAdminSupabaseClient();

  const id = txt(formData, "other_challan_id");
  if (!id) redirect("/invoicing/other");
  const { data: g } = await admin.from("other_challans").select("converted_at, cancelled_at").eq("id", id).maybeSingle();
  const guard = g as { converted_at: string | null; cancelled_at: string | null } | null;
  if (!guard) redirect("/invoicing/other?toast=Challan+not+found");
  // Jul 2026 — "Edit invoice": a converted (invoiced) other-sales bill may be
  // re-edited; the INV number never changes.
  const editMode = txt(formData, "edit_mode") === "1" && !!guard.converted_at;
  if (guard.converted_at && !editMode) redirect(`/invoicing/other?toast=${encodeURIComponent("Already an invoice — open it in Edit mode")}`);
  if (guard.cancelled_at) redirect(`/invoicing/other?toast=${encodeURIComponent("Challan is cancelled")}`);

  const items = parseItems(formData);
  if (items.length === 0) redirect("/invoicing/other?toast=Add+at+least+one+line+item");
  const partyId = txt(formData, "party_id");

  await admin
    .from("other_challans")
    .update({
      ...(partyId ? { party_id: partyId } : {}),
      ...(txt(formData, "challan_date") ? { challan_date: txt(formData, "challan_date") } : {}),
      ...readGst(formData),
      notes: txt(formData, "notes") || null,
    })
    .eq("id", id);
  await admin.from("other_challan_items").delete().eq("other_challan_id", id);
  await writeItems(admin, id, items);

  await logAudit(profile.id, "other_challan_updated", "other_challan", id, {});
  refresh(id);
  redirect(`/invoicing/other?toast=${encodeURIComponent("Challan updated")}`);
}

/** Convert a challan to an invoice — assign INV-<fy>-<n> on the shared counter.
 *  A manual XX bumps the counter so the next auto number continues after it. */
export async function convertOtherChallanAction(formData: FormData) {
  const { profile } = await requireAuth();
  if (!canUseInvoicing(profile)) redirect("/invoicing?toast=Access+denied");
  const admin = createAdminSupabaseClient();

  const id = txt(formData, "other_challan_id");
  if (!id) redirect("/invoicing/other");
  const { data: c } = await admin.from("other_challans").select("converted_at, cancelled_at, challan_date").eq("id", id).maybeSingle();
  const row = c as { converted_at: string | null; cancelled_at: string | null; challan_date: string | null } | null;
  if (!row) redirect("/invoicing/other?toast=Challan+not+found");
  if (row.cancelled_at) redirect(`/invoicing/other?toast=${encodeURIComponent("Challan is cancelled")}`);
  if (row.converted_at) redirect(`/invoicing/other?toast=${encodeURIComponent("Already converted")}`);

  const fy = financialYear(row.challan_date || new Date());
  // LOCKED number (Daksh Jul 2026) — always the next auto from the shared counter.
  let invSeq: number | null = null;
  try {
    const { data: seq } = await admin.rpc("next_doc_seq", { p_fy: `INV:${fy}` });
    if (typeof seq === "number") invSeq = seq;
  } catch { /* counter unavailable */ }

  await admin
    .from("other_challans")
    .update({ inv_fy: invSeq != null ? fy : null, inv_seq: invSeq, converted_at: new Date().toISOString(), converted_by: profile.id })
    .eq("id", id);

  await logAudit(profile.id, "other_challan_converted", "other_challan", id, { fy, invSeq });
  refresh(id);
  redirect(`/invoicing/other?toast=${encodeURIComponent(`Invoice created — INV-${fy}-${String(invSeq ?? 0).padStart(2, "0")}`)}`);
}

/** Cancel an OTHER-SALES invoice: free its number; the challan reverts to its
 *  unconverted state on the Other Sales page (mig 178). */
export async function cancelOtherInvoiceAction(formData: FormData) {
  const { profile } = await requireAuth(["owner", "developer", "accountant_star"]);
  const admin = createAdminSupabaseClient();
  const id = txt(formData, "other_challan_id");
  if (!id) redirect("/invoicing/invoices");

  const { data: c } = await admin.from("other_challans").select("inv_fy, inv_seq, converted_at, cancelled_at").eq("id", id).maybeSingle();
  const ch = c as { inv_fy: string | null; inv_seq: number | null; converted_at: string | null; cancelled_at: string | null } | null;
  if (!ch || !ch.converted_at) redirect("/invoicing/invoices?toast=Invoice+not+found");
  if (ch!.cancelled_at) redirect(`/invoicing/invoices?toast=${encodeURIComponent("Challan is cancelled")}`);

  await freeInvoiceNumber(admin, ch!.inv_fy, ch!.inv_seq, profile.id);
  await admin.from("other_challans").update({ inv_fy: null, inv_seq: null, converted_at: null, converted_by: null }).eq("id", id);

  await logAudit(profile.id, "other_invoice_cancelled", "other_challan", id, { freed: ch!.inv_seq, fy: ch!.inv_fy });
  refresh(id);
  redirect(`/invoicing/invoices?toast=${encodeURIComponent(`Invoice cancelled — number ${ch!.inv_seq ?? ""} freed, challan back on Other Sales`)}`);
}

/** Cancel an unconverted challan. */
export async function cancelOtherChallanAction(formData: FormData) {
  const { profile } = await requireAuth();
  if (!canUseInvoicing(profile)) redirect("/invoicing?toast=Access+denied");
  const admin = createAdminSupabaseClient();

  const id = txt(formData, "other_challan_id");
  if (!id) redirect("/invoicing/other");
  const { data: c } = await admin.from("other_challans").select("converted_at").eq("id", id).maybeSingle();
  if ((c as { converted_at: string | null } | null)?.converted_at) {
    redirect(`/invoicing/other?toast=${encodeURIComponent("Already an invoice — cannot cancel")}`);
  }
  await admin.from("other_challans").update({ cancelled_at: new Date().toISOString() }).eq("id", id);
  await logAudit(profile.id, "other_challan_cancelled", "other_challan", id, {});
  refresh(id);
  redirect(`/invoicing/other?toast=${encodeURIComponent("Challan cancelled")}`);
}
