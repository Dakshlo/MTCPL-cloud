"use server";

/**
 * Dispatch station server actions.
 *
 * Three actions:
 *   - createDispatchAction: creates a dispatches row + N dispatch_logs
 *     rows + flips all N slabs to status=dispatched.
 *   - markDeliveredAction: closes out a dispatch (site engineer reported
 *     receipt via the developer).
 *   - undoDispatchAction: reverts an out-for-delivery dispatch — slabs
 *     return to status=completed, the dispatches row is deleted, and
 *     the dispatch_logs rows go with it.
 *
 * All gated to developer role per plan. Roles will widen later when we
 * add site-engineer access for delivery confirmation.
 */

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";
import { notify } from "@/lib/notifications";

// ─── Helpers ─────────────────────────────────────────────────────────────

function fail(path: string, message: string): never {
  redirect(`${path}?dispatch_error=${encodeURIComponent(message)}`);
}

// ─── createDispatchAction ────────────────────────────────────────────────

export async function createDispatchAction(formData: FormData) {
  const { profile } = await requireAuth(["developer"]);
  const admin = createAdminSupabaseClient();

  const temple = String(formData.get("temple") || "").trim();
  const vehicleNo = String(formData.get("vehicle_no") || "").trim().toUpperCase() || null;
  const driverName = String(formData.get("driver_name") || "").trim() || null;
  const driverPhone = String(formData.get("driver_phone") || "").trim() || null;
  const expectedDeliveryDate = String(formData.get("expected_delivery_date") || "").trim() || null;
  const notes = String(formData.get("notes") || "").trim() || null;
  const slabIds = JSON.parse(String(formData.get("slab_ids") || "[]")) as string[];

  // ── Validation
  if (!temple) fail("/dispatch", "Temple is required");
  if (!Array.isArray(slabIds) || slabIds.length === 0) {
    fail("/dispatch", "Pick at least one slab to dispatch");
  }
  if (vehicleNo === null) fail("/dispatch", "Vehicle number is required");
  if (driverName === null) fail("/dispatch", "Driver name is required");

  // Verify every selected slab is (a) status=completed and (b) actually
  // belongs to the specified temple. Defends against stale UI or hostile
  // POST. `.in()` + `.eq()` together gives an atomic-ish check.
  const { data: slabs, error: slabErr } = await admin
    .from("slab_requirements")
    .select("id, temple, status, length_ft, width_ft, thickness_ft")
    .in("id", slabIds);
  if (slabErr) fail("/dispatch", `Could not verify slabs: ${slabErr.message}`);
  if (!slabs || slabs.length !== slabIds.length) {
    fail("/dispatch", "One or more slabs no longer exist — refresh and retry");
  }
  for (const s of slabs) {
    if (s.status !== "completed") {
      fail("/dispatch", `Slab ${s.id} is not in 'completed' status (is '${s.status}'). Refresh and retry.`);
    }
    if (s.temple !== temple) {
      fail("/dispatch", `Slab ${s.id} belongs to a different temple (${s.temple}). One dispatch = one temple.`);
    }
  }

  // Fetch matching carving_items so we can mark them dispatched + create
  // dispatch_logs rows (needs carving_item_id per schema).
  const { data: carvingItems, error: carvingErr } = await admin
    .from("carving_items")
    .select("id, slab_requirement_id")
    .in("slab_requirement_id", slabIds);
  if (carvingErr) fail("/dispatch", `Could not load carving jobs: ${carvingErr.message}`);
  const carvingBySlabId = new Map<string, string>();
  for (const ci of carvingItems ?? []) {
    carvingBySlabId.set(ci.slab_requirement_id, ci.id);
  }
  // Every completed slab should have a carving_items row — if one is
  // missing we surface it rather than silently dropping.
  for (const slabId of slabIds) {
    if (!carvingBySlabId.has(slabId)) {
      fail("/dispatch", `Slab ${slabId} has no carving record — its completion may be corrupted.`);
    }
  }

  // ── Create the dispatches row
  const { data: dispatch, error: dispatchErr } = await admin
    .from("dispatches")
    .insert({
      temple,
      vehicle_no: vehicleNo,
      driver_name: driverName,
      driver_phone: driverPhone,
      expected_delivery_date: expectedDeliveryDate,
      notes,
      dispatched_by: profile.id,
    })
    .select("id")
    .single();
  if (dispatchErr || !dispatch) {
    fail("/dispatch", `Failed to create dispatch: ${dispatchErr?.message ?? "unknown"}`);
  }
  const dispatchId = dispatch.id as string;

  // ── Insert per-slab dispatch_logs
  const logRows = slabIds.map((slabId) => ({
    carving_item_id: carvingBySlabId.get(slabId),
    slab_requirement_id: slabId,
    dispatched_by: profile.id,
    dispatch_id: dispatchId,
  }));
  const { error: logsErr } = await admin.from("dispatch_logs").insert(logRows);
  if (logsErr) {
    // Roll back the dispatches row — no point in having an orphan.
    await admin.from("dispatches").delete().eq("id", dispatchId);
    fail("/dispatch", `Failed to log slabs: ${logsErr.message}. Dispatch rolled back.`);
  }

  // ── Flip statuses
  const now = new Date().toISOString();
  await admin
    .from("carving_items")
    .update({ status: "dispatched" })
    .in("slab_requirement_id", slabIds);
  await admin
    .from("slab_requirements")
    .update({ status: "dispatched", updated_by: profile.id, updated_at: now })
    .in("id", slabIds);

  // ── Audit + notify
  await logAudit(profile.id, "dispatch_created", "dispatch", dispatchId, {
    temple,
    vehicle_no: vehicleNo,
    driver_name: driverName,
    slab_count: slabIds.length,
    slab_ids: slabIds,
  });
  await notify("dispatch_created", `Dispatch to ${temple}`, {
    message: `${slabIds.length} slab${slabIds.length !== 1 ? "s" : ""} on vehicle ${vehicleNo ?? "—"}${driverName ? ` · Driver ${driverName}` : ""}`,
    entityType: "dispatch",
    entityId: dispatchId,
    actorId: profile.id,
    targetRoles: ["owner", "team_head", "developer"],
  });

  revalidatePath("/dispatch");
  revalidatePath("/carving");
  redirect(
    `/dispatch?tab=out_for_delivery&dispatch_toast=${encodeURIComponent(
      `✓ Dispatched ${slabIds.length} slab${slabIds.length !== 1 ? "s" : ""} to ${temple}`,
    )}`,
  );
}

