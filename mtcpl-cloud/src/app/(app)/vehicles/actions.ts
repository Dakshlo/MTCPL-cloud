"use server";

/**
 * Vehicles department (mig 204) — owner + developer only.
 *
 * Vehicle master (commercial / personal) with EMI monitor, expiry dates
 * (insurance / PUC / fitness) and government-paper uploads. Files go straight
 * from the browser to storage via signed upload URLs (same fast pattern as the
 * Work Diary) — the actions only move metadata, so the pages stay snappy.
 */

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { VEHICLES_ROLES } from "@/lib/vehicles-access";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";

const BUCKET = "vehicle-docs";

function txt(fd: FormData, key: string): string {
  const v = fd.get(key);
  return typeof v === "string" ? v.trim() : "";
}
const orNull = (s: string) => (s ? s : null);
// Text fields are stored UPPERCASE to match the all-caps form display.
const upNull = (s: string) => (s ? s.toUpperCase() : null);
const numOrNull = (s: string) => {
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

function backTo(kind: string, toast: string): never {
  const page = kind === "personal" ? "/vehicles/personal" : "/vehicles/commercial";
  redirect(`${page}?toast=${encodeURIComponent(toast)}`);
}

function refresh() {
  revalidatePath("/vehicles");
  revalidatePath("/vehicles/commercial");
  revalidatePath("/vehicles/personal");
}

/** Create or update a vehicle (id present → update). */
export async function upsertVehicleAction(formData: FormData): Promise<void> {
  const { profile } = await requireAuth(VEHICLES_ROLES);
  const admin = createAdminSupabaseClient();

  const id = txt(formData, "id");
  const kind = txt(formData, "kind") === "personal" ? "personal" : "commercial";
  const name = txt(formData, "name").toUpperCase();
  if (!name) backTo(kind, "Give the vehicle a name");

  // EMI is all-or-none (Daksh, Jul 2026 — the on-EMI checkbox is gone): the
  // fields are always shown; leaving them ALL empty means no loan, filling ANY
  // of them makes every one of the five mandatory.
  const emiRaw = {
    amount: txt(formData, "emi_amount"),
    day: txt(formData, "emi_day"),
    lender: txt(formData, "emi_lender"),
    start: txt(formData, "emi_start"),
    end: txt(formData, "emi_end"),
  };
  const emiFilled = Object.values(emiRaw).filter(Boolean).length;
  if (emiFilled > 0 && emiFilled < 5) {
    backTo(kind, "EMI: fill all five fields (amount, due day, lender, loan start, loan ends) — or leave them all empty");
  }
  const emiActive = emiFilled === 5;
  const emiDayRaw = numOrNull(emiRaw.day);
  const row = {
    kind,
    name,
    reg_no: upNull(txt(formData, "reg_no")),
    make_model: upNull(txt(formData, "make_model")),
    // Mig 210 — registered owner. Stripped by the retry below pre-migration.
    owner_name: upNull(txt(formData, "owner_name")),
    emi_active: emiActive,
    emi_amount: emiActive ? numOrNull(txt(formData, "emi_amount")) : null,
    emi_day: emiActive && emiDayRaw != null ? Math.min(31, Math.max(1, Math.round(emiDayRaw))) : null,
    emi_lender: emiActive ? upNull(txt(formData, "emi_lender")) : null,
    emi_start: emiActive ? orNull(txt(formData, "emi_start")) : null,
    emi_end: emiActive ? orNull(txt(formData, "emi_end")) : null,
    insurance_company: upNull(txt(formData, "insurance_company")),
    insurance_policy_no: upNull(txt(formData, "insurance_policy_no")),
    insurance_expiry: orNull(txt(formData, "insurance_expiry")),
    puc_expiry: orNull(txt(formData, "puc_expiry")),
    // fitness is a commercial-vehicle concept; a personal save never writes it
    fitness_expiry: kind === "commercial" ? orNull(txt(formData, "fitness_expiry")) : null,
    notes: upNull(txt(formData, "notes")),
  };

  // owner_name arrived with mig 210 — if that hasn't run yet the write fails
  // on the unknown column, so retry once without it rather than erroring out.
  const missingOwnerCol = (msg: string) => /owner_name/i.test(msg);

  if (id) {
    let { error } = await admin.from("vehicles").update(row as never).eq("id", id);
    if (error && missingOwnerCol(error.message)) {
      const { owner_name: _drop, ...noOwner } = row;
      ({ error } = await admin.from("vehicles").update(noOwner as never).eq("id", id));
    }
    if (error) backTo(kind, error.message);
    void logAudit(profile.id, "vehicle_updated", "vehicle", id, { name });
    refresh();
    backTo(kind, "Vehicle updated");
  } else {
    let { error } = await admin.from("vehicles").insert({ ...row, created_by: profile.id } as never);
    if (error && missingOwnerCol(error.message)) {
      const { owner_name: _drop, ...noOwner } = row;
      ({ error } = await admin.from("vehicles").insert({ ...noOwner, created_by: profile.id } as never));
    }
    if (error) backTo(kind, error.message);
    void logAudit(profile.id, "vehicle_added", "vehicle", name, { kind });
    refresh();
    backTo(kind, "Vehicle added");
  }
}

/** Delete a vehicle + its documents (rows cascade; storage best-effort). */
export async function deleteVehicleAction(formData: FormData): Promise<void> {
  const { profile } = await requireAuth(VEHICLES_ROLES);
  const admin = createAdminSupabaseClient();
  const id = txt(formData, "id");
  const kind = txt(formData, "kind") === "personal" ? "personal" : "commercial";
  if (!id) backTo(kind, "Missing vehicle");

  try {
    const { data: docs } = await admin.from("vehicle_documents").select("path").eq("vehicle_id", id);
    const paths = ((docs ?? []) as Array<{ path: string }>).map((d) => d.path);
    if (paths.length) await admin.storage.from(BUCKET).remove(paths);
  } catch { /* orphaned storage objects are acceptable */ }

  const { error } = await admin.from("vehicles").delete().eq("id", id);
  if (error) backTo(kind, error.message);
  void logAudit(profile.id, "vehicle_deleted", "vehicle", id, {});
  refresh();
  backTo(kind, "Vehicle removed");
}

/** Hand the browser signed upload URLs for direct-to-storage uploads. */
export async function prepareVehicleDocUploadsAction(
  formData: FormData,
): Promise<{ ok: true; uploads: Array<{ name: string; path: string; token: string }> } | { ok: false; error: string }> {
  await requireAuth(VEHICLES_ROLES);
  const admin = createAdminSupabaseClient();
  const vehicleId = txt(formData, "vehicle_id");
  if (!vehicleId) return { ok: false, error: "Missing vehicle." };

  let names: Array<{ name: string }> = [];
  try {
    const raw = JSON.parse(txt(formData, "names") || "[]");
    if (Array.isArray(raw)) names = raw.filter((n) => n && typeof n.name === "string");
  } catch { /* ignore */ }
  if (names.length === 0) return { ok: false, error: "No files to upload." };
  if (names.length > 15) return { ok: false, error: "Max 15 files at once." };

  try { await admin.storage.createBucket(BUCKET, { public: true }); } catch { /* already exists */ }

  const uploads: Array<{ name: string; path: string; token: string }> = [];
  for (const n of names) {
    const safe = n.name.replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 120) || "file";
    const path = `${vehicleId}/${crypto.randomUUID()}-${safe}`;
    const { data, error } = await admin.storage.from(BUCKET).createSignedUploadUrl(path);
    if (error || !data) return { ok: false, error: error?.message || "Could not prepare the upload." };
    uploads.push({ name: n.name, path, token: data.token });
  }
  return { ok: true, uploads };
}

