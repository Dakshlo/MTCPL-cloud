"use server";

/**
 * Invoicing server actions.
 *
 *   • Mig 038 — createInvoiceAction (the v1 single-step invoice).
 *   • Mig 058 — Invoicing v2 restructure:
 *       - upsertInvoicePartyAction, archiveInvoicePartyAction
 *       - createChallanAction, cancelChallanAction
 *       - convertChallanToInvoiceAction
 *       - createInvoiceAction extended with optional
 *         invoice_party_id + source_challan_id
 *
 * Every action:
 *   1. requireAuth() + canUseInvoicing(profile) gate
 *      (dev + owner + final_auditor — the starred accountant).
 *   2. Writes via the admin Supabase client (service role).
 *   3. logAudit(...) with action prefix indicating entity + verb.
 *   4. revalidatePath on every affected surface.
 */

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";
import { canUseInvoicing } from "@/lib/invoicing-permissions";
import { financialYear } from "@/lib/doc-code";
import { freeInvoiceNumber } from "@/lib/invoice-numbers";
import { uniformGstPercent } from "@/lib/challan-pricing";
import { applyInvoiceEdit, applyInvoiceCancel, pendingTableOf, type ChangeSource, type EditPayload } from "@/lib/invoice-approvals";

type ActionResult = { ok: true } | { ok: false; error: string };

function txt(fd: FormData, key: string): string {
  const v = fd.get(key);
  return typeof v === "string" ? v.trim() : "";
}

function refreshInvoicingPaths(opts?: { partyId?: string; challanId?: string; invoiceId?: string }) {
  revalidatePath("/invoicing");
  revalidatePath("/invoicing/parties");
  revalidatePath("/invoicing/challans");
  revalidatePath("/invoicing/invoices");
  if (opts?.partyId) revalidatePath(`/invoicing/parties/${opts.partyId}`);
  if (opts?.challanId) revalidatePath(`/invoicing/challans/${opts.challanId}`);
  if (opts?.invoiceId) revalidatePath(`/invoicing/invoices/${opts.invoiceId}`);
}

// ════════════════════════════════════════════════════════════════
// Mig 157 — Price a (dispatch-sourced) challan: per-row rate + GST.
// The priced challan IS the tax invoice (prints landscape) — no separate
// invoices row, keeping the dispatch→invoicing grid intact end to end.
// ════════════════════════════════════════════════════════════════
export async function saveChallanPricingAction(formData: FormData) {
  const { profile } = await requireAuth();
  if (!canUseInvoicing(profile)) redirect("/invoicing?toast=Access+denied");
  const admin = createAdminSupabaseClient();

  const challanId = txt(formData, "challan_id");
  if (!challanId) redirect("/invoicing/challans");

  // A converted or cancelled challan must not be (re-)priced — that would issue
  // two invoice documents for one shipment. Re-pricing an already-priced (but
  // not converted) challan is allowed.
  const { data: guard } = await admin
    .from("challans").select("converted_invoice_id, cancelled_at, priced_at, owner_approved_at, owner_rejected_at").eq("id", challanId).maybeSingle();
  const g = guard as { converted_invoice_id: string | null; cancelled_at: string | null; priced_at: string | null; owner_approved_at: string | null; owner_rejected_at: string | null } | null;
  // Jul 2026 — "Edit invoice": an already-approved (final) invoice may be
  // re-edited (rates / GST / transport) as long as the INV number never changes.
  // Approval stays intact; the pending-with-owner state stays locked.
  const editMode = txt(formData, "edit_mode") === "1" && !!g?.owner_approved_at;
  if (g?.converted_invoice_id) redirect(`/invoicing/challans/${challanId}?toast=${encodeURIComponent("Already converted to an invoice — cannot re-price")}`);
  if (g?.cancelled_at) redirect(`/invoicing/challans/${challanId}?toast=${encodeURIComponent("Challan is cancelled — cannot price")}`);
  if (g?.owner_approved_at && !editMode) redirect(`/invoicing/challans/${challanId}?toast=${encodeURIComponent("Owner already approved this invoice — open it in Edit mode from the Invoices page")}`);
  // Mig 167 — once sent to the owner (priced, not yet rejected), the accountant
  // can't re-price; they wait for the owner to reject (then re-price or cancel).
  if (!g?.owner_approved_at && g?.priced_at && !g?.owner_rejected_at) redirect(`/invoicing/challans/${challanId}?toast=${encodeURIComponent("Sent to owner for approval — wait for a rejection before re-pricing")}`);

  let rates: Record<string, number | string> = {};
  try {
    rates = JSON.parse(txt(formData, "rates") || "{}") as Record<string, number | string>;
  } catch {
    rates = {};
  }
  const gstModeRaw = txt(formData, "gst_mode");
  const gstMode = gstModeRaw === "igst" || gstModeRaw === "cgst_sgst" ? gstModeRaw : null;
  // Mig 199 — GST is PER STONE TABLE ({ "<stone>|<unit>" → pct }, mandatory on
  // the form). The invoice-level % is kept only when every table shares one
  // slab (legacy readers stay right); NULL when tables differ.
  let stoneGst: Record<string, number> = {};
  try {
    const raw = JSON.parse(txt(formData, "stone_gst") || "{}") as Record<string, unknown>;
    for (const [k, v] of Object.entries(raw)) { const n = Number(v); if (Number.isFinite(n) && n >= 0) stoneGst[k] = n; }
  } catch { stoneGst = {}; }
  // Same slabs expanded PER ITEM (challan_items.section_gst) — one uniform read
  // for every totals consumer across all four invoice types.
  let itemGst: Record<string, number> = {};
  try {
    const raw = JSON.parse(txt(formData, "item_gst") || "{}") as Record<string, unknown>;
    for (const [k, v] of Object.entries(raw)) { const n = Number(v); if (Number.isFinite(n) && n >= 0) itemGst[k] = n; }
  } catch { itemGst = {}; }
  const uniformStone = gstMode ? uniformGstPercent(Object.values(stoneGst)) : null;
  // Mig 200 — discount on the final amount (default off).
  const dmRaw = txt(formData, "discount_mode");
  const discountMode = dmRaw === "amount" || dmRaw === "percent" ? dmRaw : null;
  const discountValue = discountMode ? Math.max(0, Number(txt(formData, "discount_value")) || 0) : null;
  const igst = gstMode === "igst" ? (uniformStone ?? 0) : 0;
  const cgst = gstMode === "cgst_sgst" && uniformStone != null ? uniformStone / 2 : 0;
  const sgst = gstMode === "cgst_sgst" && uniformStone != null ? uniformStone / 2 : 0;
  const igstCol = gstMode === "igst" ? uniformStone : null;
  const cgstCol = gstMode === "cgst_sgst" && uniformStone != null ? uniformStone / 2 : null;
  const sgstCol = gstMode === "cgst_sgst" && uniformStone != null ? uniformStone / 2 : null;
  if (gstMode && Object.keys(stoneGst).length === 0) {
    redirect(`/invoicing/challans/${challanId}/review?toast=${encodeURIComponent("Set the GST % on every stone table.")}`);
  }

  // HSN per stone (Daksh) — the review page makes the HSN mandatory per stone
  // table and saves it back onto the stone master so the tax invoice prints it
  // (the vendor-HSN column when this temple bills with it). Master data → saved
  // directly, not gated by the rate/GST edit-approval flow.
  try {
    const hsns = JSON.parse(txt(formData, "hsns") || "{}") as Record<string, string>;
    const stones = Object.keys(hsns);
    if (stones.length) {
      const { data: cRow } = await admin.from("challans").select("temple").eq("id", challanId).maybeSingle();
      const temple = (cRow as { temple?: string | null } | null)?.temple ?? null;
      let useVendor = false;
      if (temple) {
        const { data: tv } = await admin.from("temples").select("hsn_use_vendor").eq("name", temple).maybeSingle();
        useVendor = !!(tv as { hsn_use_vendor?: boolean } | null)?.hsn_use_vendor;
      }
      for (const s of stones) {
        const code = (hsns[s] ?? "").trim();
        if (!code) continue;
        await admin.from("stone_types").update(useVendor ? { hsn_vendor_code: code } : { hsn_code: code }).eq("name", s);
      }
    }
  } catch { /* never block pricing on an HSN-write error */ }

  // Custom per-stone table headings (mig 187, Daksh) — the LEFT of each stone
  // band on the tax invoice. Stored per-invoice on the challan as a jsonb map
  // { stone → TITLE } (forced CAPS). A label, not a priced value, so it saves
  // straight away (even in edit mode) and is best-effort so a pre-mig-187 schema
  // never blocks pricing.
  try {
    const raw = JSON.parse(txt(formData, "heads") || "{}") as Record<string, string>;
    const heads: Record<string, string> = {};
    for (const [k, v] of Object.entries(raw)) {
      const t = String(v ?? "").trim().toUpperCase().slice(0, 120);
      if (t) heads[k] = t;
    }
    await admin.from("challans").update({ stone_heads: heads } as never).eq("id", challanId);
  } catch { /* pre-mig-187 — heads simply not stored */ }

  // Amount = rate × billable measure (cft/sft qty) — falls back to the line
  // quantity for legacy challans that have no measure snapshot.
  const { data: items } = await admin
    .from("challan_items")
    .select("id, quantity, measure_qty")
    .eq("challan_id", challanId);
  // Rate is MANDATORY (Daksh Jul 2026) — every line must carry a rate > 0.
  const rows = (items ?? []) as Array<{ id: string; quantity: number | null; measure_qty: number | null }>;
  if (rows.length > 0 && rows.some((it) => !((Number(rates[it.id]) || 0) > 0))) {
    redirect(`/invoicing/challans/${challanId}/review?toast=${encodeURIComponent("Enter a rate for every stone before sending.")}`);
  }

  // Mig 184 — editing an EXISTING (approved) invoice is approval-gated: stage the
  // change and stop; owner / accountant★ apply it from the Approval page.
  if (editMode) {
    const payload = {
      kind: "purchase" as const,
      rates,
      gst: { gst_mode: gstMode, igst_percent: igstCol, cgst_percent: cgstCol, sgst_percent: sgstCol },
      stoneGst: gstMode ? stoneGst : null,
      itemGst: gstMode ? itemGst : null,
      discount: { discount_mode: discountMode, discount_value: discountValue },
      transport: {
        company: txt(formData, "transport_company") || null,
        phone: txt(formData, "transport_phone") || null,
        lr: txt(formData, "lr_no") || null,
        vehicle: txt(formData, "transport_vehicle_no") || null,
        driver: txt(formData, "transport_driver_name") || null,
        driverPhone: txt(formData, "transport_driver_phone") || null,
      },
    };
    await admin.from("challans").update({ pending_edit_payload: payload, pending_edit_at: new Date().toISOString(), pending_edit_by: profile.id } as never).eq("id", challanId);
    await logAudit(profile.id, "invoice_edit_requested", "challan", challanId, {});
    refreshInvoicingPaths({ challanId });
    revalidatePath("/invoicing/approval");
    redirect(`/invoicing/invoices?toast=${encodeURIComponent("Edit sent for approval — the invoice is unchanged until approved")}`);
  }

  for (const it of rows) {
    const rate = Number(rates[it.id]) || 0;
    const qty = it.measure_qty != null && Number(it.measure_qty) > 0 ? Number(it.measure_qty) : Number(it.quantity) || 0;
    const amount = Math.round(rate * qty * 100) / 100;
    const pct = gstMode && itemGst[it.id] != null ? itemGst[it.id] : null;
    // section_gst (mig 199) — retry without it so a pre-mig schema still prices.
    const { error: upErr } = await admin.from("challan_items").update({ rate, amount, section_gst: pct } as never).eq("id", it.id);
    if (upErr) await admin.from("challan_items").update({ rate, amount }).eq("id", it.id);
  }

  await admin
    .from("challans")
    .update({
      gst_mode: gstMode,
      igst_percent: igstCol,
      cgst_percent: cgstCol,
      sgst_percent: sgstCol,
      priced_at: new Date().toISOString(),
      priced_by: profile.id,
      // Number now lives in inv_fy/inv_seq (edited as the XX on the review form);
      // clear any legacy free-text override so the INV-<FY>-<seq> code wins.
      invoice_no_override: null,
      // Pricing (re-)submits the challan for owner approval — clear any prior
      // rejection so it re-enters the Approval queue (Mig 167).
      owner_rejected_at: null,
      owner_reject_reason: null,
    })
    .eq("id", challanId);

  // Mig 199 — the per-stone-table slabs themselves. Separate best-effort update
  // so a pre-migration schema never blocks pricing (it keeps the uniform %).
  try {
    await admin.from("challans").update({ stone_gst: gstMode ? stoneGst : null } as never).eq("id", challanId);
  } catch { /* pre-mig-199 */ }
  // Mig 200 — discount on the final amount (best-effort for the same reason).
  try {
    await admin.from("challans").update({ discount_mode: discountMode, discount_value: discountValue } as never).eq("id", challanId);
  } catch { /* pre-mig-200 */ }

  // Mig 169 — transport details (separate best-effort update so a pre-migration
  // schema never blocks pricing). A new company name is added to the master so
  // it appears in the review-form dropdown next time.
  {
    const transportCompany = txt(formData, "transport_company") || null;
    const { error: trErr } = await admin
      .from("challans")
      .update({
        transport_company: transportCompany,
        transport_phone: txt(formData, "transport_phone") || null,
        lr_no: txt(formData, "lr_no") || null,
        transport_vehicle_no: txt(formData, "transport_vehicle_no") || null,
        transport_driver_name: txt(formData, "transport_driver_name") || null,
        transport_driver_phone: txt(formData, "transport_driver_phone") || null,
      })
      .eq("id", challanId);
    if (!trErr && transportCompany) {
      await admin.from("transport_companies").upsert({ name: transportCompany }, { onConflict: "name" });
    }
  }

  // Invoice number (INV series, mig 172) — LOCKED (Daksh Jul 2026): assigned
  // ONCE from the shared per-FY counter on first pricing, never edited by hand.
  // Cancelling an invoice later frees the number (freeInvoiceNumber). Best-
  // effort: if mig 172 isn't applied the select errors and the code falls back
  // to the challan-derived number.
  try {
    const { data: inv } = await admin.from("challans").select("inv_seq, challan_date").eq("id", challanId).maybeSingle();
    const row = inv as { inv_seq?: number | null; challan_date?: string } | null;
    if (row && row.inv_seq == null) {
      const fy = financialYear(row.challan_date || new Date());
      const { data: seq } = await admin.rpc("next_doc_seq", { p_fy: `INV:${fy}` });
      if (typeof seq === "number") await admin.from("challans").update({ inv_fy: fy, inv_seq: seq }).eq("id", challanId);
    }
  } catch {
    /* mig 172 not applied — invoice code falls back to the challan-derived number */
  }

  await logAudit(profile.id, editMode ? "invoice_edited" : "challan_priced", "challan", challanId, { gstMode, igst, cgst, sgst });
  refreshInvoicingPaths({ challanId });
  revalidatePath("/invoicing/approval");
  if (editMode) {
    redirect(`/invoicing/invoices?toast=${encodeURIComponent("Invoice updated — number unchanged")}`);
  }
  const goPrint = txt(formData, "go") === "print";
  redirect(
    goPrint
      ? `/invoicing/challan/${challanId}/print`
      : `/invoicing/challans?toast=${encodeURIComponent("Priced — sent to owner for approval")}`,
  );
}

