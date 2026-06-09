"use server";

// ──────────────────────────────────────────────────────────────────
// Invoicing — manual Work Order Document generator (Mig 105)
//
// Standalone: NOT linked to carving work orders or any incoming logic.
// The user types every value; we store the record + the frozen total and
// the PDF is built on demand from the stored row.
// ──────────────────────────────────────────────────────────────────

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";

const ROUTE = "/invoicing/work-order-doc";
// Invoicing department audience (plain accountant added — Work Order Doc only).
const ALLOWED = ["developer", "owner", "accountant_star", "accountant"];

function isAllowed(role: string): boolean {
  return ALLOWED.includes(role);
}
function toastUrl(msg: string): string {
  return `${ROUTE}?toast=${encodeURIComponent(msg)}`;
}

/** Create a work-order document record (+ make it downloadable). */
export async function createWorkOrderDocAction(formData: FormData) {
  const { profile } = await requireAuth();
  if (!isAllowed(profile.role)) redirect(toastUrl("Not allowed."));

  const billVendorId = String(formData.get("bill_vendor_id") || "").trim();
  const gstExclusive = String(formData.get("gst_exclusive") || "yes").trim() !== "no";
  const dateRaw = String(formData.get("doc_date") || "").trim();
  const docDate = /^\d{4}-\d{2}-\d{2}$/.test(dateRaw) ? dateRaw : null;

  if (!billVendorId) redirect(toastUrl("Select a vendor from Finance."));

  // Mig 114 — line items come as a JSON array (1..4). Validate + freeze
  // each item's total; the grand total is the sum.
  type RawItem = { description?: string | null; unit?: string; quantity?: unknown; rate?: unknown };
  let rawItems: RawItem[] = [];
  try {
    const parsed = JSON.parse(String(formData.get("line_items_json") || "[]"));
    if (Array.isArray(parsed)) rawItems = parsed as RawItem[];
  } catch {
    rawItems = [];
  }

  const lineItems: Array<{ description: string | null; unit: "cft" | "sft"; quantity: number; rate: number; total: number }> = [];
  for (const it of rawItems) {
    const unit: "cft" | "sft" = it.unit === "sft" ? "sft" : "cft";
    const quantity = Number(it.quantity);
    const rate = Number(it.rate);
    const description = typeof it.description === "string" && it.description.trim() ? it.description.trim() : null;
    if (!Number.isFinite(quantity) || quantity <= 0) continue;
    if (!Number.isFinite(rate) || rate <= 0) continue;
    const total = Math.round(quantity * rate * 100) / 100;
    lineItems.push({ description, unit, quantity, rate, total });
    if (lineItems.length >= 4) break;
  }

  if (lineItems.length === 0) {
    redirect(toastUrl("Add at least one line item with a valid quantity and price."));
  }

  const grandTotal = Math.round(lineItems.reduce((s, it) => s + it.total, 0) * 100) / 100;
  // Legacy single-line columns mirror the FIRST item so older readers +
  // the saved-documents list stay valid; `total` holds the grand total.
  const first = lineItems[0];

  const admin = createAdminSupabaseClient();

  // Snapshot the vendor's display details from the Finance master at save
  // time, so the printed PDF stays frozen. READ-ONLY here — this action
  // never writes to bill_vendors.
  const { data: fv } = await admin
    .from("bill_vendors")
    .select("name, address, gstin, category, email, phone")
    .eq("id", billVendorId)
    .maybeSingle();
  if (!fv) redirect(toastUrl("Selected vendor not found in Finance."));
  const vendorRow = fv as { name: string | null; address: string | null; gstin: string | null; category: string | null; email: string | null; phone: string | null };
  const vendor = (vendorRow.name ?? "").trim();
  const address = (vendorRow.address ?? "").trim() || null;
  if (!vendor) redirect(toastUrl("Selected vendor has no name in Finance."));

  // Auto-generate the work-order code: MTCPL-WO-{year}-0001, a per-year
  // sequence. Year comes from the selected date (defaults to the current
  // IST year). Replaces the old hand-typed job_work_no. Low-volume
  // internal use, so max(existing seq)+1 is plenty (also survives
  // deletions, unlike a plain count).
  const year = docDate
    ? docDate.slice(0, 4)
    : new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric" }).format(new Date());
  const prefix = `MTCPL-WO-${year}-`;
  const { data: existingCodes } = await admin
    .from("invoicing_work_order_docs")
    .select("job_work_no")
    .like("job_work_no", `${prefix}%`);
  let maxSeq = 0;
  for (const r of (existingCodes ?? []) as Array<{ job_work_no: string | null }>) {
    const m = /-(\d+)$/.exec(r.job_work_no ?? "");
    if (m) maxSeq = Math.max(maxSeq, Number(m[1]));
  }
  const jobWorkNo = `${prefix}${String(maxSeq + 1).padStart(4, "0")}`;

  const row: Record<string, unknown> = {
    vendor,
    address,
    bill_vendor_id: billVendorId,
    vendor_gstin: vendorRow.gstin ?? null,
    vendor_category: vendorRow.category ?? null,
    vendor_email: vendorRow.email ?? null,
    vendor_mobile: vendorRow.phone ?? null,
    job_description: first.description,
    description_detail: null,
    job_work_no: jobWorkNo,
    unit: first.unit,
    quantity: first.quantity,
    rate: first.rate,
    total: grandTotal,
    line_items: lineItems,
    gst_exclusive: gstExclusive,
    created_by: profile.id,
  };
  if (docDate) row.doc_date = docDate;

  const { data: created, error } = await admin
    .from("invoicing_work_order_docs")
    .insert(row)
    .select("id")
    .single();
  if (error || !created) redirect(toastUrl(error?.message ?? "Failed to create document."));

  await logAudit(profile.id, "work_order_doc_created", "invoicing_work_order_doc", created.id, {
    vendor,
    job_work_no: jobWorkNo,
    total: grandTotal,
    line_item_count: lineItems.length,
  });
  revalidatePath(ROUTE);
  // Land back on the page with the new doc highlighted (Download button).
  redirect(`${ROUTE}?created=${created.id}`);
}

