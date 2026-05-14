"use server";

// Invoicing server actions (Migration 038).
//
// Single mutation for v1: createInvoiceAction takes the form payload,
// inserts an invoices header row + N invoice_items rows in a single
// transaction-ish sequence (we don't have row-locking but the
// foreign-key cascade keeps things consistent), then redirects to the
// detail page so the user can print.

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";

type LineItemInput = {
  description: string;
  quantity: number;
  rate: number;
};

export async function createInvoiceAction(formData: FormData) {
  // v1 — open to developer + owner. The "Invoicing" department isn't
  // locked to a specific role yet (no dedicated invoicer role).
  // Extend this list when an "invoicer" role lands.
  const { profile } = await requireAuth(["developer", "owner"]);
  const supabase = createAdminSupabaseClient();

  const customerName = String(formData.get("customer_name") || "").trim();
  if (!customerName) {
    redirect("/invoicing/new?error=Customer+name+is+required");
  }
  const customerAddress = String(formData.get("customer_address") || "").trim() || null;
  const customerGstin = String(formData.get("customer_gstin") || "").trim() || null;
  const customerPhone = String(formData.get("customer_phone") || "").trim() || null;
  const invoiceDate = String(formData.get("invoice_date") || "").trim() || null;
  const gstPercent = Number(formData.get("gst_percent") || 0);
  const notes = String(formData.get("notes") || "").trim() || null;

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
    redirect("/invoicing/new?error=Add+at+least+one+line+item");
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
    })
    .select("id, invoice_number")
    .single();

  if (insertErr || !header) {
    redirect(
      `/invoicing/new?error=${encodeURIComponent(
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
    // Roll back the header so we don't leave a dangling invoice.
    await supabase.from("invoices").delete().eq("id", header.id);
    redirect(
      `/invoicing/new?error=${encodeURIComponent("Failed to save line items: " + itemErr.message)}`,
    );
  }

  // 3. Audit + revalidate.
  void logAudit(profile.id, "invoice_created", "invoice", header.id, {
    invoice_number: header.invoice_number,
    customer_name: customerName,
    subtotal,
    gst_percent: gstPercent,
    item_count: items.length,
  }).catch(() => {});

  revalidatePath("/invoicing");

  // Redirect to the detail page where the user can review + print.
  redirect(`/invoicing/${header.id}`);
}
