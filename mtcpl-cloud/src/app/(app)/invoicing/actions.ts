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
  if (g?.converted_invoice_id) redirect(`/invoicing/challans/${challanId}?toast=${encodeURIComponent("Already converted to an invoice — cannot re-price")}`);
  if (g?.cancelled_at) redirect(`/invoicing/challans/${challanId}?toast=${encodeURIComponent("Challan is cancelled — cannot price")}`);
  if (g?.owner_approved_at) redirect(`/invoicing/challans/${challanId}?toast=${encodeURIComponent("Owner already approved this invoice — cannot re-price")}`);
  // Mig 167 — once sent to the owner (priced, not yet rejected), the accountant
  // can't re-price; they wait for the owner to reject (then re-price or cancel).
  if (g?.priced_at && !g?.owner_rejected_at) redirect(`/invoicing/challans/${challanId}?toast=${encodeURIComponent("Sent to owner for approval — wait for a rejection before re-pricing")}`);

  let rates: Record<string, number | string> = {};
  try {
    rates = JSON.parse(txt(formData, "rates") || "{}") as Record<string, number | string>;
  } catch {
    rates = {};
  }
  const gstModeRaw = txt(formData, "gst_mode");
  const gstMode = gstModeRaw === "igst" || gstModeRaw === "cgst_sgst" ? gstModeRaw : null;
  const igst = Number(txt(formData, "igst_percent")) || 0;
  const cgst = Number(txt(formData, "cgst_percent")) || 0;
  const sgst = Number(txt(formData, "sgst_percent")) || 0;

  // Amount = rate × billable measure (cft/sft qty) — falls back to the line
  // quantity for legacy challans that have no measure snapshot.
  const { data: items } = await admin
    .from("challan_items")
    .select("id, quantity, measure_qty")
    .eq("challan_id", challanId);
  for (const it of (items ?? []) as Array<{ id: string; quantity: number | null; measure_qty: number | null }>) {
    const rate = Number(rates[it.id]) || 0;
    const qty = it.measure_qty != null && Number(it.measure_qty) > 0 ? Number(it.measure_qty) : Number(it.quantity) || 0;
    const amount = Math.round(rate * qty * 100) / 100;
    await admin.from("challan_items").update({ rate, amount }).eq("id", it.id);
  }

  await admin
    .from("challans")
    .update({
      gst_mode: gstMode,
      igst_percent: gstMode === "igst" ? igst : null,
      cgst_percent: gstMode === "cgst_sgst" ? cgst : null,
      sgst_percent: gstMode === "cgst_sgst" ? sgst : null,
      priced_at: new Date().toISOString(),
      priced_by: profile.id,
      invoice_no_override: txt(formData, "invoice_no_override") || null,
      // Pricing (re-)submits the challan for owner approval — clear any prior
      // rejection so it re-enters the Approval queue (Mig 167).
      owner_rejected_at: null,
      owner_reject_reason: null,
    })
    .eq("id", challanId);

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

  // Mig 172 — assign an INDEPENDENT invoice number (INV series) ONCE on first
  // pricing, separate from the challan's CH number. Best-effort: if mig 172
  // isn't applied the select errors and the code falls back to the challan no.
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

  await logAudit(profile.id, "challan_priced", "challan", challanId, { gstMode, igst, cgst, sgst });
  refreshInvoicingPaths({ challanId });
  revalidatePath("/invoicing/approval");
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
  if (ch!.source_dispatch_id) {
    await admin
      .from("dispatches")
      .update({ on_road_at: now, returned_at: null, return_reason: null, handover_ack_at: null })
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
    .select("id, owner_approved_at, cancelled_at, source_dispatch_id, temple, challan_number")
    .eq("id", challanId)
    .maybeSingle();
  const ch = c as {
    owner_approved_at: string | null; cancelled_at: string | null; source_dispatch_id: string | null; temple: string | null; challan_number: string | null;
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

  await logAudit(profile.id, "challan_returned_to_dispatch", "challan", challanId, { temple: ch.temple, reason: stamp });
  // Remove the challan (items cascade) so a re-verify recreates a fresh one.
  await admin.from("challans").delete().eq("id", challanId);

  refreshInvoicingPaths({ challanId });
  revalidatePath("/invoicing/approval");
  revalidatePath("/dispatch");
  revalidatePath("/", "layout");
  return { ok: true };
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
    .select("id, challan_number, invoice_party_id, source_dispatch_id, cancelled_at, converted_invoice_id, owner_approved_at")
    .eq("id", id)
    .maybeSingle();
  const c = ch as {
    id: string; challan_number: string | null; invoice_party_id: string | null; source_dispatch_id: string | null;
    cancelled_at: string | null; converted_invoice_id: string | null; owner_approved_at: string | null;
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
    void logAudit(profile.id, "challan_cancelled", "challan", id, { challan_number: c.challan_number, reason: stamp });
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
  redirect(`/invoicing/bulk?toast=${encodeURIComponent("Challan moved to Bulk")}`);
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
