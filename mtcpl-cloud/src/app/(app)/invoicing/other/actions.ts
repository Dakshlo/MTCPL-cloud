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

type ItemIn = { particulars: string | null; hsn: string | null; unit: string | null; quantity: number | null; rate: number | null; amount: number | null };

/** Parse the JSON line-item array; drop wholly-empty rows; recompute amount. */
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
  await admin.from("other_challan_items").insert(
    items.map((it, i) => ({ other_challan_id: challanId, position: i, ...it })),
  );
}

/** Create a new "other" challan (OC-<fy>-<n>) with free-typed line items. */
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
  let docSeq: number | null = null;
  try {
    const { data: seq } = await admin.rpc("next_doc_seq", { p_fy: `OC:${fy}` });
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
  redirect(`/invoicing/other?toast=${encodeURIComponent(`Challan created — OC-${fy}-${String(docSeq ?? 0).padStart(2, "0")}`)}`);
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
  if (guard.converted_at) redirect(`/invoicing/other?toast=${encodeURIComponent("Already an invoice — cannot edit")}`);
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
  let invSeq: number | null = null;
  const manual = Math.floor(Number(txt(formData, "inv_seq")) || 0);
  try {
    if (manual > 0) {
      invSeq = manual;
      const { data: ctr } = await admin.from("doc_counters").select("last_seq").eq("fy", `INV:${fy}`).maybeSingle();
      const last = Number((ctr as { last_seq?: number } | null)?.last_seq) || 0;
      if (manual > last) await admin.from("doc_counters").upsert({ fy: `INV:${fy}`, last_seq: manual }, { onConflict: "fy" });
    } else {
      const { data: seq } = await admin.rpc("next_doc_seq", { p_fy: `INV:${fy}` });
      if (typeof seq === "number") invSeq = seq;
    }
  } catch { /* counter unavailable */ }

  await admin
    .from("other_challans")
    .update({ inv_fy: invSeq != null ? fy : null, inv_seq: invSeq, converted_at: new Date().toISOString(), converted_by: profile.id })
    .eq("id", id);

  await logAudit(profile.id, "other_challan_converted", "other_challan", id, { fy, invSeq });
  refresh(id);
  redirect(`/invoicing/other?toast=${encodeURIComponent(`Invoice created — INV-${fy}-${String(invSeq ?? 0).padStart(2, "0")}`)}`);
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
