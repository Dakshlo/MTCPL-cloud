"use server";

// ──────────────────────────────────────────────────────────────────
// Activity Register — server actions (Mig 101 + 103, site-wise)
//
// A standalone, isolated module: a dated, searchable log of company
// activities + proof (e.g. "sent a stone demo to L&T" + the photo).
// Now organised by SITE — each site owns its own code scheme
// (<prefix>/NNN, e.g. Lnt/OOS/001) and its own entries. Nothing here
// reads or writes any other module's tables. Every action is gated to
// owner / developer; to open it later, widen isManager().
// ──────────────────────────────────────────────────────────────────

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { randomUUID } from "node:crypto";
import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";

const ROUTE = "/activity-register";
const PROOF_BUCKET = "activity_proofs";
const PROOF_MAX_BYTES = 25 * 1024 * 1024; // 25 MB

// Daksh (June 2026) — ANY file type is allowed now (Excel, Word, DWG,
// PDF, photos…). We only guard size + non-empty. The original
// extension is preserved so downloads open in the right app.

/** Pick a safe storage extension from the file name, else the mime,
 *  else "bin". Lower-cased, alnum only, ≤8 chars. */
function proofExt(file: File): string {
  const fromName = (file.name || "").split(".").pop() ?? "";
  const clean = fromName.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 8);
  if (clean) return clean;
  const mime = (file.type || "").toLowerCase();
  const map: Record<string, string> = {
    "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp",
    "image/heic": "heic", "image/heif": "heif", "application/pdf": "pdf",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
    "application/vnd.ms-excel": "xls",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
    "application/msword": "doc",
  };
  return map[mime] ?? "bin";
}
function validateProof(file: File): string | null {
  if (file.size === 0) return "File is empty.";
  if (file.size > PROOF_MAX_BYTES) return "File too large (max 25 MB).";
  return null;
}
async function uploadProof(
  admin: ReturnType<typeof createAdminSupabaseClient>,
  entryId: string,
  file: File,
): Promise<{ path: string; mime: string }> {
  // Default to a generic binary type when the browser didn't set one
  // (some send "" for .dwg / .xlsx) so the upload still succeeds.
  const mime = (file.type || "").toLowerCase() || "application/octet-stream";
  const err = validateProof(file);
  if (err) throw new Error(err);
  const path = `${entryId}/${randomUUID()}.${proofExt(file)}`;
  const buffer = Buffer.from(await file.arrayBuffer());
  const { error } = await admin.storage
    .from(PROOF_BUCKET)
    .upload(path, buffer, { contentType: mime, cacheControl: "3600", upsert: false });
  if (error) throw new Error(`File upload failed: ${error.message}`);
  return { path, mime };
}

// Mig 104 — who can create/use the register: owner/dev + Tender Manager +
// senior_incharge + carving_head.
function isManager(role: string): boolean {
  return (
    role === "owner" ||
    role === "developer" ||
    role === "tender_manager" ||
    role === "senior_incharge" ||
    role === "carving_head"
  );
}

const EDIT_WINDOW_MS = 10 * 60 * 1000;
const LOCK_MSG =
  "Entries can only be edited or deleted within 10 minutes of being added. Ask the owner or developer.";
/** Daksh June 2026 — an entry locks to non-owner/dev edits 10 minutes after
 *  it was created. Owner + developer are never locked out. */
function lockedForUser(role: string, createdAt: string | null | undefined): boolean {
  if (role === "owner" || role === "developer") return false;
  if (!createdAt) return true;
  return Date.now() - new Date(createdAt).getTime() >= EDIT_WINDOW_MS;
}
function homeToast(msg: string): string {
  return `${ROUTE}?toast=${encodeURIComponent(msg)}`;
}
function siteToast(siteId: string, msg: string): string {
  return `${ROUTE}/${siteId}?toast=${encodeURIComponent(msg)}`;
}

// ── Sites ───────────────────────────────────────────────────────────

