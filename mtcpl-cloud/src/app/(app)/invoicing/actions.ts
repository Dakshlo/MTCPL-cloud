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
    })
    .eq("id", challanId);

  await logAudit(profile.id, "challan_priced", "challan", challanId, { gstMode, igst, cgst, sgst });
  refreshInvoicingPaths({ challanId });
  const goPrint = txt(formData, "go") === "print";
  redirect(
    goPrint
      ? `/invoicing/challan/${challanId}/print`
      : `/invoicing/challans/${challanId}/review?toast=${encodeURIComponent("Saved")}`,
  );
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
 *  party). The dispatch→invoicing bridge reads temples.invoice_party_id to
 *  decide which party an approved dispatch's auto-challan bills to. Owned
 *  here in Invoicing (moved off Settings) so the starred accountant sets
 *  the mapping. Empty invoice_party_id unmaps the temple. */
export async function setTempleInvoicePartyAction(
  formData: FormData,
): Promise<ActionResult> {
  const { profile } = await requireAuth();
  if (!canUseInvoicing(profile)) {
    return { ok: false, error: "Invoicing access denied." };
  }
  const templeId = txt(formData, "temple_id");
  if (!templeId) return { ok: false, error: "Missing temple." };
  const partyId = txt(formData, "invoice_party_id") || null;

  const supabase = createAdminSupabaseClient();
  const { data: updated, error } = await supabase
    .from("temples")
    .update({ invoice_party_id: partyId })
    .eq("id", templeId)
    .select("id")
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!updated) return { ok: false, error: "Temple not found." };

  void logAudit(profile.id, "temple_invoice_party_set", "temple", templeId, {
    invoice_party_id: partyId,
  });
  // Settings + the dispatch bridge read the same column — refresh both.
  revalidatePath("/invoicing");
  revalidatePath("/invoicing/temple-clients");
  revalidatePath("/settings");
  revalidatePath("/dispatch");
  return { ok: true };
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
  const reason = txt(formData, "reason") || null;
  if (!id) return { ok: false, error: "Missing challan id." };

  const supabase = createAdminSupabaseClient();
  const { data: updated, error } = await supabase
    .from("challans")
    .update({
      cancelled_at: new Date().toISOString(),
      cancel_reason: reason,
    })
    .eq("id", id)
    .is("cancelled_at", null)
    .is("converted_invoice_id", null)
    .select("id, challan_number, invoice_party_id")
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!updated)
    return {
      ok: false,
      error:
        "Cannot cancel — challan already cancelled or already converted to an invoice.",
    };

  void logAudit(profile.id, "challan_cancelled", "challan", id, {
    challan_number: (updated as { challan_number?: string }).challan_number,
    reason,
  });
  refreshInvoicingPaths({
    challanId: id,
    partyId: (updated as { invoice_party_id?: string }).invoice_party_id,
  });
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
    .select("id, challan_number, invoice_party_id, cancelled_at, converted_invoice_id")
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
  };
  if (c.cancelled_at) return { ok: false, error: "Challan is cancelled." };
  if (c.converted_invoice_id)
    return { ok: false, error: "Challan was already converted to an invoice." };

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
