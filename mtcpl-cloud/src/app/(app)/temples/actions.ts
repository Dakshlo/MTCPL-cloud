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

const WRITE_ROLES: AppRole[] = ["owner", "developer", "team_head", "senior_incharge"];
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

  const temple = String(formData.get("temple") || "").trim();
  const section = String(formData.get("section") || "").trim();
  const element = String(formData.get("element") || "").trim() || null;
  const caption = String(formData.get("caption") || "").trim() || null;
  if (!temple) return { ok: false, error: "Pick a temple." };
  if (!section) return { ok: false, error: "Pick a Category 1." };

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
    id, temple, section, element, image_path: path, caption, uploaded_by: profile.id,
  });
  if (error) {
    await admin.storage.from(BUCKET).remove([path]).catch(() => {});
    return { ok: false, error: error.message };
  }
  await logAudit(profile.id, "temple_image_added", "temple_component_image", id, { temple, section, element });
  revalidatePath("/temples");
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
