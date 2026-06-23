"use server";

/**
 * Slab cancellation flow (mig 132).
 *
 *   requestSlabCancelAction   carving_head / senior_incharge (+ owner/dev)
 *                             flag a physically-broken slab — reason
 *                             required, photo optional. Slab stays where
 *                             it is, RED + locked, until the owner decides.
 *   resolveSlabCancelAction   owner / developer approve or reject the
 *                             request from /tasks/slab-cancels.
 *   decideCancelledSlabAction Temple View decision on an approved cancel:
 *                             'no_replacement', or 'create_new' → an
 *                             identical slab is minted with a fresh code
 *                             (status 'open' → flows through cutting again).
 *
 * Cancel is an EXIT state (like dispatch): no reverse engineering of
 * cutting / carving history, no block restock — those readings stay.
 */

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";
import { notify } from "@/lib/notifications";
import { nextSlabCodeFromMaxId } from "./utils";

const REQUEST_ROLES = ["developer", "owner", "carving_head", "senior_incharge"] as const;
const APPROVE_ROLES = ["developer", "owner"] as const;
// Temple View replacement decision — same circle as full Temple View access.
const DECIDE_ROLES = ["developer", "owner", "team_head", "senior_incharge", "carving_head"] as const;

// A cancel can be requested anywhere AFTER the physical cut and BEFORE
// the slab leaves (dispatched). open/planned/cutting slabs are simply
// deleted/edited through the normal flows — no approval theatre needed.
const CANCELLABLE_STATUSES = [
  "cut_done",
  "carving_assigned",
  "carving_in_progress",
  "carving_on_hold",
  "completed",
] as const;

const PHOTO_BUCKET = "slab_cancel_photos";
const PHOTO_MAX_BYTES = 10 * 1024 * 1024;
const PHOTO_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"]);

// ─── Request ─────────────────────────────────────────────────────────────

export async function requestSlabCancelAction(
  formData: FormData,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { profile } = await requireAuth([...REQUEST_ROLES]);
  const admin = createAdminSupabaseClient();

  const slabId = String(formData.get("slab_id") || "").trim();
  const reason = String(formData.get("reason") || "").trim();
  const photo = formData.get("photo");

  try {
    if (!slabId) throw new Error("Missing slab id.");
    if (!reason) throw new Error("A reason is required — why does this slab need to be cancelled?");

    const { data: slab, error: slabErr } = await admin
      .from("slab_requirements")
      .select("id, temple, status, cancel_requested_at")
      .eq("id", slabId)
      .maybeSingle();
    if (slabErr) throw new Error(slabErr.message);
    if (!slab) throw new Error("Slab not found.");
    if (slab.cancel_requested_at) throw new Error("A cancel request is already pending for this slab.");
    if (slab.status === "cancelled") throw new Error("This slab is already cancelled.");
    if (!CANCELLABLE_STATUSES.includes(slab.status as (typeof CANCELLABLE_STATUSES)[number])) {
      throw new Error(
        `Slab is in '${slab.status}' — cancel requests apply only after cutting (cut & ready, carving, or ready to dispatch).`,
      );
    }

    // Optional photo of the damage.
    let photoPath: string | null = null;
    if (photo instanceof File && photo.size > 0) {
      const mime = (photo.type || "").toLowerCase();
      if (!PHOTO_TYPES.has(mime)) throw new Error("Photo must be a JPG / PNG / WEBP / HEIC image.");
      if (photo.size > PHOTO_MAX_BYTES) throw new Error("Photo is too large — max 10 MB.");
      const ext = mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : "jpg";
      photoPath = `${slabId}/${Date.now()}.${ext}`;
      const buf = Buffer.from(await photo.arrayBuffer());
      const { error: upErr } = await admin.storage
        .from(PHOTO_BUCKET)
        .upload(photoPath, buf, { contentType: mime, upsert: false });
      if (upErr) throw new Error(`Photo upload failed: ${upErr.message}`);
    }

    // Race-guarded stamp — only if still un-requested.
    const now = new Date().toISOString();
    const { data: stamped, error: stampErr } = await admin
      .from("slab_requirements")
      .update({
        cancel_requested_at: now,
        cancel_requested_by: profile.id,
        cancel_reason: reason,
        cancel_photo_path: photoPath,
        updated_by: profile.id,
        updated_at: now,
      })
      .eq("id", slabId)
      .is("cancel_requested_at", null)
      .select("id");
    if (stampErr) throw new Error(stampErr.message);
    if ((stamped ?? []).length === 0) {
      throw new Error("Someone else just requested cancel on this slab. Refresh.");
    }

    void Promise.all([
      logAudit(profile.id, "slab_cancel_requested", "slab", slabId, {
        temple: slab.temple,
        stage: slab.status,
        reason,
        photo_path: photoPath,
      }),
      notify("slab_cancel_requested", `Cancel requested — ${slabId}`, {
        message: `${slab.temple} · at stage '${slab.status}'. Reason: ${reason}. Approve or reject in Tasks → Slab cancel requests.`,
        entityType: "slab",
        entityId: slabId,
        actorId: profile.id,
        targetRoles: ["owner", "developer"],
      }),
    ]).catch((e) => console.warn("[requestSlabCancelAction] audit/notify failed (non-fatal)", e));

    revalidatePath("/carving");
    revalidatePath("/dispatch");
    revalidatePath("/tasks");
    revalidatePath("/temples");
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[requestSlabCancelAction] FAILED", { slabId, error: msg });
    return { ok: false, error: msg };
  }
}