/** Owner/dev — create a new site with its own code scheme. */
export async function createActivitySiteAction(formData: FormData) {
  const { profile } = await requireAuth();
  if (!isManager(profile.role)) redirect(homeToast("Only the owner can create sites."));

  const name = String(formData.get("name") || "").trim();
  // Normalise the prefix: trim, drop any trailing slashes (we add the
  // "/NNN" ourselves), collapse internal whitespace.
  let prefix = String(formData.get("code_prefix") || "").trim().replace(/\/+$/, "");
  prefix = prefix.replace(/\s+/g, " ");
  const padRaw = Number(String(formData.get("code_pad") || "3").trim());
  const pad = Number.isFinite(padRaw) ? Math.min(8, Math.max(1, Math.round(padRaw))) : 3;

  if (!name) redirect(homeToast("Site name is required."));
  if (!prefix) redirect(homeToast("Code prefix is required (e.g. Lnt/OOS)."));

  const admin = createAdminSupabaseClient();
  const { data: created, error } = await admin
    .from("activity_sites")
    .insert({ name, code_prefix: prefix, code_pad: pad, created_by: profile.id })
    .select("id")
    .single();
  if (error || !created) {
    const dup = (error?.message || "").toLowerCase().includes("duplicate") || (error?.message || "").toLowerCase().includes("unique");
    redirect(homeToast(dup ? `Code prefix "${prefix}" is already used by another site.` : (error?.message ?? "Failed to create site.")));
  }
  await logAudit(profile.id, "activity_site_created", "activity_site", created.id, { name, code_prefix: prefix });
  revalidatePath(ROUTE);
  redirect(siteToast(created.id, `Site "${name}" created — add entries below.`));
}

/** Owner/dev — delete a site, but only when it has no entries (safety). */
export async function deleteActivitySiteAction(formData: FormData) {
  const { profile } = await requireAuth();
  if (!isManager(profile.role)) redirect(homeToast("Only the owner can delete sites."));
  const id = String(formData.get("id") || "").trim();
  if (!id) redirect(homeToast("Missing site."));

  const admin = createAdminSupabaseClient();
  const { count } = await admin
    .from("activity_register")
    .select("*", { count: "exact", head: true })
    .eq("site_id", id);
  if ((count ?? 0) > 0) {
    redirect(homeToast("This site has entries — delete its entries first."));
  }
  const { error } = await admin.from("activity_sites").delete().eq("id", id);
  if (error) redirect(homeToast(error.message));
  await logAudit(profile.id, "activity_site_deleted", "activity_site", id, {});
  revalidatePath(ROUTE);
  redirect(homeToast("Site deleted."));
}

// ── Entries ─────────────────────────────────────────────────────────

function readEntryFields(formData: FormData) {
  const activity = String(formData.get("activity") || "").trim();
  const concernPerson = String(formData.get("concern_person") || "").trim() || null;
  const reference = String(formData.get("reference") || "").trim() || null;
  const dateRaw = String(formData.get("activity_date") || "").trim();
  const activityDate = /^\d{4}-\d{2}-\d{2}$/.test(dateRaw) ? dateRaw : null;
  return { activity, concernPerson, reference, activityDate };
}

/** Owner/dev — add a new entry INSIDE a site (+ optional proof). The code
 *  is auto-assigned per site: <prefix>/<zero-padded running serial>. */
