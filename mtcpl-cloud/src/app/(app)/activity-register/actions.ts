"use server";

// ──────────────────────────────────────────────────────────────────
// Activity Register — server actions (Mig 101)
//
// A standalone, isolated module: a dated, searchable log of company
// activities + proof (e.g. "sent a stone demo to L&T" + the photo).
// Nothing here reads or writes any other table. For now every action is
// gated to owner / developer; to open it to a specific staff member
// later, widen isManager() (or swap it for a profile flag).
// ──────────────────────────────────────────────────────────────────

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { randomUUID } from "node:crypto";
import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";

const ROUTE = "/activity-register";
const PROOF_BUCKET = "activity_proofs";
const PROOF_MAX_BYTES = 15 * 1024 * 1024; // 15 MB
const PROOF_MIME_ALLOW = new Set<string>([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
  "application/pdf",
]);

function proofExt(mime: string): string {
  switch (mime) {
    case "image/jpeg":
      return "jpg";
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
    case "image/heic":
      return "heic";
    case "image/heif":
      return "heif";
    case "application/pdf":
      return "pdf";
    default:
      return "bin";
  }
}
/** Validate a candidate proof file (mime + size). Returns a user-facing
 *  error string, or null when OK. */
function validateProof(file: File): string | null {
  const mime = (file.type || "").toLowerCase();
  if (!PROOF_MIME_ALLOW.has(mime)) {
    return "Proof must be a photo (JPG / PNG / WebP / HEIC) or a PDF.";
  }
  if (file.size === 0) return "Proof file is empty.";
  if (file.size > PROOF_MAX_BYTES) return "Proof file too large (max 15 MB).";
  return null;
}
/** Upload a proof file to the private bucket; returns the stored path +
 *  mime. Throws on failure. */
async function uploadProof(
  admin: ReturnType<typeof createAdminSupabaseClient>,
  entryId: string,
  file: File,
): Promise<{ path: string; mime: string }> {
  const mime = (file.type || "").toLowerCase();
  const err = validateProof(file);
  if (err) throw new Error(err);
  const path = `${entryId}/${randomUUID()}.${proofExt(mime)}`;
  const buffer = Buffer.from(await file.arrayBuffer());
  const { error } = await admin.storage
    .from(PROOF_BUCKET)
    .upload(path, buffer, { contentType: mime, cacheControl: "3600", upsert: false });
  if (error) throw new Error(`Proof upload failed: ${error.message}`);
  return { path, mime };
}

function isManager(role: string): boolean {
  return role === "owner" || role === "developer";
}
function toastUrl(msg: string): string {
  return `${ROUTE}?toast=${encodeURIComponent(msg)}`;
}

/** Owner/dev — add a new register entry (+ optional proof). */
export async function createActivityEntryAction(formData: FormData) {
  const { profile } = await requireAuth();
  if (!isManager(profile.role)) redirect(toastUrl("Only the owner can add register entries."));

  const activity = String(formData.get("activity") || "").trim();
  const person = String(formData.get("person") || "").trim() || null;
  const reference = String(formData.get("reference") || "").trim() || null;
  const dateRaw = String(formData.get("activity_date") || "").trim();
  const activityDate = /^\d{4}-\d{2}-\d{2}$/.test(dateRaw) ? dateRaw : null;

  if (!activity) redirect(toastUrl("Activity is required."));

  const proof = formData.get("proof");
  const hasProof = proof instanceof File && proof.size > 0;
  if (hasProof) {
    const err = validateProof(proof as File);
    if (err) redirect(toastUrl(err));
  }

  const admin = createAdminSupabaseClient();
  const insertRow: Record<string, unknown> = {
    activity,
    person,
    reference,
    created_by: profile.id,
  };
  if (activityDate) insertRow.activity_date = activityDate;

  const { data: created, error } = await admin
    .from("activity_register")
    .insert(insertRow)
    .select("id")
    .single();
  if (error || !created) redirect(toastUrl(error?.message ?? "Failed to add entry."));

  if (hasProof) {
    try {
      const meta = await uploadProof(admin, created.id, proof as File);
      await admin
        .from("activity_register")
        .update({
          proof_path: meta.path,
          proof_mime: meta.mime,
          proof_uploaded_at: new Date().toISOString(),
        })
        .eq("id", created.id);
    } catch (e) {
      // The entry is saved; only the proof failed — keep the entry and
      // tell the owner so they can re-attach via Edit.
      const msg = e instanceof Error ? e.message : String(e);
      await logAudit(profile.id, "activity_entry_created", "activity_register", created.id, { proof_error: msg });
      revalidatePath(ROUTE);
      redirect(toastUrl(`Entry saved, but proof upload failed: ${msg}`));
    }
  }

  await logAudit(profile.id, "activity_entry_created", "activity_register", created.id, { hasProof });
  revalidatePath(ROUTE);
  redirect(toastUrl("Entry added."));
}

