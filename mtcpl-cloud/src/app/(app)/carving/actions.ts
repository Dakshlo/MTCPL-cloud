"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";

// ── Shared helpers ──────────────────────────────────────────────────

function txt(formData: FormData, key: string) {
  const v = formData.get(key);
  return typeof v === "string" ? v.trim() : "";
}

function num(formData: FormData, key: string, fallback = 0) {
  const raw = formData.get(key);
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
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

function refreshAll() {
  revalidatePath("/carving");
  revalidatePath("/carving/vendors");
  revalidatePath("/dashboard");
  revalidatePath("/vendor");
}

// ── Vendor CRUD (team-side) ─────────────────────────────────────────

export async function createVendorAction(formData: FormData) {
  const { profile } = await requireAuth(["developer", "owner"]);
  const admin = createAdminSupabaseClient();

  const name = txt(formData, "name");
  const vendorType = txt(formData, "vendor_type") as "CNC" | "Manual" | "Outsource";
  const machinesJson = txt(formData, "machines_json");

  if (!name) redirect("/carving/vendors?toast=Vendor+name+is+required");
  if (!["CNC", "Manual", "Outsource"].includes(vendorType)) {
    redirect("/carving/vendors?toast=Invalid+vendor+type");
  }

  const { data: vendor, error } = await admin
    .from("vendors")
    .insert({ name, vendor_type: vendorType, is_active: true })
    .select("id")
    .single();

  if (error || !vendor) {
    redirect(`/carving/vendors?toast=${encodeURIComponent(error?.message ?? "Failed to create vendor")}`);
  }

  // If CNC, insert machines
  if (vendorType === "CNC" && machinesJson) {
    try {
      const machines = JSON.parse(machinesJson) as Array<{ machine_code: string; operator_name?: string }>;
      const rows = machines
        .filter((m) => m.machine_code.trim())
        .map((m) => ({
          vendor_id: vendor.id,
          machine_code: m.machine_code.trim(),
          operator_name: m.operator_name?.trim() || null,
          is_active: true,
        }));
      if (rows.length > 0) {
        const { error: mErr } = await admin.from("cnc_machines").insert(rows);
        if (mErr) throw new Error(mErr.message);
      }
    } catch (e) {
      // Vendor created but machines failed — log it, continue
      console.error("[createVendorAction] machine insert error:", e);
    }
  }

  await logAudit(profile.id, "vendor_created", "vendor", vendor.id, { name, type: vendorType });
  refreshAll();
  redirect("/carving/vendors?toast=Vendor+created");
}

export async function updateVendorAction(formData: FormData) {
  const { profile } = await requireAuth(["developer", "owner"]);
  const admin = createAdminSupabaseClient();

  const vendorId = txt(formData, "vendor_id");
  const name = txt(formData, "name");
  const vendorType = txt(formData, "vendor_type") as "CNC" | "Manual" | "Outsource";
  const isActive = txt(formData, "is_active") === "true";
  const machinesJson = txt(formData, "machines_json");

  if (!vendorId || !name) redirect(`/carving/vendors/${vendorId}?toast=Missing+fields`);

  const { error } = await admin
    .from("vendors")
    .update({ name, vendor_type: vendorType, is_active: isActive })
    .eq("id", vendorId);

  if (error) {
    redirect(`/carving/vendors/${vendorId}?toast=${encodeURIComponent(error.message)}`);
  }

  // Sync machines for CNC vendors
  if (vendorType === "CNC" && machinesJson) {
    try {
      const machines = JSON.parse(machinesJson) as Array<{
        id?: string;
        machine_code: string;
        operator_name?: string;
        is_active?: boolean;
        _delete?: boolean;
      }>;

      // Delete marked machines
      const toDelete = machines.filter((m) => m._delete && m.id).map((m) => m.id!);
      if (toDelete.length > 0) {
        await admin.from("cnc_machines").delete().in("id", toDelete);
      }

      // Upsert the rest
      const toUpsert = machines
        .filter((m) => !m._delete && m.machine_code.trim())
        .map((m) => ({
          ...(m.id ? { id: m.id } : {}),
          vendor_id: vendorId,
          machine_code: m.machine_code.trim(),
          operator_name: m.operator_name?.trim() || null,
          is_active: m.is_active ?? true,
        }));

      if (toUpsert.length > 0) {
        const { error: mErr } = await admin.from("cnc_machines").upsert(toUpsert);
        if (mErr) throw new Error(mErr.message);
      }
    } catch (e) {
      console.error("[updateVendorAction] machine sync error:", e);
    }
  }

  await logAudit(profile.id, "vendor_updated", "vendor", vendorId, { name });
  refreshAll();
  redirect(`/carving/vendors/${vendorId}?toast=Vendor+saved`);
}

export async function deactivateVendorAction(formData: FormData) {
  const { profile } = await requireAuth(["developer", "owner"]);
  const admin = createAdminSupabaseClient();
  const vendorId = txt(formData, "vendor_id");

  await admin.from("vendors").update({ is_active: false }).eq("id", vendorId);
  await logAudit(profile.id, "vendor_deactivated", "vendor", vendorId, {});
  refreshAll();
  redirect("/carving/vendors?toast=Vendor+deactivated");
}

// ── Carving job lifecycle ───────────────────────────────────────────

export async function assignCarvingJobAction(formData: FormData) {
  const { profile } = await requireAuth(["developer", "owner"]);
  const admin = createAdminSupabaseClient();

  const slabId = txt(formData, "slab_id");
  const vendorId = txt(formData, "vendor_id");
  const cncMachineId = txt(formData, "cnc_machine_id") || null;
  const deadlineDays = num(formData, "deadline_days", 7);
  const note = txt(formData, "note") || null;

  if (!slabId || !vendorId) {
    redirect("/carving?toast=Missing+slab+or+vendor");
  }

  // Load vendor so we can snapshot name/type into carving_items
  const { data: vendor } = await admin
    .from("vendors")
    .select("id, name, vendor_type")
    .eq("id", vendorId)
    .single();

  if (!vendor) redirect("/carving?toast=Vendor+not+found");

  const dueAt = new Date(Date.now() + deadlineDays * 24 * 3600 * 1000).toISOString();

  // Race guard: slab must currently be cut_done
  const { data: slabRow, error: slabErr } = await admin
    .from("slab_requirements")
    .update({ status: "carving_assigned", updated_by: profile.id, updated_at: new Date().toISOString() })
    .eq("id", slabId)
    .eq("status", "cut_done")
    .select("id");

  if (slabErr) redirect(`/carving?toast=${encodeURIComponent(slabErr.message)}`);
  if (!slabRow?.length) redirect(`/carving?toast=Slab+no+longer+available+for+assignment`);

  const { data: item, error: itemErr } = await admin
    .from("carving_items")
    .insert({
      slab_requirement_id: slabId,
      vendor_id: vendorId,
      vendor_name: vendor.name,
      vendor_type: vendor.vendor_type,
      cnc_machine_id: cncMachineId,
      note,
      status: "carving_assigned",
      deadline_days: deadlineDays,
      due_at: dueAt,
      assigned_by: profile.id,
    })
    .select("id")
    .single();

  if (itemErr || !item) {
    // Rollback slab status
    await admin
      .from("slab_requirements")
      .update({ status: "cut_done", updated_by: profile.id, updated_at: new Date().toISOString() })
      .eq("id", slabId);
    redirect(`/carving?toast=${encodeURIComponent(itemErr?.message ?? "Failed to create job")}`);
  }

  await recordEvent(item.id, "assigned", profile.id, `Assigned to ${vendor.name} · ${deadlineDays}d deadline`);
  await logAudit(profile.id, "carving_assigned", "carving_item", item.id, { slab_id: slabId, vendor_id: vendorId, deadline_days: deadlineDays });

  refreshAll();
  redirect("/carving?tab=active&toast=Job+assigned");
}

export async function approveCarvingJobAction(formData: FormData) {
  const { profile } = await requireAuth(["developer", "owner"]);
  const admin = createAdminSupabaseClient();
  const jobId = txt(formData, "job_id");
  const notes = txt(formData, "notes") || null;

  if (!jobId) redirect("/carving?toast=Missing+job+id");

  const { data: job } = await admin
    .from("carving_items")
    .select("id, slab_requirement_id, completed_at")
    .eq("id", jobId)
    .single();

  if (!job) redirect("/carving?toast=Job+not+found");
  if (!job.completed_at) redirect(`/carving/${jobId}?toast=Vendor+hasn%27t+marked+it+complete+yet`);

  await admin
    .from("carving_items")
    .update({
      review_approved_at: new Date().toISOString(),
      review_approved_by: profile.id,
      review_notes: notes,
      status: "completed",
    })
    .eq("id", jobId);

  await admin
    .from("slab_requirements")
    .update({ status: "completed", updated_by: profile.id, updated_at: new Date().toISOString() })
    .eq("id", job.slab_requirement_id);

  await recordEvent(jobId, "approved", profile.id, notes || "Approved by team");
  await logAudit(profile.id, "carving_approved", "carving_item", jobId, { slab_id: job.slab_requirement_id });

  refreshAll();
  redirect(`/carving/${jobId}?toast=Approved`);
}

export async function rejectCarvingJobAction(formData: FormData) {
  const { profile } = await requireAuth(["developer", "owner"]);
  const admin = createAdminSupabaseClient();
  const jobId = txt(formData, "job_id");
  const notes = txt(formData, "notes");

  if (!jobId || !notes) redirect(`/carving/${jobId}?toast=Rejection+notes+required`);

  await admin
    .from("carving_items")
    .update({
      completed_at: null,
      review_notes: notes,
      status: "carving_in_progress",
    })
    .eq("id", jobId);

  await recordEvent(jobId, "rejected", profile.id, notes);
  await logAudit(profile.id, "carving_rejected", "carving_item", jobId, { notes });

  refreshAll();
  redirect(`/carving/${jobId}?toast=Rejected+-+sent+back+to+vendor`);
}

export async function dispatchCarvingJobAction(formData: FormData) {
  const { profile } = await requireAuth(["developer", "owner"]);
  const admin = createAdminSupabaseClient();
  const jobId = txt(formData, "job_id");
  const note = txt(formData, "note") || null;

  if (!jobId) redirect("/carving?toast=Missing+job+id");

  const { data: job } = await admin
    .from("carving_items")
    .select("id, slab_requirement_id, review_approved_at")
    .eq("id", jobId)
    .single();

  if (!job) redirect("/carving?toast=Job+not+found");
  if (!job.review_approved_at) redirect(`/carving/${jobId}?toast=Approve+before+dispatching`);

  await admin.from("dispatch_logs").insert({
    carving_item_id: jobId,
    slab_requirement_id: job.slab_requirement_id,
    dispatched_by: profile.id,
    dispatch_note: note,
  });

  await admin
    .from("carving_items")
    .update({ status: "dispatched" })
    .eq("id", jobId);

  await admin
    .from("slab_requirements")
    .update({ status: "dispatched", updated_by: profile.id, updated_at: new Date().toISOString() })
    .eq("id", job.slab_requirement_id);

  await recordEvent(jobId, "dispatched", profile.id, note || "Dispatched to installation site");
  await logAudit(profile.id, "carving_dispatched", "carving_item", jobId, { slab_id: job.slab_requirement_id });

  refreshAll();
  redirect(`/carving/${jobId}?toast=Dispatched`);
}

export async function cancelCarvingJobAction(formData: FormData) {
  const { profile } = await requireAuth(["developer", "owner"]);
  const admin = createAdminSupabaseClient();
  const jobId = txt(formData, "job_id");

  const { data: job } = await admin
    .from("carving_items")
    .select("id, slab_requirement_id")
    .eq("id", jobId)
    .single();

  if (!job) redirect("/carving?toast=Job+not+found");

  await recordEvent(jobId, "cancelled", profile.id, "Assignment cancelled by team");
  await admin.from("carving_items").delete().eq("id", jobId);
  await admin
    .from("slab_requirements")
    .update({ status: "cut_done", updated_by: profile.id, updated_at: new Date().toISOString() })
    .eq("id", job.slab_requirement_id);

  await logAudit(profile.id, "carving_cancelled", "carving_item", jobId, { slab_id: job.slab_requirement_id });

  refreshAll();
  redirect("/carving?toast=Assignment+cancelled");
}
