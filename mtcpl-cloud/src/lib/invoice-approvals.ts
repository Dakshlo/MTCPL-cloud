/* eslint-disable @typescript-eslint/no-explicit-any */
// Invoice change requests (mig 184) — approval-gated edit & cancel.
//
// The edit / cancel actions STAGE a request (pending_edit_payload or
// pending_cancel_at). On approval these helpers APPLY it to the live invoice;
// on rejection the pending flags are simply cleared (nothing here runs).
// Plain (non-"use server") helpers so the approval server actions can import them.
//
// Purchase + running invoices live on `challans`; work-order on `bulk_invoices`;
// other-sales on `other_challans`.

import type { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { freeInvoiceNumber } from "@/lib/invoice-numbers";

type Admin = ReturnType<typeof createAdminSupabaseClient>;

export type ChangeSource = "purchase" | "running" | "bulk" | "other";
export type StagedGst = { gst_mode: "igst" | "cgst_sgst" | null; igst_percent: number | null; cgst_percent: number | null; sgst_percent: number | null };
export type StagedItem = { particulars: string | null; hsn: string | null; unit: string | null; quantity: number | null; rate: number | null; amount: number | null; section_index: number; section_head: string | null; section_gst?: number | null };

export type EditPayload =
  | { kind: "purchase"; rates: Record<string, number | string>; gst: StagedGst; transport: Record<string, string | null>; stoneGst?: Record<string, number> | null; itemGst?: Record<string, number> | null }
  | { kind: "running"; items: StagedItem[]; gst: StagedGst }
  | { kind: "bulk"; items: StagedItem[]; gst: StagedGst; notes: string | null; challanIds: string[] }
  | { kind: "other"; items: StagedItem[]; gst: StagedGst };

/** Which table carries the pending_* columns for a source. */
export function pendingTableOf(source: ChangeSource): "challans" | "bulk_invoices" | "other_challans" {
  return source === "bulk" ? "bulk_invoices" : source === "other" ? "other_challans" : "challans";
}

function itemRows(parentCol: string, parentId: string, items: StagedItem[]) {
  return items.map((it, i) => ({
    [parentCol]: parentId, position: i,
    particulars: it.particulars, hsn: it.hsn, unit: it.unit,
    quantity: it.quantity, rate: it.rate, amount: it.amount,
    section_index: it.section_index, section_head: it.section_head,
    section_gst: it.section_gst ?? null,
  }));
}

async function insertItems(admin: Admin, table: "challan_custom_items" | "other_challan_items" | "bulk_invoice_items", rows: Array<Record<string, unknown>>) {
  if (!rows.length) return;
  const { error } = await (admin.from(table) as any).insert(rows);
  if (!error) return;
  // Fall back for older schemas: first without section_gst (mig 199), then
  // without the mig-179/182/183 section cols too.
  const noGst = rows.map(({ section_gst: _sg, ...rest }) => rest);
  const { error: error2 } = await (admin.from(table) as any).insert(noGst);
  if (error2) await (admin.from(table) as any).insert(noGst.map(({ section_index: _si, section_head: _sh, ...rest }) => rest));
}

function transportUpdate(t: Record<string, string | null>) {
  return {
    transport_company: t.company ?? null,
    transport_phone: t.phone ?? null,
    lr_no: t.lr ?? null,
    transport_vehicle_no: t.vehicle ?? null,
    transport_driver_name: t.driver ?? null,
    transport_driver_phone: t.driverPhone ?? null,
  };
}

/** Reconcile a bulk invoice's linked challans to exactly `challanIds` — removed
 *  ones return to the Bulk pool, added ones leave it. */
async function reconcileBulkChallans(admin: Admin, bulkId: string, challanIds: string[]) {
  const want = new Set(challanIds);
  const { data: cur } = await admin.from("bulk_invoice_challans").select("challan_id").eq("bulk_invoice_id", bulkId);
  const have = new Set(((cur ?? []) as Array<{ challan_id: string }>).map((r) => r.challan_id));
  const toRemove = [...have].filter((c) => !want.has(c));
  const toAdd = [...want].filter((c) => !have.has(c));
  if (toRemove.length) await admin.from("bulk_invoice_challans").delete().eq("bulk_invoice_id", bulkId).in("challan_id", toRemove);
  if (toAdd.length) await (admin.from("bulk_invoice_challans") as any).insert(toAdd.map((c) => ({ bulk_invoice_id: bulkId, challan_id: c })));
}

/** Apply a staged edit to the live invoice. */
export async function applyInvoiceEdit(admin: Admin, source: ChangeSource, id: string, payload: EditPayload): Promise<void> {
  if (source === "purchase" && payload.kind === "purchase") {
    const { data: items } = await admin.from("challan_items").select("id, quantity, measure_qty").eq("challan_id", id);
    for (const it of (items ?? []) as Array<{ id: string; quantity: number | null; measure_qty: number | null }>) {
      const rate = Number(payload.rates[it.id]) || 0;
      const qty = it.measure_qty != null && Number(it.measure_qty) > 0 ? Number(it.measure_qty) : Number(it.quantity) || 0;
      const amount = Math.round(rate * qty * 100) / 100;
      // Mig 199 — per-line slab; retry without it so a pre-mig schema still applies.
      const pct = payload.itemGst != null && payload.itemGst[it.id] != null ? Number(payload.itemGst[it.id]) : null;
      const { error: upErr } = await admin.from("challan_items").update({ rate, amount, section_gst: pct } as any).eq("id", it.id);
      if (upErr) await admin.from("challan_items").update({ rate, amount }).eq("id", it.id);
    }
    await admin.from("challans").update({ ...payload.gst, ...transportUpdate(payload.transport) } as any).eq("id", id);
    // Mig 199 — per-stone-table GST slabs (best-effort; pre-mig schema keeps the
    // invoice-level % applied above).
    if (payload.stoneGst !== undefined) {
      try { await admin.from("challans").update({ stone_gst: payload.stoneGst } as any).eq("id", id); } catch { /* pre-mig-199 */ }
    }
    return;
  }
  if (source === "running" && payload.kind === "running") {
    await admin.from("challan_custom_items").delete().eq("challan_id", id);
    await insertItems(admin, "challan_custom_items", itemRows("challan_id", id, payload.items));
    await admin.from("challans").update({ ...payload.gst } as any).eq("id", id);
    return;
  }
  if (source === "bulk" && payload.kind === "bulk") {
    await admin.from("bulk_invoices").update({ ...payload.gst, notes: payload.notes } as any).eq("id", id);
    await admin.from("bulk_invoice_items").delete().eq("bulk_invoice_id", id);
    await insertItems(admin, "bulk_invoice_items", itemRows("bulk_invoice_id", id, payload.items));
    await reconcileBulkChallans(admin, id, payload.challanIds);
    return;
  }
  if (source === "other" && payload.kind === "other") {
    await admin.from("other_challan_items").delete().eq("other_challan_id", id);
    await insertItems(admin, "other_challan_items", itemRows("other_challan_id", id, payload.items));
    await admin.from("other_challans").update({ ...payload.gst } as any).eq("id", id);
    return;
  }
}

/** Apply a cancel: free the INV number and retire/reset the invoice (mirrors the
 *  old direct cancel actions). */
export async function applyInvoiceCancel(admin: Admin, source: ChangeSource, id: string, actorId: string): Promise<void> {
  const freeFrom = async (table: "challans" | "bulk_invoices" | "other_challans") => {
    const { data } = await admin.from(table).select("inv_fy, inv_seq").eq("id", id).maybeSingle();
    const r = data as { inv_fy: string | null; inv_seq: number | null } | null;
    if (r) await freeInvoiceNumber(admin, r.inv_fy, r.inv_seq, actorId);
  };
  if (source === "purchase") {
    await freeFrom("challans");
    await admin.from("challans").update({ inv_fy: null, inv_seq: null, invoice_no_override: null, priced_at: null, priced_by: null, owner_approved_at: null, owner_approved_by: null, owner_rejected_at: null, owner_reject_reason: null } as any).eq("id", id);
    return;
  }
  if (source === "running") {
    await freeFrom("challans");
    await admin.from("challans").update({ inv_fy: null, inv_seq: null } as any).eq("id", id);
    return;
  }
  if (source === "bulk") {
    await freeFrom("bulk_invoices");
    await admin.from("bulk_invoice_challans").delete().eq("bulk_invoice_id", id);
    await admin.from("bulk_invoices").update({ cancelled_at: new Date().toISOString(), inv_fy: null, inv_seq: null } as any).eq("id", id);
    return;
  }
  if (source === "other") {
    await freeFrom("other_challans");
    await admin.from("other_challans").update({ inv_fy: null, inv_seq: null, converted_at: null, converted_by: null } as any).eq("id", id);
    return;
  }
}