/** Owner/dev — delete a saved document record. */
export async function deleteWorkOrderDocAction(formData: FormData) {
  const { profile } = await requireAuth();
  if (profile.role !== "owner" && profile.role !== "developer") {
    redirect(toastUrl("Only the owner can delete records."));
  }
  const id = String(formData.get("id") || "").trim();
  if (!id) redirect(toastUrl("Missing record."));
  const admin = createAdminSupabaseClient();
  const { error } = await admin.from("invoicing_work_order_docs").delete().eq("id", id);
  if (error) redirect(toastUrl(error.message));
  await logAudit(profile.id, "work_order_doc_deleted", "invoicing_work_order_doc", id, {});
  revalidatePath(ROUTE);
  redirect(toastUrl("Record deleted."));
}

/**
 * Fill in MISSING display fields on a Finance vendor, straight from the
 * Work Order Doc page (so the user doesn't have to leave to add a GST no /
 * email / mobile / address that was never captured).
 *
 * ⚠️ MONEY-SAFETY: this action writes to public.bill_vendors, which also
 * holds bank_account / ifsc / upi_id / hdfc_bene_name / pan and the
 * TDS/TCS/GST percents — REAL PAYMENT DATA. To make it impossible to ever
 * touch those by accident, the update is built from a HARD ALLOWLIST of
 * exactly five text columns, and ONLY non-empty submitted values are
 * included (so an absent or blank field is skipped, never blanked). No
 * other column name is referenced anywhere in this function.
 */
const VENDOR_FILL_ALLOW = ["gstin", "category", "email", "phone", "address"] as const;

export async function updateFinanceVendorFieldsAction(formData: FormData) {
  const { profile } = await requireAuth();
  if (!isAllowed(profile.role)) redirect(toastUrl("Not allowed."));
  const id = String(formData.get("bill_vendor_id") || "").trim();
  if (!id) redirect(toastUrl("Missing vendor."));

  const patch: Record<string, string> = {};
  for (const key of VENDOR_FILL_ALLOW) {
    const raw = formData.get(key);
    if (raw == null) continue; // not submitted
    const v = String(raw).trim();
    if (!v) continue; // empty → skip; never blank an existing value
    patch[key] = v;
  }
  if (Object.keys(patch).length === 0) {
    redirect(`${ROUTE}?vendor_filled=${id}`);
  }

  const admin = createAdminSupabaseClient();
  const { error } = await admin
    .from("bill_vendors")
    .update({ ...patch, updated_at: new Date().toISOString(), updated_by: profile.id })
    .eq("id", id);
  if (error) redirect(toastUrl(error.message));
  await logAudit(profile.id, "wo_finance_vendor_fields_filled", "bill_vendor", id, {
    fields: Object.keys(patch),
  });
  revalidatePath(ROUTE);
  redirect(`${ROUTE}?vendor_filled=${id}`);
}
