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
import { createInvoicingChallanFromDispatch } from "@/lib/dispatch-invoicing-bridge";

// ─── Helpers ─────────────────────────────────────────────────────────────

function fail(path: string, message: string): never {
  redirect(`${path}?dispatch_error=${encodeURIComponent(message)}`);
}

// Roles allowed to operate the station — matches the /dispatch page guard
// (carving_head runs the station day-to-day; previously the actions were
// developer/owner-only and silently bounced them).
// Senior dispatch roles — they APPROVE / cancel / edit a dispatch.
const STATION_ROLES = ["developer", "owner", "carving_head", "senior_incharge"] as const;
// Daksh (Jun 2026) — UNDO on the road (recall an approved truck) is tighter:
// owner / developer / senior_incharge ONLY (not carving_head, not dispatch).
const UNDO_ROLES = ["developer", "owner", "senior_incharge"] as const;
// Floor roles — the dispatch incharge can CREATE a dispatch and MARK DELIVERED,
// but not approve it (that's a senior's call). Includes the dedicated
// "dispatch" (dispatch incharge) role on top of the senior set.
const FLOOR_ROLES = [...STATION_ROLES, "dispatch"] as const;

// Delivery-proof photo upload (mig 129).
const PROOF_BUCKET = "dispatch_delivery_proofs";
const PROOF_MAX_BYTES = 10 * 1024 * 1024; // 10 MB per photo
const PROOF_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"]);

function proofExt(mime: string): string {
  return mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : "jpg";
}

// Return provisional/recalled-dispatch slabs to their pre-dispatch home.
//
// We keep a slab's `is_parked` flag through the whole dispatch (a dispatched
// slab is invisible to every storage view, which all filter on status), so on
// revert the flag still tells us it came from STORAGE:
//   • parked + NO carving_item  → carving storage (cut_done, direct-dispatch) → cut_done
//   • parked + HAS carving_item → dispatch storage (completed)                 → completed
//   • not parked                → normal ready                                 → completed
// is_parked is left untouched, so storage slabs reappear in their own storage.
async function returnSlabsFromDispatch(
  admin: ReturnType<typeof createAdminSupabaseClient>,
  logRows: Array<{ slab_requirement_id: string | null; carving_item_id: string | null }>,
  actorId: string,
  now: string,
): Promise<void> {
  const slabIds = logRows.map((l) => l.slab_requirement_id).filter(Boolean) as string[];
  if (slabIds.length === 0) return;
  const hasCarving = new Map<string, boolean>();
  for (const l of logRows) {
    if (l.slab_requirement_id) hasCarving.set(l.slab_requirement_id, !!l.carving_item_id);
  }
  const { data: rows } = await admin.from("slab_requirements").select("id, is_parked").in("id", slabIds);
  const toCutDone: string[] = [];
  const toCompleted: string[] = [];
  for (const r of (rows ?? []) as Array<{ id: string; is_parked?: boolean }>) {
    if (r.is_parked === true && !hasCarving.get(r.id)) toCutDone.push(r.id);
    else toCompleted.push(r.id);
  }
  // Any slab the read missed (shouldn't happen) still gets reverted to completed.
  for (const id of slabIds) if (!toCutDone.includes(id) && !toCompleted.includes(id)) toCompleted.push(id);
  if (toCutDone.length > 0) {
    await admin.from("slab_requirements").update({ status: "cut_done", updated_by: actorId, updated_at: now }).in("id", toCutDone);
  }
  if (toCompleted.length > 0) {
    await admin.from("slab_requirements").update({ status: "completed", updated_by: actorId, updated_at: now }).in("id", toCompleted);
  }
}

// ─── createDispatchAction ────────────────────────────────────────────────

