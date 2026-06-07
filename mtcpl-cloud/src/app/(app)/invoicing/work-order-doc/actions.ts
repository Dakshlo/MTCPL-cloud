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
// Invoicing department audience.
const ALLOWED = ["developer", "owner", "accountant_star"];

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

  const vendor = String(formData.get("vendor") || "").trim();
  const address = String(formData.get("address") || "").trim() || null;
  const jobDescription = String(formData.get("job_description") || "").trim() || null;
  const jobWorkNo = String(formData.get("job_work_no") || "").trim() || null;
  const unit = String(formData.get("unit") || "").trim() === "sft" ? "sft" : "cft";
  const quantity = Number(String(formData.get("quantity") || "").trim());
  const rate = Number(String(formData.get("rate") || "").trim());
  const dateRaw = String(formData.get("doc_date") || "").trim();
  const docDate = /^\d{4}-\d{2}-\d{2}$/.test(dateRaw) ? dateRaw : null;

  if (!vendor) redirect(toastUrl("Vendor is required."));
  if (!Number.isFinite(quantity) || quantity <= 0) redirect(toastUrl("Enter a valid quantity."));
  if (!Number.isFinite(rate) || rate <= 0) redirect(toastUrl("Enter a valid price."));

  const total = Math.round(quantity * rate * 100) / 100;

  const admin = createAdminSupabaseClient();
  const row: Record<string, unknown> = {
    vendor,
    address,
    job_description: jobDescription,
    job_work_no: jobWorkNo,
    unit,
    quantity,
    rate,
    total,
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
    total,
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