// ════════════════════════════════════════════════════════════════
// Mig 167 — Owner approval gate. A priced challan waits on /invoicing/approval
// until the OWNER approves (→ becomes a final invoice + releases the truck) or
// rejects (→ back to the accountant on Challans).
// ════════════════════════════════════════════════════════════════

/** OWNER approves a priced challan → it becomes a final tax invoice and the
 *  linked dispatch's truck is released to the road (on_road_at). */
export async function ownerApproveChallanAction(formData: FormData) {
  const { profile } = await requireAuth(["owner", "developer", "accountant_star"]);
  const admin = createAdminSupabaseClient();

  const challanId = txt(formData, "challan_id");
  if (!challanId) redirect("/invoicing/approval");

  const { data: c } = await admin
    .from("challans")
    .select("id, priced_at, owner_approved_at, cancelled_at, converted_invoice_id, source_dispatch_id, temple, challan_number")
    .eq("id", challanId)
    .maybeSingle();
  const ch = c as {
    priced_at: string | null; owner_approved_at: string | null; cancelled_at: string | null;
    converted_invoice_id: string | null; source_dispatch_id: string | null; temple: string | null; challan_number: string | null;
  } | null;
  if (!ch) redirect("/invoicing/approval?toast=Challan+not+found");
  if (ch!.cancelled_at || ch!.converted_invoice_id) redirect(`/invoicing/approval?toast=${encodeURIComponent("Challan is no longer pending")}`);
  if (!ch!.priced_at) redirect(`/invoicing/approval?toast=${encodeURIComponent("Not priced yet")}`);
  if (ch!.owner_approved_at) redirect(`/invoicing/approval?toast=${encodeURIComponent("Already approved")}`);

  const now = new Date().toISOString();
  await admin
    .from("challans")
    .update({ owner_approved_at: now, owner_approved_by: profile.id, owner_rejected_at: null, owner_reject_reason: null })
    .eq("id", challanId);

  // Release the truck — only if the dispatch isn't already on the road/delivered.
  // Mig 175 — this is the INVOICE path, so mark release_mode='invoice' (unless the
  // bulk "Get challan" flow already put it on the road with a challan).
  if (ch!.source_dispatch_id) {
    await admin
      .from("dispatches")
      .update({ on_road_at: now, release_mode: "invoice", returned_at: null, return_reason: null, handover_ack_at: null })
      .eq("id", ch!.source_dispatch_id)
      .is("on_road_at", null)
      .is("delivered_at", null);
  }

  await logAudit(profile.id, "challan_owner_approved", "challan", challanId, { temple: ch!.temple, challan_number: ch!.challan_number });
  refreshInvoicingPaths({ challanId });
  revalidatePath("/invoicing/approval");
  revalidatePath("/dispatch");
  revalidatePath("/", "layout");
  redirect(`/invoicing/approval?toast=${encodeURIComponent("Approved — invoice issued, truck released")}`);
}

/** OWNER rejects a priced challan → back to the accountant on Challans. The
 *  dispatch stays in "Invoice in process" (truck still held). */
export async function ownerRejectChallanAction(formData: FormData) {
  const { profile } = await requireAuth(["owner", "developer", "accountant_star"]);
  const admin = createAdminSupabaseClient();

  const challanId = txt(formData, "challan_id");
  if (!challanId) redirect("/invoicing/approval");
  const reason = txt(formData, "reason") || null;

  const { data: c } = await admin
    .from("challans")
    .select("id, priced_at, owner_approved_at, cancelled_at, converted_invoice_id, temple, challan_number")
    .eq("id", challanId)
    .maybeSingle();
  const ch = c as {
    priced_at: string | null; owner_approved_at: string | null; cancelled_at: string | null;
    converted_invoice_id: string | null; temple: string | null; challan_number: string | null;
  } | null;
  if (!ch) redirect("/invoicing/approval?toast=Challan+not+found");
  if (ch!.cancelled_at || ch!.converted_invoice_id) redirect(`/invoicing/approval?toast=${encodeURIComponent("Challan is no longer pending")}`);
  if (!ch!.priced_at) redirect(`/invoicing/approval?toast=${encodeURIComponent("Not priced yet")}`);
  if (ch!.owner_approved_at) redirect(`/invoicing/approval?toast=${encodeURIComponent("Already approved — cannot reject")}`);

  await admin
    .from("challans")
    .update({ owner_rejected_at: new Date().toISOString(), owner_reject_reason: reason, owner_approved_at: null, owner_approved_by: null })
    .eq("id", challanId);

  await logAudit(profile.id, "challan_owner_rejected", "challan", challanId, { temple: ch!.temple, reason });
  refreshInvoicingPaths({ challanId });
  revalidatePath("/invoicing/approval");
  redirect(`/invoicing/approval?toast=${encodeURIComponent("Rejected — sent back to accountant")}`);
}

/** Accountant cancels a (rejected) dispatch challan WITH A REASON → the challan
 *  is removed and its dispatch returns to Waiting approval flagged "Returned",
 *  where seniors can re-check & verify or cancel (slabs back to Make Dispatch). */
export async function returnDispatchToWaitingAction(formData: FormData): Promise<ActionResult> {
  const { profile } = await requireAuth();
  if (!canUseInvoicing(profile)) return { ok: false, error: "Invoicing access denied." };
  const admin = createAdminSupabaseClient();

  const challanId = txt(formData, "challan_id");
  if (!challanId) return { ok: false, error: "Missing challan." };
  const reason = txt(formData, "reason");
  if (!reason) return { ok: false, error: "A cancellation reason is required." };

  const { data: c } = await admin
    .from("challans")
    .select("id, owner_approved_at, cancelled_at, source_dispatch_id, temple, challan_number, inv_fy, inv_seq")
    .eq("id", challanId)
    .maybeSingle();
  const ch = c as {
    owner_approved_at: string | null; cancelled_at: string | null; source_dispatch_id: string | null; temple: string | null; challan_number: string | null;
    inv_fy: string | null; inv_seq: number | null;
  } | null;
  if (!ch) return { ok: false, error: "Challan not found." };
  if (ch.owner_approved_at) return { ok: false, error: "Owner already approved this invoice — cannot cancel here." };

  // Bounce the dispatch back to Waiting approval (un-verify), flagged returned.
  // Stamp WHO cancelled so the header reads "Cancelled by <name>: <reason>".
  const who = (profile.full_name ?? "").trim() || "someone";
  const stamp = `Cancelled by ${who}: ${reason}`;
  if (ch.source_dispatch_id) {
    await admin
      .from("dispatches")
      .update({ approved_at: null, approved_by: null, on_road_at: null, returned_at: new Date().toISOString(), return_reason: stamp })
      .eq("id", ch.source_dispatch_id)
      .is("delivered_at", null);
  }

  // If this challan had already been priced it holds a LOCKED invoice number
  // (mig 178). Deleting the row would otherwise strand that number — the counter
  // would stay advanced with no invoice keeping it (the INV:26/27 → 90 leak).
  // Free it first so a head cancellation rolls the counter back for reuse.
  await freeInvoiceNumber(admin, ch.inv_fy, ch.inv_seq, profile.id);

  await logAudit(profile.id, "challan_returned_to_dispatch", "challan", challanId, { temple: ch.temple, reason: stamp, freedInvoice: ch.inv_seq });
  // Remove the challan (items cascade) so a re-verify recreates a fresh one.
  await admin.from("challans").delete().eq("id", challanId);

  refreshInvoicingPaths({ challanId });
  revalidatePath("/invoicing/approval");
  revalidatePath("/dispatch");
  revalidatePath("/", "layout");
  return { ok: true };
}

// ════════════════════════════════════════════════════════════════
// Mig 177 — "Drop the challan" → custom whole-piece temple bill. A dispatch-
// sourced challan is DROPPED (dragged onto the new drop zone), re-billed with
// free line items KEEPING its CH number, and the production dispatch is released
// straight to Delivered (skipping On-the-road). The custom bill → tax invoice.
// ════════════════════════════════════════════════════════════════

type CustomItem = { particulars: string | null; hsn: string | null; unit: string | null; quantity: number | null; rate: number | null; amount: number | null };
function parseCustomItems(fd: FormData): CustomItem[] {
  let raw: unknown = [];
  try { raw = JSON.parse(txt(fd, "items") || "[]"); } catch { raw = []; }
  const out: CustomItem[] = [];
  for (const r of Array.isArray(raw) ? raw : []) {
    const it = r as Record<string, unknown>;
    const particulars = String(it?.particulars ?? "").trim();
    const qty = Number(it?.quantity) || 0;
    const rate = Number(it?.rate) || 0;
    const amount = Math.round((Number(it?.amount) || qty * rate) * 100) / 100;
    if (!particulars && !amount && !qty) continue;
    out.push({ particulars: particulars || null, hsn: String(it?.hsn ?? "").trim() || null, unit: String(it?.unit ?? "").trim() || null, quantity: qty || null, rate: rate || null, amount: amount || null });
  }
  return out;
}

/** Drop a challan out of the main board into the "Dropped" section. */
export async function dropChallanAction(formData: FormData) {
  const { profile } = await requireAuth();
  if (!canUseInvoicing(profile)) redirect("/invoicing?toast=Access+denied");
  const admin = createAdminSupabaseClient();
  const challanId = txt(formData, "id");
  if (!challanId) redirect("/invoicing/challans");
  const { data: c } = await admin.from("challans").select("cancelled_at, converted_invoice_id, owner_approved_at, priced_at, dropped_at").eq("id", challanId).maybeSingle();
  const g = c as { cancelled_at: string | null; converted_invoice_id: string | null; owner_approved_at: string | null; priced_at: string | null; dropped_at: string | null } | null;
  if (!g) redirect("/invoicing/challans?toast=Challan+not+found");
  // Only an OPEN challan may be dropped (a priced one is under owner review).
  if (g!.cancelled_at || g!.converted_invoice_id || g!.owner_approved_at || g!.priced_at) redirect(`/invoicing/challans?toast=${encodeURIComponent("This challan can't be dropped")}`);
  if (!g!.dropped_at) {
    await admin.from("challans").update({ dropped_at: new Date().toISOString(), dropped_by: profile.id }).eq("id", challanId);
    void logAudit(profile.id, "challan_dropped", "challan", challanId, {});
  }
  refreshInvoicingPaths({ challanId });
  redirect(`/invoicing/challans?toast=${encodeURIComponent("Dropped — create its custom bill in the Dropped section")}`);
}

