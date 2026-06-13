"use server";

/**
 * Site / Installation module server actions (mig 133).
 *
 *   createSiteYardAction     incharge makes a new yard for a temple.
 *   unloadTruckAction        a delivered truck's still-loaded slabs land
 *                            in a chosen yard (whole truck → one yard).
 *   transferSlabYardAction   move a stocked slab to a different yard.
 *   installSlabAction        mark a stocked slab INSTALLED (photo required).
 *
 * Site state is column-derived (see mig 133): status stays 'dispatched';
 * site_yard_id / installed_at track where the slab is.
 */

import { revalidatePath } from "next/cache";
import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";
import { notify } from "@/lib/notifications";
import { SITE_ROLES } from "./site-roles";

const PHOTO_BUCKET = "site_install_photos";
const PHOTO_MAX_BYTES = 10 * 1024 * 1024;
const PHOTO_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"]);

// Revalidate the dynamic site routes by PATTERN (not a concrete encoded
// path) so temple names with spaces/commas don't break the match. The
// clients also router.refresh() after each action, so this is belt-and-
// suspenders for other open tabs.
function revalidateSite() {
  revalidatePath("/site/[temple]", "page");
  revalidatePath("/site/[temple]/stock", "page");
  revalidatePath("/site/[temple]/install", "page");
  revalidatePath("/site", "page");
}

// ─── Create yard ─────────────────────────────────────────────────────────