export async function createActivityEntryAction(formData: FormData) {
  const { profile } = await requireAuth();
  if (!isManager(profile.role)) redirect(homeToast("Only the owner can add register entries."));

  const siteId = String(formData.get("site_id") || "").trim();
  if (!siteId) redirect(homeToast("Pick a site first."));

  const { activity, concernPerson, reference, activityDate } = readEntryFields(formData);
  if (!activity) redirect(siteToast(siteId, "Activity is required."));
  // "Person" auto-fills with the name of whoever is logging the entry.
  const creatorName =
    (profile.full_name || profile.vendor_name || profile.phone || "").trim() || null;

  const proof = formData.get("proof");
  const hasProof = proof instanceof File && proof.size > 0;
  if (hasProof) {
    const err = validateProof(proof as File);
    if (err) redirect(siteToast(siteId, err));
  }

  const admin = createAdminSupabaseClient();
  const { data: site } = await admin
    .from("activity_sites")
    .select("code_prefix, code_pad")
    .eq("id", siteId)
    .maybeSingle();
  if (!site) redirect(homeToast("That site no longer exists."));
  const prefix = (site as { code_prefix: string }).code_prefix;
  const pad = Number((site as { code_pad: number }).code_pad) || 3;

  // Compute the next per-site serial and insert. The UNIQUE(site_id,
  // site_seq) index makes concurrent inserts safe — on a collision we
  // re-read the max and retry.
  let createdId: string | null = null;
  let lastErr: string | null = null;
  for (let attempt = 0; attempt < 6 && !createdId; attempt++) {
    const { data: maxRow } = await admin
      .from("activity_register")
      .select("site_seq")
      .eq("site_id", siteId)
      .not("site_seq", "is", null)
      .order("site_seq", { ascending: false })
      .limit(1)
      .maybeSingle();
    const nextSeq = ((maxRow as { site_seq: number | null } | null)?.site_seq ?? 0) + 1;
    const code = `${prefix}/${String(nextSeq).padStart(pad, "0")}`;
    const insertRow: Record<string, unknown> = {
      site_id: siteId,
      site_seq: nextSeq,
      entry_code: code,
      activity,
      person: creatorName,
      concern_person: concernPerson,
      reference,
      created_by: profile.id,
    };
    if (activityDate) insertRow.activity_date = activityDate;
    const { data, error } = await admin
      .from("activity_register")
      .insert(insertRow)
      .select("id")
      .single();
    if (!error && data) {
      createdId = data.id as string;
      break;
    }
    lastErr = error?.message ?? "insert failed";
    const isDup = (lastErr || "").toLowerCase().includes("duplicate") || (lastErr || "").toLowerCase().includes("unique");
    if (!isDup) break; // a non-collision error won't fix itself by retrying
  }
  if (!createdId) redirect(siteToast(siteId, lastErr ?? "Failed to add entry."));

  if (hasProof) {
    try {
      const meta = await uploadProof(admin, createdId, proof as File);
      await admin
        .from("activity_register")
        .update({ proof_path: meta.path, proof_mime: meta.mime, proof_uploaded_at: new Date().toISOString() })
        .eq("id", createdId);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await logAudit(profile.id, "activity_entry_created", "activity_register", createdId, { site_id: siteId, proof_error: msg });
      revalidatePath(`${ROUTE}/${siteId}`);
      redirect(siteToast(siteId, `Entry saved, but proof upload failed: ${msg}`));
    }
  }

  await logAudit(profile.id, "activity_entry_created", "activity_register", createdId, { site_id: siteId, hasProof });
  revalidatePath(`${ROUTE}/${siteId}`);
  redirect(siteToast(siteId, "Entry added."));
}

/** Owner/dev — edit an existing entry (+ optionally replace the proof).
 *  The code + site are NOT changed here. */
export async function updateActivityEntryAction(formData: FormData) {
  const { profile } = await requireAuth();
  const siteId = String(formData.get("site_id") || "").trim();
  if (!isManager(profile.role)) redirect(siteId ? siteToast(siteId, "Only the owner can edit entries.") : homeToast("Only the owner can edit entries."));
  const id = String(formData.get("id") || "").trim();
  if (!id) redirect(siteId ? siteToast(siteId, "Missing entry.") : homeToast("Missing entry."));

  const { activity, concernPerson, reference, activityDate } = readEntryFields(formData);
  if (!activity) redirect(siteToast(siteId, "Activity is required."));

  const admin = createAdminSupabaseClient();
  // Daksh June 2026 — enforce the 10-minute edit window (owner/dev exempt).
  const { data: lockRow } = await admin
    .from("activity_register")
    .select("created_at")
    .eq("id", id)
    .maybeSingle();
  if (lockedForUser(profile.role, (lockRow as { created_at?: string } | null)?.created_at ?? null)) {
    redirect(siteToast(siteId, LOCK_MSG));
  }
  // "Person" (who created the entry) is preserved on edit — not overwritten.
  const update: Record<string, unknown> = {
    activity,
    concern_person: concernPerson,
    reference,
    updated_at: new Date().toISOString(),
    updated_by: profile.id,
  };
  if (activityDate) update.activity_date = activityDate;

  const proof = formData.get("proof");
  if (proof instanceof File && proof.size > 0) {
    const err = validateProof(proof);
    if (err) redirect(siteToast(siteId, err));
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
      redirect(siteToast(siteId, `Proof upload failed: ${msg}`));
    }
  }

  const { error } = await admin.from("activity_register").update(update).eq("id", id);
  if (error) redirect(siteToast(siteId, error.message));
  await logAudit(profile.id, "activity_entry_updated", "activity_register", id, { site_id: siteId });
  revalidatePath(`${ROUTE}/${siteId}`);
  redirect(siteToast(siteId, "Entry updated."));
}