/** Bring a dropped (not-yet-billed) challan back onto the main board. */
export async function undropChallanAction(formData: FormData) {
  const { profile } = await requireAuth();
  if (!canUseInvoicing(profile)) redirect("/invoicing?toast=Access+denied");
  const admin = createAdminSupabaseClient();
  const challanId = txt(formData, "id");
  if (!challanId) redirect("/invoicing/challans");
  const { data: c } = await admin.from("challans").select("custom_billed_at").eq("id", challanId).maybeSingle();
  if ((c as { custom_billed_at: string | null } | null)?.custom_billed_at) {
    redirect(`/invoicing/challans?toast=${encodeURIComponent("Already custom-billed — cannot un-drop")}`);
  }
  await admin.from("challans").update({ dropped_at: null, dropped_by: null }).eq("id", challanId);
  refreshInvoicingPaths({ challanId });
  redirect(`/invoicing/challans?toast=${encodeURIComponent("Back on the board")}`);
}

/** Archive a challan (test/cleanup, mig 181) — retire it WITHOUT invoicing it or
 *  returning its slabs. The challan leaves the Invoicing board and its dispatch
 *  leaves every dispatch lane; the slabs stay dispatched (they've already left
 *  the plant), no INV number is consumed. Owner / developer / account-star. */
export async function archiveChallanAction(formData: FormData): Promise<void> {
  const { profile } = await requireAuth(["owner", "developer", "accountant_star"]);
  const admin = createAdminSupabaseClient();
  const id = txt(formData, "id");
  if (!id) redirect("/invoicing/challans");
  const { data: c } = await admin.from("challans")
    .select("source_dispatch_id, priced_at, converted_invoice_id, dropped_at").eq("id", id).maybeSingle();
  const ch = c as { source_dispatch_id: string | null; priced_at: string | null; converted_invoice_id: string | null; dropped_at: string | null } | null;
  if (!ch) redirect("/invoicing/challans?toast=Challan+not+found");
  if (ch!.converted_invoice_id || ch!.priced_at) {
    redirect(`/invoicing/challans?toast=${encodeURIComponent("It's in an invoice — cancel the invoice first, then archive")}`);
  }
  const now = new Date().toISOString();
  await admin.from("challans").update({ archived_at: now, archived_by: profile.id, sent_to_bulk_at: null, dropped_at: null }).eq("id", id);
  if (ch!.source_dispatch_id) {
    await admin.from("dispatches").update({ archived_at: now, archived_by: profile.id }).eq("id", ch!.source_dispatch_id);
  }
  void logAudit(profile.id, "challan_archived", "challan", id, {});
  refreshInvoicingPaths({ challanId: id });
  revalidatePath("/dispatch");
  redirect(`/invoicing/challans?toast=${encodeURIComponent("Challan archived — removed without an invoice; slabs untouched")}`);
}

/** Un-archive a challan (mig 181) — clears the archive flag on the challan AND
 *  its dispatch, bringing both back (Challans board + dispatch lanes). The exact
 *  reverse of archiveChallanAction; slabs were never touched. Developer only. */
export async function unarchiveChallanAction(formData: FormData): Promise<void> {
  const { profile } = await requireAuth(["developer"]);
  const admin = createAdminSupabaseClient();
  const id = txt(formData, "id");
  if (!id) redirect("/invoicing/challans");
  const { data: c } = await admin.from("challans").select("source_dispatch_id, archived_at").eq("id", id).maybeSingle();
  const ch = c as { source_dispatch_id: string | null; archived_at: string | null } | null;
  if (!ch) redirect("/invoicing/challans?toast=Challan+not+found");
  await admin.from("challans").update({ archived_at: null, archived_by: null }).eq("id", id);
  if (ch!.source_dispatch_id) {
    await admin.from("dispatches").update({ archived_at: null, archived_by: null }).eq("id", ch!.source_dispatch_id);
  }
  void logAudit(profile.id, "challan_unarchived", "challan", id, {});
  refreshInvoicingPaths({ challanId: id });
  revalidatePath("/dispatch");
  redirect(`/invoicing/challans?toast=${encodeURIComponent("Challan un-archived — back on the Challans page")}`);
}

// ════════════════════════════════════════════════════════════════
// Mig 182 — Running bill, two-step. (1) createRunningChallanAction builds the
// RUNNING CHALLAN (item tables + heads, NO rate) from the drop and delivers the
// dispatch; (2) convertRunningToInvoiceAction adds rate + GST + the INV number.
// sendRunningBackAction undoes it all back to the Challans page.
// ════════════════════════════════════════════════════════════════

type RunItem = { particulars: string | null; hsn: string | null; unit: string | null; quantity: number | null; rate: number | null; amount: number | null; section_index: number; section_head: string | null; section_gst: number | null };
function parseRunningItems(fd: FormData, withRate: boolean): RunItem[] {
  let raw: unknown = [];
  try { raw = JSON.parse(txt(fd, "items") || "[]"); } catch { raw = []; }
  const out: RunItem[] = [];
  for (const r of Array.isArray(raw) ? raw : []) {
    const it = r as Record<string, unknown>;
    const particulars = String(it?.particulars ?? "").trim();
    const qty = Number(it?.quantity) || 0;
    if (!particulars && !qty) continue;
    const rate = withRate ? (Number(it?.rate) || 0) : 0;
    const amount = withRate ? (Math.round((Number(it?.amount) || qty * rate) * 100) / 100) : 0;
    out.push({
      particulars: particulars || null,
      hsn: String(it?.hsn ?? "").trim() || null,
      unit: String(it?.unit ?? "").trim() || null,
      quantity: qty || null,
      rate: withRate ? (rate || null) : null,
      amount: withRate ? (amount || null) : null,
      section_index: Number(it?.section_index) || 0,
      section_head: String(it?.section_head ?? "").trim() || null,
      // Mig 199 — the table's own GST slab % (null when GST is off / not sent).
      section_gst: it?.section_gst != null && `${it.section_gst}`.trim() !== "" && Number.isFinite(Number(it.section_gst)) ? Number(it.section_gst) : null,
    });
  }
  return out;
}

/** Insert challan_custom_items with section cols, falling back if mig 199 /
 *  mig 182 isn't applied (so a pre-migration deploy still works). */
async function insertCustomItems(admin: ReturnType<typeof createAdminSupabaseClient>, challanId: string, items: RunItem[]) {
  const rows = items.map((it, i) => ({ challan_id: challanId, position: i, ...it }));
  const { error } = await admin.from("challan_custom_items").insert(rows);
  if (!error) return;
  const noGst = rows.map(({ section_gst: _sg, ...rest }) => rest);
  const { error: error2 } = await admin.from("challan_custom_items").insert(noGst);
  if (error2) await admin.from("challan_custom_items").insert(noGst.map(({ section_index: _si, section_head: _sh, ...rest }) => rest));
}

const RUN_TRANSPORT = (fd: FormData) => ({
  transport_company: txt(fd, "transport_company") || null,
  transport_vehicle_no: txt(fd, "transport_vehicle_no") || null,
  transport_driver_name: txt(fd, "transport_driver_name") || null,
  transport_driver_phone: txt(fd, "transport_driver_phone") || null,
  lr_no: txt(fd, "lr_no") || null,
  transport_phone: txt(fd, "transport_phone") || null,
});

export async function createRunningChallanAction(formData: FormData) {
  const { profile } = await requireAuth();
  if (!canUseInvoicing(profile)) redirect("/invoicing?toast=Access+denied");
  const admin = createAdminSupabaseClient();
  const challanId = txt(formData, "challan_id");
  if (!challanId) redirect("/invoicing/challans");

  const { data: c } = await admin.from("challans").select("running_challan_at, priced_at, converted_invoice_id, cancelled_at, source_dispatch_id").eq("id", challanId).maybeSingle();
  const ch = c as { running_challan_at: string | null; priced_at: string | null; converted_invoice_id: string | null; cancelled_at: string | null; source_dispatch_id: string | null } | null;
  if (!ch) redirect("/invoicing/challans?toast=Challan+not+found");
  if (ch!.cancelled_at || ch!.priced_at || ch!.converted_invoice_id) redirect(`/invoicing/challans?toast=${encodeURIComponent("This challan can't be a running bill")}`);
  const editMode = txt(formData, "edit_mode") === "1" && !!ch!.running_challan_at;

  const items = parseRunningItems(formData, false);
  if (items.length === 0) redirect(`/invoicing/challans?toast=${encodeURIComponent("Add at least one line item")}`);
  const now = new Date().toISOString();

  await admin.from("challan_custom_items").delete().eq("challan_id", challanId);
  await insertCustomItems(admin, challanId, items);
  await admin.from("challans").update({ ...RUN_TRANSPORT(formData), dropped_at: now, dropped_by: profile.id }).eq("id", challanId);
  // running_challan_at (mig 182) — best-effort, only stamped on first create.
  if (!editMode) {
    try { await admin.from("challans").update({ running_challan_at: now, running_challan_by: profile.id }).eq("id", challanId); } catch { /* pre-mig */ }
    if (ch!.source_dispatch_id) {
      await admin.from("dispatches").update({ delivered_at: now, delivered_by: profile.id, delivery_note: "Running bill — no physical on-road leg." }).eq("id", ch!.source_dispatch_id).is("delivered_at", null);
    }
  }
  void logAudit(profile.id, editMode ? "running_challan_edited" : "running_challan_created", "challan", challanId, {});
  refreshInvoicingPaths({ challanId });
  revalidatePath("/dispatch");
  revalidatePath("/invoicing/dropped");
  redirect(`/invoicing/dropped?toast=${encodeURIComponent(editMode ? "Running challan updated" : "Running challan created — dispatch delivered")}`);
}

export async function convertRunningToInvoiceAction(formData: FormData) {
  const { profile } = await requireAuth();
  if (!canUseInvoicing(profile)) redirect("/invoicing?toast=Access+denied");
  const admin = createAdminSupabaseClient();
  const challanId = txt(formData, "challan_id");
  if (!challanId) redirect("/invoicing/dropped");

  const { data: c } = await admin.from("challans").select("running_challan_at, inv_seq, challan_date, cancelled_at").eq("id", challanId).maybeSingle();
  const ch = c as { running_challan_at: string | null; inv_seq: number | null; challan_date: string | null; cancelled_at: string | null } | null;
  if (!ch) redirect("/invoicing/dropped?toast=Not+found");
  if (ch!.cancelled_at) redirect(`/invoicing/dropped?toast=${encodeURIComponent("Challan is cancelled")}`);
  const editMode = txt(formData, "edit_mode") === "1" && ch!.inv_seq != null;
  if (ch!.inv_seq != null && !editMode) redirect(`/invoicing/invoices?toast=${encodeURIComponent("Already invoiced — open it in Edit mode")}`);

  const items = parseRunningItems(formData, true);
  if (items.length === 0) redirect(`/invoicing/dropped?toast=${encodeURIComponent("Add rates for the line items")}`);
  const gm = txt(formData, "gst_mode");
  const gstMode = gm === "igst" || gm === "cgst_sgst" ? gm : null;
  // Mig 199 — per-TABLE GST slab, mandatory when GST is on. Invoice-level %
  // kept only when every table shares one slab; NULL when they differ.
  if (gstMode && items.some((it) => it.section_gst == null)) {
    redirect(`/invoicing/running/${challanId}/invoice?toast=${encodeURIComponent("Set the GST % on every table")}`);
  }
  if (!gstMode) items.forEach((it) => { it.section_gst = null; });
  const uniform = gstMode ? uniformGstPercent(items.map((it) => it.section_gst)) : null;
  const gstCols = {
    gst_mode: gstMode,
    igst_percent: gstMode === "igst" ? uniform : null,
    cgst_percent: gstMode === "cgst_sgst" && uniform != null ? uniform / 2 : null,
    sgst_percent: gstMode === "cgst_sgst" && uniform != null ? uniform / 2 : null,
  };
  // Mig 200 — discount on the final amount (default off).
  const dmRaw = txt(formData, "discount_mode");
  const discountMode = dmRaw === "amount" || dmRaw === "percent" ? dmRaw : null;
  const discountValue = discountMode ? Math.max(0, Number(txt(formData, "discount_value")) || 0) : null;
  const now = new Date().toISOString();

  // Mig 184 — editing an EXISTING running invoice is approval-gated: stage + stop.
  if (editMode) {
    const payload = { kind: "running" as const, items, gst: gstCols, discount: { discount_mode: discountMode, discount_value: discountValue } };
    await admin.from("challans").update({ pending_edit_payload: payload, pending_edit_at: now, pending_edit_by: profile.id } as never).eq("id", challanId);
    void logAudit(profile.id, "invoice_edit_requested", "challan", challanId, {});
    refreshInvoicingPaths({ challanId });
    revalidatePath("/invoicing/approval");
    redirect(`/invoicing/invoices?toast=${encodeURIComponent("Edit sent for approval — the invoice is unchanged until approved")}`);
  }

  await admin.from("challan_custom_items").delete().eq("challan_id", challanId);
  await insertCustomItems(admin, challanId, items);
  await admin.from("challans").update({
    ...gstCols,
    custom_billed_at: now, custom_billed_by: profile.id,
  }).eq("id", challanId);
  // Mig 200 — discount (best-effort so a pre-mig schema still converts).
  try {
    await admin.from("challans").update({ discount_mode: discountMode, discount_value: discountValue } as never).eq("id", challanId);
  } catch { /* pre-mig-200 */ }
  // Assign the locked INV number on first conversion only.
  if (!editMode) {
    const fy = financialYear(ch!.challan_date || new Date());
    try {
      const { data: seq } = await admin.rpc("next_doc_seq", { p_fy: `INV:${fy}` });
      if (typeof seq === "number") await admin.from("challans").update({ inv_fy: fy, inv_seq: seq }).eq("id", challanId);
    } catch { /* counter unavailable */ }
  }
  void logAudit(profile.id, editMode ? "running_invoice_edited" : "running_invoiced", "challan", challanId, {});
  refreshInvoicingPaths({ challanId });
  revalidatePath("/invoicing/dropped");
  redirect(`/invoicing/invoices?toast=${encodeURIComponent(editMode ? "Invoice updated — number unchanged" : "Running bill invoiced")}`);
}