// ─── markDeliveredAction ─────────────────────────────────────────────────

export async function markDeliveredAction(formData: FormData) {
  const { profile } = await requireAuth(["developer"]);
  const admin = createAdminSupabaseClient();

  const dispatchId = String(formData.get("dispatch_id") || "").trim();
  const receiverName = String(formData.get("receiver_name") || "").trim() || null;
  const deliveryNote = String(formData.get("delivery_note") || "").trim() || null;

  if (!dispatchId) fail("/dispatch", "Dispatch id is required");

  // Guard: only out-for-delivery rows can be marked delivered.
  const { data: dispatch } = await admin
    .from("dispatches")
    .select("id, temple, delivered_at")
    .eq("id", dispatchId)
    .maybeSingle();
  if (!dispatch) fail("/dispatch", "Dispatch not found");
  if (dispatch.delivered_at) {
    fail("/dispatch", "Dispatch is already marked delivered");
  }

  const { error } = await admin
    .from("dispatches")
    .update({
      delivered_at: new Date().toISOString(),
      delivered_by: profile.id,
      receiver_name: receiverName,
      delivery_note: deliveryNote,
    })
    .eq("id", dispatchId);
  if (error) fail("/dispatch", `Failed to mark delivered: ${error.message}`);

  await logAudit(profile.id, "dispatch_delivered", "dispatch", dispatchId, {
    temple: dispatch.temple,
    receiver_name: receiverName,
  });
  await notify("dispatch_delivered", `Delivered to ${dispatch.temple}`, {
    message: receiverName ? `Received by ${receiverName}` : "Confirmed by site engineer",
    entityType: "dispatch",
    entityId: dispatchId,
    actorId: profile.id,
    targetRoles: ["owner", "team_head", "developer"],
  });

  revalidatePath("/dispatch");
  redirect(
    `/dispatch?tab=delivered&dispatch_toast=${encodeURIComponent(`✓ Marked delivered to ${dispatch.temple}`)}`,
  );
}

// ─── undoDispatchAction ──────────────────────────────────────────────────

export async function undoDispatchAction(formData: FormData) {
  const { profile } = await requireAuth(["developer"]);
  const admin = createAdminSupabaseClient();

  const dispatchId = String(formData.get("dispatch_id") || "").trim();
  if (!dispatchId) fail("/dispatch", "Dispatch id is required");

  // Can only undo out-for-delivery (not-yet-delivered) rows.
  const { data: dispatch } = await admin
    .from("dispatches")
    .select("id, temple, delivered_at")
    .eq("id", dispatchId)
    .maybeSingle();
  if (!dispatch) fail("/dispatch", "Dispatch not found");
  if (dispatch.delivered_at) {
    fail("/dispatch", "Cannot undo a dispatch that has already been marked delivered");
  }

  // Fetch the slab ids this dispatch carries so we can flip them back.
  const { data: logs } = await admin
    .from("dispatch_logs")
    .select("slab_requirement_id, carving_item_id")
    .eq("dispatch_id", dispatchId);
  const slabIds = (logs ?? []).map((l) => l.slab_requirement_id).filter(Boolean) as string[];
  const carvingIds = (logs ?? []).map((l) => l.carving_item_id).filter(Boolean) as string[];

  // Revert statuses first.
  const now = new Date().toISOString();
  if (slabIds.length > 0) {
    await admin
      .from("slab_requirements")
      .update({ status: "completed", updated_by: profile.id, updated_at: now })
      .in("id", slabIds);
  }
  if (carvingIds.length > 0) {
    await admin
      .from("carving_items")
      .update({ status: "completed" })
      .in("id", carvingIds);
  }

  // Delete the dispatch_logs rows tied to this dispatch (the FK is set
  // ON DELETE SET NULL, so deleting the dispatches row alone would
  // leave orphaned logs — we want them gone entirely).
  await admin.from("dispatch_logs").delete().eq("dispatch_id", dispatchId);
  await admin.from("dispatches").delete().eq("id", dispatchId);

  await logAudit(profile.id, "dispatch_undone", "dispatch", dispatchId, {
    temple: dispatch.temple,
    slabs_reverted: slabIds,
  });

  revalidatePath("/dispatch");
  revalidatePath("/carving");
  redirect(
    `/dispatch?dispatch_toast=${encodeURIComponent(`✓ Undid dispatch to ${dispatch.temple} — ${slabIds.length} slab${slabIds.length !== 1 ? "s" : ""} back in queue`)}`,
  );
}