export async function createDispatchAction(formData: FormData) {
  const { profile } = await requireAuth([...FLOOR_ROLES]);
  const admin = createAdminSupabaseClient();

  const temple = String(formData.get("temple") || "").trim();
  const vehicleNo = String(formData.get("vehicle_no") || "").trim().toUpperCase() || null;
  const driverName = String(formData.get("driver_name") || "").trim() || null;
  const driverPhone = String(formData.get("driver_phone") || "").trim() || null;
  const expectedDeliveryDate = String(formData.get("expected_delivery_date") || "").trim() || null;
  const notes = String(formData.get("notes") || "").trim() || null;
  const slabIds = JSON.parse(String(formData.get("slab_ids") || "[]")) as string[];
  // Mig 130 — optional per-slab weights, entered in KG on the truck form.
  // Stored as TONNES in dispatch_logs.weight_tonnes (canonical) — the
  // challan prints per-slab kg + a net total in tonnes. Map slabId → kg;
  // missing/invalid entries stay NULL.
  let slabWeightsKg: Record<string, number> = {};
  try {
    const parsed = JSON.parse(String(formData.get("slab_weights") || "{}"));
    if (parsed && typeof parsed === "object") {
      for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
        const n = Number(v);
        if (Number.isFinite(n) && n > 0) slabWeightsKg[k] = n;
      }
    }
  } catch {
    slabWeightsKg = {};
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
    .select("id, temple, status, is_parked, length_ft, width_ft, thickness_ft, cancel_requested_at")
    .in("id", slabIds);
  if (slabErr) fail("/dispatch", `Could not verify slabs: ${slabErr.message}`);
  if (!slabs || slabs.length !== slabIds.length) {
    fail("/dispatch", "One or more slabs no longer exist — refresh and retry");
  }
  for (const s of slabs) {
    // Normal flow = status 'completed'. Mig 125 follow-on — a PARKED cut_done
    // slab (carving storage) can be dispatched directly (skipping carving) when
    // the picker's 'cut-done storage' toggle was used to pull it in.
    const parkedCutDone = s.status === "cut_done" && (s as { is_parked?: boolean }).is_parked === true;
    if (s.status !== "completed" && !parkedCutDone) {
      fail("/dispatch", `Slab ${s.id} is not ready to dispatch (status '${s.status}'). Refresh and retry.`);
    }
    if (s.temple !== temple) {
      fail("/dispatch", `Slab ${s.id} belongs to a different temple (${s.temple}). One dispatch = one temple.`);
    }
    // Mig 132 — pending-cancel slabs are locked out of dispatch.
    if ((s as { cancel_requested_at?: string | null }).cancel_requested_at) {
      fail("/dispatch", `Slab ${s.id} has a pending CANCEL request — locked until the owner decides.`);
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

  // ── Insert per-slab dispatch_logs (weight_tonnes — mig 130).
  // Input is kg → store tonnes (kg / 1000).
  const logRows = slabIds.map((slabId) => ({
    carving_item_id: carvingBySlabId.get(slabId) ?? null,
    slab_requirement_id: slabId,
    dispatched_by: profile.id,
    dispatch_id: dispatchId,
    weight_tonnes: slabWeightsKg[slabId] != null ? slabWeightsKg[slabId] / 1000 : null,
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
    // Keep is_parked as-is — a storage slab stays "parked" (invisible to storage
    // views while dispatched) so a later cancel returns it to its own storage.
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
  const { profile } = await requireAuth([...FLOOR_ROLES]);
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
  const { profile } = await requireAuth([...UNDO_ROLES]);
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

  // Mig 158 — a verified dispatch already spawned an invoicing challan. Undo is
  // a full reversal, so remove that challan too. BLOCK only when the challan is
  // a LIVE bill: priced (the challan IS the tax invoice) or converted to a
  // legacy invoice, AND not cancelled. A cancelled challan is already void — so
  // "cancel the challan in Invoicing, then undo" works (it no longer blocks),
  // and any legacy invoice it spawned is cleaned up here too.
  const { data: ch } = await admin
    .from("challans")
    .select("id, priced_at, converted_invoice_id, cancelled_at")
    .eq("source_dispatch_id", dispatchId)
    .maybeSingle();
  if (ch) {
    const chr = ch as { id: string; priced_at: string | null; converted_invoice_id: string | null; cancelled_at: string | null };
    if (!chr.cancelled_at && (chr.priced_at || chr.converted_invoice_id)) {
      fail("/dispatch", "This truck's challan is priced as a tax invoice in Invoicing. Cancel that challan in Invoicing first, then undo.");
    }
    if (chr.converted_invoice_id) {
      await admin.from("invoices").delete().eq("id", chr.converted_invoice_id); // invoice_items cascade
    }
    await admin.from("challans").delete().eq("id", chr.id); // challan_items cascade
  }

  // Fetch the slab ids this dispatch carries so we can flip them back.
  const { data: logs } = await admin
    .from("dispatch_logs")
    .select("slab_requirement_id, carving_item_id")
    .eq("dispatch_id", dispatchId);
  const slabIds = (logs ?? []).map((l) => l.slab_requirement_id).filter(Boolean) as string[];
  const carvingIds = (logs ?? []).map((l) => l.carving_item_id).filter(Boolean) as string[];

  // Revert statuses first. Storage slabs go back to their storage.
  const now = new Date().toISOString();
  await returnSlabsFromDispatch(admin, logs ?? [], profile.id, now);
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

// Mig 154/158 — on verify/approve, mirror the dispatch into an Invoicing
// challan billed to the TEMPLE (the client). Shared bridge lives in
// @/lib/dispatch-invoicing-bridge (also used by the invoicing "Sync from
// dispatch" backfill). Idempotent via challans.source_dispatch_id.

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

  // Bridge → Invoicing: if this temple maps to a customer party, spawn an
  // invoicing challan with the delivered slabs so it can be converted to an
  // invoice. Best-effort — never blocks the approval.
  try {
    await createInvoicingChallanFromDispatch(admin, dispatchId, dispatch.temple, dispatch.challan_number ?? null, profile.id);
  } catch (e) {
    console.warn("[dispatch→invoicing challan] non-fatal", e);
  }

  revalidatePath("/dispatch");
  revalidatePath("/challan");
  revalidatePath("/invoicing");
  revalidatePath("/invoicing/challans");
  redirect(
    `/dispatch?tab=out_for_delivery&dispatch_toast=${encodeURIComponent(`✓ ${chalanLabel} approved — ${dispatch.temple}`)}`,
  );
}

// ─── verifyDispatchAction ────────────────────────────────────────────────
// The "Check & verify" page's primary action (replaces the inline Approve).
// Persists each slab's billing unit (cft/sft) chosen on the grid, then signs
// off exactly like approve: truck cleared to leave + the invoicing challan is
// spawned carrying the same priced grid.
export async function verifyDispatchAction(formData: FormData) {
  const { profile } = await requireAuth([...STATION_ROLES]);
  const admin = createAdminSupabaseClient();

  const dispatchId = String(formData.get("id") || "").trim();
  if (!dispatchId) fail("/dispatch", "Dispatch id is required");

  let units: Record<string, string> = {};
  try {
    units = JSON.parse(String(formData.get("units") || "{}")) as Record<string, string>;
  } catch {
    units = {};
  }
  // Per-slab weight (tonnes) edited on the Check grid — already split evenly
  // across each row's slabs by the client. In whole-truck mode these are all 0.
  let weights: Record<string, number | string> = {};
  try {
    weights = JSON.parse(String(formData.get("weights") || "{}")) as Record<string, number | string>;
  } catch {
    weights = {};
  }
  // Mig 163 — whole-truck weight mode. truck → one load weight on the dispatch.
  const weightMode = String(formData.get("weight_mode") || "slab") === "truck" ? "truck" : "slab";
  const truckTonnes = Math.max(0, Math.round((Number(formData.get("truck_weight")) || 0) * 1000) / 1000);

  const { data: dispatch } = await admin
    .from("dispatches")
    .select("id, temple, challan_number, approved_at, delivered_at")
    .eq("id", dispatchId)
    .maybeSingle();
  if (!dispatch) fail("/dispatch", "Dispatch not found");
  if (dispatch.approved_at) fail("/dispatch", "Dispatch already verified");
  if (dispatch.delivered_at) fail("/dispatch", "Dispatch already delivered");

  // Weight is MANDATORY before verifying (Daksh). Truck mode → one load weight;
  // per-slab mode → every slab must carry a weight. The Check grid already
  // blocks the button, this is the server-side backstop.
  if (weightMode === "truck") {
    if (!(truckTonnes > 0)) fail(`/dispatch/${dispatchId}/check`, "Weight is mandatory — enter the whole-truck load weight before verifying.");
  } else {
    const vals = Object.values(weights).map((w) => Number(w) || 0);
    if (vals.length === 0 || vals.some((w) => w <= 0)) {
      fail(`/dispatch/${dispatchId}/check`, "Weight is mandatory — every slab needs a weight (or switch to whole-truck weight).");
    }
  }

  // Persist the per-slab billing unit. Default cft; only the explicitly-toggled
  // sft slabs flip. Two bulk updates keep it to a couple of round-trips.
  const sftIds: string[] = [];
  const cftIds: string[] = [];
  for (const [slabId, u] of Object.entries(units)) {
    if (!slabId) continue;
    if (u === "sft") sftIds.push(slabId);
    else cftIds.push(slabId);
  }
  if (sftIds.length > 0) {
    await admin.from("dispatch_logs").update({ measure_unit: "sft" }).eq("dispatch_id", dispatchId).in("slab_requirement_id", sftIds);
  }
  if (cftIds.length > 0) {
    await admin.from("dispatch_logs").update({ measure_unit: "cft" }).eq("dispatch_id", dispatchId).in("slab_requirement_id", cftIds);
  }

  // Persist edited weights. Slabs sharing a value (a row's even split) are
  // updated together → roughly one round-trip per row, not per slab.
  const byWeight = new Map<number, string[]>();
  for (const [slabId, raw] of Object.entries(weights)) {
    if (!slabId) continue;
    const val = Math.round((Number(raw) || 0) * 1000) / 1000;
    const arr = byWeight.get(val) ?? [];
    arr.push(slabId);
    byWeight.set(val, arr);
  }
  for (const [val, ids] of byWeight) {
    await admin
      .from("dispatch_logs")
      .update({ weight_tonnes: val > 0 ? val : null })
      .eq("dispatch_id", dispatchId)
      .in("slab_requirement_id", ids);
  }

  // Persist per-slab Description / Additional overrides (challan + invoice only;
  // Mig 162). Only the rows the user actually changed are sent. Null in a field
  // = unchanged → leave the column NULL so it falls back to the slab's own text.
  // Done BEFORE the invoicing bridge below so the snapshot picks up the edits.
  let descs: Record<string, { d: string | null; a: string | null }> = {};
  try {
    descs = JSON.parse(String(formData.get("descs") || "{}")) as Record<string, { d: string | null; a: string | null }>;
  } catch {
    descs = {};
  }
  const byDesc = new Map<string, { d: string | null; a: string | null; ids: string[] }>();
  for (const [slabId, v] of Object.entries(descs)) {
    if (!slabId || !v) continue;
    const d = v.d == null ? null : String(v.d);
    const a = v.a == null ? null : String(v.a);
    const k = JSON.stringify([d, a]); // unambiguous — no separator collisions
    const e = byDesc.get(k) ?? { d, a, ids: [] };
    e.ids.push(slabId);
    byDesc.set(k, e);
  }
  for (const { d, a, ids } of byDesc.values()) {
    await admin
      .from("dispatch_logs")
      .update({ desc_override: d, additional_override: a })
      .eq("dispatch_id", dispatchId)
      .in("slab_requirement_id", ids);
  }

  const { error } = await admin
    .from("dispatches")
    .update({ approved_at: new Date().toISOString(), approved_by: profile.id })
    .eq("id", dispatchId);
  if (error) fail(`/dispatch/${dispatchId}/check`, `Failed to verify: ${error.message}`);

  // Mig 163 — persist the weight mode + whole-truck weight. SEPARATE from the
  // critical approve update above + error ignored, so a pre-migration schema
  // never blocks Verify (it just falls back to per-slab).
  {
    const { error: wmErr } = await admin
      .from("dispatches")
      .update({
        weight_mode: weightMode,
        load_weight_tonnes: weightMode === "truck" && truckTonnes > 0 ? truckTonnes : null,
      })
      .eq("id", dispatchId);
    if (wmErr) console.warn("[dispatch weight_mode] non-fatal", wmErr.message);
  }

  const chalanLabel = dispatch.challan_number != null
    ? `CHLN-${String(dispatch.challan_number).padStart(4, "0")}`
    : dispatchId.slice(0, 8);

  await logAudit(profile.id, "dispatch_verified", "dispatch", dispatchId, {
    temple: dispatch.temple,
    challan_number: dispatch.challan_number,
    sft_slabs: sftIds.length,
  });
  await notify("dispatch_approved", `${chalanLabel} verified for ${dispatch.temple}`, {
    message: `Dispatch verified — truck cleared to leave`,
    entityType: "dispatch",
    entityId: dispatchId,
    actorId: profile.id,
    targetRoles: ["owner", "team_head", "developer"],
  });

  try {
    await createInvoicingChallanFromDispatch(admin, dispatchId, dispatch.temple, dispatch.challan_number ?? null, profile.id);
  } catch (e) {
    console.warn("[dispatch→invoicing challan] non-fatal", e);
  }

  revalidatePath("/dispatch");
  revalidatePath("/challan");
  revalidatePath("/invoicing");
  revalidatePath("/invoicing/challans");
  redirect(
    `/dispatch?tab=out_for_delivery&dispatch_toast=${encodeURIComponent(`✓ ${chalanLabel} verified — ${dispatch.temple}`)}`,
  );
}

// ─── removeSlabsFromDispatchAction ───────────────────────────────────────
// Per-row Remove on the Check page — drop slab(s) from a still-provisional
// dispatch and send them back to Make Dispatch, staying on the Check page. If
// it empties the dispatch, the dispatch is cancelled and we bounce to Make
// Dispatch (same as a full cancel).
export async function removeSlabsFromDispatchAction(formData: FormData) {
  const { profile } = await requireAuth([...STATION_ROLES]);
  const admin = createAdminSupabaseClient();

  const dispatchId = String(formData.get("id") || "").trim();
  if (!dispatchId) fail("/dispatch", "Dispatch id is required");

  let slabIds: string[] = [];
  try {
    slabIds = (JSON.parse(String(formData.get("slab_ids") || "[]")) as string[]).filter(Boolean);
  } catch {
    slabIds = [];
  }
  if (slabIds.length === 0) redirect(`/dispatch/${dispatchId}/check`);

  const { data: dispatch } = await admin
    .from("dispatches")
    .select("id, approved_at, delivered_at")
    .eq("id", dispatchId)
    .maybeSingle();
  if (!dispatch) fail("/dispatch", "Dispatch not found");
  if (dispatch.approved_at || dispatch.delivered_at) {
    fail("/dispatch", "Can only edit a dispatch that is still waiting for verification");
  }

  const now = new Date().toISOString();
  const { data: logs } = await admin
    .from("dispatch_logs")
    .select("slab_requirement_id, carving_item_id")
    .eq("dispatch_id", dispatchId)
    .in("slab_requirement_id", slabIds);
  const carvingIds = (logs ?? []).map((l) => l.carving_item_id).filter(Boolean) as string[];

  // Storage slabs return to their storage; others to Make Dispatch.
  await returnSlabsFromDispatch(admin, logs ?? [], profile.id, now);
  if (carvingIds.length > 0) {
    await admin.from("carving_items").update({ status: "completed" }).in("id", carvingIds);
  }
  await admin.from("dispatch_logs").delete().eq("dispatch_id", dispatchId).in("slab_requirement_id", slabIds);

  const { count } = await admin
    .from("dispatch_logs")
    .select("slab_requirement_id", { count: "exact", head: true })
    .eq("dispatch_id", dispatchId);
  if ((count ?? 0) === 0) {
    await admin.from("dispatches").delete().eq("id", dispatchId);
    revalidatePath("/dispatch");
    revalidatePath("/carving");
    redirect(`/dispatch?tab=ready&dispatch_toast=${encodeURIComponent("Dispatch emptied — all slabs back in Make Dispatch")}`);
  }

  revalidatePath(`/dispatch/${dispatchId}/check`);
  revalidatePath("/dispatch");
  revalidatePath("/carving");
  redirect(
    `/dispatch/${dispatchId}/check?dispatch_toast=${encodeURIComponent(`Removed ${slabIds.length} slab${slabIds.length !== 1 ? "s" : ""} → back in Make Dispatch`)}`,
  );
}

// ─── addSlabsToDispatchAction ────────────────────────────────────────────
// Check page "+ Add slab" — pull this temple's completed (available) slabs
// onto a still-provisional dispatch, staying on the Check page.
export async function addSlabsToDispatchAction(formData: FormData) {
  const { profile } = await requireAuth([...STATION_ROLES]);
  const admin = createAdminSupabaseClient();

  const dispatchId = String(formData.get("id") || "").trim();
  if (!dispatchId) fail("/dispatch", "Dispatch id is required");

  let slabIds: string[] = [];
  try {
    slabIds = (JSON.parse(String(formData.get("slab_ids") || "[]")) as string[]).filter(Boolean);
  } catch {
    slabIds = [];
  }
  if (slabIds.length === 0) redirect(`/dispatch/${dispatchId}/check`);

  const { data: dispatch } = await admin
    .from("dispatches")
    .select("id, temple, approved_at, delivered_at")
    .eq("id", dispatchId)
    .maybeSingle();
  if (!dispatch) fail("/dispatch", "Dispatch not found");
  if (dispatch.approved_at || dispatch.delivered_at) {
    fail("/dispatch", "Can only edit a dispatch that is still waiting for verification");
  }

  // Eligible slabs: completed (ready or dispatch-storage) OR a parked cut_done
  // slab pulled in from carving storage (direct-dispatch, skips carving) —
  // same rule as createDispatchAction. Must be the same temple.
  const { data: slabs } = await admin
    .from("slab_requirements")
    .select("id, status, temple, is_parked")
    .in("id", slabIds);
  const valid = ((slabs ?? []) as Array<{ id: string; status: string; temple: string; is_parked?: boolean }>)
    .filter((s) => {
      const eligible = s.status === "completed" || (s.status === "cut_done" && s.is_parked === true);
      return eligible && s.temple === dispatch.temple;
    })
    .map((s) => s.id);
  if (valid.length === 0) {
    redirect(`/dispatch/${dispatchId}/check?dispatch_toast=${encodeURIComponent("No eligible slabs to add")}`);
  }

  // carving_item per slab (nullable — direct-dispatch slabs have none).
  const { data: carving } = await admin
    .from("carving_items")
    .select("id, slab_requirement_id")
    .in("slab_requirement_id", valid);
  const ciBySlab = new Map<string, string>();
  for (const ci of (carving ?? []) as Array<{ id: string; slab_requirement_id: string }>) {
    ciBySlab.set(ci.slab_requirement_id, ci.id);
  }

  // Don't double-add a slab already on this dispatch.
  const { data: existingLogs } = await admin
    .from("dispatch_logs")
    .select("slab_requirement_id")
    .eq("dispatch_id", dispatchId)
    .in("slab_requirement_id", valid);
  const have = new Set(((existingLogs ?? []) as Array<{ slab_requirement_id: string | null }>).map((l) => l.slab_requirement_id));
  const toAdd = valid.filter((id) => !have.has(id));
  if (toAdd.length === 0) redirect(`/dispatch/${dispatchId}/check`);

  const now = new Date().toISOString();
  await admin.from("dispatch_logs").insert(
    toAdd.map((slabId) => ({
      dispatch_id: dispatchId,
      slab_requirement_id: slabId,
      carving_item_id: ciBySlab.get(slabId) ?? null,
      dispatched_by: profile.id,
    })),
  );
  // Keep is_parked — a storage slab stays parked while dispatched so a later
  // cancel/remove returns it to its own storage (see returnSlabsFromDispatch).
  await admin.from("slab_requirements").update({ status: "dispatched", updated_by: profile.id, updated_at: now }).in("id", toAdd);
  const ciIds = toAdd.map((s) => ciBySlab.get(s)).filter(Boolean) as string[];
  if (ciIds.length > 0) {
    await admin.from("carving_items").update({ status: "dispatched" }).in("id", ciIds);
  }

  revalidatePath(`/dispatch/${dispatchId}/check`);
  revalidatePath("/dispatch");
  revalidatePath("/carving");
  redirect(`/dispatch/${dispatchId}/check?dispatch_toast=${encodeURIComponent(`Added ${toAdd.length} slab${toAdd.length !== 1 ? "s" : ""}`)}`);
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
  // Storage slabs return to their storage; others to Make Dispatch.
  await returnSlabsFromDispatch(admin, logs ?? [], profile.id, now);
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
      .select("id, temple, status, is_parked, cancel_requested_at")
      .in("id", addIds);
    if (!addSlabs || addSlabs.length !== addIds.length) {
      fail("/dispatch", "One or more slabs to add no longer exist");
    }
    for (const s of addSlabs) {
      if (s.temple !== dispatch.temple) {
        fail("/dispatch", `Slab ${s.id} belongs to ${s.temple}, not ${dispatch.temple}. One dispatch = one temple.`);
      }
      // completed (ready / dispatch-storage) OR parked cut_done (carving storage,
      // direct-dispatch) — same rule as create / addSlabsToDispatchAction.
      const eligible = s.status === "completed" || (s.status === "cut_done" && (s as { is_parked?: boolean }).is_parked === true);
      if (!eligible) {
        fail("/dispatch", `Slab ${s.id} is not ready to dispatch (status '${s.status}')`);
      }
      // Mig 132 — pending-cancel slabs are locked out of dispatch.
      if ((s as { cancel_requested_at?: string | null }).cancel_requested_at) {
        fail("/dispatch", `Slab ${s.id} has a pending CANCEL request — locked until the owner decides.`);
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
      .select("slab_requirement_id, carving_item_id")
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
    // Storage slabs return to their storage; others to Make Dispatch.
    await returnSlabsFromDispatch(admin, removedLogs ?? [], profile.id, now);
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
      // Keep is_parked — storage slabs stay parked while dispatched so a later
      // remove/cancel returns them to storage (see returnSlabsFromDispatch).
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

// ── Mig 159 — multiple dispatch incharges, linked to temples ─────────────

export async function addInchargeAction(formData: FormData) {
  const { profile } = await requireAuth([...STATION_ROLES]);
  const admin = createAdminSupabaseClient();
  const name = String(formData.get("name") || "").trim();
  const phone = String(formData.get("phone") || "").trim() || null;
  if (!name) fail("/dispatch", "Incharge name is required");
  const { error } = await admin.from("dispatch_incharges").insert({ name, phone, created_by: profile.id });
  if (error) fail("/dispatch", `Failed to add incharge: ${error.message}`);
  await logAudit(profile.id, "dispatch_incharge_added", "dispatch_incharge", name, { phone });
  revalidatePath("/dispatch");
  redirect(`/dispatch?open=incharges&dispatch_toast=${encodeURIComponent(`✓ Added incharge ${name}`)}`);
}

export async function editInchargeAction(formData: FormData) {
  const { profile } = await requireAuth([...STATION_ROLES]);
  const admin = createAdminSupabaseClient();
  const id = String(formData.get("id") || "").trim();
  const name = String(formData.get("name") || "").trim();
  const phone = String(formData.get("phone") || "").trim() || null;
  if (!id || !name) fail("/dispatch", "Incharge id + name are required");
  const { error } = await admin.from("dispatch_incharges").update({ name, phone }).eq("id", id);
  if (error) fail("/dispatch", `Failed to update incharge: ${error.message}`);
  await logAudit(profile.id, "dispatch_incharge_edited", "dispatch_incharge", id, { name, phone });
  revalidatePath("/dispatch");
  redirect(`/dispatch?open=incharges&dispatch_toast=${encodeURIComponent(`✓ Updated ${name}`)}`);
}

export async function deleteInchargeAction(formData: FormData) {
  const { profile } = await requireAuth([...STATION_ROLES]);
  const admin = createAdminSupabaseClient();
  const id = String(formData.get("id") || "").trim();
  if (!id) fail("/dispatch", "Incharge id is required");
  // FK is ON DELETE SET NULL → any linked temples / dispatches just lose the link.
  const { error } = await admin.from("dispatch_incharges").delete().eq("id", id);
  if (error) fail("/dispatch", `Failed to delete incharge: ${error.message}`);
  await logAudit(profile.id, "dispatch_incharge_deleted", "dispatch_incharge", id, {});
  revalidatePath("/dispatch");
  redirect(`/dispatch?open=incharges&dispatch_toast=${encodeURIComponent("✓ Incharge removed")}`);
}

// Link / unlink a temple to an incharge (a temple has one incharge; an incharge
// covers many temples). Empty incharge_id unlinks the temple.
export async function linkTempleInchargeAction(formData: FormData) {
  const { profile } = await requireAuth([...STATION_ROLES]);
  const admin = createAdminSupabaseClient();
  const templeId = String(formData.get("temple_id") || "").trim();
  const inchargeId = String(formData.get("incharge_id") || "").trim() || null;
  if (!templeId) fail("/dispatch", "Temple id is required");
  const { error } = await admin.from("temples").update({ dispatch_incharge_id: inchargeId }).eq("id", templeId);
  if (error) fail("/dispatch", `Failed to link temple: ${error.message}`);
  await logAudit(profile.id, "temple_incharge_linked", "temple", templeId, { incharge_id: inchargeId });
  revalidatePath("/dispatch");
  redirect(`/dispatch?open=incharges&dispatch_toast=${encodeURIComponent("✓ Temple link saved")}`);
}

// Per-dispatch incharge override, set on the Check & verify page. Empty clears
// it → the challan falls back to the temple's incharge. Stays on the Check page.
export async function setDispatchInchargeAction(formData: FormData) {
  const { profile } = await requireAuth([...STATION_ROLES]);
  const admin = createAdminSupabaseClient();
  const dispatchId = String(formData.get("id") || "").trim();
  const inchargeId = String(formData.get("incharge_id") || "").trim() || null;
  if (!dispatchId) fail("/dispatch", "Dispatch id is required");
  const { error } = await admin.from("dispatches").update({ incharge_id: inchargeId }).eq("id", dispatchId);
  if (error) fail(`/dispatch/${dispatchId}/check`, `Failed to set incharge: ${error.message}`);
  await logAudit(profile.id, "dispatch_incharge_set", "dispatch", dispatchId, { incharge_id: inchargeId });
  revalidatePath(`/dispatch/${dispatchId}/check`);
  redirect(`/dispatch/${dispatchId}/check?dispatch_toast=${encodeURIComponent("✓ Incharge updated for this dispatch")}`);
}

// ── Edit Load No. on Check & verify (Daksh) ──────────────────────────────
// load_number is a per-TEMPLE series with a (temple, load_number) unique
// index. Editing rejects a number already used by another dispatch for the
// same temple, suggesting the next free one in the series.
const CAN_EDIT_LOAD = ["developer", "owner", "carving_head", "senior_incharge"];

export async function updateDispatchLoadNumberAction(
  dispatchId: string,
  loadNo: number,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { profile } = await requireAuth();
  if (!CAN_EDIT_LOAD.includes(profile.role)) return { ok: false, error: "Not allowed." };
  const n = Math.floor(Number(loadNo));
  if (!Number.isFinite(n) || n <= 0) return { ok: false, error: "Enter a valid load number (1 or more)." };

  const admin = createAdminSupabaseClient();
  const { data: disp } = await admin
    .from("dispatches")
    .select("id, temple, load_number")
    .eq("id", dispatchId)
    .maybeSingle();
  if (!disp) return { ok: false, error: "Dispatch not found." };
  const temple = (disp as { temple: string }).temple;
  if ((disp as { load_number?: number | null }).load_number === n) return { ok: true }; // unchanged

  const nextFree = async () => {
    const { data: maxRow } = await admin
      .from("dispatches").select("load_number").eq("temple", temple)
      .not("load_number", "is", null).order("load_number", { ascending: false }).limit(1).maybeSingle();
    return (Number((maxRow as { load_number?: number } | null)?.load_number) || 0) + 1;
  };

  // Reject a number already taken for this temple.
  const { data: clash } = await admin
    .from("dispatches").select("id").eq("temple", temple).eq("load_number", n).neq("id", dispatchId).limit(1).maybeSingle();
  if (clash) {
    return { ok: false, error: `Load no. ${n} is already created for ${temple}. Try the current series — next available is ${await nextFree()}.` };
  }

  const { error } = await admin.from("dispatches").update({ load_number: n }).eq("id", dispatchId);
  if (error) {
    if ((error as { code?: string }).code === "23505") {
      return { ok: false, error: `Load no. ${n} is already created for ${temple}. Try the current series — next available is ${await nextFree()}.` };
    }
    return { ok: false, error: error.message };
  }
  void logAudit(profile.id, "dispatch_load_number_edited", "dispatch", dispatchId, { load_number: n });
  revalidatePath(`/dispatch/${dispatchId}/check`);
  revalidatePath(`/dispatch/${dispatchId}/print`);
  return { ok: true };
}

// ── Storage: ready (completed) slabs (Mig 125 follow-on) ─────────────────
// Park "ready to dispatch" (status=completed) slabs OUT of Make Dispatch, to
// declutter. Daksh June 2026 — there is now ONE "Main Storage" (/carving/
// storage) holding both kinds; these actions revalidate it. Same `is_parked`
// column, distinguished by status (completed = ready; cut_done = carving).
// Result-returning (not redirect) so the storage client can call them directly.
function canDispatchStorage(role: string): boolean {
  return ["owner", "developer", "carving_head", "senior_incharge", "dispatch"].includes(role);
}

export async function parkDispatchSlabsAction(
  ids: string[],
): Promise<{ ok: true; count: number } | { ok: false; error: string }> {
  const { profile } = await requireAuth();
  if (!canDispatchStorage(profile.role)) return { ok: false, error: "Not allowed." };
  const list = (Array.isArray(ids) ? ids : []).map((s) => String(s).trim()).filter(Boolean);
  if (list.length === 0) return { ok: false, error: "No slabs selected." };
  const admin = createAdminSupabaseClient();
  const { data, error } = await admin
    .from("slab_requirements")
    .update({ is_parked: true, parked_at: new Date().toISOString(), parked_by: profile.id })
    .in("id", list)
    .eq("status", "completed")
    .eq("is_parked", false)
    .select("id");
  if (error) return { ok: false, error: error.message };
  const count = (data ?? []).length;
  void logAudit(profile.id, "dispatch_slabs_parked", "slab", "batch", { count });
  revalidatePath("/dispatch");
  revalidatePath("/carving/storage");
  return { ok: true, count };
}

export async function unparkDispatchSlabsAction(
  ids: string[],
): Promise<{ ok: true; count: number } | { ok: false; error: string }> {
  const { profile } = await requireAuth();
  if (!canDispatchStorage(profile.role)) return { ok: false, error: "Not allowed." };
  const list = (Array.isArray(ids) ? ids : []).map((s) => String(s).trim()).filter(Boolean);
  if (list.length === 0) return { ok: false, error: "No slabs selected." };
  const admin = createAdminSupabaseClient();
  const { data, error } = await admin
    .from("slab_requirements")
    .update({ is_parked: false, parked_at: null, parked_by: null })
    .in("id", list)
    .eq("status", "completed")
    .eq("is_parked", true)
    .select("id");
  if (error) return { ok: false, error: error.message };
  const count = (data ?? []).length;
  void logAudit(profile.id, "dispatch_slabs_unparked", "slab", "batch", { count });
  revalidatePath("/dispatch");
  revalidatePath("/carving/storage");
  return { ok: true, count };
}

// ReadySlab-compatible storage slab (+ which storage it came from) — pulled
// into the dispatch picker by the "include storage" toggles.
export type StorageSlab = {
  id: string; label: string | null; description: string | null; temple: string;
  stone: string | null; quality: string | null; dimensions: string; cft: number;
  priority: boolean; isMarble: boolean; readySince: string | null; reworked: boolean;
  cancelPending: boolean; component_section: string | null; component_element: string | null;
  additional_description: string | null; storageSource: "carving" | "dispatch";
};

// Lazily load a temple's storage slabs for the dispatch picker: carving storage
// = parked cut_done (direct-dispatchable, skips carving); dispatch storage =
// parked completed.
export async function fetchTempleStorageSlabsAction(
  temple: string,
): Promise<{ carving: StorageSlab[]; dispatch: StorageSlab[] }> {
  const { profile } = await requireAuth();
  if (!canDispatchStorage(profile.role)) return { carving: [], dispatch: [] };
  const t = String(temple || "").trim();
  if (!t) return { carving: [], dispatch: [] };
  const admin = createAdminSupabaseClient();
  const { data } = await admin
    .from("slab_requirements")
    .select("id, label, description, temple, stone, quality, length_ft, width_ft, thickness_ft, priority, status, cancel_requested_at, component_section, component_element, additional_description")
    .eq("temple", t)
    .eq("is_parked", true)
    .in("status", ["cut_done", "completed"])
    .order("id", { ascending: true });
  const rows = (data ?? []) as Array<Record<string, unknown>>;
  const map = (s: Record<string, unknown>, source: "carving" | "dispatch"): StorageSlab => {
    const l = Number(s.length_ft) || 0, w = Number(s.width_ft) || 0, th = Number(s.thickness_ft) || 0;
    return {
      id: s.id as string,
      label: (s.label as string | null) ?? null,
      description: (s.description as string | null) ?? null,
      temple: (s.temple as string) ?? t,
      stone: (s.stone as string | null) ?? null,
      quality: (s.quality as string | null) ?? null,
      dimensions: `${l}×${w}×${th} in`,
      cft: (l * w * th) / 1728,
      priority: s.priority === true,
      isMarble: false,
      readySince: null,
      reworked: false,
      cancelPending: !!s.cancel_requested_at,
      component_section: (s.component_section as string | null) ?? null,
      component_element: (s.component_element as string | null) ?? null,
      additional_description: (s.additional_description as string | null) ?? null,
      storageSource: source,
    };
  };
  return {
    carving: rows.filter((r) => r.status === "cut_done").map((r) => map(r, "carving")),
    dispatch: rows.filter((r) => r.status === "completed").map((r) => map(r, "dispatch")),
  };
}

export async function parkAllReadyDispatchAction(): Promise<{ ok: true; count: number } | { ok: false; error: string }> {
  const { profile } = await requireAuth();
  if (!canDispatchStorage(profile.role)) return { ok: false, error: "Not allowed." };
  const admin = createAdminSupabaseClient();
  const { data, error } = await admin
    .from("slab_requirements")
    .update({ is_parked: true, parked_at: new Date().toISOString(), parked_by: profile.id })
    .eq("status", "completed")
    .eq("is_parked", false)
    .is("cancel_requested_at", null)
    .select("id");
  if (error) return { ok: false, error: error.message };
  const count = (data ?? []).length;
  void logAudit(profile.id, "dispatch_slabs_parked_all", "slab", "batch", { count });
  revalidatePath("/dispatch");
  revalidatePath("/carving/storage");
  return { ok: true, count };
}