/** Send a running challan back to the Challans page — undo the running challan +
 *  items and un-deliver the dispatch (back to Invoice-in-process). */
export async function sendRunningBackAction(formData: FormData) {
  const { profile } = await requireAuth();
  if (!canUseInvoicing(profile)) redirect("/invoicing?toast=Access+denied");
  const admin = createAdminSupabaseClient();
  const id = txt(formData, "id");
  if (!id) redirect("/invoicing/dropped");
  const { data: c } = await admin.from("challans").select("inv_seq, source_dispatch_id").eq("id", id).maybeSingle();
  const ch = c as { inv_seq: number | null; source_dispatch_id: string | null } | null;
  if (ch?.inv_seq != null) redirect(`/invoicing/dropped?toast=${encodeURIComponent("Cancel the invoice first, then send back")}`);
  await admin.from("challan_custom_items").delete().eq("challan_id", id);
  await admin.from("challans").update({ dropped_at: null, dropped_by: null, running_challan_at: null, running_challan_by: null, custom_billed_at: null, custom_billed_by: null }).eq("id", id);
  if (ch?.source_dispatch_id) {
    await admin.from("dispatches").update({ delivered_at: null, delivered_by: null, delivery_note: null }).eq("id", ch.source_dispatch_id);
  }
  void logAudit(profile.id, "running_sent_back", "challan", id, {});
  refreshInvoicingPaths({ challanId: id });
  revalidatePath("/dispatch");
  revalidatePath("/invoicing/dropped");
  redirect(`/invoicing/challans?toast=${encodeURIComponent("Running challan sent back to Challans")}`);
}

/** Create the custom whole-piece bill for a dropped challan — free line items,
 *  SAME CH number — and release the production dispatch straight to Delivered. */
export async function createCustomBillAction(formData: FormData) {
  const { profile } = await requireAuth();
  if (!canUseInvoicing(profile)) redirect("/invoicing?toast=Access+denied");
  const admin = createAdminSupabaseClient();
  const challanId = txt(formData, "challan_id");
  if (!challanId) redirect("/invoicing/challans");

  const { data: c } = await admin.from("challans").select("dropped_at, custom_billed_at, cancelled_at, source_dispatch_id").eq("id", challanId).maybeSingle();
  const ch = c as { dropped_at: string | null; custom_billed_at: string | null; cancelled_at: string | null; source_dispatch_id: string | null } | null;
  if (!ch) redirect("/invoicing/challans?toast=Challan+not+found");
  if (ch!.cancelled_at) redirect(`/invoicing/challans?toast=${encodeURIComponent("Challan is cancelled")}`);
  if (!ch!.dropped_at) redirect(`/invoicing/challans?toast=${encodeURIComponent("Drop the challan first")}`);
  // Jul 2026 — "Edit invoice": a billed (even invoiced) running bill may be
  // re-edited; the INV number never changes and the dispatch is not re-delivered.
  const editMode = txt(formData, "edit_mode") === "1" && !!ch!.custom_billed_at;
  if (ch!.custom_billed_at && !editMode) redirect(`/invoicing/challans?toast=${encodeURIComponent("Already custom-billed — open it in Edit mode")}`);

  const items = parseCustomItems(formData);
  if (items.length === 0) redirect(`/invoicing/challans?toast=${encodeURIComponent("Add at least one line item")}`);

  const gm = txt(formData, "gst_mode");
  const gstMode = gm === "igst" || gm === "cgst_sgst" ? gm : null;
  const now = new Date().toISOString();

  await admin.from("challan_custom_items").delete().eq("challan_id", challanId);
  await admin.from("challan_custom_items").insert(items.map((it, i) => ({ challan_id: challanId, position: i, ...it })));
  await admin.from("challans").update({
    gst_mode: gstMode,
    igst_percent: gstMode === "igst" ? (Number(txt(formData, "igst_percent")) || 0) : null,
    cgst_percent: gstMode === "cgst_sgst" ? (Number(txt(formData, "cgst_percent")) || 0) : null,
    sgst_percent: gstMode === "cgst_sgst" ? (Number(txt(formData, "sgst_percent")) || 0) : null,
    // Transport (mig 169) — captured on the custom-bill form, printed on the bill.
    transport_company: txt(formData, "transport_company") || null,
    transport_vehicle_no: txt(formData, "transport_vehicle_no") || null,
    transport_driver_name: txt(formData, "transport_driver_name") || null,
    transport_driver_phone: txt(formData, "transport_driver_phone") || null,
    lr_no: txt(formData, "lr_no") || null,
    transport_phone: txt(formData, "transport_phone") || null,
    custom_billed_at: now, custom_billed_by: profile.id,
  }).eq("id", challanId);

  // Release the production dispatch straight to Delivered (skip On-the-road):
  // the delivered lane is gated only on delivered_at, so on_road_at stays null.
  // (Edit mode never re-delivers — the .is(delivered_at, null) guard holds.)
  if (ch!.source_dispatch_id && !editMode) {
    await admin.from("dispatches")
      .update({ delivered_at: now, delivered_by: profile.id, delivery_note: "Custom whole-piece bill (dropped) — no physical on-road leg." })
      .eq("id", ch!.source_dispatch_id)
      .is("delivered_at", null);
  }

  void logAudit(profile.id, editMode ? "running_bill_edited" : "challan_custom_billed", "challan", challanId, {});
  refreshInvoicingPaths({ challanId });
  revalidatePath("/dispatch");
  revalidatePath("/invoicing/dropped");
  if (editMode) redirect(`/invoicing/invoices?toast=${encodeURIComponent("Invoice updated — number unchanged")}`);
  redirect(`/invoicing/challans?toast=${encodeURIComponent("Custom bill created — dispatch marked Delivered")}`);
}

/** Convert a custom bill to a tax invoice — assign INV-<fy>-<n> (shared counter). */
export async function convertCustomBillToInvoiceAction(formData: FormData) {
  const { profile } = await requireAuth();
  if (!canUseInvoicing(profile)) redirect("/invoicing?toast=Access+denied");
  const admin = createAdminSupabaseClient();
  const challanId = txt(formData, "challan_id");
  if (!challanId) redirect("/invoicing/challans");

  const { data: c } = await admin.from("challans").select("custom_billed_at, inv_seq, challan_date, cancelled_at").eq("id", challanId).maybeSingle();
  const ch = c as { custom_billed_at: string | null; inv_seq: number | null; challan_date: string | null; cancelled_at: string | null } | null;
  if (!ch) redirect("/invoicing/challans?toast=Challan+not+found");
  if (ch!.cancelled_at) redirect(`/invoicing/challans?toast=${encodeURIComponent("Challan is cancelled")}`);
  if (!ch!.custom_billed_at) redirect(`/invoicing/challans?toast=${encodeURIComponent("Create the custom bill first")}`);
  if (ch!.inv_seq != null) redirect(`/invoicing/challans?toast=${encodeURIComponent("Already invoiced")}`);

  const fy = financialYear(ch!.challan_date || new Date());
  // LOCKED number (Daksh Jul 2026) — always the next auto from the shared counter.
  let invSeq: number | null = null;
  try {
    const { data: seq } = await admin.rpc("next_doc_seq", { p_fy: `INV:${fy}` });
    if (typeof seq === "number") invSeq = seq;
  } catch { /* mig 172 not applied */ }
  await admin.from("challans").update({ inv_fy: invSeq != null ? fy : null, inv_seq: invSeq }).eq("id", challanId);

  void logAudit(profile.id, "challan_custom_invoiced", "challan", challanId, { fy, invSeq });
  refreshInvoicingPaths({ challanId });
  redirect(`/invoicing/invoices?toast=${encodeURIComponent(`Invoice created — INV-${fy}-${String(invSeq ?? 0).padStart(2, "0")}`)}`);
}

// ════════════════════════════════════════════════════════════════
// Mig 178 — invoice-number freeing. Numbers are LOCKED (auto-assigned only);
// cancelling an invoice frees its number: head-of-series cancellations roll the
// counter back (so the next invoice reuses the number, collapsing through any
// freed tail), mid-series ones are recorded in freed_invoice_numbers and shown
// as an indication on Review & price.
// ════════════════════════════════════════════════════════════════

/** Cancel a PRICED-CHALLAN invoice: free its number, wipe pricing/approval —
 *  the challan returns to the Challans page (open) for a fresh cycle. */
export async function cancelPricedInvoiceAction(formData: FormData): Promise<void> {
  const { profile } = await requireAuth(["owner", "developer", "accountant_star"]);
  const admin = createAdminSupabaseClient();
  const challanId = txt(formData, "challan_id");
  if (!challanId) redirect("/invoicing/invoices");

  const { data: c } = await admin.from("challans")
    .select("inv_fy, inv_seq, priced_at, cancelled_at, converted_invoice_id")
    .eq("id", challanId).maybeSingle();
  const ch = c as { inv_fy: string | null; inv_seq: number | null; priced_at: string | null; cancelled_at: string | null; converted_invoice_id: string | null } | null;
  if (!ch) redirect("/invoicing/invoices?toast=Invoice+not+found");
  if (ch!.cancelled_at || ch!.converted_invoice_id) redirect(`/invoicing/invoices?toast=${encodeURIComponent("Challan is no longer an invoice")}`);

  // Mig 184 — cancelling is approval-gated: file a request; owner / accountant★
  // approve it (frees the number + returns the challan) or reject it.
  await admin.from("challans").update({ pending_cancel_at: new Date().toISOString(), pending_cancel_by: profile.id } as never).eq("id", challanId);
  void logAudit(profile.id, "invoice_cancel_requested", "challan", challanId, {});
  refreshInvoicingPaths({ challanId });
  revalidatePath("/invoicing/approval");
  redirect(`/invoicing/invoices?toast=${encodeURIComponent("Cancel request sent for approval")}`);
}

/** Cancel a RUNNING-BILL invoice: free the number; the custom bill stays and
 *  the challan returns to the Running bills page (re-invoiceable). */
export async function cancelRunningInvoiceAction(formData: FormData): Promise<void> {
  const { profile } = await requireAuth(["owner", "developer", "accountant_star"]);
  const admin = createAdminSupabaseClient();
  const challanId = txt(formData, "challan_id");
  if (!challanId) redirect("/invoicing/invoices");

  const { data: c } = await admin.from("challans")
    .select("inv_fy, inv_seq, custom_billed_at, cancelled_at").eq("id", challanId).maybeSingle();
  const ch = c as { inv_fy: string | null; inv_seq: number | null; custom_billed_at: string | null; cancelled_at: string | null } | null;
  if (!ch || !ch.custom_billed_at) redirect("/invoicing/invoices?toast=Invoice+not+found");
  if (ch!.cancelled_at) redirect(`/invoicing/invoices?toast=${encodeURIComponent("Challan is cancelled")}`);

  // Mig 184 — approval-gated cancel: stage the request.
  await admin.from("challans").update({ pending_cancel_at: new Date().toISOString(), pending_cancel_by: profile.id } as never).eq("id", challanId);
  void logAudit(profile.id, "running_invoice_cancel_requested", "challan", challanId, {});
  refreshInvoicingPaths({ challanId });
  revalidatePath("/invoicing/approval");
  redirect(`/invoicing/invoices?toast=${encodeURIComponent("Cancel request sent for approval")}`);
}

