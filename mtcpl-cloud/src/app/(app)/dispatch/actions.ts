"use server";

/**
 * Dispatch station server actions.
 *
 * Lifecycle (v2 — with senior-approval step):
 *
 *   [junior creates]  createDispatchAction  → row lands in Provisional
 *                                             (approved_at = NULL)
 *   [senior reviews]                       → approveDispatchAction    (→ Out for Delivery)
 *                     OR                    → cancelDispatchAction    (revert, delete)
 *                     OR                    → editDispatchSlabsAction (modify slab list)
 *   [driver leaves]                        → row is Out for Delivery
 *                                             (approved_at set, delivered_at NULL)
 *   [engineer reports]                     → markDeliveredAction      (→ Delivered)
 *   [mistake / recall]                     → undoDispatchAction       (revert from OFD)
 *
 * All gated to ["developer", "owner"] — the junior/senior split is
 * organisational, not a system role (the plan notes this as future work
 * once a real role hierarchy lands).
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

// Roles allowed to operate the station — matches the /dispatch page guard
// (carving_head runs the station day-to-day; previously the actions were
// developer/owner-only and silently bounced them).
const STATION_ROLES = ["developer", "owner", "carving_head"] as const;

// Delivery-proof photo upload (mig 129).
const PROOF_BUCKET = "dispatch_delivery_proofs";
const PROOF_MAX_BYTES = 10 * 1024 * 1024; // 10 MB per photo
const PROOF_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"]);

function proofExt(mime: string): string {
  return mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : "jpg";
}

// ─── createDispatchAction ────────────────────────────────────────────────

export async function createDispatchAction(formData: FormData) {
  const { profile } = await requireAuth([...STATION_ROLES]);
  const admin = createAdminSupabaseClient();

  const temple = String(formData.get("temple") || "").trim();
  const vehicleNo = String(formData.get("vehicle_no") || "").trim().toUpperCase() || null;
  const driverName = String(formData.get("driver_name") || "").trim() || null;
  const driverPhone = String(formData.get("driver_phone") || "").trim() || null;
  const expectedDeliveryDate = String(formData.get("expected_delivery_date") || "").trim() || null;
  const notes = String(formData.get("notes") || "").trim() || null;
  const slabIds = JSON.parse(String(formData.get("slab_ids") || "[]")) as string[];
  // Mig 130 — optional per-slab weights (tonnes), entered on the truck
  // form. Map slabId → tonnes; missing/invalid entries stay NULL.
  let slabWeights: Record<string, number> = {};
  try {
    const parsed = JSON.parse(String(formData.get("slab_weights") || "{}"));
    if (parsed && typeof parsed === "object") {
      for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
        const n = Number(v);
        if (Number.isFinite(n) && n > 0) slabWeights[k] = n;
      }
    }
  } catch {
    slabWeights = {};
  }

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
  // dispatch_logs rows. Mig 130 — a missing carving row is NO LONGER an
  // error: direct-dispatch slabs (sent straight from cutting, never
  // carved) legitimately have none; their dispatch_logs.carving_item_id
  // stays NULL.
  const { data: carvingItems, error: carvingErr } = await admin
    .from("carving_items")
    .select("id, slab_requirement_id")
    .in("slab_requirement_id", slabIds);
  if (carvingErr) fail("/dispatch", `Could not load carving jobs: ${carvingErr.message}`);
  const carvingBySlabId = new Map<string, string>();
  for (const ci of carvingItems ?? []) {
    carvingBySlabId.set(ci.slab_requirement_id, ci.id);
  }

  // ── Create the dispatches row. approved_at stays NULL → lands in
  // Provisional tab awaiting senior review. challan_number is auto-
  // assigned by the sequence default (migration 011). load_number is
  // the per-TEMPLE counter (mig 130): next = max+1 for this temple,
  // retried on the unique-index collision if two dispatches race.
  let dispatchId = "";
  let challanNumber: number | null = null;
  let loadNumber: number | null = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    const { data: maxRow } = await admin
      .from("dispatches")
      .select("load_number")
      .eq("temple", temple)
      .not("load_number", "is", null)
      .order("load_number", { ascending: false })
      .limit(1)
      .maybeSingle();
    const candidate = (Number((maxRow as { load_number?: number } | null)?.load_number) || 0) + 1 + attempt;

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
        load_number: candidate,
      })
      .select("id, challan_number, load_number")
      .single();
    if (dispatchErr) {
      // 23505 = unique violation on (temple, load_number) — someone
      // grabbed this load number between our read and insert. Retry.
      if ((dispatchErr as { code?: string }).code === "23505" && attempt < 3) continue;
      fail("/dispatch", `Failed to create dispatch: ${dispatchErr.message}`);
    }
    dispatchId = (dispatch as { id: string }).id;
    challanNumber = (dispatch as { challan_number?: number }).challan_number ?? null;
    loadNumber = (dispatch as { load_number?: number }).load_number ?? null;
    break;
  }
  if (!dispatchId) fail("/dispatch", "Failed to create dispatch — load number collision. Retry.");

  // ── Insert per-slab dispatch_logs (weight_tonnes — mig 130)
  const logRows = slabIds.map((slabId) => ({
    carving_item_id: carvingBySlabId.get(slabId) ?? null,
    slab_requirement_id: slabId,
    dispatched_by: profile.id,
    dispatch_id: dispatchId,
    weight_tonnes: slabWeights[slabId] ?? null,
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

  // ── Audit + notify. Event name is now "dispatch_created_provisional"
  // to distinguish from the pre-v2 single-step dispatch.
  const chalanLabel = challanNumber != null ? `CHLN-${String(challanNumber).padStart(4, "0")}` : dispatchId.slice(0, 8);
  await logAudit(profile.id, "dispatch_created", "dispatch", dispatchId, {
    temple,
    vehicle_no: vehicleNo,
    driver_name: driverName,
    slab_count: slabIds.length,
    slab_ids: slabIds,
    challan_number: challanNumber,
    load_number: loadNumber,
    state: "provisional",
  });
  await notify("dispatch_created", `Provisional dispatch to ${temple} (${chalanLabel})`, {
    message: `${slabIds.length} slab${slabIds.length !== 1 ? "s" : ""} · awaiting senior approval · vehicle ${vehicleNo ?? "—"}${driverName ? ` · Driver ${driverName}` : ""}`,
    entityType: "dispatch",
    entityId: dispatchId,
    actorId: profile.id,
    targetRoles: ["owner", "team_head", "developer"],
  });

  revalidatePath("/dispatch");
  revalidatePath("/carving");
  redirect(
    `/dispatch?tab=provisional&dispatch_toast=${encodeURIComponent(
      `✓ ${chalanLabel} created for ${temple} — awaiting senior approval`,
    )}`,
  );
}

// ─── markDeliveredAction ─────────────────────────────────────────────────

export async function markDeliveredAction(formData: FormData) {
  const { profile } = await requireAuth([...STATION_ROLES]);
  const admin = createAdminSupabaseClient();

  const dispatchId = String(formData.get("dispatch_id") || "").trim();
  const receiverName = String(formData.get("receiver_name") || "").trim() || null;
  const deliveryNote = String(formData.get("delivery_note") || "").trim() || null;

  if (!dispatchId) fail("/dispatch", "Dispatch id is required");

  // Mig 129 — delivery proof is MANDATORY: (1) the truck at the site and
  // (2) the signed challan. No photos → cannot mark delivered.
  const proofSite = formData.get("proof_site");
  const proofChallan = formData.get("proof_challan");
  if (!(proofSite instanceof File) || proofSite.size === 0) {
    fail("/dispatch?tab=out_for_delivery", "Photo 1 missing — truck at the site (proof slabs reached). Both photos are required.");
  }
  if (!(proofChallan instanceof File) || proofChallan.size === 0) {
    fail("/dispatch?tab=out_for_delivery", "Photo 2 missing — the signed challan. Both photos are required.");
  }
  for (const [label, f] of [["Site photo", proofSite], ["Challan photo", proofChallan]] as const) {
    if (f.size > PROOF_MAX_BYTES) fail("/dispatch?tab=out_for_delivery", `${label} is too large — max 10 MB.`);
    const mime = (f.type || "").toLowerCase();
    if (!PROOF_TYPES.has(mime)) fail("/dispatch?tab=out_for_delivery", `${label} must be a JPG / PNG / WEBP / HEIC image.`);
  }

  // Guard: only approved (i.e. out-for-delivery) rows can be marked
  // delivered. Cannot mark a still-provisional row delivered.
  const { data: dispatch } = await admin
    .from("dispatches")
    .select("id, temple, approved_at, delivered_at")
    .eq("id", dispatchId)
    .maybeSingle();
  if (!dispatch) fail("/dispatch", "Dispatch not found");
  if (!dispatch.approved_at) {
    fail("/dispatch", "Dispatch is still provisional — must be approved by a senior first");
  }
  if (dispatch.delivered_at) {
    fail("/dispatch", "Dispatch is already marked delivered");
  }

  // Upload both proofs BEFORE flipping the row — if an upload fails, the
  // dispatch stays out-for-delivery and the operator simply retries.
  const sitePath = `${dispatchId}/site-${Date.now()}.${proofExt((proofSite.type || "").toLowerCase())}`;
  const challanPath = `${dispatchId}/challan-${Date.now()}.${proofExt((proofChallan.type || "").toLowerCase())}`;
  const siteBuf = Buffer.from(await proofSite.arrayBuffer());
  const challanBuf = Buffer.from(await proofChallan.arrayBuffer());
  const { error: upSiteErr } = await admin.storage
    .from(PROOF_BUCKET)
    .upload(sitePath, siteBuf, { contentType: proofSite.type || "image/jpeg", upsert: false });
  if (upSiteErr) fail("/dispatch?tab=out_for_delivery", `Site photo upload failed: ${upSiteErr.message}`);
  const { error: upChallanErr } = await admin.storage
    .from(PROOF_BUCKET)
    .upload(challanPath, challanBuf, { contentType: proofChallan.type || "image/jpeg", upsert: false });
  if (upChallanErr) {
    await admin.storage.from(PROOF_BUCKET).remove([sitePath]).catch(() => {});
    fail("/dispatch?tab=out_for_delivery", `Challan photo upload failed: ${upChallanErr.message}`);
  }

  const { error } = await admin
    .from("dispatches")
    .update({
      delivered_at: new Date().toISOString(),
      delivered_by: profile.id,
      receiver_name: receiverName,
      delivery_note: deliveryNote,
      proof_site_path: sitePath,
      proof_challan_path: challanPath,
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
  const { profile } = await requireAuth([...STATION_ROLES]);
  const admin = createAdminSupabaseClient();

  const dispatchId = String(formData.get("dispatch_id") || "").trim();
  if (!dispatchId) fail("/dispatch", "Dispatch id is required");

  // Can only undo out-for-delivery (approved but not-yet-delivered) rows.
  // Provisional dispatches use cancelDispatchAction instead.
  const { data: dispatch } = await admin
    .from("dispatches")
    .select("id, temple, approved_at, delivered_at")
    .eq("id", dispatchId)
    .maybeSingle();
  if (!dispatch) fail("/dispatch", "Dispatch not found");
  if (!dispatch.approved_at) {
    fail("/dispatch", "Dispatch is still provisional — use Cancel instead of Undo");
  }
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

// ─── approveDispatchAction ───────────────────────────────────────────────
// Senior signs off on a provisional dispatch — truck is now cleared to leave.
// Sets approved_at + approved_by; row moves from Provisional → Out for Delivery.

export async function approveDispatchAction(formData: FormData) {
  const { profile } = await requireAuth([...STATION_ROLES]);
  const admin = createAdminSupabaseClient();

  const dispatchId = String(formData.get("id") || "").trim();
  if (!dispatchId) fail("/dispatch", "Dispatch id is required");

  const { data: dispatch } = await admin
    .from("dispatches")
    .select("id, temple, challan_number, approved_at, delivered_at")
    .eq("id", dispatchId)
    .maybeSingle();
  if (!dispatch) fail("/dispatch", "Dispatch not found");
  if (dispatch.approved_at) fail("/dispatch", "Dispatch already approved");
  if (dispatch.delivered_at) fail("/dispatch", "Dispatch already delivered");

  const { error } = await admin
    .from("dispatches")
    .update({
      approved_at: new Date().toISOString(),
      approved_by: profile.id,
    })
    .eq("id", dispatchId);
  if (error) fail("/dispatch", `Failed to approve: ${error.message}`);

  const chalanLabel = dispatch.challan_number != null
    ? `CHLN-${String(dispatch.challan_number).padStart(4, "0")}`
    : dispatchId.slice(0, 8);

  await logAudit(profile.id, "dispatch_approved", "dispatch", dispatchId, {
    temple: dispatch.temple,
    challan_number: dispatch.challan_number,
  });
  await notify("dispatch_approved", `${chalanLabel} approved for ${dispatch.temple}`, {
    message: `Senior approved — truck cleared to leave`,
    entityType: "dispatch",
    entityId: dispatchId,
    actorId: profile.id,
    targetRoles: ["owner", "team_head", "developer"],
  });

  revalidatePath("/dispatch");
  revalidatePath("/challan");
  redirect(
    `/dispatch?tab=out_for_delivery&dispatch_toast=${encodeURIComponent(`✓ ${chalanLabel} approved — ${dispatch.temple}`)}`,
  );
}

// ─── cancelDispatchAction ────────────────────────────────────────────────
// Senior rejects a provisional dispatch. Slabs go back to "completed" so
// they reappear in Make Dispatch. The dispatch row + its dispatch_logs are
// deleted. Sequence number is consumed (gap), same as a voided paper challan.

export async function cancelDispatchAction(formData: FormData) {
  const { profile } = await requireAuth([...STATION_ROLES]);
  const admin = createAdminSupabaseClient();

  const dispatchId = String(formData.get("id") || "").trim();
  if (!dispatchId) fail("/dispatch", "Dispatch id is required");

  const { data: dispatch } = await admin
    .from("dispatches")
    .select("id, temple, challan_number, approved_at, delivered_at")
    .eq("id", dispatchId)
    .maybeSingle();
  if (!dispatch) fail("/dispatch", "Dispatch not found");
  if (dispatch.approved_at) {
    fail("/dispatch", "Dispatch is already approved — use Undo (on Out-for-delivery) instead of Cancel");
  }
  if (dispatch.delivered_at) {
    fail("/dispatch", "Cannot cancel a delivered dispatch");
  }

  // Fetch slab ids so we can flip their statuses back.
  const { data: logs } = await admin
    .from("dispatch_logs")
    .select("slab_requirement_id, carving_item_id")
    .eq("dispatch_id", dispatchId);
  const slabIds = (logs ?? []).map((l) => l.slab_requirement_id).filter(Boolean) as string[];
  const carvingIds = (logs ?? []).map((l) => l.carving_item_id).filter(Boolean) as string[];

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

  await admin.from("dispatch_logs").delete().eq("dispatch_id", dispatchId);
  await admin.from("dispatches").delete().eq("id", dispatchId);

  const chalanLabel = dispatch.challan_number != null
    ? `CHLN-${String(dispatch.challan_number).padStart(4, "0")}`
    : dispatchId.slice(0, 8);

  await logAudit(profile.id, "dispatch_cancelled", "dispatch", dispatchId, {
    temple: dispatch.temple,
    challan_number: dispatch.challan_number,
    slabs_returned: slabIds,
  });

  revalidatePath("/dispatch");
  revalidatePath("/carving");
  redirect(
    `/dispatch?tab=ready&dispatch_toast=${encodeURIComponent(
      `✓ Cancelled ${chalanLabel} — ${slabIds.length} slab${slabIds.length !== 1 ? "s" : ""} back in Make Dispatch`,
    )}`,
  );
}

// ─── editDispatchSlabsAction ─────────────────────────────────────────────
// Senior modifies the slab list of a still-provisional dispatch.
// Inputs (FormData):
//   - id: dispatch_id
//   - add_slab_ids:    JSON string[] of slab ids to add to this dispatch
//   - remove_slab_ids: JSON string[] of slab ids to remove from this dispatch
//
// Validation:
//   - dispatch must be provisional (approved_at IS NULL, delivered_at IS NULL)
//   - every add-slab must belong to the dispatch's temple, be status=completed,
//     and not already on another dispatch
//   - every remove-slab must currently be on this dispatch
//
// Side effects: dispatch_logs rows inserted/deleted; slab_requirements +
// carving_items statuses flipped accordingly. Auto-cancels the whole
// dispatch if the edit leaves it with zero slabs.

export async function editDispatchSlabsAction(formData: FormData) {
  const { profile } = await requireAuth([...STATION_ROLES]);
  const admin = createAdminSupabaseClient();

  const dispatchId = String(formData.get("id") || "").trim();
  if (!dispatchId) fail("/dispatch", "Dispatch id is required");

  let addIds: string[] = [];
  let removeIds: string[] = [];
  try {
    addIds = JSON.parse(String(formData.get("add_slab_ids") || "[]"));
    removeIds = JSON.parse(String(formData.get("remove_slab_ids") || "[]"));
  } catch {
    fail("/dispatch", "Malformed slab lists");
  }
  if (!Array.isArray(addIds) || !Array.isArray(removeIds)) {
    fail("/dispatch", "Slab lists must be arrays");
  }

  // No-op check
  if (addIds.length === 0 && removeIds.length === 0) {
    redirect(`/dispatch?tab=provisional&dispatch_toast=${encodeURIComponent("No changes")}`);
  }

  // ── Load + validate dispatch
  const { data: dispatch } = await admin
    .from("dispatches")
    .select("id, temple, challan_number, approved_at, delivered_at")
    .eq("id", dispatchId)
    .maybeSingle();
  if (!dispatch) fail("/dispatch", "Dispatch not found");
  if (dispatch.approved_at) fail("/dispatch", "Dispatch already approved — can no longer edit slabs");
  if (dispatch.delivered_at) fail("/dispatch", "Dispatch already delivered");

  // ── Validate remove-slabs are currently on this dispatch
  if (removeIds.length > 0) {
    const { data: currentLogs } = await admin
      .from("dispatch_logs")
      .select("slab_requirement_id")
      .eq("dispatch_id", dispatchId);
    const currentSet = new Set((currentLogs ?? []).map((l) => l.slab_requirement_id));
    for (const id of removeIds) {
      if (!currentSet.has(id)) fail("/dispatch", `Slab ${id} is not on this dispatch`);
    }
  }

  // ── Validate add-slabs: same temple, status=completed, not on another dispatch
  if (addIds.length > 0) {
    const { data: addSlabs } = await admin
      .from("slab_requirements")
      .select("id, temple, status")
      .in("id", addIds);
    if (!addSlabs || addSlabs.length !== addIds.length) {
      fail("/dispatch", "One or more slabs to add no longer exist");
    }
    for (const s of addSlabs) {
      if (s.temple !== dispatch.temple) {
        fail("/dispatch", `Slab ${s.id} belongs to ${s.temple}, not ${dispatch.temple}. One dispatch = one temple.`);
      }
      if (s.status !== "completed") {
        fail("/dispatch", `Slab ${s.id} is not in 'completed' status (is '${s.status}')`);
      }
    }
    // Reject if any add-slab is already on a different dispatch
    const { data: otherLogs } = await admin
      .from("dispatch_logs")
      .select("slab_requirement_id, dispatch_id")
      .in("slab_requirement_id", addIds);
    for (const l of otherLogs ?? []) {
      if (l.dispatch_id && l.dispatch_id !== dispatchId) {
        fail("/dispatch", `Slab ${l.slab_requirement_id} is already on another dispatch`);
      }
    }
  }

  // ── Execute: remove first (so add-slabs get a clean slate), then add
  const now = new Date().toISOString();

  if (removeIds.length > 0) {
    const { data: removedLogs } = await admin
      .from("dispatch_logs")
      .select("carving_item_id")
      .eq("dispatch_id", dispatchId)
      .in("slab_requirement_id", removeIds);
    const removedCarvingIds = (removedLogs ?? [])
      .map((l) => l.carving_item_id)
      .filter(Boolean) as string[];

    await admin
      .from("dispatch_logs")
      .delete()
      .eq("dispatch_id", dispatchId)
      .in("slab_requirement_id", removeIds);
    await admin
      .from("slab_requirements")
      .update({ status: "completed", updated_by: profile.id, updated_at: now })
      .in("id", removeIds);
    if (removedCarvingIds.length > 0) {
      await admin
        .from("carving_items")
        .update({ status: "completed" })
        .in("id", removedCarvingIds);
    }
  }

  if (addIds.length > 0) {
    // Fetch carving_items for the slabs being added (need carving_item_id FK)
    const { data: addCarving } = await admin
      .from("carving_items")
      .select("id, slab_requirement_id")
      .in("slab_requirement_id", addIds);
    const carvingBySlab = new Map<string, string>();
    for (const ci of addCarving ?? []) {
      carvingBySlab.set(ci.slab_requirement_id, ci.id);
    }
    // Mig 130 — direct-dispatch slabs have no carving record;
    // carving_item_id stays NULL on their log rows.
    const newLogs = addIds.map((slabId) => ({
      carving_item_id: carvingBySlab.get(slabId) ?? null,
      slab_requirement_id: slabId,
      dispatched_by: profile.id,
      dispatch_id: dispatchId,
    }));
    await admin.from("dispatch_logs").insert(newLogs);
    await admin
      .from("slab_requirements")
      .update({ status: "dispatched", updated_by: profile.id, updated_at: now })
      .in("id", addIds);
    await admin
      .from("carving_items")
      .update({ status: "dispatched" })
      .in("slab_requirement_id", addIds);
  }

  // ── If the dispatch now has zero slabs, auto-cancel
  const { count: remaining } = await admin
    .from("dispatch_logs")
    .select("slab_requirement_id", { count: "exact", head: true })
    .eq("dispatch_id", dispatchId);
  if ((remaining ?? 0) === 0) {
    await admin.from("dispatches").delete().eq("id", dispatchId);
    redirect(
      `/dispatch?tab=ready&dispatch_toast=${encodeURIComponent(
        "Dispatch was left with zero slabs — auto-cancelled",
      )}`,
    );
  }

  const chalanLabel = dispatch.challan_number != null
    ? `CHLN-${String(dispatch.challan_number).padStart(4, "0")}`
    : dispatchId.slice(0, 8);

  await logAudit(profile.id, "dispatch_edited", "dispatch", dispatchId, {
    temple: dispatch.temple,
    challan_number: dispatch.challan_number,
    added: addIds,
    removed: removeIds,
  });

  revalidatePath("/dispatch");
  revalidatePath("/carving");
  redirect(
    `/dispatch?tab=provisional&dispatch_toast=${encodeURIComponent(
      `✓ ${chalanLabel} updated — ${addIds.length} added, ${removeIds.length} removed`,
    )}`,
  );
}

// ─── clearDispatchHoldAction (Mig 097) ─────────────────────────────────────
// "✓ Correct" on the Needs-work section: the departed slab's touch-up is
// done, so release the dispatch hold → it drops back into Make Dispatch.
export async function clearDispatchHoldAction(formData: FormData) {
  const { profile } = await requireAuth(["developer", "owner", "senior_incharge", "carving_head"]);
  const admin = createAdminSupabaseClient();
  const slabId = String(formData.get("slab_id") || "").trim();
  // "rework" → the button was pressed on the Rework Tunnel page; bounce
  // back there instead of the main station so the list flow continues.
  const from = String(formData.get("from") || "").trim();
  if (!slabId) fail("/dispatch", "Missing slab id");
  const now = new Date().toISOString();
  await admin
    .from("slab_requirements")
    .update({ dispatch_hold: false, updated_by: profile.id, updated_at: now })
    .eq("id", slabId);
  // Record on the carving_item that the touch-up was signed off.
  await admin
    .from("carving_items")
    .update({ depart_cleared_at: now, depart_cleared_by: profile.id })
    .eq("slab_requirement_id", slabId);
  await logAudit(profile.id, "dispatch_hold_cleared", "slab", slabId, {});
  revalidatePath("/dispatch");
  revalidatePath("/dispatch/rework");
  revalidatePath("/carving");
  const dest = from === "rework" ? "/dispatch/rework" : "/dispatch";
  redirect(`${dest}?dispatch_toast=${encodeURIComponent(`✓ ${slabId} released — now in Make Dispatch`)}`);
}

// ── updateDispatchInchargeAction (mig 130 follow-on) ─────────────────────
// The Dispatch Incharge (MTCPL plant side) printed on every challan —
// default POSA RAM · 8949783579. Edited from the Dispatch page header
// (moved out of Settings → Temple Codes at Daksh's request). Stored in
// app_settings under the original 'dispatch_handling_man' key so the
// value carries over.
export async function updateDispatchInchargeAction(formData: FormData) {
  const { profile } = await requireAuth([...STATION_ROLES]);
  const admin = createAdminSupabaseClient();

  const name = String(formData.get("incharge_name") || "").trim();
  const phone = String(formData.get("incharge_phone") || "").trim();
  if (!name) fail("/dispatch", "Dispatch incharge name is required");

  const { error } = await admin
    .from("app_settings")
    .upsert({
      key: "dispatch_handling_man",
      value: { name, phone },
      updated_at: new Date().toISOString(),
      updated_by: profile.id,
    });
  if (error) fail("/dispatch", `Failed to save dispatch incharge: ${error.message}`);

  await logAudit(profile.id, "dispatch_incharge_updated", "app_setting", "dispatch_handling_man", { name, phone });
  revalidatePath("/dispatch");
  redirect(`/dispatch?dispatch_toast=${encodeURIComponent(`✓ Dispatch incharge updated — ${name}${phone ? ` (${phone})` : ""}`)}`);
}