/** Owner/dev — edit an existing entry (+ optionally replace the proof). */
export async function updateActivityEntryAction(formData: FormData) {
  const { profile } = await requireAuth();
  if (!isManager(profile.role)) redirect(toastUrl("Only the owner can edit register entries."));
  const id = String(formData.get("id") || "").trim();
  if (!id) redirect(toastUrl("Missing entry."));

  const activity = String(formData.get("activity") || "").trim();
  const person = String(formData.get("person") || "").trim() || null;
  const reference = String(formData.get("reference") || "").trim() || null;
  const dateRaw = String(formData.get("activity_date") || "").trim();
  const activityDate = /^\d{4}-\d{2}-\d{2}$/.test(dateRaw) ? dateRaw : null;
  if (!activity) redirect(toastUrl("Activity is required."));

  const admin = createAdminSupabaseClient();
  const update: Record<string, unknown> = {
    activity,
    person,
    reference,
    updated_at: new Date().toISOString(),
    updated_by: profile.id,
  };
  if (activityDate) update.activity_date = activityDate;

  const proof = formData.get("proof");
  if (proof instanceof File && proof.size > 0) {
    const err = validateProof(proof);
    if (err) redirect(toastUrl(err));
    const { data: cur } = await admin
      .from("activity_register")
      .select("proof_path")
      .eq("id", id)
      .maybeSingle();
    const oldPath = (cur as { proof_path?: string | null } | null)?.proof_path ?? null;
    try {
      const meta = await uploadProof(admin, id, proof);
      update.proof_path = meta.path;
      update.proof_mime = meta.mime;
      update.proof_uploaded_at = new Date().toISOString();
      if (oldPath) {
        try {
          await admin.storage.from(PROOF_BUCKET).remove([oldPath]);
        } catch {
          /* best-effort cleanup */
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      redirect(toastUrl(`Proof upload failed: ${msg}`));
    }
  }

  const { error } = await admin.from("activity_register").update(update).eq("id", id);
  if (error) redirect(toastUrl(error.message));
  await logAudit(profile.id, "activity_entry_updated", "activity_register", id, {});
  revalidatePath(ROUTE);
  redirect(toastUrl("Entry updated."));
}

/** Owner/dev — delete an entry and its proof file. */
export async function deleteActivityEntryAction(formData: FormData) {
  const { profile } = await requireAuth();
  if (!isManager(profile.role)) redirect(toastUrl("Only the owner can delete register entries."));
  const id = String(formData.get("id") || "").trim();
  if (!id) redirect(toastUrl("Missing entry."));

  const admin = createAdminSupabaseClient();
  const { data: cur } = await admin
    .from("activity_register")
    .select("proof_path, entry_code")
    .eq("id", id)
    .maybeSingle();
  const path = (cur as { proof_path?: string | null } | null)?.proof_path ?? null;
  if (path) {
    try {
      await admin.storage.from(PROOF_BUCKET).remove([path]);
    } catch {
      /* best-effort */
    }
  }
  const { error } = await admin.from("activity_register").delete().eq("id", id);
  if (error) redirect(toastUrl(error.message));
  await logAudit(profile.id, "activity_entry_deleted", "activity_register", id, {
    entry_code: (cur as { entry_code?: string } | null)?.entry_code ?? null,
  });
  revalidatePath(ROUTE);
  redirect(toastUrl("Entry deleted."));
}

/** Owner/dev — remove just the proof file, keep the entry. */
export async function removeActivityProofAction(formData: FormData) {
  const { profile } = await requireAuth();
  if (!isManager(profile.role)) redirect(toastUrl("Only the owner can remove proof."));
  const id = String(formData.get("id") || "").trim();
  if (!id) redirect(toastUrl("Missing entry."));

  const admin = createAdminSupabaseClient();
  const { data: cur } = await admin
    .from("activity_register")
    .select("proof_path")
    .eq("id", id)
    .maybeSingle();
  const path = (cur as { proof_path?: string | null } | null)?.proof_path ?? null;
  if (path) {
    try {
      await admin.storage.from(PROOF_BUCKET).remove([path]);
    } catch {
      /* best-effort */
    }
  }
  await admin
    .from("activity_register")
    .update({
      proof_path: null,
      proof_mime: null,
      proof_uploaded_at: null,
      updated_at: new Date().toISOString(),
      updated_by: profile.id,
    })
    .eq("id", id);
  await logAudit(profile.id, "activity_proof_removed", "activity_register", id, {});
  revalidatePath(ROUTE);
  redirect(toastUrl("Proof removed."));
}