// ════════════════════════════════════════════════════════════════
// Mig 184 — invoice change requests. Editing / cancelling an EXISTING invoice
// stages a request; owner / accountant★ approve or reject it on the Approval
// page. Approve-edit applies the staged payload; approve-cancel frees the
// number + retires the invoice; reject leaves the invoice exactly as it was.
// ════════════════════════════════════════════════════════════════

function readChange(fd: FormData): { source: ChangeSource; id: string } | null {
  const s = txt(fd, "source");
  const id = txt(fd, "id");
  if (!id || !(s === "purchase" || s === "running" || s === "bulk" || s === "other")) return null;
  return { source: s, id };
}

/** Approve a staged EDIT → apply the payload to the live invoice. */
export async function approveInvoiceEditAction(formData: FormData): Promise<void> {
  const { profile } = await requireAuth(["owner", "developer", "accountant_star"]);
  const admin = createAdminSupabaseClient();
  const c = readChange(formData);
  if (!c) redirect("/invoicing/approval");
  const table = pendingTableOf(c!.source);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (admin.from(table) as any).select("pending_edit_payload").eq("id", c!.id).maybeSingle();
  const payload = (data?.pending_edit_payload ?? null) as EditPayload | null;
  if (payload) await applyInvoiceEdit(admin, c!.source, c!.id, payload);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (admin.from(table) as any).update({ pending_edit_at: null, pending_edit_by: null, pending_edit_payload: null }).eq("id", c!.id);
  void logAudit(profile.id, "invoice_edit_approved", table, c!.id, {});
  revalidatePath("/invoicing/approval");
  revalidatePath("/invoicing/invoices");
  revalidatePath("/invoicing");
  redirect(`/invoicing/approval?toast=${encodeURIComponent("Edit approved & applied")}`);
}

/** Reject a staged EDIT → discard it; the invoice stays as it was. */
export async function rejectInvoiceEditAction(formData: FormData): Promise<void> {
  const { profile } = await requireAuth(["owner", "developer", "accountant_star"]);
  const admin = createAdminSupabaseClient();
  const c = readChange(formData);
  if (!c) redirect("/invoicing/approval");
  const table = pendingTableOf(c!.source);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (admin.from(table) as any).update({ pending_edit_at: null, pending_edit_by: null, pending_edit_payload: null }).eq("id", c!.id);
  void logAudit(profile.id, "invoice_edit_rejected", table, c!.id, {});
  revalidatePath("/invoicing/approval");
  revalidatePath("/invoicing/invoices");
  redirect(`/invoicing/approval?toast=${encodeURIComponent("Edit rejected — invoice unchanged")}`);
}

/** Approve a CANCEL request → cancel the invoice (free number, retire). */
export async function approveInvoiceCancelAction(formData: FormData): Promise<void> {
  const { profile } = await requireAuth(["owner", "developer", "accountant_star"]);
  const admin = createAdminSupabaseClient();
  const c = readChange(formData);
  if (!c) redirect("/invoicing/approval");
  await applyInvoiceCancel(admin, c!.source, c!.id, profile.id);
  const table = pendingTableOf(c!.source);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (admin.from(table) as any).update({ pending_cancel_at: null, pending_cancel_by: null, pending_edit_at: null, pending_edit_by: null, pending_edit_payload: null }).eq("id", c!.id);
  void logAudit(profile.id, "invoice_cancel_approved", table, c!.id, {});
  revalidatePath("/invoicing/approval");
  revalidatePath("/invoicing/invoices");
  revalidatePath("/invoicing/bulk");
  revalidatePath("/invoicing/challans");
  revalidatePath("/invoicing/other");
  revalidatePath("/invoicing");
  redirect(`/invoicing/approval?toast=${encodeURIComponent("Invoice cancelled — number freed")}`);
}

/** Reject a CANCEL request → keep the invoice. */
export async function rejectInvoiceCancelAction(formData: FormData): Promise<void> {
  const { profile } = await requireAuth(["owner", "developer", "accountant_star"]);
  const admin = createAdminSupabaseClient();
  const c = readChange(formData);
  if (!c) redirect("/invoicing/approval");
  const table = pendingTableOf(c!.source);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (admin.from(table) as any).update({ pending_cancel_at: null, pending_cancel_by: null }).eq("id", c!.id);
  void logAudit(profile.id, "invoice_cancel_rejected", table, c!.id, {});
  revalidatePath("/invoicing/approval");
  redirect(`/invoicing/approval?toast=${encodeURIComponent("Cancel rejected — invoice kept")}`);
}

// ════════════════════════════════════════════════════════════════
// Parties (customer master)
// ════════════════════════════════════════════════════════════════

/** Create-or-update an invoice party. id present → update, else
 *  insert. Matches the upsertBillVendorAction pattern from
 *  /accounts/actions.ts so the create/edit form can be one
 *  component. */
export async function upsertInvoicePartyAction(
  formData: FormData,
): Promise<ActionResult> {
  const { profile } = await requireAuth();
  if (!canUseInvoicing(profile)) {
    return { ok: false, error: "Invoicing access denied." };
  }

  const id = txt(formData, "id");
  const name = txt(formData, "name");
  if (!name) return { ok: false, error: "Party name is required." };
  if (name.length > 200) return { ok: false, error: "Name too long (max 200)." };

  const payload: Record<string, unknown> = {
    name,
    gstin: txt(formData, "gstin") || null,
    pan: txt(formData, "pan") || null,
    address: txt(formData, "address") || null,
    phone: txt(formData, "phone") || null,
    email: txt(formData, "email") || null,
    notes: txt(formData, "notes") || null,
  };

  // Mig 176 — billing extras + shipping block + per-client GST default. Written
  // ONLY when the form actually sends the field, so a form that omits them (the
  // original parties form) never wipes values set elsewhere.
  const setIfPresent = (key: string, val: unknown) => { if (formData.has(key)) payload[key] = val; };
  setIfPresent("category", txt(formData, "category") || null);
  setIfPresent("city", txt(formData, "city") || null);
  setIfPresent("state", txt(formData, "state") || null);
  setIfPresent("state_code", txt(formData, "state_code") || null);
  setIfPresent("ship_name", txt(formData, "ship_name") || null);
  setIfPresent("ship_address", txt(formData, "ship_address") || null);
  setIfPresent("ship_city", txt(formData, "ship_city") || null);
  setIfPresent("ship_state", txt(formData, "ship_state") || null);
  setIfPresent("ship_state_code", txt(formData, "ship_state_code") || null);
  setIfPresent("ship_gstin", txt(formData, "ship_gstin") || null);
  setIfPresent("ship_phone", txt(formData, "ship_phone") || null);
  if (formData.has("gst_mode")) { const g = txt(formData, "gst_mode"); payload.gst_mode = g === "igst" || g === "cgst_sgst" ? g : null; }
  setIfPresent("igst_percent", txt(formData, "igst_percent") ? Number(txt(formData, "igst_percent")) || null : null);
  setIfPresent("cgst_percent", txt(formData, "cgst_percent") ? Number(txt(formData, "cgst_percent")) || null : null);
  setIfPresent("sgst_percent", txt(formData, "sgst_percent") ? Number(txt(formData, "sgst_percent")) || null : null);

  const supabase = createAdminSupabaseClient();

  if (id) {
    // UPDATE path.
    payload.updated_at = new Date().toISOString();
    payload.updated_by = profile.id;
    const { data: updated, error } = await supabase
      .from("invoice_parties")
      .update(payload)
      .eq("id", id)
      .select("id, name")
      .maybeSingle();
    if (error) {
      if (error.code === "23505")
        return { ok: false, error: "Another party already uses this name." };
      return { ok: false, error: error.message };
    }
    if (!updated) return { ok: false, error: "Party not found." };
    void logAudit(profile.id, "invoice_party_updated", "invoice_party", id, {
      name,
    });
    refreshInvoicingPaths({ partyId: id });
    return { ok: true };
  }

  // INSERT path.
  payload.created_by = profile.id;
  payload.updated_by = profile.id;
  const { data: row, error } = await supabase
    .from("invoice_parties")
    .insert(payload)
    .select("id")
    .single();
  if (error) {
    if (error.code === "23505")
      return { ok: false, error: "Another party already uses this name." };
    return { ok: false, error: error.message };
  }
  void logAudit(profile.id, "invoice_party_created", "invoice_party", row.id, {
    name,
  });
  refreshInvoicingPaths({ partyId: row.id });
  return { ok: true };
}

/** Mig 154 (relocated) — map a TEMPLE to its billing customer (invoice
 *  client). Mig 158 — the temple IS the client, so instead of mapping to a
 *  separate party, the accountant fills the temple's own billing fields
 *  (GSTIN, PAN, address, email, phone). Client name = temple name (read-only).
 *  One field per call so the grid can save on blur. */
export async function setTempleBillingAction(
  formData: FormData,
): Promise<ActionResult> {
  const { profile } = await requireAuth();
  if (!canUseInvoicing(profile)) {
    return { ok: false, error: "Invoicing access denied." };
  }
  const templeId = txt(formData, "temple_id");
  if (!templeId) return { ok: false, error: "Missing temple." };

  const FIELDS = [
    // Billing block
    "bill_name", "bill_gstin", "bill_pan", "bill_address", "bill_city", "bill_state", "bill_state_code", "bill_email", "bill_phone",
    // Shipping block
    "ship_name", "ship_address", "ship_city", "ship_state", "ship_state_code", "ship_gstin", "ship_pan", "ship_phone", "ship_email",
    // Shared optional
    "vendor_code", "work_order_no",
  ] as const;
  const patch: Record<string, string | null> = {};
  for (const f of FIELDS) {
    if (formData.has(f)) patch[f] = txt(formData, f) || null;
  }
  if (Object.keys(patch).length === 0) return { ok: false, error: "Nothing to save." };

  const supabase = createAdminSupabaseClient();
  const { data: updated, error } = await supabase
    .from("temples")
    .update(patch)
    .eq("id", templeId)
    .select("id")
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!updated) return { ok: false, error: "Temple not found." };

  void logAudit(profile.id, "temple_billing_set", "temple", templeId, { fields: Object.keys(patch) });
  revalidatePath("/invoicing");
  revalidatePath("/invoicing/temple-clients");
  return { ok: true };
}

/** Rename a temple from the Client-billing page (accountants too). Cascades the
 *  name across all denormalised tables via rename_temple() (mig 161). The
 *  code_prefix stays locked — slab IDs embed it. */
export async function renameTempleClientAction(
  templeId: string,
  newName: string,
): Promise<ActionResult> {
  const { profile } = await requireAuth();
  if (!canUseInvoicing(profile)) return { ok: false, error: "Invoicing access denied." };
  const name = (newName ?? "").trim();
  if (!templeId) return { ok: false, error: "Missing temple." };
  if (!name) return { ok: false, error: "Enter a name." };
  const supabase = createAdminSupabaseClient();
  const { error } = await supabase.rpc("rename_temple", { p_id: templeId, p_new: name });
  if (error) return { ok: false, error: error.message };
  void logAudit(profile.id, "temple_renamed", "temple", templeId, { name });
  revalidatePath("/invoicing");
  revalidatePath("/invoicing/temple-clients");
  return { ok: true };
}

/** Mig 158 — backfill invoicing challans for approved dispatches that don't
 *  have one yet (e.g. a truck approved/on-the-road before this flow, or a
 *  temple that previously had no client mapped). Idempotent. */
export async function syncDispatchChallansAction() {
  const { profile } = await requireAuth();
  if (!canUseInvoicing(profile)) redirect("/invoicing?toast=Access+denied");
  const supabase = createAdminSupabaseClient();
  const { createInvoicingChallanFromDispatch } = await import("@/lib/dispatch-invoicing-bridge");

  // Every dispatch that left the station (approved) — on the road OR delivered.
  const { data: dispatches } = await supabase
    .from("dispatches")
    .select("id, temple, challan_number")
    .not("approved_at", "is", null);
  const all = (dispatches ?? []) as Array<{ id: string; temple: string; challan_number: number | null }>;

  // Skip the ones that already have a challan.
  const { data: existingRows } = await supabase
    .from("challans")
    .select("source_dispatch_id")
    .not("source_dispatch_id", "is", null);
  const already = new Set(((existingRows ?? []) as Array<{ source_dispatch_id: string | null }>).map((r) => r.source_dispatch_id));

  let made = 0;
  for (const d of all) {
    if (already.has(d.id)) continue;
    try {
      const res = await createInvoicingChallanFromDispatch(supabase, d.id, d.temple, d.challan_number ?? null, profile.id);
      if (res === "created") made += 1;
    } catch (e) {
      console.warn("[sync dispatch challan] non-fatal", d.id, e);
    }
  }

  refreshInvoicingPaths();
  redirect(`/invoicing/challans?toast=${encodeURIComponent(made > 0 ? `Created ${made} challan${made !== 1 ? "s" : ""} from dispatch` : "All dispatches already billed")}`);
}