/** Owner/dev — delete an entry and its proof file. */
export async function deleteActivityEntryAction(formData: FormData) {
  const { profile } = await requireAuth();
  const siteId = String(formData.get("site_id") || "").trim();
  if (!isManager(profile.role)) redirect(siteId ? siteToast(siteId, "Only the owner can delete entries.") : homeToast("Only the owner can delete entries."));
  const id = String(formData.get("id") || "").trim();
  if (!id) redirect(siteId ? siteToast(siteId, "Missing entry.") : homeToast("Missing entry."));

  const admin = createAdminSupabaseClient();
  const { data: cur } = await admin
    .from("activity_register")
    .select("proof_path, entry_code, site_id, created_at")
    .eq("id", id)
    .maybeSingle();
  const path = (cur as { proof_path?: string | null } | null)?.proof_path ?? null;
  const backSite = siteId || ((cur as { site_id?: string | null } | null)?.site_id ?? "");
  // Daksh June 2026 — 10-minute delete window (owner/dev exempt).
  if (lockedForUser(profile.role, (cur as { created_at?: string } | null)?.created_at ?? null)) {
    redirect(backSite ? siteToast(backSite, LOCK_MSG) : homeToast(LOCK_MSG));
  }
  if (path) {
    try {
      await admin.storage.from(PROOF_BUCKET).remove([path]);
    } catch {
      /* best-effort */
    }
  }
  const { error } = await admin.from("activity_register").delete().eq("id", id);
  if (error) redirect(backSite ? siteToast(backSite, error.message) : homeToast(error.message));
  await logAudit(profile.id, "activity_entry_deleted", "activity_register", id, {
    entry_code: (cur as { entry_code?: string } | null)?.entry_code ?? null,
  });
  revalidatePath(backSite ? `${ROUTE}/${backSite}` : ROUTE);
  redirect(backSite ? siteToast(backSite, "Entry deleted.") : homeToast("Entry deleted."));
}

/** Owner/dev — remove just the proof file, keep the entry. */
export async function removeActivityProofAction(formData: FormData) {
  const { profile } = await requireAuth();
  const siteId = String(formData.get("site_id") || "").trim();
  if (!isManager(profile.role)) redirect(siteId ? siteToast(siteId, "Only the owner can remove proof.") : homeToast("Only the owner can remove proof."));
  const id = String(formData.get("id") || "").trim();
  if (!id) redirect(siteId ? siteToast(siteId, "Missing entry.") : homeToast("Missing entry."));

  const admin = createAdminSupabaseClient();
  const { data: cur } = await admin
    .from("activity_register")
    .select("proof_path, site_id")
    .eq("id", id)
    .maybeSingle();
  const path = (cur as { proof_path?: string | null } | null)?.proof_path ?? null;
  const backSite = siteId || ((cur as { site_id?: string | null } | null)?.site_id ?? "");
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
  revalidatePath(backSite ? `${ROUTE}/${backSite}` : ROUTE);
  redirect(backSite ? siteToast(backSite, "Proof removed.") : homeToast("Proof removed."));
}