export async function createSiteYardAction(
  formData: FormData,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const { profile } = await requireAuth(SITE_ROLES);
  const admin = createAdminSupabaseClient();

  const temple = String(formData.get("temple") || "").trim();
  const name = String(formData.get("name") || "").trim();

  try {
    if (!temple) throw new Error("Missing temple.");
    if (!name) throw new Error("Yard name is required.");

    const { data, error } = await admin
      .from("site_yards")
      .insert({ temple, name, created_by: profile.id })
      .select("id")
      .single();
    if (error) {
      if ((error as { code?: string }).code === "23505") {
        throw new Error(`A yard called "${name}" already exists for this temple.`);
      }
      throw new Error(error.message);
    }

    void logAudit(profile.id, "site_yard_created", "site_yard", (data as { id: string }).id, { temple, name });
    revalidateSite();
    return { ok: true, id: (data as { id: string }).id };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ─── Unload a truck into a yard ──────────────────────────────────────────

export async function unloadTruckAction(
  formData: FormData,
): Promise<{ ok: true; count: number } | { ok: false; error: string }> {
  const { profile } = await requireAuth(SITE_ROLES);
  const admin = createAdminSupabaseClient();

  const dispatchId = String(formData.get("dispatch_id") || "").trim();
  const yardId = String(formData.get("yard_id") || "").trim();

  try {
    if (!dispatchId) throw new Error("Missing truck.");
    if (!yardId) throw new Error("Pick (or create) a yard to unload into.");

    // The dispatch must be delivered; yard must belong to its temple.
    const { data: dispatch } = await admin
      .from("dispatches")
      .select("id, temple, delivered_at")
      .eq("id", dispatchId)
      .maybeSingle();
    if (!dispatch) throw new Error("Truck not found.");
    if (!dispatch.delivered_at) throw new Error("This truck isn't marked delivered yet.");

    const { data: yard } = await admin
      .from("site_yards")
      .select("id, temple, name")
      .eq("id", yardId)
      .maybeSingle();
    if (!yard) throw new Error("Yard not found.");
    if (yard.temple !== dispatch.temple) throw new Error("That yard belongs to a different temple.");

    // Slab ids on this truck still waiting to be unloaded.
    const { data: logs } = await admin
      .from("dispatch_logs")
      .select("slab_requirement_id")
      .eq("dispatch_id", dispatchId);
    const slabIds = ((logs ?? []) as Array<{ slab_requirement_id: string | null }>)
      .map((l) => l.slab_requirement_id)
      .filter(Boolean) as string[];
    if (slabIds.length === 0) throw new Error("This truck has no slabs to unload.");

    const now = new Date().toISOString();
    const { data: unloaded, error } = await admin
      .from("slab_requirements")
      .update({
        site_yard_id: yardId,
        site_unloaded_at: now,
        site_unloaded_by: profile.id,
        updated_by: profile.id,
        updated_at: now,
      })
      .in("id", slabIds)
      .is("site_yard_id", null)
      .is("installed_at", null)
      .select("id");
    if (error) throw new Error(error.message);
    const count = (unloaded ?? []).length;
    if (count === 0) throw new Error("Nothing to unload — this truck's slabs are already in a yard.");

    void logAudit(profile.id, "site_truck_unloaded", "dispatch", dispatchId, {
      temple: dispatch.temple,
      yard: yard.name,
      count,
    });
    revalidateSite();
    return { ok: true, count };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ─── Transfer a slab to another yard ─────────────────────────────────────

export async function transferSlabYardAction(
  formData: FormData,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { profile } = await requireAuth(SITE_ROLES);
  const admin = createAdminSupabaseClient();

  const slabId = String(formData.get("slab_id") || "").trim();
  const yardId = String(formData.get("yard_id") || "").trim();

  try {
    if (!slabId || !yardId) throw new Error("Missing slab or yard.");

    const { data: slab } = await admin
      .from("slab_requirements")
      .select("id, temple, site_yard_id, installed_at")
      .eq("id", slabId)
      .maybeSingle();
    if (!slab) throw new Error("Slab not found.");
    if (slab.installed_at) throw new Error("This slab is already installed — can't move it.");
    if (!slab.site_yard_id) throw new Error("This slab isn't in a yard yet.");

    const { data: yard } = await admin
      .from("site_yards")
      .select("id, temple, name")
      .eq("id", yardId)
      .maybeSingle();
    if (!yard) throw new Error("Target yard not found.");
    if (yard.temple !== slab.temple) throw new Error("That yard belongs to a different temple.");

    const now = new Date().toISOString();
    await admin
      .from("slab_requirements")
      .update({ site_yard_id: yardId, updated_by: profile.id, updated_at: now })
      .eq("id", slabId);

    void logAudit(profile.id, "site_slab_transferred", "slab", slabId, { temple: slab.temple, to_yard: yard.name });
    revalidateSite();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ─── Install a slab ──────────────────────────────────────────────────────

export async function installSlabAction(
  formData: FormData,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { profile } = await requireAuth(SITE_ROLES);
  const admin = createAdminSupabaseClient();

  const slabId = String(formData.get("slab_id") || "").trim();
  const note = String(formData.get("note") || "").trim() || null;
  const photo = formData.get("photo");

  try {
    if (!slabId) throw new Error("Missing slab.");
    if (!(photo instanceof File) || photo.size === 0) {
      throw new Error("An installed photo is required.");
    }
    const mime = (photo.type || "").toLowerCase();
    if (!PHOTO_TYPES.has(mime)) throw new Error("Photo must be a JPG / PNG / WEBP / HEIC image.");
    if (photo.size > PHOTO_MAX_BYTES) throw new Error("Photo is too large — max 10 MB.");

    const { data: slab } = await admin
      .from("slab_requirements")
      .select("id, temple, site_yard_id, installed_at")
      .eq("id", slabId)
      .maybeSingle();
    if (!slab) throw new Error("Slab not found.");
    if (slab.installed_at) throw new Error("This slab is already marked installed.");
    if (!slab.site_yard_id) throw new Error("Unload this slab into a yard before installing it.");

    // Upload first; if the flip fails the orphan photo is harmless.
    const ext = mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : "jpg";
    const path = `${slabId}/${Date.now()}.${ext}`;
    const buf = Buffer.from(await photo.arrayBuffer());
    const { error: upErr } = await admin.storage
      .from(PHOTO_BUCKET)
      .upload(path, buf, { contentType: mime, upsert: false });
    if (upErr) throw new Error(`Photo upload failed: ${upErr.message}`);

    const now = new Date().toISOString();
    const { data: done, error } = await admin
      .from("slab_requirements")
      .update({
        installed_at: now,
        installed_by: profile.id,
        install_note: note,
        install_photo_path: path,
        updated_by: profile.id,
        updated_at: now,
      })
      .eq("id", slabId)
      .is("installed_at", null)
      .select("id");
    if (error) throw new Error(error.message);
    if ((done ?? []).length === 0) throw new Error("Someone just installed this slab. Refresh.");

    void Promise.all([
      logAudit(profile.id, "site_slab_installed", "slab", slabId, { temple: slab.temple, photo_path: path }),
      notify("slab_installed", `Installed at ${slab.temple} — ${slabId}`, {
        message: `Site incharge marked ${slabId} installed.${note ? ` Note: ${note}` : ""}`,
        entityType: "slab",
        entityId: slabId,
        actorId: profile.id,
        targetRoles: ["owner", "developer"],
      }),
    ]).catch((e) => console.warn("[installSlabAction] audit/notify failed (non-fatal)", e));

    revalidateSite();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