export async function archiveInvoicePartyAction(
  formData: FormData,
): Promise<ActionResult> {
  const { profile } = await requireAuth();
  if (!canUseInvoicing(profile)) {
    return { ok: false, error: "Invoicing access denied." };
  }
  const id = txt(formData, "id");
  if (!id) return { ok: false, error: "Missing party id." };

  const supabase = createAdminSupabaseClient();
  const { data: updated, error } = await supabase
    .from("invoice_parties")
    .update({ is_active: false, updated_at: new Date().toISOString(), updated_by: profile.id })
    .eq("id", id)
    .eq("is_active", true)
    .select("id, name")
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!updated) return { ok: false, error: "Party already archived or not found." };

  void logAudit(profile.id, "invoice_party_archived", "invoice_party", id, {
    name: (updated as { name?: string }).name,
  });
  refreshInvoicingPaths({ partyId: id });
  return { ok: true };
}

// ════════════════════════════════════════════════════════════════
// Challans (delivery notes — items + qty, no money)
// ════════════════════════════════════════════════════════════════

type ChallanItemInput = {
  description: string;
  quantity: number;
  unit?: string | null;
};

function parseChallanItems(raw: unknown): ChallanItemInput[] | string {
  if (typeof raw !== "string") return "Items missing.";
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return "Items JSON malformed.";
  }
  if (!Array.isArray(parsed)) return "Items must be an array.";
  if (parsed.length === 0) return "Add at least one item.";

  const out: ChallanItemInput[] = [];
  for (const raw of parsed) {
    if (typeof raw !== "object" || raw == null) return "Invalid item.";
    const o = raw as Record<string, unknown>;
    const description = typeof o.description === "string" ? o.description.trim() : "";
    const quantity = Number(o.quantity);
    const unitRaw = typeof o.unit === "string" ? o.unit.trim().toLowerCase() : "";
    const unit = unitRaw === "sft" || unitRaw === "cft" || unitRaw === "pcs"
      ? unitRaw
      : null;
    if (!description) return "Item description required.";
    if (!Number.isFinite(quantity) || quantity <= 0)
      return "Item quantity must be > 0.";
    out.push({ description, quantity, unit });
  }
  return out;
}

export async function createChallanAction(formData: FormData): Promise<ActionResult> {
  const { profile } = await requireAuth();
  if (!canUseInvoicing(profile)) {
    return { ok: false, error: "Invoicing access denied." };
  }

  const partyId = txt(formData, "invoice_party_id");
  const challanDate = txt(formData, "challan_date");
  const notes = txt(formData, "notes") || null;
  if (!partyId) return { ok: false, error: "Pick a party first." };
  if (!challanDate || !/^\d{4}-\d{2}-\d{2}$/.test(challanDate)) {
    return { ok: false, error: "Challan date is required (YYYY-MM-DD)." };
  }

  const items = parseChallanItems(formData.get("items_json"));
  if (typeof items === "string") return { ok: false, error: items };

  const supabase = createAdminSupabaseClient();

  // Confirm the party exists.
  const { data: party, error: partyErr } = await supabase
    .from("invoice_parties")
    .select("id, name")
    .eq("id", partyId)
    .maybeSingle();
  if (partyErr) return { ok: false, error: partyErr.message };
  if (!party) return { ok: false, error: "Party not found." };

  // Insert challan header — challan_number auto-fills via trigger.
  const { data: header, error: insErr } = await supabase
    .from("challans")
    .insert({
      challan_date: challanDate,
      invoice_party_id: partyId,
      notes,
      created_by: profile.id,
    })
    .select("id, challan_number")
    .single();
  if (insErr) return { ok: false, error: insErr.message };

  // Insert items.
  const itemRows = items.map((it, idx) => ({
    challan_id: header.id,
    description: it.description,
    quantity: it.quantity,
    unit: it.unit,
    position: idx,
  }));
  const { error: itemErr } = await supabase
    .from("challan_items")
    .insert(itemRows);
  if (itemErr) {
    await supabase.from("challans").delete().eq("id", header.id);
    return { ok: false, error: "Failed to save items: " + itemErr.message };
  }

  void logAudit(profile.id, "challan_created", "challan", header.id, {
    challan_number: header.challan_number,
    party_id: partyId,
    party_name: (party as { name?: string }).name,
    item_count: items.length,
  });
  refreshInvoicingPaths({ challanId: header.id, partyId });
  return { ok: true };
}

export async function cancelChallanAction(formData: FormData): Promise<ActionResult> {
  const { profile } = await requireAuth();
  if (!canUseInvoicing(profile)) {
    return { ok: false, error: "Invoicing access denied." };
  }
  const id = txt(formData, "id");
  const reason = txt(formData, "reason");
  if (!id) return { ok: false, error: "Missing challan id." };

  const admin = createAdminSupabaseClient();
  const { data: ch } = await admin
    .from("challans")
    .select("id, challan_number, invoice_party_id, source_dispatch_id, cancelled_at, converted_invoice_id, owner_approved_at, inv_fy, inv_seq")
    .eq("id", id)
    .maybeSingle();
  const c = ch as {
    id: string; challan_number: string | null; invoice_party_id: string | null; source_dispatch_id: string | null;
    cancelled_at: string | null; converted_invoice_id: string | null; owner_approved_at: string | null;
    inv_fy: string | null; inv_seq: number | null;
  } | null;
  if (!c) return { ok: false, error: "Challan not found." };
  if (c.cancelled_at) return { ok: false, error: "Challan is already cancelled." };
  if (c.converted_invoice_id) return { ok: false, error: "Cannot cancel — already converted to an invoice." };
  if (c.owner_approved_at) return { ok: false, error: "Owner already approved this invoice — cannot cancel here." };

  // Stamp WHO cancelled + their reason so the dispatch's Waiting-approval header
  // reads "Cancelled by <name>: <reason>".
  const who = (profile.full_name ?? "").trim() || "someone";
  const stamp = `Cancelled by ${who}${reason ? `: ${reason}` : ""}`;

  if (c.source_dispatch_id) {
    // Mig 167/168 — a DISPATCH challan: bounce the dispatch back to Waiting
    // approval (flagged returned/cancelled), then remove the challan so a
    // re-verify recreates a fresh one. (Was leaving the truck stuck in
    // "Invoice in process" before — Daksh.)
    await admin
      .from("dispatches")
      .update({ approved_at: null, approved_by: null, on_road_at: null, returned_at: new Date().toISOString(), return_reason: stamp })
      .eq("id", c.source_dispatch_id)
      .is("delivered_at", null);
    // Free a locked invoice number before the row is deleted (a priced-but-not-
    // yet-approved challan holds one — otherwise the INV counter leaks ahead).
    await freeInvoiceNumber(admin, c.inv_fy, c.inv_seq, profile.id);
    void logAudit(profile.id, "challan_cancelled", "challan", id, { challan_number: c.challan_number, reason: stamp, freedInvoice: c.inv_seq });
    await admin.from("challans").delete().eq("id", id);
    refreshInvoicingPaths({ challanId: id });
    revalidatePath("/dispatch");
    revalidatePath("/", "layout");
    return { ok: true };
  }

  // Manual (non-dispatch) challan — soft-cancel, keep the record.
  const { data: updated, error } = await admin
    .from("challans")
    .update({ cancelled_at: new Date().toISOString(), cancel_reason: reason || null })
    .eq("id", id)
    .is("cancelled_at", null)
    .is("converted_invoice_id", null)
    .select("id")
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!updated) return { ok: false, error: "Cannot cancel — challan already cancelled or converted." };
  void logAudit(profile.id, "challan_cancelled", "challan", id, { challan_number: c.challan_number, reason });
  refreshInvoicingPaths({ challanId: id, partyId: c.invoice_party_id ?? undefined });
  return { ok: true };
}

/** Convert a challan into an invoice. Server-side flow:
 *   1. Load challan + items (must be uncancelled, unconverted).
 *   2. Insert invoice with party info copied from the party row +
 *      source_challan_id link.
 *   3. Insert invoice_items from posted rates × challan items.
 *   4. Mark challan as converted (converted_invoice_id +
 *      converted_at).
 *   5. Audit log.
 *
 * On any failure mid-flight, delete the partially-created invoice
 * so we don't leave orphans.
 */
type RateInput = { rate: number };

export async function convertChallanToInvoiceAction(
  formData: FormData,
): Promise<ActionResult> {
  const { profile } = await requireAuth();
  if (!canUseInvoicing(profile)) {
    return { ok: false, error: "Invoicing access denied." };
  }

  const challanId = txt(formData, "challan_id");
  const invoiceDate = txt(formData, "invoice_date");
  const gstPercent = Number(formData.get("gst_percent") ?? 0);
  const notes = txt(formData, "notes") || null;
  if (!challanId) return { ok: false, error: "Missing challan id." };
  if (!invoiceDate || !/^\d{4}-\d{2}-\d{2}$/.test(invoiceDate)) {
    return { ok: false, error: "Invoice date is required (YYYY-MM-DD)." };
  }
  if (!Number.isFinite(gstPercent) || gstPercent < 0 || gstPercent > 100) {
    return { ok: false, error: "GST % must be between 0 and 100." };
  }

  // Parse rates payload — array aligned with challan_items position.
  let rates: RateInput[] = [];
  try {
    const raw = String(formData.get("rates_json") ?? "[]");
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error("not array");
    rates = parsed.map((r) => ({ rate: Number((r as { rate?: number })?.rate ?? 0) }));
  } catch {
    return { ok: false, error: "Rates JSON malformed." };
  }

  const supabase = createAdminSupabaseClient();

  // Load challan + items + party.
  const { data: challan, error: chErr } = await supabase
    .from("challans")
    .select("id, challan_number, invoice_party_id, cancelled_at, converted_invoice_id, priced_at")
    .eq("id", challanId)
    .maybeSingle();
  if (chErr) return { ok: false, error: chErr.message };
  if (!challan) return { ok: false, error: "Challan not found." };
  const c = challan as {
    id: string;
    challan_number: string;
    invoice_party_id: string;
    cancelled_at: string | null;
    converted_invoice_id: string | null;
    priced_at: string | null;
  };
  if (c.cancelled_at) return { ok: false, error: "Challan is cancelled." };
  if (c.converted_invoice_id)
    return { ok: false, error: "Challan was already converted to an invoice." };
  // Already priced ⇒ the priced challan IS its tax invoice; don't also mint a
  // legacy invoices row (would double-bill the same goods).
  if (c.priced_at)
    return { ok: false, error: "Challan is already priced as a tax invoice." };

  const [{ data: items }, { data: party }] = await Promise.all([
    supabase
      .from("challan_items")
      .select("id, description, quantity, unit, position")
      .eq("challan_id", challanId)
      .order("position"),
    supabase
      .from("invoice_parties")
      .select("id, name, gstin, address, phone")
      .eq("id", c.invoice_party_id)
      .maybeSingle(),
  ]);
  const challanItems = (items ?? []) as Array<{
    id: string;
    description: string;
    quantity: number;
    unit: string | null;
    position: number;
  }>;
  if (challanItems.length === 0)
    return { ok: false, error: "Challan has no items to convert." };
  if (!party) return { ok: false, error: "Party not found." };

  if (rates.length !== challanItems.length) {
    return {
      ok: false,
      error: `Expected ${challanItems.length} rates, got ${rates.length}.`,
    };
  }
  for (const r of rates) {
    if (!Number.isFinite(r.rate) || r.rate < 0) {
      return { ok: false, error: "Each rate must be ≥ 0." };
    }
  }

  const subtotal = challanItems.reduce(
    (s, it, idx) => s + it.quantity * (rates[idx]?.rate ?? 0),
    0,
  );

  const p = party as {
    id: string;
    name: string;
    gstin: string | null;
    address: string | null;
    phone: string | null;
  };

  // Insert invoice header.
  const { data: header, error: insErr } = await supabase
    .from("invoices")
    .insert({
      invoice_date: invoiceDate,
      customer_name: p.name,
      customer_address: p.address,
      customer_gstin: p.gstin,
      customer_phone: p.phone,
      subtotal,
      gst_percent: gstPercent,
      notes,
      created_by: profile.id,
      invoice_party_id: p.id,
      source_challan_id: c.id,
    })
    .select("id, invoice_number, total")
    .single();
  if (insErr) return { ok: false, error: insErr.message };

  // Insert items with rate per challan item.
  const invoiceItems = challanItems.map((ci, idx) => ({
    invoice_id: header.id,
    description: ci.description + (ci.unit ? ` (${ci.unit.toUpperCase()})` : ""),
    quantity: ci.quantity,
    rate: rates[idx]?.rate ?? 0,
    position: ci.position,
  }));
  const { error: itemErr } = await supabase
    .from("invoice_items")
    .insert(invoiceItems);
  if (itemErr) {
    await supabase.from("invoices").delete().eq("id", header.id);
    return { ok: false, error: "Failed to save items: " + itemErr.message };
  }

  // Mark challan as converted.
  const { error: convErr } = await supabase
    .from("challans")
    .update({
      converted_invoice_id: header.id,
      converted_at: new Date().toISOString(),
    })
    .eq("id", c.id);
  if (convErr) {
    await supabase.from("invoices").delete().eq("id", header.id);
    return {
      ok: false,
      error: "Failed to link challan to invoice: " + convErr.message,
    };
  }

  void logAudit(profile.id, "challan_converted_to_invoice", "challan", c.id, {
    challan_number: c.challan_number,
    invoice_id: header.id,
    invoice_number: header.invoice_number,
    party_id: p.id,
    party_name: p.name,
    subtotal,
    gst_percent: gstPercent,
    total: Number((header as { total?: number }).total ?? subtotal),
  });
  void logAudit(profile.id, "invoice_created", "invoice", header.id, {
    invoice_number: header.invoice_number,
    customer_name: p.name,
    subtotal,
    gst_percent: gstPercent,
    item_count: invoiceItems.length,
    invoice_party_id: p.id,
    source_challan_id: c.id,
  });
  refreshInvoicingPaths({ challanId: c.id, partyId: p.id, invoiceId: header.id });
  return { ok: true };
}