/** Record uploaded documents' metadata (files are already in storage). */
export async function saveVehicleDocsAction(
  formData: FormData,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { profile } = await requireAuth(VEHICLES_ROLES);
  const admin = createAdminSupabaseClient();
  const vehicleId = txt(formData, "vehicle_id");
  const docType = orNull(txt(formData, "doc_type"));
  if (!vehicleId) return { ok: false, error: "Missing vehicle." };

  type Meta = { name: string; path: string; mime: string | null; size: number | null };
  let files: Meta[] = [];
  try {
    const raw = JSON.parse(txt(formData, "files") || "[]");
    if (Array.isArray(raw)) {
      files = raw
        .filter((f) => f && typeof f.name === "string" && typeof f.path === "string")
        .map((f) => ({ name: String(f.name).slice(0, 300), path: String(f.path), mime: f.mime ? String(f.mime) : null, size: Number(f.size) || null }));
    }
  } catch { /* ignore */ }
  if (files.length === 0) return { ok: false, error: "No files." };

  const { error } = await admin.from("vehicle_documents").insert(
    files.map((f) => ({ vehicle_id: vehicleId, name: f.name, path: f.path, mime: f.mime, size: f.size, doc_type: docType, uploaded_by: profile.id })),
  );
  if (error) return { ok: false, error: error.message };
  void logAudit(profile.id, "vehicle_docs_added", "vehicle", vehicleId, { count: files.length, docType });
  refresh();
  return { ok: true };
}

/** Delete one document (row + storage object). */
export async function deleteVehicleDocAction(
  formData: FormData,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { profile } = await requireAuth(VEHICLES_ROLES);
  const admin = createAdminSupabaseClient();
  const id = txt(formData, "doc_id");
  if (!id) return { ok: false, error: "Missing document." };

  const { data } = await admin.from("vehicle_documents").select("id, vehicle_id, path").eq("id", id).maybeSingle();
  const doc = data as { id: string; vehicle_id: string; path: string } | null;
  if (!doc) return { ok: false, error: "Document not found." };

  try { await admin.storage.from(BUCKET).remove([doc.path]); } catch { /* best-effort */ }
  const { error } = await admin.from("vehicle_documents").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  void logAudit(profile.id, "vehicle_doc_deleted", "vehicle", doc.vehicle_id, {});
  refresh();
  return { ok: true };
}
