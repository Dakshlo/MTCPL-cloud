"use server";

/**
 * "Other Sales" server actions (mig 176 + 183) — non-temple challans that
 * convert to invoices, now a TWO-STEP flow like running bills (Daksh, Jul 2026):
 *   1. Create a CHALLAN — sectioned line items (table heads), NO rate/GST.
 *      Numbered CH-<fy>-n from the SHARED per-FY challan counter.
 *   2. Convert to an INVOICE on a full-screen page — add a rate per line + GST;
 *      the locked INV-<fy>-n is drawn from the SHARED INV counter so every
 *      invoice (temple + bulk + other) stays on one continuous series.
 */

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";
import { canUseInvoicing } from "@/lib/invoicing-permissions";
import { financialYear } from "@/lib/doc-code";
import { fetchTempleBilling } from "@/lib/temple-billing";
import { uniformGstPercent } from "@/lib/challan-pricing";

function txt(fd: FormData, key: string): string {
  const v = fd.get(key);
  return typeof v === "string" ? v.trim() : "";
}

function refresh(id?: string) {
  revalidatePath("/invoicing/other");
  revalidatePath("/invoicing/invoices");
  revalidatePath("/invoicing");
  if (id) {
    revalidatePath(`/invoicing/other/${id}/print`);
    revalidatePath(`/invoicing/other/${id}/invoice`);
  }
}

type ItemIn = { particulars: string | null; hsn: string | null; unit: string | null; quantity: number | null; rate: number | null; amount: number | null; section_index: number; section_head: string | null; section_gst: number | null };

/** Parse the JSON line-item array; drop wholly-empty rows; recompute amount.
 *  Carries the table/head grouping (mig 183). `rate` is absent on the challan
 *  step (kept null) and present on convert. */
function parseItems(fd: FormData): ItemIn[] {
  let raw: unknown = [];
  try { raw = JSON.parse(txt(fd, "items") || "[]"); } catch { raw = []; }
  const out: ItemIn[] = [];
  for (const r of Array.isArray(raw) ? raw : []) {
    const it = r as Record<string, unknown>;
    const particulars = String(it?.particulars ?? "").trim();
    const qty = Number(it?.quantity) || 0;
    const hasRate = it?.rate != null && String(it.rate).trim() !== "";
    const rate = hasRate ? Number(it?.rate) || 0 : null;
    const amount = rate != null ? Math.round(qty * rate * 100) / 100 : null;
    if (!particulars && !qty && !amount) continue; // skip blank line
    out.push({
      particulars: particulars || null,
      hsn: String(it?.hsn ?? "").trim() || null,
      unit: String(it?.unit ?? "").trim() || null,
      quantity: qty || null,
      rate,
      amount,
      section_index: Number(it?.section_index) || 0,
      section_head: String(it?.section_head ?? "").trim() || null,
      // Mig 199 — the table's own GST slab % (null when GST is off / challan step).
      section_gst: it?.section_gst != null && `${it.section_gst}`.trim() !== "" && Number.isFinite(Number(it.section_gst)) ? Number(it.section_gst) : null,
    });
  }
  return out;
}

/** Mig 199 — invoice-level GST from the per-table slabs: the shared % when every
 *  table agrees (legacy readers stay right), NULL when tables differ. */
function readGst(fd: FormData, items: ItemIn[]) {
  const gm = txt(fd, "gst_mode");
  const gstMode = gm === "igst" || gm === "cgst_sgst" ? gm : null;
  if (!gstMode) items.forEach((it) => { it.section_gst = null; });
  const uniform = gstMode ? uniformGstPercent(items.map((it) => it.section_gst)) : null;
  return {
    gst_mode: gstMode,
    igst_percent: gstMode === "igst" ? uniform : null,
    cgst_percent: gstMode === "cgst_sgst" && uniform != null ? uniform / 2 : null,
    sgst_percent: gstMode === "cgst_sgst" && uniform != null ? uniform / 2 : null,
  };
}

/** Resolve a client-dropdown value to an invoice_parties id. A `temple:<name>`
 *  value (selling other goods to a temple) finds-or-creates a party from the
 *  temple's billing, so its details never have to be re-entered. */
