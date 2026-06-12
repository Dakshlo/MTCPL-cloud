"use server";

// Mig 124 — temple component reference images. Upload a photo against a
// temple component node (temple → Category 1 → optional Category 2) and
// delete it. Public bucket; the page renders thumbnails on matching nodes.

import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";
import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";
import type { AppRole } from "@/lib/types";

const WRITE_ROLES: AppRole[] = ["owner", "developer", "team_head", "senior_incharge", "carving_head"];
const BUCKET = "temple_component_images";
const MAX_BYTES = 8 * 1024 * 1024; // 8 MB
const IMG_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "image/heic", "image/heif"]);

function ext(mime: string): string {
  return mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : mime === "image/gif" ? "gif" : "jpg";
}

export async function addTempleComponentImageAction(
  formData: FormData,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { profile } = await requireAuth(WRITE_ROLES);
  const admin = createAdminSupabaseClient();

  // Two callers:
  //  · legacy Add-image button → temple + section (+ optional element).
  //  · card-browser node uploader (mig 128) → node_path (the full tree path,
  //    any level) + node_label. We derive section/element from the path so
  //    the NOT NULL columns stay valid, and store node_path for keying.
  const rawNodePath = String(formData.get("node_path") || "").trim();
  let temple = String(formData.get("temple") || "").trim();
  let section = String(formData.get("section") || "").trim();
  let element = String(formData.get("element") || "").trim() || null;
  const nodeLabel = String(formData.get("node_label") || "").trim() || null;
  const caption = String(formData.get("caption") || "").trim() || null;

  let nodePath: string;
  if (rawNodePath) {
    const segs = rawNodePath.split("/").map((s) => s.trim()).filter(Boolean);
    if (segs.length < 1) return { ok: false, error: "Bad node path." };
    if (!temple) temple = segs[0];
    section = segs[1] ?? "(temple)";
    element = segs[2] ?? null;
    nodePath = rawNodePath;
  } else {
    if (!temple) return { ok: false, error: "Pick a temple." };
    if (!section) return { ok: false, error: "Pick a Category 1." };
    nodePath = element ? `${temple}/${section}/${element}` : `${temple}/${section}`;
  }

  const file = formData.get("image");
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: "Choose an image to upload." };
  if (file.size > MAX_BYTES) return { ok: false, error: "Image too large — max 8 MB." };
  const mime = (file.type || "").toLowerCase();
  if (!IMG_TYPES.has(mime)) return { ok: false, error: "Use a JPG, PNG, WEBP, GIF or HEIC image." };

  const id = randomUUID();
  const path = `${temple.replace(/[^a-zA-Z0-9]+/g, "_")}/${id}.${ext(mime)}`;
  const buffer = Buffer.from(await file.arrayBuffer());
  const { error: upErr } = await admin.storage.from(BUCKET).upload(path, buffer, { contentType: mime, upsert: false });
  if (upErr) return { ok: false, error: `Upload failed: ${upErr.message}` };

  const { error } = await admin.from("temple_component_images").insert({
    id, temple, section, element, node_path: nodePath, label: nodeLabel,
    image_path: path, caption, uploaded_by: profile.id,
  });
  if (error) {
    await admin.storage.from(BUCKET).remove([path]).catch(() => {});
    return { ok: false, error: error.message };
  }
  await logAudit(profile.id, "temple_image_added", "temple_component_image", id, { temple, node_path: nodePath });
  revalidatePath("/temples");
  return { ok: true };
}

// Mig 128 — re-categorize a slab from the card browser. Changes where the
// slab lives in Temple View (Category 1 / 2 / Label / Description / Additional)
// without touching its size, stone, status or code. Cat 1/2 + Label are
// stored UPPERCASE (same as import); Description / Additional keep their case.
export async function moveSlabComponentAction(
  formData: FormData,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { profile } = await requireAuth(WRITE_ROLES);
  const admin = createAdminSupabaseClient();

  const id = String(formData.get("slab_id") || "").trim();
  if (!id) return { ok: false, error: "Missing slab id." };

  const up = (k: string) => String(formData.get(k) || "").trim().toUpperCase();
  const asis = (k: string) => String(formData.get(k) || "").trim();
  const section = up("section");
  const element = up("element");
  const label = up("label");
  const description = asis("description");
  const additional = asis("additional");
  if (!label) return { ok: false, error: "Label can't be empty." };

  const { data: before } = await admin
    .from("slab_requirements")
    .select("temple, component_section, component_element, label")
    .eq("id", id)
    .maybeSingle();
  if (!before) return { ok: false, error: "Slab not found." };

  const { error } = await admin
    .from("slab_requirements")
    .update({
      component_section: section || null,
      component_element: element || null,
      label,
      description: description || null,
      additional_description: additional || null,
      updated_by: profile.id,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };

  await logAudit(profile.id, "slab_recategorized", "slab", id, {
    from: before,
    to: { component_section: section || null, component_element: element || null, label },
  });
  revalidatePath("/temples");
  revalidatePath("/slabs");
  return { ok: true };
}

// Redirect-style (returns void) so it can be used directly as a <form action>.
export async function deleteTempleComponentImageAction(formData: FormData): Promise<void> {
  const { profile } = await requireAuth(WRITE_ROLES);
  const admin = createAdminSupabaseClient();
  const id = String(formData.get("id") || "").trim();
  if (!id) return;

  const { data } = await admin.from("temple_component_images").select("image_path").eq("id", id).maybeSingle();
  const path = (data as { image_path?: string } | null)?.image_path;
  await admin.from("temple_component_images").delete().eq("id", id);
  if (path) await admin.storage.from(BUCKET).remove([path]).catch(() => {});
  await logAudit(profile.id, "temple_image_deleted", "temple_component_image", id, {});
  revalidatePath("/temples");
}