// ─── Owner decision ──────────────────────────────────────────────────────

export async function resolveSlabCancelAction(formData: FormData) {
  const { profile } = await requireAuth([...APPROVE_ROLES]);
  const admin = createAdminSupabaseClient();

  const slabId = String(formData.get("slab_id") || "").trim();
  const decision = String(formData.get("decision") || "").trim(); // 'approve' | 'reject'
  const back = (msg: string) =>
    redirect(`/tasks/slab-cancels?toast=${encodeURIComponent(msg)}`);

  if (!slabId || !["approve", "reject"].includes(decision)) back("Bad request.");

  const { data: slab } = await admin
    .from("slab_requirements")
    .select("id, temple, status, cancel_requested_at, cancel_requested_by, cancel_reason")
    .eq("id", slabId)
    .maybeSingle();
  if (!slab) back("Slab not found.");
  if (!slab!.cancel_requested_at) back("No pending cancel request on this slab.");
  if (slab!.status === "cancelled") back("Slab is already cancelled.");

  const now = new Date().toISOString();

  if (decision === "reject") {
    // Back to normal — request fields cleared, slab fully processable.
    await admin
      .from("slab_requirements")
      .update({
        cancel_requested_at: null,
        cancel_requested_by: null,
        cancel_reason: null,
        cancel_photo_path: null,
        updated_by: profile.id,
        updated_at: now,
      })
      .eq("id", slabId);

    await logAudit(profile.id, "slab_cancel_rejected", "slab", slabId, {
      temple: slab!.temple,
      reason_was: slab!.cancel_reason,
    });
    await notify("slab_cancel_rejected", `Cancel REJECTED — ${slabId} stays`, {
      message: `Owner says no need to cancel. The slab is back to normal and fully processable.`,
      entityType: "slab",
      entityId: slabId,
      actorId: profile.id,
      targetRoles: ["carving_head", "senior_incharge", "developer"],
    });

    revalidatePath("/carving");
    revalidatePath("/dispatch");
    revalidatePath("/tasks");
    revalidatePath("/temples");
    back(`✓ Request rejected — ${slabId} is back to normal`);
  }

  // ── Approve: the slab exits the live flow. Remember where it died.
  const prevStatus = slab!.status;
  await admin
    .from("slab_requirements")
    .update({
      status: "cancelled",
      cancel_prev_status: prevStatus,
      cancelled_at: now,
      cancelled_by: profile.id,
      updated_by: profile.id,
      updated_at: now,
    })
    .eq("id", slabId);

  // In-flight carving job rows leave the Active / Approval queues too.
  // APPROVED carving history (review_approved_at set) is untouched —
  // the vendor's output readings stay intact.
  await admin
    .from("carving_items")
    .update({ status: "cancelled" })
    .eq("slab_requirement_id", slabId)
    .is("review_approved_at", null)
    .in("status", ["carving_assigned", "carving_in_progress", "carving_on_hold", "completed"]);

  await logAudit(profile.id, "slab_cancel_approved", "slab", slabId, {
    temple: slab!.temple,
    prev_status: prevStatus,
    reason: slab!.cancel_reason,
  });
  await notify("slab_cancel_approved", `Cancel APPROVED — ${slabId}`, {
    message: `Cancelled at stage '${prevStatus}'. Decide on Temple View: create a replacement slab or close it out.`,
    entityType: "slab",
    entityId: slabId,
    actorId: profile.id,
    targetRoles: ["carving_head", "senior_incharge", "team_head", "developer"],
  });

  revalidatePath("/carving");
  revalidatePath("/dispatch");
  revalidatePath("/tasks");
  revalidatePath("/temples");
  revalidatePath("/slabs");
  // Re-render the (app) layout so the Temple View nav item starts blinking.
  revalidatePath("/", "layout");
  back(`✓ ${slabId} cancelled — Temple View now asks whether to create a replacement`);
}

// ─── Temple View resolution ──────────────────────────────────────────────

