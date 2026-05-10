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

  // If CNC, insert machines. Surface errors via toast — silently
  // logging means the user sees "Vendor created" but no machines
  // appear and they can't tell why.
  if (vendorType === "CNC" && machinesJson) {
    let machineErr: string | null = null;
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
      machineErr = e instanceof Error ? e.message : String(e);
      console.error("[createVendorAction] machine insert error:", e);
    }
    if (machineErr) {
      await logAudit(profile.id, "vendor_created", "vendor", vendor.id, { name, type: vendorType, machine_error: machineErr });
      refreshAll();
      redirect(
        `/carving/vendors/${vendor.id}?toast=${encodeURIComponent(`Vendor saved but machines failed: ${machineErr}`)}`,
      );
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

  // Sync machines for CNC vendors. Errors here used to be swallowed
  // (logged + ignored) which meant the user clicked "Save changes",
  // saw "Vendor saved", and had no idea why the new machine wasn't
  // there. Now we redirect with the real error in the toast.
  if (vendorType === "CNC" && machinesJson) {
    let machineErr: string | null = null;
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
        const { error: dErr } = await admin.from("cnc_machines").delete().in("id", toDelete);
        if (dErr) throw new Error(`delete failed: ${dErr.message}`);
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
      machineErr = e instanceof Error ? e.message : String(e);
      console.error("[updateVendorAction] machine sync error:", e);
    }
    if (machineErr) {
      await logAudit(profile.id, "vendor_updated", "vendor", vendorId, { name, machine_error: machineErr });
      refreshAll();
      redirect(`${redirectTo}?toast=${encodeURIComponent(`Machine sync failed: ${machineErr}`)}`);
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

// ── 2-head CNC: load TWO identical slabs simultaneously ───────────
//
// On a multi_head_2 machine both heads carve the same shape on
// IDENTICAL slabs in lockstep — same temple, same label, same
// L/W/T. The vendor picks two queued items, this action validates
// the match and atomically loads BOTH onto the machine.
//
// Subsequent unload finishes both at once (see completeAndUnload
// below — when the machine is multi_head_2 it pairs and unloads
// every active item on it).
export async function loadTwoSlabsOnMultiHeadAction(formData: FormData) {
  const { profile } = await requireAuth(["developer", "owner", "carving_head", "vendor"]);
  const admin = createAdminSupabaseClient();

  const carvingItemAId = txt(formData, "carving_item_a_id");
  const carvingItemBId = txt(formData, "carving_item_b_id");
  const machineId = txt(formData, "cnc_machine_id");
  const vendorEstMinutes = Math.max(0, num(formData, "vendor_estimated_minutes", 0));

  if (!carvingItemAId || !carvingItemBId || !machineId) {
    redirect("/vendor?toast=Pick+two+slabs+and+a+machine");
  }
  if (carvingItemAId === carvingItemBId) {
    redirect("/vendor?toast=Pick+TWO+different+slabs");
  }

  const [{ data: itemA }, { data: itemB }, { data: mc }] = await Promise.all([
    admin
      .from("carving_items")
      .select("id, vendor_id, status, cnc_machine_id, slab_requirement_id, estimated_minutes")
      .eq("id", carvingItemAId)
      .maybeSingle(),
    admin
      .from("carving_items")
      .select("id, vendor_id, status, cnc_machine_id, slab_requirement_id, estimated_minutes")
      .eq("id", carvingItemBId)
      .maybeSingle(),
    admin
      .from("cnc_machines")
      .select("id, vendor_id, status, is_active, machine_type")
      .eq("id", machineId)
      .maybeSingle(),
  ]);

  if (!itemA || !itemB) redirect("/vendor?toast=One+of+the+jobs+was+not+found");
  if (!mc) redirect("/vendor?toast=Machine+not+found");
  const a = itemA as { id: string; vendor_id: string; status: string; cnc_machine_id: string | null; slab_requirement_id: string; estimated_minutes: number | null };
  const b = itemB as { id: string; vendor_id: string; status: string; cnc_machine_id: string | null; slab_requirement_id: string; estimated_minutes: number | null };
  const m = mc as { id: string; vendor_id: string; status: string; is_active: boolean; machine_type: string | null };

  if (m.machine_type !== "multi_head_2") {
    redirect("/vendor?toast=This+action+is+only+for+2-head+machines");
  }
  if (!m.is_active) redirect("/vendor?toast=Machine+is+inactive");
  if (m.status !== "idle") redirect("/vendor?toast=Machine+is+not+idle");
  if (a.vendor_id !== m.vendor_id || b.vendor_id !== m.vendor_id) {
    redirect("/vendor?toast=One+of+the+jobs+belongs+to+a+different+vendor");
  }
  if (a.status !== "carving_assigned" || a.cnc_machine_id || b.status !== "carving_assigned" || b.cnc_machine_id) {
    redirect("/vendor?toast=One+of+the+jobs+is+not+in+queue");
  }

  // Validate identical slab geometry. Two cylinders on a 2-head CNC
  // must have matching L/W/T or they won't sit in the jig together.
  const { data: slabRows } = await admin
    .from("slab_requirements")
    .select("id, label, temple, length_ft, width_ft, thickness_ft")
    .in("id", [a.slab_requirement_id, b.slab_requirement_id]);
  if (!slabRows || slabRows.length !== 2) {
    redirect("/vendor?toast=Could+not+load+slab+geometry+for+matching");
  }
  const slabA = (slabRows as Array<{
    id: string; label: string | null; temple: string;
    length_ft: number | string; width_ft: number | string; thickness_ft: number | string;
  }>).find((s) => s.id === a.slab_requirement_id)!;
  const slabB = (slabRows as Array<{
    id: string; label: string | null; temple: string;
    length_ft: number | string; width_ft: number | string; thickness_ft: number | string;
  }>).find((s) => s.id === b.slab_requirement_id)!;

  const dimsMatch =
    Number(slabA.length_ft) === Number(slabB.length_ft) &&
    Number(slabA.width_ft) === Number(slabB.width_ft) &&
    Number(slabA.thickness_ft) === Number(slabB.thickness_ft);
  const labelMatch = (slabA.label ?? "") === (slabB.label ?? "");
  const templeMatch = (slabA.temple ?? "") === (slabB.temple ?? "");
  if (!dimsMatch || !labelMatch || !templeMatch) {
    redirect(
      `/vendor?toast=${encodeURIComponent(
        "2-head load needs IDENTICAL slabs (same L×W×T + temple + label). Pick a matching pair from the queue.",
      )}`,
    );
  }

  const now = new Date().toISOString();
  const finalEst = vendorEstMinutes || a.estimated_minutes || b.estimated_minutes || null;

  // Flip both items + machine atomically. Race-guard on each item.
  const updateOne = async (id: string) =>
    admin
      .from("carving_items")
      .update({
        status: "carving_in_progress",
        cnc_machine_id: machineId,
        loaded_at: now,
        loaded_by: profile.id,
        vendor_estimated_minutes: finalEst,
      })
      .eq("id", id)
      .eq("status", "carving_assigned")
      .is("cnc_machine_id", null)
      .select("id");

  const [{ data: updA }, { data: updB }] = await Promise.all([updateOne(a.id), updateOne(b.id)]);
  if (!updA?.length || !updB?.length) {
    // Roll back the one that succeeded if the other didn't.
    if (updA?.length) {
      await admin
        .from("carving_items")
        .update({
          status: "carving_assigned",
          cnc_machine_id: null,
          loaded_at: null,
          loaded_by: null,
          vendor_estimated_minutes: null,
        })
        .eq("id", a.id);
    }
    if (updB?.length) {
      await admin
        .from("carving_items")
        .update({
          status: "carving_assigned",
          cnc_machine_id: null,
          loaded_at: null,
          loaded_by: null,
          vendor_estimated_minutes: null,
        })
        .eq("id", b.id);
    }
    redirect("/vendor?toast=Could+not+claim+both+slabs+(state+changed).+Refresh+and+retry.");
  }

  // Machine + slab status flips. Machine.current_carving_item_id
  // points at the first head's item; the second is implicit
  // (we'll fetch all carving_items where cnc_machine_id=m.id when
  // we need both).
  await admin
    .from("cnc_machines")
    .update({ status: "carving", current_carving_item_id: a.id })
    .eq("id", machineId)
    .eq("status", "idle");

  await admin
    .from("slab_requirements")
    .update({ status: "carving_in_progress", updated_by: profile.id, updated_at: now })
    .in("id", [a.slab_requirement_id, b.slab_requirement_id]);

  // Audit on both items + the machine.
  await Promise.all([
    recordEvent(a.id, "loaded", profile.id, `2-head load (paired with ${b.id}) · ETA ${finalEst ?? "?"}min`),
    recordEvent(b.id, "loaded", profile.id, `2-head load (paired with ${a.id}) · ETA ${finalEst ?? "?"}min`),
  ]);
  await admin.from("cnc_machine_events").insert({
    cnc_machine_id: machineId,
    event_type: "loaded",
    carving_item_id: a.id,
    user_id: profile.id,
    message: `2-head load · pair ${a.id} + ${b.id} · ETA ${finalEst ?? "?"}min`,
  });
  await logAudit(profile.id, "carving_loaded_pair", "carving_item", a.id, {
    machine_id: machineId,
    paired_with: b.id,
    vendor_estimated_minutes: finalEst,
  });

  refreshAll();
  redirect("/vendor?toast=Both+slabs+loaded");
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

  // 2-head machines load + unload as a paired set. If the machine
  // is multi_head_2, find every active item on this machine and
  // complete them together so neither head is left in a half-state.
  const { data: machineRow } = await admin
    .from("cnc_machines")
    .select("id, machine_type")
    .eq("id", item.cnc_machine_id)
    .maybeSingle();
  const isMultiHead = (machineRow as { machine_type?: string } | null)?.machine_type === "multi_head_2";

  const idsToComplete = [carvingItemId];
  if (isMultiHead) {
    const { data: pair } = await admin
      .from("carving_items")
      .select("id, slab_requirement_id")
      .eq("cnc_machine_id", item.cnc_machine_id)
      .eq("status", "carving_in_progress")
      .is("completed_at", null);
    for (const r of (pair ?? []) as Array<{ id: string }>) {
      if (r.id !== carvingItemId) idsToComplete.push(r.id);
    }
  }

  // Update every paired item with the same completed/unloaded stamp
  // + temp location so the pair lands in Awaiting Review together.
  await admin
    .from("carving_items")
    .update({
      completed_at: now,
      unloaded_at: now,
      unloaded_by: profile.id,
      temporary_location: tempLocation,
    })
    .in("id", idsToComplete);

  await admin
    .from("cnc_machines")
    .update({ status: "idle", current_carving_item_id: null })
    .eq("id", item.cnc_machine_id);

  // Audit each item separately so the timeline records both unloads.
  for (const id of idsToComplete) {
    await recordEvent(id, "completed", profile.id, `Unloaded · location: ${tempLocation}${idsToComplete.length > 1 ? " (2-head pair)" : ""}`);
  }
  await admin.from("cnc_machine_events").insert({
    cnc_machine_id: item.cnc_machine_id,
    event_type: "unloaded",
    carving_item_id: carvingItemId,
    user_id: profile.id,
    message:
      idsToComplete.length > 1
        ? `Unloaded 2-head pair · ${tempLocation}`
        : `Unloaded · ${tempLocation}`,
  });
  await logAudit(profile.id, "carving_completed", "carving_item", carvingItemId, {
    temporary_location: tempLocation,
    paired_count: idsToComplete.length,
  });

  refreshAll();
  redirect(
    idsToComplete.length > 1
      ? "/vendor?toast=Both+slabs+unloaded+%E2%80%94+awaiting+team+review"
      : "/vendor?toast=Slab+unloaded+%E2%80%94+awaiting+team+review",
  );
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
  // When the action is called from the JobDetailPeek modal we don't
  // want to redirect — the modal closes itself + parent revalidates
  // in place. Set `stay=1` from the form to opt out of the redirect.
  const stay = txt(formData, "stay") === "1";

  if (!jobId) {
    if (stay) return;
    redirect("/carving?toast=Missing+job+id");
  }

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
    if (stay) throw new Error(`Approve failed: ${readErr.message}`);
    redirect(`/carving?toast=${encodeURIComponent(`Approve failed: ${readErr.message}`)}`);
  }
  if (!job) {
    if (stay) throw new Error(`Job not found (id ${jobId.slice(0, 8)}…)`);
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
    if (stay) throw new Error("Vendor hasn't marked it complete yet");
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
    if (stay) throw new Error(`Approve failed: ${updateErr.message}`);
    redirect(`/carving?toast=${encodeURIComponent(`Approve failed: ${updateErr.message}`)}`);
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
  if (stay) return;
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
  const stay = txt(formData, "stay") === "1";

  if (!jobId || !notes) {
    if (stay) throw new Error("Rejection notes required");
    redirect(`/carving/${jobId}?toast=Rejection+notes+required`);
  }

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
  if (stay) return;
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

// ── Job event timeline — used by JobDetailPeek modal ─────────────
//
// Returns the carving_job_events for a single carving_item, with
// user names hydrated. Same shape the legacy /carving/[id] detail
// page renders, just delivered as a server-action call so the peek
// modal can mount it without a route navigation.
export type JobEvent = {
  id: string;
  event_type: string;
  message: string | null;
  created_at: string;
  user_name: string | null;
};

export async function getJobEvents(jobId: string): Promise<JobEvent[]> {
  await requireAuth(["developer", "owner", "carving_head"]);
  const admin = createAdminSupabaseClient();

  const { data: events } = await admin
    .from("carving_job_events")
    .select("id, event_type, message, created_at, user_id")
    .eq("carving_item_id", jobId)
    .order("created_at", { ascending: false })
    .limit(200);

  const userIds = [
    ...new Set(
      ((events ?? []) as { user_id: string | null }[])
        .map((e) => e.user_id)
        .filter(Boolean) as string[],
    ),
  ];
  const { data: profs } = userIds.length > 0
    ? await admin.from("profiles").select("id, full_name").in("id", userIds)
    : { data: [] as { id: string; full_name: string | null }[] };
  const nameById = new Map<string, string>();
  for (const p of profs ?? []) nameById.set(p.id, p.full_name ?? "—");

  return ((events ?? []) as Array<{
    id: string; event_type: string; message: string | null;
    created_at: string; user_id: string | null;
  }>).map((e) => ({
    id: e.id,
    event_type: e.event_type,
    message: e.message,
    created_at: e.created_at,
    user_name: e.user_id ? nameById.get(e.user_id) ?? null : null,
  }));
}

// ── Machine history — events + computed aggregates ────────────────
//
// Surfaces a machine's full event timeline (loaded / unloaded /
// maintenance start / maintenance end) plus rolled-up totals so the
// supervisor can see at a glance:
//   • how much time the machine has spent CARVING vs DOWN over a
//     given window (default last 30d)
//   • how many slabs it has produced
//   • how many maintenance episodes it had + cumulative downtime
//
// Read-only; can be called from any logged-in user with carving-
// related access.
export type MachineEvent = {
  id: string;
  event_type: string;
  carving_item_id: string | null;
  reason: string | null;
  message: string | null;
  user_id: string | null;
  user_name: string | null;
  slab_id: string | null;
  created_at: string;
};

export type MachineHistory = {
  machine: {
    id: string;
    machine_code: string;
    operator_name: string | null;
    machine_type: "single_head" | "multi_head_2" | "lathe";
    status: string;
  };
  windowDays: number;
  totals: {
    /** Number of carving sessions completed in the window. */
    sessions: number;
    /** Total minutes the machine spent carving (sum of unload − load
     *  pairs). Open sessions count up to "now". */
    carvingMinutes: number;
    /** Number of maintenance episodes started in the window. */
    maintEpisodes: number;
    /** Total minutes the machine spent in maintenance (sum of end −
     *  start pairs). Open episodes count up to "now". */
    maintMinutes: number;
  };
  events: MachineEvent[];
};

export async function getMachineHistory(
  machineId: string,
  windowDays = 30,
): Promise<MachineHistory | null> {
  await requireAuth(["developer", "owner", "carving_head", "vendor"]);
  const admin = createAdminSupabaseClient();

  const sinceIso = new Date(Date.now() - windowDays * 86400000).toISOString();

  const [{ data: machine }, { data: rawEvents }] = await Promise.all([
    admin
      .from("cnc_machines")
      .select("id, machine_code, operator_name, machine_type, status")
      .eq("id", machineId)
      .maybeSingle(),
    admin
      .from("cnc_machine_events")
      .select("id, event_type, carving_item_id, reason, message, user_id, created_at")
      .eq("cnc_machine_id", machineId)
      .gte("created_at", sinceIso)
      .order("created_at", { ascending: false })
      .limit(500),
  ]);

  if (!machine) return null;
  const m = machine as {
    id: string;
    machine_code: string;
    operator_name: string | null;
    machine_type: string | null;
    status: string;
  };

  // Hydrate user names + slab ids in one round-trip each.
  const userIds = [...new Set((rawEvents ?? [])
    .map((e) => (e as { user_id: string | null }).user_id)
    .filter(Boolean) as string[])];
  const itemIds = [...new Set((rawEvents ?? [])
    .map((e) => (e as { carving_item_id: string | null }).carving_item_id)
    .filter(Boolean) as string[])];

  const [{ data: profs }, { data: items }] = await Promise.all([
    userIds.length > 0
      ? admin.from("profiles").select("id, full_name").in("id", userIds)
      : Promise.resolve({ data: [] as { id: string; full_name: string | null }[] }),
    itemIds.length > 0
      ? admin
          .from("carving_items")
          .select("id, slab_requirement_id")
          .in("id", itemIds)
      : Promise.resolve({ data: [] as { id: string; slab_requirement_id: string }[] }),
  ]);
  const nameById = new Map<string, string>();
  for (const p of profs ?? []) nameById.set(p.id, p.full_name ?? "—");
  const slabIdByItem = new Map<string, string>();
  for (const i of items ?? []) slabIdByItem.set(i.id, i.slab_requirement_id);

  const events: MachineEvent[] = ((rawEvents ?? []) as Array<{
    id: string; event_type: string; carving_item_id: string | null;
    reason: string | null; message: string | null; user_id: string | null;
    created_at: string;
  }>).map((e) => ({
    id: e.id,
    event_type: e.event_type,
    carving_item_id: e.carving_item_id,
    reason: e.reason,
    message: e.message,
    user_id: e.user_id,
    user_name: e.user_id ? nameById.get(e.user_id) ?? null : null,
    slab_id: e.carving_item_id ? slabIdByItem.get(e.carving_item_id) ?? null : null,
    created_at: e.created_at,
  }));

  // Walk the events in chronological order and pair load↔unload +
  // maintenance_start↔maintenance_end to compute durations. Open
  // sessions / episodes count up to `now`.
  const chronological = [...events].reverse();
  const now = Date.now();
  let carvingMinutes = 0;
  let sessions = 0;
  let maintMinutes = 0;
  let maintEpisodes = 0;
  let openLoadAt: number | null = null;
  let openMaintAt: number | null = null;
  for (const ev of chronological) {
    const t = new Date(ev.created_at).getTime();
    if (ev.event_type === "loaded") {
      openLoadAt = t;
    } else if (ev.event_type === "unloaded") {
      if (openLoadAt != null) {
        carvingMinutes += (t - openLoadAt) / 60000;
        sessions += 1;
        openLoadAt = null;
      }
    } else if (ev.event_type === "maintenance_start") {
      openMaintAt = t;
      maintEpisodes += 1;
    } else if (ev.event_type === "maintenance_end") {
      if (openMaintAt != null) {
        maintMinutes += (t - openMaintAt) / 60000;
        openMaintAt = null;
      }
    }
  }
  // Currently-open session / episode → count up to now.
  if (openLoadAt != null) {
    carvingMinutes += (now - openLoadAt) / 60000;
    sessions += 1; // still in progress; show in count
  }
  if (openMaintAt != null) {
    maintMinutes += (now - openMaintAt) / 60000;
  }

  return {
    machine: {
      id: m.id,
      machine_code: m.machine_code,
      operator_name: m.operator_name,
      machine_type:
        m.machine_type === "multi_head_2" || m.machine_type === "lathe"
          ? (m.machine_type as "multi_head_2" | "lathe")
          : "single_head",
      status: m.status,
    },
    windowDays,
    totals: {
      sessions,
      carvingMinutes: Math.round(carvingMinutes),
      maintEpisodes,
      maintMinutes: Math.round(maintMinutes),
    },
    events,
  };
}
