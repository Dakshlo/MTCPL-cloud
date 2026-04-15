"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";

function txt(formData: FormData, key: string) {
  const v = formData.get(key);
  return typeof v === "string" ? v.trim() : "";
}

async function recordEvent(
  carvingItemId: string,
  eventType: string,
  userId: string | null,
  message?: string,
) {
  const admin = createAdminSupabaseClient();
  await admin.from("carving_job_events").insert({
    carving_item_id: carvingItemId,
    event_type: eventType,
    message: message ?? null,
    user_id: userId,
  });
}

async function assertVendorOwnsJob(jobId: string, vendorId: string | null) {
  const admin = createAdminSupabaseClient();
  const { data: job } = await admin
    .from("carving_items")
    .select("id, vendor_id, slab_requirement_id")
    .eq("id", jobId)
    .single();
  if (!job) return null;
  // Developer bypasses (vendorId is null for developer)
  if (vendorId && job.vendor_id !== vendorId) return null;
  return job;
}

function refreshAll() {
  revalidatePath("/vendor");
  revalidatePath("/carving");
  revalidatePath("/dashboard");
}

// ── Vendor-side actions ─────────────────────────────────────────────

export async function startCarvingJobAction(formData: FormData) {
  const { profile } = await requireAuth(["vendor", "developer"]);
  const admin = createAdminSupabaseClient();
  const jobId = txt(formData, "job_id");

  const job = await assertVendorOwnsJob(jobId, profile.role === "developer" ? null : profile.vendor_id);
  if (!job) redirect("/vendor?toast=Job+not+found");

  await admin
    .from("carving_items")
    .update({ status: "carving_in_progress" })
    .eq("id", jobId);

  await admin
    .from("slab_requirements")
    .update({ status: "carving_in_progress", updated_by: profile.id, updated_at: new Date().toISOString() })
    .eq("id", job.slab_requirement_id);

  await recordEvent(jobId, "started", profile.id, "Vendor started work");
  await logAudit(profile.id, "carving_started", "carving_item", jobId, {});

  refreshAll();
  redirect(`/vendor/${jobId}?toast=Work+started`);
}

export async function updateCarvingProgressAction(formData: FormData) {
  const { profile } = await requireAuth(["vendor", "developer"]);
  const admin = createAdminSupabaseClient();
  const jobId = txt(formData, "job_id");
  const phase = txt(formData, "progress_phase");
  const note = txt(formData, "note") || null;

  const job = await assertVendorOwnsJob(jobId, profile.role === "developer" ? null : profile.vendor_id);
  if (!job) redirect("/vendor?toast=Job+not+found");
  if (!phase) redirect(`/vendor/${jobId}?toast=Phase+required`);

  await admin
    .from("carving_items")
    .update({ progress_phase: phase })
    .eq("id", jobId);

  await recordEvent(jobId, "phase_update", profile.id, note ? `${phase} — ${note}` : phase);
  refreshAll();
  redirect(`/vendor/${jobId}?toast=Progress+updated`);
}

export async function addCarvingPhotoAction(formData: FormData) {
  const { profile } = await requireAuth(["vendor", "developer"]);
  const admin = createAdminSupabaseClient();
  const jobId = txt(formData, "job_id");
  const url = txt(formData, "url");

  const job = await assertVendorOwnsJob(jobId, profile.role === "developer" ? null : profile.vendor_id);
  if (!job) redirect("/vendor?toast=Job+not+found");
  if (!url || !/^https?:\/\//.test(url)) redirect(`/vendor/${jobId}?toast=Valid+URL+required`);

  // Fetch current photo_urls, append, save
  const { data: current } = await admin
    .from("carving_items")
    .select("photo_urls")
    .eq("id", jobId)
    .single();

  const existing = (current?.photo_urls ?? []) as string[];
  const updated = [...existing, url];

  await admin
    .from("carving_items")
    .update({ photo_urls: updated })
    .eq("id", jobId);

  await recordEvent(jobId, "photo_added", profile.id, url);
  refreshAll();
  redirect(`/vendor/${jobId}?toast=Photo+added`);
}

export async function markCarvingCompleteAction(formData: FormData) {
  const { profile } = await requireAuth(["vendor", "developer"]);
  const admin = createAdminSupabaseClient();
  const jobId = txt(formData, "job_id");

  const job = await assertVendorOwnsJob(jobId, profile.role === "developer" ? null : profile.vendor_id);
  if (!job) redirect("/vendor?toast=Job+not+found");

  await admin
    .from("carving_items")
    .update({ completed_at: new Date().toISOString() })
    .eq("id", jobId);

  await recordEvent(jobId, "completed", profile.id, "Vendor marked job complete — awaiting team review");
  await logAudit(profile.id, "carving_completed_by_vendor", "carving_item", jobId, {});

  refreshAll();
  redirect(`/vendor/${jobId}?toast=Marked+complete+-+waiting+for+team+approval`);
}