async function resolvePartyId(admin: ReturnType<typeof createAdminSupabaseClient>, raw: string): Promise<string> {
  if (!raw.startsWith("temple:")) return raw;
  const templeName = raw.slice("temple:".length);
  const billing = await fetchTempleBilling(admin, templeName);
  const partyName = (billing?.name ?? templeName).trim() || templeName;
  const { data: existing } = await admin.from("invoice_parties").select("id").eq("name", partyName).maybeSingle();
  if (existing) return (existing as { id: string }).id;
  const ship = billing?.shipping ?? null;
  const { data: created, error } = await admin.from("invoice_parties").insert({
    name: partyName, category: "Temple", is_active: true,
    gstin: billing?.gstin ?? null, pan: billing?.pan ?? null,
    address: billing?.address ?? null, city: billing?.city ?? null, state: billing?.state ?? null, state_code: billing?.state_code ?? null,
    phone: billing?.phone ?? null, email: billing?.email ?? null,
    ship_name: ship?.name ?? null, ship_address: ship?.address ?? null, ship_city: ship?.city ?? null, ship_state: ship?.state ?? null, ship_state_code: ship?.state_code ?? null, ship_gstin: ship?.gstin ?? null, ship_phone: ship?.phone ?? null,
    gst_mode: billing?.gst.mode ?? null, igst_percent: billing?.gst.igst ?? null, cgst_percent: billing?.gst.cgst ?? null, sgst_percent: billing?.gst.sgst ?? null,
  } as never).select("id").single();
  if (error || !created) return raw;
  return (created as { id: string }).id;
}

async function writeItems(admin: ReturnType<typeof createAdminSupabaseClient>, challanId: string, items: ItemIn[]) {
  if (items.length === 0) return;
  const rows = items.map((it, i) => ({ other_challan_id: challanId, position: i, ...it }));
  const { error } = await admin.from("other_challan_items").insert(rows);
  if (!error) return;
  // Fall back for older schemas: first without section_gst (mig 199), then
  // without the mig-183 section cols too.
  const noGst = rows.map(({ section_gst: _sg, ...rest }) => rest);
  const { error: error2 } = await admin.from("other_challan_items").insert(noGst);
  if (error2) await admin.from("other_challan_items").insert(noGst.map(({ section_index: _si, section_head: _sh, ...rest }) => rest));
}

/** STEP 1 — create a new "other" CHALLAN (CH-<fy>-<n>, shared series) with
 *  sectioned line items and NO rate/GST. */
export async function createOtherChallanAction(formData: FormData) {
  const { profile } = await requireAuth();
  if (!canUseInvoicing(profile)) redirect("/invoicing?toast=Access+denied");
  const admin = createAdminSupabaseClient();

  const partyId = txt(formData, "party_id");
  if (!partyId) redirect("/invoicing/other?toast=Pick+a+client");
  const items = parseItems(formData);
  if (items.length === 0) redirect("/invoicing/other?toast=Add+at+least+one+line+item");
  const resolvedPartyId = await resolvePartyId(admin, partyId);

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
      party_id: resolvedPartyId,
      challan_date: challanDate ?? undefined,
      doc_fy: docSeq != null ? fy : null,
      doc_seq: docSeq,
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
  redirect(`/invoicing/other?toast=${encodeURIComponent(`Challan created — CH-${fy}-${String(docSeq ?? 0).padStart(2, "0")} · now convert it to an invoice`)}`);
}