export async function decideCancelledSlabAction(
  formData: FormData,
): Promise<{ ok: true; newId?: string } | { ok: false; error: string }> {
  const { profile } = await requireAuth([...DECIDE_ROLES]);
  const admin = createAdminSupabaseClient();

  const slabId = String(formData.get("slab_id") || "").trim();
  const choice = String(formData.get("choice") || "").trim(); // 'no_replacement' | 'create_new'

  try {
    if (!slabId) throw new Error("Missing slab id.");
    if (!["no_replacement", "create_new"].includes(choice)) throw new Error("Bad choice.");

    const { data: slab, error: slabErr } = await admin
      .from("slab_requirements")
      .select(
        "id, temple, status, cancel_resolution, label, description, additional_description, stone, quality, length_ft, width_ft, thickness_ft, priority, component_section, component_element",
      )
      .eq("id", slabId)
      .maybeSingle();
    if (slabErr) throw new Error(slabErr.message);
    if (!slab) throw new Error("Slab not found.");
    if (slab.status !== "cancelled") throw new Error("Slab is not cancelled.");
    if (slab.cancel_resolution) throw new Error("This cancelled slab is already resolved.");

    const now = new Date().toISOString();

    if (choice === "no_replacement") {
      const { data: done } = await admin
        .from("slab_requirements")
        .update({ cancel_resolution: "no_replacement", updated_by: profile.id, updated_at: now })
        .eq("id", slabId)
        .is("cancel_resolution", null)
        .select("id");
      if ((done ?? []).length === 0) throw new Error("Already resolved by someone else. Refresh.");
      void logAudit(profile.id, "slab_cancel_no_replacement", "slab", slabId, { temple: slab.temple });
      revalidatePath("/temples");
      // Re-render the (app) layout so the blinking Temple View nav item +
      // its alert clear (the count lives in the layout, not the page).
      revalidatePath("/", "layout");
      return { ok: true };
    }

    // create_new — mint an identical slab with a fresh code. Retry the
    // code on PK collision (two replacements minted at once).
    const { data: templeRow } = await admin
      .from("temples")
      .select("code_prefix")
      .eq("name", slab.temple)
      .maybeSingle();
    const prefix = (templeRow as { code_prefix?: string } | null)?.code_prefix ?? "SLB";

    let newId = "";
    for (let attempt = 0; attempt < 4; attempt++) {
      const { data: maxRow } = await admin
        .from("slab_requirements")
        .select("id")
        .like("id", `${prefix}-%`)
        .order("id", { ascending: false })
        .limit(1)
        .maybeSingle();
      const candidate = nextSlabCodeFromMaxId((maxRow as { id?: string } | null)?.id ?? null, prefix);

      const { error: insErr } = await admin.from("slab_requirements").insert({
        id: candidate,
        label: slab.label,
        description: slab.description,
        additional_description: slab.additional_description,
        temple: slab.temple,
        stone: slab.stone,
        quality: slab.quality,
        length_ft: slab.length_ft,
        width_ft: slab.width_ft,
        thickness_ft: slab.thickness_ft,
        priority: slab.priority === true,
        component_section: slab.component_section,
        component_element: slab.component_element,
        status: "open",
        replacement_of: slabId,
        created_by: profile.id,
        updated_by: profile.id,
      });
      if (insErr) {
        if ((insErr as { code?: string }).code === "23505" && attempt < 3) continue;
        throw new Error(`Could not create the new slab: ${insErr.message}`);
      }
      newId = candidate;
      break;
    }
    if (!newId) throw new Error("Could not mint a new slab code — retry.");

    const { data: done } = await admin
      .from("slab_requirements")
      .update({
        cancel_resolution: "replaced",
        replacement_slab_id: newId,
        updated_by: profile.id,
        updated_at: now,
      })
      .eq("id", slabId)
      .is("cancel_resolution", null)
      .select("id");
    if ((done ?? []).length === 0) {
      // Someone resolved in parallel — remove the duplicate we just minted.
      await admin.from("slab_requirements").delete().eq("id", newId).eq("replacement_of", slabId);
      throw new Error("Already resolved by someone else. Refresh.");
    }

    void Promise.all([
      logAudit(profile.id, "slab_cancel_replaced", "slab", slabId, {
        temple: slab.temple,
        new_slab_id: newId,
      }),
      notify("slab_replacement_created", `Replacement slab ${newId} created`, {
        message: `Identical to cancelled ${slabId} (${slab.temple}) — status Open, needs planning + cutting.`,
        entityType: "slab",
        entityId: newId,
        actorId: profile.id,
        targetRoles: ["owner", "senior_incharge", "team_head", "developer"],
      }),
    ]).catch((e) => console.warn("[decideCancelledSlabAction] audit/notify failed (non-fatal)", e));

    revalidatePath("/temples");
    revalidatePath("/slabs");
    // Re-render the (app) layout so the blinking Temple View nav item clears.
    revalidatePath("/", "layout");
    return { ok: true, newId };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[decideCancelledSlabAction] FAILED", { slabId, choice, error: msg });
    return { ok: false, error: msg };
  }
}
