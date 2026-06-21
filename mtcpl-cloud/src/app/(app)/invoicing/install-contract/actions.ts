"use server";

// ──────────────────────────────────────────────────────────────────
// Invoicing — Installation Vendor Contract generator (Mig 148)
//
// Standalone. Create installation vendors + project sites (creatable
// masters), then issue a contract: pick vendor + site + price, snapshot
// them onto an install_contracts row, and the PDF is built on demand.
// ──────────────────────────────────────────────────────────────────

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";
import { numberToIndianWords } from "@/app/(app)/accounts/payments/[id]/voucher/number-to-words";

const ROUTE = "/invoicing/install-contract";
const ALLOWED = ["developer", "owner", "accountant_star", "accountant"];

function isAllowed(role: string): boolean {
  return ALLOWED.includes(role);
}
function toastUrl(msg: string): string {
  return `${ROUTE}?toast=${encodeURIComponent(msg)}`;
}

/** Create an installation vendor (creatable master). */
export async function createInstallVendorAction(formData: FormData) {
  const { profile } = await requireAuth();
  if (!isAllowed(profile.role)) redirect(toastUrl("Not allowed."));
  const admin = createAdminSupabaseClient();

  const name = String(formData.get("name") || "").trim();
  if (!name) redirect(toastUrl("Vendor name is required."));
  const contact_person = String(formData.get("contact_person") || "").trim() || null;
  const phone = String(formData.get("phone") || "").trim() || null;
  const address = String(formData.get("address") || "").trim() || null;
  const gstin = String(formData.get("gstin") || "").trim() || null;

  const { data: existing } = await admin
    .from("install_vendors")
    .select("id")
    .ilike("name", name)
    .maybeSingle();
  if (existing) redirect(toastUrl(`Vendor "${name}" already exists.`));

  const { data: created, error } = await admin
    .from("install_vendors")
    .insert({ name, contact_person, phone, address, gstin, created_by: profile.id })
    .select("id")
    .single();
  if (error || !created) redirect(toastUrl(error?.message ?? "Failed to add vendor."));
  await logAudit(profile.id, "install_vendor_created", "install_vendor", created.id, { name });
  revalidatePath(ROUTE);
  redirect(toastUrl(`Vendor "${name}" added.`));
}

/** Create a project / temple site (creatable master). */
export async function createInstallSiteAction(formData: FormData) {
  const { profile } = await requireAuth();
  if (!isAllowed(profile.role)) redirect(toastUrl("Not allowed."));
  const admin = createAdminSupabaseClient();

  const project_name = String(formData.get("project_name") || "").trim();
  if (!project_name) redirect(toastUrl("Project name is required."));
  const location = String(formData.get("location") || "").trim() || null;

  const { data: existing } = await admin
    .from("install_sites")
    .select("id")
    .ilike("project_name", project_name)
    .maybeSingle();
  if (existing) redirect(toastUrl(`Site "${project_name}" already exists.`));

  const { data: created, error } = await admin
    .from("install_sites")
    .insert({ project_name, location, created_by: profile.id })
    .select("id")
    .single();
  if (error || !created) redirect(toastUrl(error?.message ?? "Failed to add site."));
  await logAudit(profile.id, "install_site_created", "install_site", created.id, { project_name });
  revalidatePath(ROUTE);
  redirect(toastUrl(`Site "${project_name}" added.`));
}

/** Issue a contract — snapshot the vendor + site, freeze the price. */
export async function createInstallContractAction(formData: FormData) {
  const { profile } = await requireAuth();
  if (!isAllowed(profile.role)) redirect(toastUrl("Not allowed."));
  const admin = createAdminSupabaseClient();

  const vendorId = String(formData.get("install_vendor_id") || "").trim();
  const siteId = String(formData.get("install_site_id") || "").trim();
  const price = Number(formData.get("price"));
  const scope_note = String(formData.get("scope_note") || "").trim() || null;
  const dateRaw = String(formData.get("doc_date") || "").trim();
  const docDate = /^\d{4}-\d{2}-\d{2}$/.test(dateRaw) ? dateRaw : null;

  if (!vendorId) redirect(toastUrl("Select a vendor."));
  if (!siteId) redirect(toastUrl("Select a project site."));
  if (!Number.isFinite(price) || price <= 0) redirect(toastUrl("Enter a valid contract price."));

  const [{ data: v }, { data: s }] = await Promise.all([
    admin.from("install_vendors").select("name, contact_person, phone, address, gstin").eq("id", vendorId).maybeSingle(),
    admin.from("install_sites").select("project_name, location").eq("id", siteId).maybeSingle(),
  ]);
  if (!v) redirect(toastUrl("Selected vendor not found."));
  if (!s) redirect(toastUrl("Selected site not found."));
  const vendor = v as { name: string; contact_person: string | null; phone: string | null; address: string | null; gstin: string | null };
  const site = s as { project_name: string; location: string | null };

  // Contract number: MTCPL-IC-{year}-0001, per-year sequence (survives
  // deletions — uses max(seq)+1 over the year's existing codes).
  const year = docDate
    ? docDate.slice(0, 4)
    : new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric" }).format(new Date());
  const prefix = `MTCPL-IC-${year}-`;
  const { data: existingCodes } = await admin
    .from("install_contracts")
    .select("contract_no")
    .like("contract_no", `${prefix}%`);
  let maxSeq = 0;
  for (const r of (existingCodes ?? []) as Array<{ contract_no: string | null }>) {
    const m = /-(\d+)$/.exec(r.contract_no ?? "");
    if (m) maxSeq = Math.max(maxSeq, Number(m[1]));
  }
  const contractNo = `${prefix}${String(maxSeq + 1).padStart(4, "0")}`;

  const row: Record<string, unknown> = {
    contract_no: contractNo,
    install_vendor_id: vendorId,
    install_site_id: siteId,
    vendor_name: vendor.name,
    vendor_contact: vendor.contact_person,
    vendor_phone: vendor.phone,
    vendor_address: vendor.address,
    vendor_gstin: vendor.gstin,
    site_project: site.project_name,
    site_location: site.location,
    price,
    price_words: numberToIndianWords(price),
    scope_note,
    created_by: profile.id,
  };
  if (docDate) row.doc_date = docDate;

  const { data: created, error } = await admin
    .from("install_contracts")
    .insert(row)
    .select("id")
    .single();
  if (error || !created) redirect(toastUrl(error?.message ?? "Failed to issue contract."));
  await logAudit(profile.id, "install_contract_created", "install_contract", created.id, {
    contract_no: contractNo,
    vendor: vendor.name,
    site: site.project_name,
    price,
  });
  revalidatePath(ROUTE);
  redirect(`${ROUTE}?created=${created.id}`);
}

/** Soft-delete a contract — kept on record (shown red, CANCELLED stamp). */
export async function deleteInstallContractAction(formData: FormData) {
  const { profile } = await requireAuth();
  if (!isAllowed(profile.role)) redirect(toastUrl("Not allowed."));
  const id = String(formData.get("id") || "").trim();
  if (!id) redirect(toastUrl("Missing record."));
  const admin = createAdminSupabaseClient();
  const { error } = await admin
    .from("install_contracts")
    .update({ deleted_at: new Date().toISOString(), deleted_by: profile.id })
    .eq("id", id)
    .is("deleted_at", null);
  if (error) redirect(toastUrl(error.message));
  await logAudit(profile.id, "install_contract_deleted", "install_contract", id, {});
  revalidatePath(ROUTE);
  redirect(toastUrl("Contract deleted (kept on record)."));
}
