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
  // Dynamic-segment revalidation — without this, the detail page
  // /carving/[id] stayed cached after an approve and showed the
  // stale Approve form (giving the impression the action didn't
  // run).
  revalidatePath("/carving/[id]", "page");
  revalidatePath("/carving/vendors");
  revalidatePath("/dashboard");
  revalidatePath("/vendor");
  revalidatePath("/dispatch");
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
      const machines = JSON.parse(machinesJson) as Array<{
        machine_code: string;
        operator_name?: string;
        machine_type?: "single_head" | "multi_head_2" | "lathe";
      }>;
      const rows = machines
        .filter((m) => m.machine_code.trim())
        .map((m) => ({
          vendor_id: vendor.id,
          machine_code: m.machine_code.trim(),
          operator_name: m.operator_name?.trim() || null,
          machine_type: m.machine_type ?? "single_head",
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
  // Caller can pass redirect_to to land back where they came from
  // (carving page peek modal sends "/carving"). Defaults to the
  // vendor's detail page for back-compat with the old form.
  const redirectTo = txt(formData, "redirect_to") || `/carving/vendors/${vendorId}`;

  if (!vendorId || !name) redirect(`${redirectTo}?toast=Missing+fields`);

  const { error } = await admin
    .from("vendors")
    .update({ name, vendor_type: vendorType, is_active: isActive })
    .eq("id", vendorId);

  if (error) {
    redirect(`${redirectTo}?toast=${encodeURIComponent(error.message)}`);
  }

  // Sync machines for CNC vendors
  if (vendorType === "CNC" && machinesJson) {
    try {
      const machines = JSON.parse(machinesJson) as Array<{
        id?: string;
        machine_code: string;
        operator_name?: string;
        machine_type?: "single_head" | "multi_head_2" | "lathe";
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
          machine_type: m.machine_type ?? "single_head",
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
  redirect(`${redirectTo}?toast=Vendor+saved`);
}

export async function deactivateVendorAction(formData: FormData) {
  const { profile } = await requireAuth(["developer", "owner"]);
  const admin = createAdminSupabaseClient();
  const vendorId = txt(formData, "vendor_id");
  const redirectTo = txt(formData, "redirect_to") || "/carving/vendors";

  await admin.from("vendors").update({ is_active: false }).eq("id", vendorId);
  await logAudit(profile.id, "vendor_deactivated", "vendor", vendorId, {});
  refreshAll();
  redirect(`${redirectTo}?toast=Vendor+deactivated`);
}

export async function reactivateVendorAction(formData: FormData) {
  const { profile } = await requireAuth(["developer", "owner"]);
  const admin = createAdminSupabaseClient();
  const vendorId = txt(formData, "vendor_id");
  const redirectTo = txt(formData, "redirect_to") || "/carving/vendors";

  await admin.from("vendors").update({ is_active: true }).eq("id", vendorId);
  await logAudit(profile.id, "vendor_reactivated", "vendor", vendorId, {});
  refreshAll();
  redirect(`${redirectTo}?toast=Vendor+reactivated`);
}

// Hard-delete a vendor. Only allowed when the vendor has no carving
// items referencing it AND no machines (cascading delete on machines
// would lose history we want to keep). If either guard fails, falls
// back to a deactivate so the carving head doesn't have to think
// about which command to run.
export async function deleteVendorAction(formData: FormData) {
  const { profile } = await requireAuth(["developer", "owner"]);
  const admin = createAdminSupabaseClient();
  const vendorId = txt(formData, "vendor_id");
  const redirectTo = txt(formData, "redirect_to") || "/carving/vendors";

  if (!vendorId) redirect(`${redirectTo}?toast=Missing+vendor+id`);

  const [{ count: itemCount }, { count: machineCount }] = await Promise.all([
    admin
      .from("carving_items")
      .select("id", { count: "exact", head: true })
      .eq("vendor_id", vendorId),
    admin
      .from("cnc_machines")
      .select("id", { count: "exact", head: true })
      .eq("vendor_id", vendorId),
  ]);

  if ((itemCount ?? 0) > 0 || (machineCount ?? 0) > 0) {
    // Has history — soft-delete instead so audit trails stay intact.
    await admin.from("vendors").update({ is_active: false }).eq("id", vendorId);
    await logAudit(profile.id, "vendor_soft_deleted", "vendor", vendorId, {
      reason: "has_history",
      carving_items: itemCount ?? 0,
      machines: machineCount ?? 0,
    });
    refreshAll();
    redirect(
      `${redirectTo}?toast=${encodeURIComponent(
        `Vendor has ${itemCount} job(s) and ${machineCount} machine(s) — deactivated instead`,
      )}`,
    );
  }

  // Truly no history — safe to hard delete.
  const { error } = await admin.from("vendors").delete().eq("id", vendorId);
  if (error) {
    redirect(`${redirectTo}?toast=${encodeURIComponent(error.message)}`);
  }
  await logAudit(profile.id, "vendor_deleted", "vendor", vendorId, {});
  refreshAll();
  redirect(`${redirectTo}?toast=Vendor+deleted`);
}

// ── Carving job lifecycle ───────────────────────────────────────────

export async function assignCarvingJobAction(formData: FormData) {
  const { profile } = await requireAuth(["developer", "owner", "carving_head"]);
  const admin = createAdminSupabaseClient();

  const slabId = txt(formData, "slab_id");
  const vendorId = txt(formData, "vendor_id");
  const note = txt(formData, "note") || null;
  // CNC ops: urgency + rough estimated carving minutes from the
  // carving head. Machine is NOT picked here — the vendor (CNC
  // supervisor) decides which of their machines to load it on.
  const urgency = txt(formData, "urgency") === "urgent" ? "urgent" : "normal";
  const estimatedMinutes = Math.max(0, num(formData, "estimated_minutes", 0));

  if (!slabId || !vendorId) {
    redirect("/carving?toast=Missing+slab+or+vendor");
  }

  // Load vendor so we can snapshot name/type into carving_items.
  // We only allow CNC vendors in this Phase 3 flow (Manual / Outsource
  // are paused for now per business decision).
  const { data: vendor } = await admin
    .from("vendors")
    .select("id, name, vendor_type, is_active")
    .eq("id", vendorId)
    .single();

  if (!vendor) redirect("/carving?toast=Vendor+not+found");
  if ((vendor as { vendor_type: string }).vendor_type !== "CNC") {
    redirect("/carving?toast=Only+CNC+vendors+supported+for+now");
  }
  if (!(vendor as { is_active: boolean }).is_active) {
    redirect("/carving?toast=Vendor+is+inactive");
  }

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
      vendor_name: (vendor as { name: string }).name,
      vendor_type: (vendor as { vendor_type: string }).vendor_type,
      // cnc_machine_id intentionally null — vendor picks at load time.
      cnc_machine_id: null,
      note,
      status: "carving_assigned",
      urgency,
      estimated_minutes: estimatedMinutes || null,
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

  const eta = estimatedMinutes ? `${estimatedMinutes}min` : "no eta";
  const urgencyTag = urgency === "urgent" ? " · ⚡ URGENT" : "";
  await recordEvent(item.id, "assigned", profile.id, `Queued for ${(vendor as { name: string }).name} · ${eta}${urgencyTag}`);
  await logAudit(profile.id, "carving_assigned", "carving_item", item.id, { slab_id: slabId, vendor_id: vendorId, urgency, estimated_minutes: estimatedMinutes });

  refreshAll();
  redirect("/carving?tab=active&toast=Job+queued");
}

// ── CNC ops: load slab on a specific machine ────────────────────────
//
// Vendor (CNC supervisor) picks a slab from their queue and loads it
// onto a free CNC. Atomic side-effects:
//   1. carving_items: status → carving_in_progress, cnc_machine_id,
//      loaded_at, loaded_by, vendor_estimated_minutes (vendor's tighter
//      estimate; defaults to the carving head's estimated_minutes)
//   2. cnc_machines: status → 'carving', current_carving_item_id
//   3. cnc_machine_events: event 'loaded'
//   4. slab_requirements: status → carving_in_progress
//
// Race guards: machine must currently be 'idle', carving item must
// currently be 'carving_assigned' with no cnc_machine_id.
export async function loadSlabOnMachineAction(formData: FormData) {
  const { profile } = await requireAuth(["developer", "owner", "carving_head", "vendor"]);
  const admin = createAdminSupabaseClient();

  const carvingItemId = txt(formData, "carving_item_id");
  const machineId = txt(formData, "cnc_machine_id");
  const vendorEstMinutes = Math.max(0, num(formData, "vendor_estimated_minutes", 0));

  if (!carvingItemId || !machineId) {
    redirect("/vendor?toast=Missing+slab+or+machine");
  }

  // Load both rows so we can sanity-check vendor ownership (machine
  // must belong to the same vendor as the carving item).
  const [{ data: ci }, { data: mc }] = await Promise.all([
    admin.from("carving_items").select("id, vendor_id, status, cnc_machine_id, slab_requirement_id, estimated_minutes").eq("id", carvingItemId).maybeSingle(),
    admin.from("cnc_machines").select("id, vendor_id, status, is_active").eq("id", machineId).maybeSingle(),
  ]);

  if (!ci) redirect("/vendor?toast=Carving+job+not+found");
  if (!mc) redirect("/vendor?toast=Machine+not+found");
  const item = ci as { id: string; vendor_id: string; status: string; cnc_machine_id: string | null; slab_requirement_id: string; estimated_minutes: number | null };
  const machine = mc as { id: string; vendor_id: string; status: string; is_active: boolean };
  if (item.vendor_id !== machine.vendor_id) {
    redirect("/vendor?toast=Machine+belongs+to+a+different+vendor");
  }
  if (!machine.is_active) redirect("/vendor?toast=Machine+is+inactive");
  if (machine.status !== "idle") redirect("/vendor?toast=Machine+is+not+idle");
  if (item.status !== "carving_assigned" || item.cnc_machine_id) {
    redirect("/vendor?toast=Job+is+not+in+queue");
  }

  const now = new Date().toISOString();
  const finalVendorEst = vendorEstMinutes || item.estimated_minutes || null;

  // Flip carving_items first. Race-guard: only update if status is
  // still carving_assigned (avoids the rare two-phones-at-once case).
  const { data: updatedCi } = await admin
    .from("carving_items")
    .update({
      status: "carving_in_progress",
      cnc_machine_id: machineId,
      loaded_at: now,
      loaded_by: profile.id,
      vendor_estimated_minutes: finalVendorEst,
    })
    .eq("id", carvingItemId)
    .eq("status", "carving_assigned")
    .is("cnc_machine_id", null)
    .select("id");

  if (!updatedCi?.length) {
    redirect("/vendor?toast=Slab+already+loaded+or+state+changed");
  }

  // Flip the machine.
  await admin
    .from("cnc_machines")
    .update({
      status: "carving",
      current_carving_item_id: carvingItemId,
    })
    .eq("id", machineId)
    .eq("status", "idle");

  // Slab table mirrors the carving_items state.
  await admin
    .from("slab_requirements")
    .update({ status: "carving_in_progress", updated_by: profile.id, updated_at: now })
    .eq("id", item.slab_requirement_id);

  // Audit trails — both per-item (carving_job_events) + per-machine
  // (cnc_machine_events).
  await recordEvent(carvingItemId, "loaded", profile.id, `Loaded on machine · ETA ${finalVendorEst ?? "?"}min`);
  await admin.from("cnc_machine_events").insert({
    cnc_machine_id: machineId,
    event_type: "loaded",
    carving_item_id: carvingItemId,
    user_id: profile.id,
    message: `ETA ${finalVendorEst ?? "?"}min`,
  });
  await logAudit(profile.id, "carving_loaded", "carving_item", carvingItemId, {
    machine_id: machineId,
    vendor_estimated_minutes: finalVendorEst,
  });

  refreshAll();
  redirect("/vendor?toast=Slab+loaded");
}

// ── Complete + unload — vendor marks done after the cut ────────────
//
// Atomic:
//   1. carving_items: completed_at, unloaded_at, unloaded_by,
//      temporary_location
//   2. cnc_machines: status → 'idle', current_carving_item_id → null
//   3. cnc_machine_events: 'unloaded'
//   4. slab_requirements unchanged — the team approval step is what
//      flips the slab to 'completed'.
export async function completeAndUnloadAction(formData: FormData) {
  const { profile } = await requireAuth(["developer", "owner", "carving_head", "vendor"]);
  const admin = createAdminSupabaseClient();

  const carvingItemId = txt(formData, "carving_item_id");
  const tempLocation = txt(formData, "temporary_location");

  if (!carvingItemId) redirect("/vendor?toast=Missing+job+id");
  if (!tempLocation) redirect("/vendor?toast=Temporary+location+is+required");

  const { data: ci } = await admin
    .from("carving_items")
    .select("id, status, cnc_machine_id, slab_requirement_id, completed_at")
    .eq("id", carvingItemId)
    .maybeSingle();

  if (!ci) redirect("/vendor?toast=Job+not+found");
  const item = ci as { id: string; status: string; cnc_machine_id: string | null; slab_requirement_id: string; completed_at: string | null };
  if (item.completed_at) redirect("/vendor?toast=Already+marked+complete");
  if (!item.cnc_machine_id) redirect("/vendor?toast=Job+is+not+loaded+on+a+machine");

  const now = new Date().toISOString();

  await admin
    .from("carving_items")
    .update({
      completed_at: now,
      unloaded_at: now,
      unloaded_by: profile.id,
      temporary_location: tempLocation,
    })
    .eq("id", carvingItemId);

  await admin
    .from("cnc_machines")
    .update({ status: "idle", current_carving_item_id: null })
    .eq("id", item.cnc_machine_id);

  await recordEvent(carvingItemId, "completed", profile.id, `Unloaded · location: ${tempLocation}`);
  await admin.from("cnc_machine_events").insert({
    cnc_machine_id: item.cnc_machine_id,
    event_type: "unloaded",
    carving_item_id: carvingItemId,
    user_id: profile.id,
    message: `Unloaded · ${tempLocation}`,
  });
  await logAudit(profile.id, "carving_completed", "carving_item", carvingItemId, {
    temporary_location: tempLocation,
  });

  refreshAll();
  redirect("/vendor?toast=Slab+unloaded+%E2%80%94+awaiting+team+review");
}

// Update temporary location after unload (e.g., slab moved across
// the yard).
export async function updateTemporaryLocationAction(formData: FormData) {
  const { profile } = await requireAuth(["developer", "owner", "carving_head", "vendor"]);
  const admin = createAdminSupabaseClient();

  const carvingItemId = txt(formData, "carving_item_id");
  const tempLocation = txt(formData, "temporary_location");

  if (!carvingItemId) redirect("/vendor?toast=Missing+job+id");

  await admin
    .from("carving_items")
    .update({ temporary_location: tempLocation || null })
    .eq("id", carvingItemId);

  await recordEvent(carvingItemId, "location_updated", profile.id, `Temp location: ${tempLocation || "(cleared)"}`);
  await logAudit(profile.id, "carving_temp_location_updated", "carving_item", carvingItemId, {
    temporary_location: tempLocation,
  });

  refreshAll();
  redirect("/vendor?toast=Location+saved");
}

// ── Maintenance: flag / resolve a CNC machine ──────────────────────
//
// Reasons are a fixed dropdown list — kept in sync between the form
// and this action. We don't gate against currently-carving here:
// instead the UI prevents picking maintenance on a busy machine. This
// guard is the safety net.
const MAINTENANCE_REASONS = new Set([
  "tool_change",
  "spindle_issue",
  "electrical",
  "coolant",
  "scheduled_service",
  "other",
]);

export async function flagMaintenanceAction(formData: FormData) {
  const { profile } = await requireAuth(["developer", "owner", "carving_head", "vendor"]);
  const admin = createAdminSupabaseClient();

  const machineId = txt(formData, "cnc_machine_id");
  const reason = txt(formData, "reason");
  const detail = txt(formData, "detail");

  if (!machineId) redirect("/vendor?toast=Missing+machine+id");
  if (!MAINTENANCE_REASONS.has(reason)) {
    redirect("/vendor?toast=Pick+a+maintenance+reason");
  }

  const { data: m } = await admin
    .from("cnc_machines")
    .select("id, status")
    .eq("id", machineId)
    .maybeSingle();
  if (!m) redirect("/vendor?toast=Machine+not+found");
  if ((m as { status: string }).status === "carving") {
    redirect("/vendor?toast=Unload+the+slab+before+flagging+maintenance");
  }

  const now = new Date().toISOString();
  await admin
    .from("cnc_machines")
    .update({
      status: "maintenance",
      maintenance_reason: detail ? `${reason}: ${detail}` : reason,
      maintenance_flagged_at: now,
      maintenance_flagged_by: profile.id,
    })
    .eq("id", machineId);

  await admin.from("cnc_machine_events").insert({
    cnc_machine_id: machineId,
    event_type: "maintenance_start",
    reason,
    message: detail || null,
    user_id: profile.id,
  });
  await logAudit(profile.id, "cnc_maintenance_start", "cnc_machine", machineId, {
    reason,
    detail,
  });

  refreshAll();
  redirect("/vendor?toast=Machine+flagged+for+maintenance");
}

export async function resolveMaintenanceAction(formData: FormData) {
  const { profile } = await requireAuth(["developer", "owner", "carving_head", "vendor"]);
  const admin = createAdminSupabaseClient();

  const machineId = txt(formData, "cnc_machine_id");
  if (!machineId) redirect("/vendor?toast=Missing+machine+id");

  const { data: m } = await admin
    .from("cnc_machines")
    .select("id, status")
    .eq("id", machineId)
    .maybeSingle();
  if (!m) redirect("/vendor?toast=Machine+not+found");

  await admin
    .from("cnc_machines")
    .update({
      status: "idle",
      maintenance_reason: null,
      maintenance_flagged_at: null,
      maintenance_flagged_by: null,
    })
    .eq("id", machineId);

  await admin.from("cnc_machine_events").insert({
    cnc_machine_id: machineId,
    event_type: "maintenance_end",
    user_id: profile.id,
  });
  await logAudit(profile.id, "cnc_maintenance_end", "cnc_machine", machineId, {});

  refreshAll();
  redirect("/vendor?toast=Machine+back+online");
}

export async function approveCarvingJobAction(formData: FormData) {
  const { profile } = await requireAuth(["developer", "owner", "carving_head"]);
  const admin = createAdminSupabaseClient();
  const jobId = txt(formData, "job_id");
  const notes = txt(formData, "notes") || null;

  if (!jobId) redirect("/carving?toast=Missing+job+id");

  // Use select("*") + maybeSingle so a stale prod schema (missing
  // optional columns like temporary_location) doesn't make the
  // whole row come back as null — that bug would surface as a
  // misleading "Job not found" toast. Surface the real Supabase
  // error if any so we can debug schema drift.
  const { data: job, error: readErr } = await admin
    .from("carving_items")
    .select("*")
    .eq("id", jobId)
    .maybeSingle();

  if (readErr) {
    redirect(
      `/carving?toast=${encodeURIComponent(`Approve failed: ${readErr.message}`)}`,
    );
  }
  if (!job) {
    redirect(`/carving?toast=Job+not+found+(id+${encodeURIComponent(jobId.slice(0, 8))}…)`);
  }
  const j = job as {
    id: string;
    slab_requirement_id: string;
    completed_at: string | null;
    temporary_location?: string | null;
    location?: string | null;
  };
  if (!j.completed_at) {
    redirect(`/carving/${jobId}?toast=Vendor+hasn%27t+marked+it+complete+yet`);
  }

  // Phase 3 simplification: approval now auto-marks the slab as
  // ready-for-dispatch using the vendor's temporary_location (set
  // when they unloaded). The "enter a location and click Ready to
  // Dispatch" intermediate step is gone — Carving Done items appear
  // in the Dispatch Station's Ready tab immediately.
  const now = new Date().toISOString();
  const finalLocation = j.temporary_location ?? j.location ?? "Carving area";

  // Surface the actual error if the update fails (could be a
  // missing column on prod schema if migration 014 wasn't run).
  const { error: updateErr } = await admin
    .from("carving_items")
    .update({
      review_approved_at: now,
      review_approved_by: profile.id,
      review_notes: notes,
      status: "completed",
      location: finalLocation,
      ready_to_dispatch_at: now,
      ready_to_dispatch_by: profile.id,
    })
    .eq("id", jobId);
  if (updateErr) {
    redirect(
      `/carving?toast=${encodeURIComponent(`Approve failed: ${updateErr.message}`)}`,
    );
  }

  // Flip the slab to 'completed' so it surfaces in the Dispatch
  // Station "Ready" tab. Soft-fail here — slab might already be
  // 'completed' or may have been deleted; we don't want to undo the
  // approve we just wrote.
  if (j.slab_requirement_id) {
    await admin
      .from("slab_requirements")
      .update({ status: "completed", updated_by: profile.id, updated_at: now })
      .eq("id", j.slab_requirement_id);
  }

  await recordEvent(jobId, "approved", profile.id, `Approved + ready for dispatch · ${finalLocation}${notes ? ` · ${notes}` : ""}`);
  await logAudit(profile.id, "carving_approved", "carving_item", jobId, {
    slab_id: j.slab_requirement_id,
    location: finalLocation,
  });

  refreshAll();
  redirect(`/carving/${jobId}?toast=Approved+%E2%80%94+ready+for+dispatch`);
}

export async function markReadyToDispatchAction(formData: FormData) {
  const { profile } = await requireAuth(["developer", "owner", "carving_head"]);
  const admin = createAdminSupabaseClient();
  const jobId = txt(formData, "job_id");
  const location = txt(formData, "location");

  if (!jobId) redirect("/carving?toast=Missing+job+id");
  if (!location) redirect(`/carving/${jobId}?toast=Location+is+required+before+marking+ready+to+dispatch`);

  const { data: job } = await admin
    .from("carving_items")
    .select("id, slab_requirement_id, review_approved_at, ready_to_dispatch_at")
    .eq("id", jobId)
    .single();

  if (!job) redirect("/carving?toast=Job+not+found");
  if (!job.review_approved_at) {
    redirect(`/carving/${jobId}?toast=Approve+the+job+first`);
  }
  if (job.ready_to_dispatch_at) {
    // Idempotent: just update the location and bail.
    await admin.from("carving_items").update({ location }).eq("id", jobId);
    refreshAll();
    redirect(`/carving/${jobId}?toast=Location+updated`);
  }

  const now = new Date().toISOString();

  // Atomic side-effects:
  //   1. carving_items: location + ready_to_dispatch_at + ready_to_dispatch_by
  //   2. slab_requirements.status='completed' so it appears in Dispatch Station
  await admin
    .from("carving_items")
    .update({
      location,
      ready_to_dispatch_at: now,
      ready_to_dispatch_by: profile.id,
    })
    .eq("id", jobId);

  await admin
    .from("slab_requirements")
    .update({ status: "completed", updated_by: profile.id, updated_at: now })
    .eq("id", job.slab_requirement_id);

  await recordEvent(jobId, "ready_to_dispatch", profile.id, `Ready for dispatch · location: ${location}`);
  await logAudit(profile.id, "carving_ready_to_dispatch", "carving_item", jobId, {
    slab_id: job.slab_requirement_id,
    location,
  });

  refreshAll();
  redirect(`/carving/${jobId}?toast=Ready+to+dispatch+%E2%80%94+visible+in+Dispatch+Station`);
}

export async function updateCarvingLocationAction(formData: FormData) {
  const { profile } = await requireAuth(["developer", "owner", "carving_head"]);
  const admin = createAdminSupabaseClient();
  const jobId = txt(formData, "job_id");
  const location = txt(formData, "location");

  if (!jobId) redirect("/carving?toast=Missing+job+id");

  await admin.from("carving_items").update({ location: location || null }).eq("id", jobId);
  await recordEvent(jobId, "location_updated", profile.id, `Location set to: ${location || "(cleared)"}`);
  await logAudit(profile.id, "carving_location_updated", "carving_item", jobId, { location });

  refreshAll();
  redirect(`/carving/${jobId}?toast=Location+saved`);
}

export async function rejectCarvingJobAction(formData: FormData) {
  const { profile } = await requireAuth(["developer", "owner", "carving_head"]);
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

// dispatchCarvingJobAction was removed — carved slabs now flow through
// markReadyToDispatchAction (above) and then through the Dispatch
// Station instead of being one-click-dispatched from the carving
// detail page. See migration 014 for the schema change.

export async function cancelCarvingJobAction(formData: FormData) {
  const { profile } = await requireAuth(["developer", "owner", "carving_head"]);
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