// ════════════════════════════════════════════════════════════════
// Invoices (existing Mig 038 flow, extended in Mig 058)
// ════════════════════════════════════════════════════════════════

type LineItemInput = {
  description: string;
  quantity: number;
  rate: number;
};

export async function createInvoiceAction(formData: FormData) {
  const { profile } = await requireAuth();
  if (!canUseInvoicing(profile)) {
    redirect("/invoicing/invoices/new?error=Invoicing+access+denied");
  }
  const supabase = createAdminSupabaseClient();

  const customerName = String(formData.get("customer_name") || "").trim();
  if (!customerName) {
    redirect("/invoicing/invoices/new?error=Customer+name+is+required");
  }
  const customerAddress = String(formData.get("customer_address") || "").trim() || null;
  const customerGstin = String(formData.get("customer_gstin") || "").trim() || null;
  const customerPhone = String(formData.get("customer_phone") || "").trim() || null;
  const invoiceDate = String(formData.get("invoice_date") || "").trim() || null;
  const gstPercent = Number(formData.get("gst_percent") || 0);
  const notes = String(formData.get("notes") || "").trim() || null;
  // Mig 058 — optional FKs. Empty string from the form → null.
  const invoicePartyIdRaw = String(formData.get("invoice_party_id") || "").trim();
  const invoicePartyId = invoicePartyIdRaw || null;
  const sourceChallanIdRaw = String(formData.get("source_challan_id") || "").trim();
  const sourceChallanId = sourceChallanIdRaw || null;

  // Items posted as `items_json` from the client form.
  let items: LineItemInput[] = [];
  try {
    const raw = String(formData.get("items_json") || "[]");
    items = JSON.parse(raw) as LineItemInput[];
  } catch {
    items = [];
  }
  items = items
    .filter((i) => i && typeof i.description === "string" && i.description.trim() !== "")
    .map((i) => ({
      description: String(i.description).trim(),
      quantity: Number(i.quantity) || 0,
      rate: Number(i.rate) || 0,
    }));

  if (items.length === 0) {
    redirect("/invoicing/invoices/new?error=Add+at+least+one+line+item");
  }

  const subtotal = items.reduce((sum, i) => sum + i.quantity * i.rate, 0);

  // 1. Insert the header. invoice_number auto-fills via the trigger
  //    added in migration 038 (assign_invoice_number).
  const { data: header, error: insertErr } = await supabase
    .from("invoices")
    .insert({
      invoice_date: invoiceDate,
      customer_name: customerName,
      customer_address: customerAddress,
      customer_gstin: customerGstin,
      customer_phone: customerPhone,
      subtotal,
      gst_percent: gstPercent,
      notes,
      created_by: profile.id,
      invoice_party_id: invoicePartyId,
      source_challan_id: sourceChallanId,
    })
    .select("id, invoice_number")
    .single();

  if (insertErr || !header) {
    redirect(
      `/invoicing/invoices/new?error=${encodeURIComponent(
        insertErr?.message ?? "Failed to create invoice",
      )}`,
    );
  }

  // 2. Insert items in order.
  const itemRows = items.map((i, idx) => ({
    invoice_id: header.id,
    description: i.description,
    quantity: i.quantity,
    rate: i.rate,
    position: idx,
  }));
  const { error: itemErr } = await supabase
    .from("invoice_items")
    .insert(itemRows);

  if (itemErr) {
    await supabase.from("invoices").delete().eq("id", header.id);
    redirect(
      `/invoicing/invoices/new?error=${encodeURIComponent("Failed to save line items: " + itemErr.message)}`,
    );
  }

  // 3. Audit + revalidate.
  void logAudit(profile.id, "invoice_created", "invoice", header.id, {
    invoice_number: header.invoice_number,
    customer_name: customerName,
    subtotal,
    gst_percent: gstPercent,
    item_count: items.length,
    invoice_party_id: invoicePartyId,
    source_challan_id: sourceChallanId,
  }).catch(() => {});

  refreshInvoicingPaths({
    partyId: invoicePartyId ?? undefined,
    challanId: sourceChallanId ?? undefined,
    invoiceId: header.id,
  });

  // Redirect to the detail page where the user can review + print.
  redirect(`/invoicing/invoices/${header.id}`);
}

// ── Stone HSN codes (Mig 171) — accountant-managed, shown on the tax invoice ──
// HSN belongs to the stone type (same across temples). Each stone may carry a
// normal HSN and a vendor HSN; the per-temple toggle picks which prints.
export async function setStoneHsnAction(formData: FormData): Promise<void> {
  const { profile } = await requireAuth();
  if (!canUseInvoicing(profile)) redirect("/invoicing?toast=Access+denied");
  const admin = createAdminSupabaseClient();
  const id = txt(formData, "id");
  if (!id) redirect("/invoicing/stone-hsn?toast=Missing+id");

  const { error } = await admin
    .from("stone_types")
    .update({ hsn_code: txt(formData, "hsn_code") || null, hsn_vendor_code: txt(formData, "hsn_vendor_code") || null })
    .eq("id", id);
  if (error) redirect(`/invoicing/stone-hsn?toast=${encodeURIComponent(error.message)}`);

  void logAudit(profile.id, "stone_hsn_set", "stone_type", id, {});
  revalidatePath("/invoicing/stone-hsn");
  redirect("/invoicing/stone-hsn?toast=HSN+saved");
}

// ════════════════════════════════════════════════════════════════
// Mig 173 — Bulk invoices. An OPEN challan can be "sent to bulk" (leaves the
// Challans page → Bulk page), where the accountant later bills several together
// on one tax invoice with manual line items. createBulkInvoiceAction below.
// ════════════════════════════════════════════════════════════════

/** Move an OPEN challan to the bulk pool (off the Challans page). */
export async function sendChallanToBulkAction(formData: FormData): Promise<void> {
  const { profile } = await requireAuth();
  if (!canUseInvoicing(profile)) redirect("/invoicing?toast=Access+denied");
  const admin = createAdminSupabaseClient();
  const id = txt(formData, "id");
  if (!id) redirect("/invoicing/challans");
  const { data: c } = await admin.from("challans").select("priced_at, converted_invoice_id, cancelled_at").eq("id", id).maybeSingle();
  const g = c as { priced_at: string | null; converted_invoice_id: string | null; cancelled_at: string | null } | null;
  if (!g) redirect("/invoicing/challans?toast=Challan+not+found");
  if (g.priced_at || g.converted_invoice_id || g.cancelled_at) {
    redirect(`/invoicing/challans/${id}?toast=${encodeURIComponent("Only an open challan can be sent to bulk")}`);
  }
  await admin.from("challans").update({ sent_to_bulk_at: new Date().toISOString() }).eq("id", id);
  void logAudit(profile.id, "challan_sent_to_bulk", "challan", id, {});
  refreshInvoicingPaths({ challanId: id });
  revalidatePath("/invoicing/bulk");
  revalidatePath("/invoicing/challans");
  // Daksh Jul 2026 — go straight to the full-page "prepare work order challan"
  // step (challan on the left, transport on the right). Filling transport there
  // turns it into the FINAL work order challan; the Bulk page no longer has an
  // awaiting/final split.
  redirect(`/invoicing/bulk/prepare/${id}`);
}

/** Send a bulk challan back to the Challans page. */
export async function sendChallanBackFromBulkAction(formData: FormData): Promise<void> {
  const { profile } = await requireAuth();
  if (!canUseInvoicing(profile)) redirect("/invoicing?toast=Access+denied");
  const admin = createAdminSupabaseClient();
  const id = txt(formData, "id");
  if (!id) redirect("/invoicing/bulk");
  await admin.from("challans").update({ sent_to_bulk_at: null }).eq("id", id);
  void logAudit(profile.id, "challan_back_from_bulk", "challan", id, {});
  refreshInvoicingPaths({ challanId: id });
  revalidatePath("/invoicing/bulk");
  redirect(`/invoicing/challans?toast=${encodeURIComponent("Challan returned to Challans")}`);
}

/** Mig 175 — "Get challan" for a bulk challan: capture the transport details, mark
 *  it a FULL challan (Tab-2, ready for the driver), and release the linked dispatch
 *  On-the-road WITH THE CHALLAN (release_mode='challan') — goods leave now, the tax
 *  invoice is billed later from bulk. */
export async function saveBulkTransportAction(formData: FormData): Promise<void> {
  const { profile } = await requireAuth();
  if (!canUseInvoicing(profile)) redirect("/invoicing?toast=Access+denied");
  const admin = createAdminSupabaseClient();
  const id = txt(formData, "id");
  if (!id) redirect("/invoicing/bulk");

  // Transport (mig 169 columns — always present).
  const transportCompany = txt(formData, "transport_company") || null;
  const { error: trErr } = await admin.from("challans").update({
    transport_company: transportCompany,
    transport_phone: txt(formData, "transport_phone") || null,
    lr_no: txt(formData, "lr_no") || null,
    transport_vehicle_no: txt(formData, "transport_vehicle_no") || null,
    transport_driver_name: txt(formData, "transport_driver_name") || null,
    transport_driver_phone: txt(formData, "transport_driver_phone") || null,
  }).eq("id", id);
  if (trErr) redirect(`/invoicing/bulk?toast=${encodeURIComponent("Could not save — try again")}`);
  if (transportCompany) await admin.from("transport_companies").upsert({ name: transportCompany }, { onConflict: "name" });

  // Mark it a full challan AND flag it into the bulk pool NOW (Daksh Jul 2026 —
  // the drag no longer flags on drop; the challan stays on the Challans page
  // until this Convert). Best-effort so a pre-migration deploy still saves.
  await admin.from("challans").update({ full_challan_at: new Date().toISOString(), full_challan_by: profile.id, sent_to_bulk_at: new Date().toISOString() }).eq("id", id);

  // Release the truck On-the-road WITH THE CHALLAN (only if not already out).
  const { data: ch } = await admin.from("challans").select("source_dispatch_id").eq("id", id).maybeSingle();
  const dispId = (ch as { source_dispatch_id: string | null } | null)?.source_dispatch_id ?? null;
  if (dispId) {
    await admin.from("dispatches")
      .update({ on_road_at: new Date().toISOString(), release_mode: "challan", returned_at: null, return_reason: null })
      .eq("id", dispId).is("on_road_at", null).is("delivered_at", null);
  }

  void logAudit(profile.id, "bulk_full_challan", "challan", id, {});
  refreshInvoicingPaths({ challanId: id });
  revalidatePath("/invoicing/bulk");
  revalidatePath("/dispatch");
  redirect(`/invoicing/bulk?toast=${encodeURIComponent("Challan ready — transport saved, dispatch on the road")}`);
}

/** Create ONE bulk tax invoice covering several of a temple's bulk challans,
 *  with manual line items. Pending owner approval (Mig 173). */