/** Edit an UNCONVERTED challan (replaces its sectioned line items, still no rate). */
export async function updateOtherChallanAction(formData: FormData) {
  const { profile } = await requireAuth();
  if (!canUseInvoicing(profile)) redirect("/invoicing?toast=Access+denied");
  const admin = createAdminSupabaseClient();

  const id = txt(formData, "other_challan_id");
  if (!id) redirect("/invoicing/other");
  const { data: g } = await admin.from("other_challans").select("converted_at, cancelled_at").eq("id", id).maybeSingle();
  const guard = g as { converted_at: string | null; cancelled_at: string | null } | null;
  if (!guard) redirect("/invoicing/other?toast=Challan+not+found");
  // A converted (invoiced) bill is edited on the full-screen convert page.
  if (guard.converted_at) redirect(`/invoicing/other/${id}/invoice?edit=1`);
  if (guard.cancelled_at) redirect(`/invoicing/other?toast=${encodeURIComponent("Challan is cancelled")}`);

  const items = parseItems(formData);
  if (items.length === 0) redirect("/invoicing/other?toast=Add+at+least+one+line+item");
  const partyId = txt(formData, "party_id");
  const resolvedPartyId = partyId ? await resolvePartyId(admin, partyId) : "";

  await admin
    .from("other_challans")
    .update({
      ...(resolvedPartyId ? { party_id: resolvedPartyId } : {}),
      ...(txt(formData, "challan_date") ? { challan_date: txt(formData, "challan_date") } : {}),
      notes: txt(formData, "notes") || null,
    })
    .eq("id", id);
  await admin.from("other_challan_items").delete().eq("other_challan_id", id);
  await writeItems(admin, id, items);

  await logAudit(profile.id, "other_challan_updated", "other_challan", id, {});
  refresh(id);
  redirect(`/invoicing/other?toast=${encodeURIComponent("Challan updated")}`);
}

/** STEP 2 — convert a challan to an INVOICE (rate per line + GST). Prices the
 *  items, sets GST, and assigns INV-<fy>-<n> from the shared counter (locked).
 *  Re-editing a converted bill (edit_mode) keeps the same INV number. */
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
  const editMode = txt(formData, "edit_mode") === "1" && !!row.converted_at;
  if (row.converted_at && !editMode) redirect(`/invoicing/other?toast=${encodeURIComponent("Already an invoice")}`);

  const items = parseItems(formData);
  if (items.length === 0) redirect(`/invoicing/other/${id}/invoice?toast=Add+at+least+one+line+item`);
  // Mig 199 — per-TABLE GST slab, mandatory when GST is on.
  const gmRaw = txt(formData, "gst_mode");
  if ((gmRaw === "igst" || gmRaw === "cgst_sgst") && items.some((it) => it.section_gst == null)) {
    redirect(`/invoicing/other/${id}/invoice?toast=${encodeURIComponent("Set the GST % on every table")}`);
  }
  const gst = readGst(formData, items);
  // Mig 200 — discount on the final amount (default off).
  const dmRaw2 = txt(formData, "discount_mode");
  const discountMode = dmRaw2 === "amount" || dmRaw2 === "percent" ? dmRaw2 : null;
  const discountValue = discountMode ? Math.max(0, Number(txt(formData, "discount_value")) || 0) : null;

  // Mig 184 — editing an EXISTING other-sales invoice is approval-gated: stage
  // the change; owner / accountant★ apply it from the Approval page.
  if (editMode) {
    const payload = { kind: "other" as const, items, gst, discount: { discount_mode: discountMode, discount_value: discountValue } };
    await admin.from("other_challans").update({ pending_edit_payload: payload, pending_edit_at: new Date().toISOString(), pending_edit_by: profile.id } as never).eq("id", id);
    await logAudit(profile.id, "invoice_edit_requested", "other_challan", id, {});
    refresh(id);
    redirect(`/invoicing/invoices?toast=${encodeURIComponent("Edit sent for approval — the invoice is unchanged until approved")}`);
  }

  // First conversion — re-price the existing items + set GST on the parent.
  await admin.from("other_challan_items").delete().eq("other_challan_id", id);
  await writeItems(admin, id, items);
  await admin.from("other_challans").update({ ...gst }).eq("id", id);
  // Mig 200 — discount (best-effort so a pre-mig schema still converts).
  try {
    await admin.from("other_challans").update({ discount_mode: discountMode, discount_value: discountValue } as never).eq("id", id);
  } catch { /* pre-mig-200 */ }

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

  // Mig 184 — approval-gated cancel: stage the request.
  await admin.from("other_challans").update({ pending_cancel_at: new Date().toISOString(), pending_cancel_by: profile.id } as never).eq("id", id);
  await logAudit(profile.id, "invoice_cancel_requested", "other_challan", id, {});
  refresh(id);
  redirect(`/invoicing/invoices?toast=${encodeURIComponent("Cancel request sent for approval")}`);
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