export async function createBulkInvoiceAction(formData: FormData): Promise<void> {
  const { profile } = await requireAuth();
  if (!canUseInvoicing(profile)) redirect("/invoicing?toast=Access+denied");
  const admin = createAdminSupabaseClient();

  const temple = txt(formData, "temple");
  if (!temple) redirect("/invoicing/bulk/new?toast=Pick+a+temple");

  let challanIds: string[] = [];
  let items: Array<{ particulars?: string; hsn?: string; unit?: string; quantity?: number | string; rate?: number | string; amount?: number | string; section_index?: number; section_head?: string | null; section_gst?: number | string | null }> = [];
  try { challanIds = JSON.parse(txt(formData, "challan_ids") || "[]") as string[]; } catch { challanIds = []; }
  try { items = JSON.parse(txt(formData, "items") || "[]"); } catch { items = []; }
  items = items.filter((it) => (it.particulars ?? "").toString().trim() || Number(it.amount) || Number(it.quantity));
  if (items.length === 0) redirect("/invoicing/bulk/new?toast=Add+at+least+one+line+item");
  if (challanIds.length === 0) redirect("/invoicing/bulk/new?toast=Select+at+least+one+challan");

  const gm = txt(formData, "gst_mode");
  const gstMode = gm === "igst" || gm === "cgst_sgst" ? gm : null;
  // Mig 199 — per-TABLE GST slab, mandatory when GST is on.
  const secGst = (it: { section_gst?: number | string | null }): number | null =>
    it.section_gst != null && `${it.section_gst}`.trim() !== "" && Number.isFinite(Number(it.section_gst)) ? Number(it.section_gst) : null;
  if (gstMode && items.some((it) => secGst(it) == null)) {
    redirect(`/invoicing/bulk/new?toast=${encodeURIComponent("Set the GST % on every table")}`);
  }
  // Keep the legacy invoice-level % when every table shares one slab (any
  // pre-mig-199 reader stays correct); NULL when tables differ.
  const uniform = gstMode ? uniformGstPercent(items.map(secGst)) : null;
  // Mig 200 — discount on the final amount (default off).
  const dmRaw = txt(formData, "discount_mode");
  const discountMode = dmRaw === "amount" || dmRaw === "percent" ? dmRaw : null;
  const discountValue = discountMode ? Math.max(0, Number(txt(formData, "discount_value")) || 0) : null;
  const invoiceDate = txt(formData, "invoice_date") || null;
  const fy = financialYear(invoiceDate || new Date());
  // Invoice number on the SHARED per-FY INV counter — LOCKED (auto only, Daksh
  // Jul 2026). Cancelling later frees the number via freeInvoiceNumber.
  let invSeq: number | null = null;
  try {
    const { data: seq } = await admin.rpc("next_doc_seq", { p_fy: `INV:${fy}` });
    if (typeof seq === "number") invSeq = seq;
  } catch { /* mig not applied */ }

  const insert: Record<string, unknown> = {
    temple,
    inv_fy: invSeq != null ? fy : null,
    inv_seq: invSeq,
    invoice_no_override: null,
    gst_mode: gstMode,
    igst_percent: gstMode === "igst" ? uniform : null,
    cgst_percent: gstMode === "cgst_sgst" && uniform != null ? uniform / 2 : null,
    sgst_percent: gstMode === "cgst_sgst" && uniform != null ? uniform / 2 : null,
    notes: txt(formData, "notes") || null,
    created_by: profile.id,
  };
  if (invoiceDate) insert.invoice_date = invoiceDate;
  // Discount cols (mig 200) — retried without so a pre-mig schema still creates.
  let { data: bi, error } = await admin.from("bulk_invoices").insert({ ...insert, discount_mode: discountMode, discount_value: discountValue }).select("id").single();
  if (error) ({ data: bi, error } = await admin.from("bulk_invoices").insert(insert).select("id").single());
  if (error || !bi) redirect(`/invoicing/bulk/new?toast=${encodeURIComponent(error?.message || "Failed to create invoice")}`);
  const bulkId = (bi as { id: string }).id;

  const itemRows = items.map((it, i) => ({
    bulk_invoice_id: bulkId,
    position: i,
    section_index: Number(it.section_index) || 0,
    section_head: (it.section_head ?? "").toString().trim() || null,
    section_gst: gstMode ? secGst(it) : null,
    particulars: (it.particulars ?? "").toString() || null,
    hsn: (it.hsn ?? "").toString() || null,
    unit: (it.unit ?? "").toString() || null,
    quantity: Number(it.quantity) || null,
    rate: Number(it.rate) || null,
    amount: it.amount != null && it.amount !== "" ? Number(it.amount) : ((Number(it.quantity) || 0) * (Number(it.rate) || 0)),
  }));
  // Best-effort insert with the section cols; fall back for older schemas
  // (drop section_gst first — mig 199; then the mig-179 section cols too).
  {
    const { error: insErr } = await admin.from("bulk_invoice_items").insert(itemRows);
    if (insErr) {
      const noGst = itemRows.map(({ section_gst: _sg, ...rest }) => rest);
      const { error: insErr2 } = await admin.from("bulk_invoice_items").insert(noGst);
      if (insErr2) {
        await admin.from("bulk_invoice_items").insert(noGst.map(({ section_index: _si, section_head: _sh, ...rest }) => rest));
      }
    }
  }
  if (challanIds.length) {
    await admin.from("bulk_invoice_challans").insert(challanIds.map((cid) => ({ bulk_invoice_id: bulkId, challan_id: cid })));
  }

  void logAudit(profile.id, "bulk_invoice_created", "bulk_invoice", bulkId, { temple, challans: challanIds.length, items: items.length });
  revalidatePath("/invoicing/bulk");
  revalidatePath("/invoicing/approval");
  refreshInvoicingPaths();
  // Daksh — the work order invoice now needs owner approval, so land on the
  // Approval page (not the print) so it's clearly "pending approval" and the
  // create form isn't re-shown on Back.
  redirect(`/invoicing/approval?toast=${encodeURIComponent("Work order invoice sent for owner approval")}`);
}

// ── Bulk invoice owner approval (Mig 173) ────────────────────────────────
export async function ownerApproveBulkAction(formData: FormData): Promise<void> {
  const { profile } = await requireAuth(["owner", "developer", "accountant_star"]);
  const admin = createAdminSupabaseClient();
  const id = txt(formData, "id");
  if (!id) redirect("/invoicing/approval");
  await admin.from("bulk_invoices")
    .update({ owner_approved_at: new Date().toISOString(), owner_approved_by: profile.id, owner_rejected_at: null, owner_reject_reason: null })
    .eq("id", id).is("owner_approved_at", null);
  void logAudit(profile.id, "bulk_invoice_approved", "bulk_invoice", id, {});
  revalidatePath("/invoicing/approval");
  revalidatePath("/invoicing/invoices");
  redirect(`/invoicing/approval?toast=${encodeURIComponent("Bulk invoice approved")}`);
}

export async function ownerRejectBulkAction(formData: FormData): Promise<void> {
  const { profile } = await requireAuth(["owner", "developer", "accountant_star"]);
  const admin = createAdminSupabaseClient();
  const id = txt(formData, "id");
  const reason = txt(formData, "reason") || null;
  if (!id) redirect("/invoicing/approval");
  await admin.from("bulk_invoices")
    .update({ owner_rejected_at: new Date().toISOString(), owner_reject_reason: reason })
    .eq("id", id).is("owner_approved_at", null);
  // Daksh: rejecting RETURNS the covered challans to the bulk pool right away so
  // they can be re-billed. The rejected invoice stays visible (with the reason)
  // on the Bulk page until dismissed.
  await admin.from("bulk_invoice_challans").delete().eq("bulk_invoice_id", id);
  void logAudit(profile.id, "bulk_invoice_rejected", "bulk_invoice", id, { reason });
  revalidatePath("/invoicing/approval");
  revalidatePath("/invoicing/bulk");
  redirect(`/invoicing/approval?toast=${encodeURIComponent("Bulk invoice rejected — challans returned to the pool")}`);
}

/** Cancel a bulk (work-order) invoice: free its INV number and RETURN its
 *  challans to the bulk pool. */
export async function cancelBulkInvoiceAction(formData: FormData): Promise<void> {
  const { profile } = await requireAuth();
  if (!canUseInvoicing(profile)) redirect("/invoicing?toast=Access+denied");
  const admin = createAdminSupabaseClient();
  const id = txt(formData, "id");
  if (!id) redirect("/invoicing/bulk");
  // Mig 184 — approval-gated cancel: stage the request; approval frees the
  // number + returns the challans to the pool.
  await admin.from("bulk_invoices").update({ pending_cancel_at: new Date().toISOString(), pending_cancel_by: profile.id } as never).eq("id", id);
  void logAudit(profile.id, "invoice_cancel_requested", "bulk_invoice", id, {});
  revalidatePath("/invoicing/invoices");
  revalidatePath("/invoicing/approval");
  redirect(`/invoicing/invoices?toast=${encodeURIComponent("Cancel request sent for approval")}`);
}

/** Edit a bulk (work-order) invoice — line items / GST / notes. The INV number
 *  never changes (Daksh Jul 2026). */
export async function updateBulkInvoiceAction(formData: FormData): Promise<void> {
  const { profile } = await requireAuth();
  if (!canUseInvoicing(profile)) redirect("/invoicing?toast=Access+denied");
  const admin = createAdminSupabaseClient();
  const id = txt(formData, "id");
  if (!id) redirect("/invoicing/invoices");

  const { data: b } = await admin.from("bulk_invoices").select("cancelled_at").eq("id", id).maybeSingle();
  if (!b) redirect("/invoicing/invoices?toast=Invoice+not+found");
  if ((b as { cancelled_at: string | null }).cancelled_at) redirect(`/invoicing/invoices?toast=${encodeURIComponent("Invoice is cancelled")}`);

  let items: Array<{ particulars?: string; hsn?: string; unit?: string; quantity?: number | string; rate?: number | string; amount?: number | string; section_index?: number; section_head?: string | null; section_gst?: number | string | null }> = [];
  try { items = JSON.parse(txt(formData, "items") || "[]"); } catch { items = []; }
  items = items.filter((it) => (it.particulars ?? "").toString().trim() || Number(it.amount) || Number(it.quantity));
  if (items.length === 0) redirect(`/invoicing/invoices?toast=${encodeURIComponent("Add at least one line item")}`);

  const gm = txt(formData, "gst_mode");
  const gstMode = gm === "igst" || gm === "cgst_sgst" ? gm : null;
  // Mig 199 — per-TABLE GST slab, mandatory when GST is on.
  const secGst = (it: { section_gst?: number | string | null }): number | null =>
    it.section_gst != null && `${it.section_gst}`.trim() !== "" && Number.isFinite(Number(it.section_gst)) ? Number(it.section_gst) : null;
  if (gstMode && items.some((it) => secGst(it) == null)) {
    redirect(`/invoicing/invoices?toast=${encodeURIComponent("Set the GST % on every table")}`);
  }
  const uniform = gstMode ? uniformGstPercent(items.map(secGst)) : null;

  // Mig 184 — editing a work-order invoice is approval-gated: stage + stop. The
  // edit form may RE-SELECT the linked challans; if it sends no set, keep the
  // current links unchanged (reconciled on approval).
  let challanIds: string[];
  const rawIds = txt(formData, "challan_ids");
  if (rawIds) {
    try { challanIds = (JSON.parse(rawIds) as string[]).filter(Boolean); } catch { challanIds = []; }
  } else {
    const { data: cur } = await admin.from("bulk_invoice_challans").select("challan_id").eq("bulk_invoice_id", id);
    challanIds = ((cur ?? []) as Array<{ challan_id: string }>).map((r) => r.challan_id);
  }
  const stagedItems = items.map((it) => ({
    particulars: (it.particulars ?? "").toString() || null,
    hsn: (it.hsn ?? "").toString() || null,
    unit: (it.unit ?? "").toString() || null,
    quantity: Number(it.quantity) || null,
    rate: Number(it.rate) || null,
    amount: Number(it.amount) || (Number(it.quantity) || 0) * (Number(it.rate) || 0) || null,
    section_index: Number(it.section_index) || 0,
    section_head: (it.section_head ?? "").toString().trim() || null,
    section_gst: gstMode ? secGst(it) : null,
  }));
  // Mig 200 — discount on the final amount.
  const dmRaw = txt(formData, "discount_mode");
  const discountMode = dmRaw === "amount" || dmRaw === "percent" ? dmRaw : null;
  const payload = {
    kind: "bulk" as const,
    items: stagedItems,
    gst: { gst_mode: gstMode, igst_percent: gstMode === "igst" ? uniform : null, cgst_percent: gstMode === "cgst_sgst" && uniform != null ? uniform / 2 : null, sgst_percent: gstMode === "cgst_sgst" && uniform != null ? uniform / 2 : null },
    discount: { discount_mode: discountMode, discount_value: discountMode ? Math.max(0, Number(txt(formData, "discount_value")) || 0) : null },
    notes: txt(formData, "notes") || null,
    challanIds,
  };
  await admin.from("bulk_invoices").update({ pending_edit_payload: payload, pending_edit_at: new Date().toISOString(), pending_edit_by: profile.id } as never).eq("id", id);

  void logAudit(profile.id, "invoice_edit_requested", "bulk_invoice", id, {});
  revalidatePath("/invoicing/invoices");
  revalidatePath("/invoicing/approval");
  redirect(`/invoicing/invoices?toast=${encodeURIComponent("Edit sent for approval — the invoice is unchanged until approved")}`);
}
