"use server";

import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { nextSlabCodeFromMaxId } from "./utils";
import { logAudit } from "@/lib/audit";
import { notify } from "@/lib/notifications";
import { fetchUncategorizedOpenSlabs } from "@/lib/uncategorized-slabs";
import { getProfilesMap } from "@/lib/profiles";
import { fetchAllPaged } from "@/lib/paginate";
import type { AppRole } from "@/lib/types";
import type { ImportBatch, ImportBatchRowPreview, BatchSlab } from "./import-batches-button";


function num(fd: FormData, key: string, fallback = 0) {
  const v = Number(fd.get(key));
  return Number.isFinite(v) ? v : fallback;
}
function text(fd: FormData, key: string) {
  const v = fd.get(key);
  return typeof v === "string" ? v.trim() : "";
}
function toast(path: string, msg: string): never {
  redirect(`${path}?toast=${encodeURIComponent(msg)}`);
}

export async function addSlabAction(formData: FormData) {
  const { profile } = await requireAuth(["owner", "team_head", "senior_incharge", "slab_entry"]);
  const supabase = createAdminSupabaseClient();

  const temple = text(formData, "temple");
  if (!temple) toast("/slabs", "Temple is required");

  const qty = Math.min(100, Math.max(1, parseInt(text(formData, "quantity") || "1", 10)));

  // Get prefix from temples table
  const { data: templeRow } = await supabase.from("temples").select("code_prefix").eq("name", temple).single();
  const prefix = templeRow?.code_prefix ?? "SLB";

  const stone = text(formData, "stone");
  if (!stone) toast("/slabs", "Stone type is required");

  // Batch grouping: only when creating >1 rows in one submit. Singletons stay
  // batch_id=null so the UI never multi-selects them with other singletons.
  const batchId = qty > 1 ? randomUUID() : null;

  const label = text(formData, "label");
  const description = text(formData, "description") || null;

  const common = {
    label: label || temple,
    description,
    temple,
    stone,
    quality: text(formData, "quality") || null,
    length_ft: num(formData, "length_in"),
    width_ft: num(formData, "width_in"),
    thickness_ft: num(formData, "thickness_in"),
    priority: text(formData, "priority") === "true",
    status: "open" as const,
    batch_id: batchId,
    created_by: profile.id,
    updated_by: profile.id,
  };

  // Insert with collision retry. Each attempt queries Postgres for the
  // single highest ID under this prefix (no 1000-row cap issue —
  // we only ask for ONE row), builds baseId = that + 1, attempts insert.
  // If it collides (race condition, concurrent admin), refetch + retry.
  let baseId = "";
  let lastError: { message: string; code?: string } | null = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    // ORDER BY id DESC + LIMIT 1 returns one row: the alphabetically
    // highest id for the prefix. Zero-padded 4-digit numeric component
    // means alphabetical DESC == numeric DESC, so this is also the
    // numerically highest base number. parseInt on "0010-9" returns 10
    // (stops at the hyphen), exactly what we want — batch children
    // share their base's number.
    const { data: maxRow } = await supabase
      .from("slab_requirements")
      .select("id")
      .like("id", `${prefix}-%`)
      .order("id", { ascending: false })
      .limit(1)
      .maybeSingle();
    baseId = nextSlabCodeFromMaxId(maxRow?.id ?? null, prefix);

    const rows = Array.from({ length: qty }, (_, i) => ({
      ...common,
      id: i === 0 ? baseId : `${baseId}-${i}`,
    }));

    const { error } = await supabase.from("slab_requirements").insert(rows);
    if (!error) {
      lastError = null;
      break;
    }
    lastError = { message: error.message, code: error.code };
    if (error.code !== "23505") break;
    // 23505 = primary-key collision. Loop will refetch + retry — the
    // only way this happens now is a legitimate concurrent insert.
  }
  if (lastError) toast("/slabs", lastError.message);

  await logAudit(profile.id, "create", "slab", baseId, { temple, qty, stone: common.stone, batch_id: batchId });
  revalidatePath("/slabs");
  revalidatePath("/planning");
  redirect(`/slabs?toast=${qty > 1 ? `${qty}+slabs+added` : "Slab+added"}`);
}

export async function updateSlabAction(formData: FormData) {
  const { profile } = await requireAuth(["owner", "team_head", "senior_incharge", "slab_entry"]);
  const supabase = createAdminSupabaseClient();

  const id = text(formData, "id");
  if (!id) toast("/slabs", "Missing slab ID");

  const stone = text(formData, "stone");
  if (!stone) toast("/slabs", "Stone type is required");

  const payload = {
    label: text(formData, "label"),
    description: text(formData, "description") || null,
    temple: text(formData, "temple"),
    stone,
    quality: text(formData, "quality") || null,
    length_ft: num(formData, "length_in"),
    width_ft: num(formData, "width_in"),
    thickness_ft: num(formData, "thickness_in"),
    priority: text(formData, "priority") === "true",
    status: text(formData, "status") || "open",
    updated_by: profile.id,
    updated_at: new Date().toISOString(),
  };

  const { error } = await supabase.from("slab_requirements").update(payload).eq("id", id);
  if (error) toast("/slabs", error.message);

  await logAudit(profile.id, "update", "slab", id, { status: payload.status });
  revalidatePath("/slabs");
  revalidatePath("/planning");
  redirect("/slabs?toast=Slab+updated");
}

export async function deleteSlabAction(formData: FormData) {
  const { profile } = await requireAuth(["owner", "team_head", "senior_incharge", "slab_entry", "block_slab_entry"]);
  const supabase = createAdminSupabaseClient();

  const id = text(formData, "id");

  if (!id) toast("/slabs", "Missing ID");

  // Entry roles can only delete slabs they personally added
  const ENTRY_ROLES = ["slab_entry", "block_slab_entry"];
  if (ENTRY_ROLES.includes(profile.role)) {
    const { data: slab } = await supabase.from("slab_requirements").select("created_by").eq("id", id).single();
    if (slab?.created_by !== profile.id) {
      toast("/slabs", "You can only delete slabs you added.");
    }
  }

  const { error } = await supabase.from("slab_requirements").delete().eq("id", id);
  if (error) {
    if (error.code === "23503") {
      await supabase.from("slab_requirements").update({ status: "rejected", updated_by: profile.id }).eq("id", id);
      await logAudit(profile.id, "archive", "slab", id, { reason: "referenced_delete" });
      revalidatePath("/slabs");
      toast("/slabs", "Slab was referenced — archived as rejected");
    }
    toast("/slabs", error.message);
  }

  await logAudit(profile.id, "delete", "slab", id);
  await notify("slab_deleted", `Slab ${id} was deleted`, {
    entityType: "slab",
    entityId: id,
    actorId: profile.id,
  });
  revalidatePath("/slabs");
  redirect("/slabs?toast=Slab+deleted");
}

// ────────────────────────────────────────────────────────────────────────────
// Bulk import from Excel (Daksh June 2026)
//
// The /slabs/import flow parses the uploaded .xlsx CLIENT-SIDE (SheetJS)
// and posts the verified rows here as plain JSON. This action:
//   • gates the same write roles as addSlabAction (+ developer),
//   • verifies the bulk-import password SERVER-SIDE,
//   • allocates ids with the EXACT scheme single-add uses
//     (nextSlabCodeFromMaxId), one base number per row, quantity
//     expanded into base / base-1 / base-2 … children — so temple
//     numbering continues seamlessly, no break,
//   • tags the whole import with ONE batch_id so the existing Required
//     Sizes bulk-select can delete the group together later,
//   • inserts everything at status='open' → it shows in Required Sizes.
// Returns a result (not a redirect) so the rich client can keep the
// verify table on a wrong password / error.
// ────────────────────────────────────────────────────────────────────────────
// ────────────────────────────────────────────────────────────────────────────
// Bulk import — batch + approval flow (mig 122, Daksh June 2026).
// The manual Add-Slab form is retired; Import from Excel is the only way to
// add slabs, and every import is a batch that must be APPROVED by owner /
// senior_incharge / carving_head / developer before any slab row exists.
// The uploaded Excel is kept as the audit copy.
// ────────────────────────────────────────────────────────────────────────────

const IMPORT_SUBMIT_ROLES: AppRole[] = ["owner", "team_head", "senior_incharge", "slab_entry", "developer"];
const IMPORT_APPROVER_ROLES: AppRole[] = ["owner", "senior_incharge", "carving_head", "developer"];
const IMPORT_FILE_BUCKET = "slab_import_files";

type CleanImportRow = {
  label: string;
  description: string | null;
  // Mig 128 — optional extra description (further tree level under Description).
  additionalDescription: string | null;
  length: number;
  width: number;
  height: number;
  quantity: number;
  quality: string | null;
  priority: boolean;
  // Mig 123 — temple-component category (Category 1 / Category 2). Optional.
  componentSection: string | null;
  componentElement: string | null;
  // Mig 155 — external-slab imports carry a stock location per row
  // (where the externally-cut slab physically sits). Null for Required
  // Sizes imports, which don't collect it.
  stockLocation: string | null;
};

function cleanImportRows(rows: unknown): CleanImportRow[] {
  type RawRow = {
    label?: string | null; description?: string | null; additionalDescription?: string | null;
    length?: number | string | null; width?: number | string | null; height?: number | string | null;
    quantity?: number | string | null; quality?: string | null; priority?: boolean | null;
    componentSection?: string | null; componentElement?: string | null;
    stockLocation?: string | null;
  };
  // Label + Category 1/2 are stored UPPERCASE so they group consistently
  // no matter how they were typed in Excel ("floor-1" → "FLOOR-1").
  // Description + Additional Description keep their original casing (prose).
  const up = (v: unknown) => (v ?? "").toString().trim().toUpperCase();
  const upOrNull = (v: unknown) => up(v) || null;
  return (Array.isArray(rows) ? (rows as RawRow[]) : [])
    .map((r) => ({
      label: up(r.label),
      description: (r.description ?? "").toString().trim() || null,
      additionalDescription: (r.additionalDescription ?? "").toString().trim() || null,
      length: Number(r.length) || 0,
      width: Number(r.width) || 0,
      height: Number(r.height) || 0,
      quantity: Math.min(100, Math.max(1, Math.floor(Number(r.quantity) || 1))),
      quality: (r.quality ?? "").toString().trim() || null,
      priority: r.priority === true,
      componentSection: upOrNull(r.componentSection),
      componentElement: upOrNull(r.componentElement),
      stockLocation: (r.stockLocation ?? "").toString().trim() || null,
    }))
    // Every slab needs all three dimensions (stored as inches in *_ft).
    .filter((r) => r.length > 0 && r.width > 0 && r.height > 0);
}

/** Generate ids + insert the slabs of an approved batch. Same code scheme
 *  and 23505-retry as the old direct import. Returns the slab group id. */
async function insertApprovedSlabRows(
  supabase: ReturnType<typeof createAdminSupabaseClient>,
  actorId: string,
  temple: string,
  stone: string,
  cleaned: CleanImportRow[],
): Promise<{ ok: true; count: number; slabBatchId: string } | { ok: false; error: string }> {
  const { data: templeRow } = await supabase
    .from("temples")
    .select("code_prefix")
    .eq("name", temple)
    .single();
  const prefix = (templeRow as { code_prefix?: string } | null)?.code_prefix ?? "SLB";

  // One batch_id for the whole import = the deletable "group".
  const slabBatchId = randomUUID();
  let inserted = 0;
  let lastError = "";
  for (let attempt = 0; attempt < 5; attempt++) {
    // Highest existing id for this prefix (ORDER BY id DESC LIMIT 1 —
    // no 1000-row cap issue). parseInt ignores the "-N" child suffix.
    const { data: maxRow } = await supabase
      .from("slab_requirements")
      .select("id")
      .like("id", `${prefix}-%`)
      .order("id", { ascending: false })
      .limit(1)
      .maybeSingle();
    let cursor = (maxRow as { id?: string } | null)?.id ?? null;

    const insertRows: Array<Record<string, unknown>> = [];
    for (const r of cleaned) {
      const baseId = nextSlabCodeFromMaxId(cursor, prefix);
      for (let i = 0; i < r.quantity; i++) {
        insertRows.push({
          id: i === 0 ? baseId : `${baseId}-${i}`,
          label: r.label || temple,
          description: r.description,
          additional_description: r.additionalDescription,
          temple,
          stone,
          quality: r.quality,
          length_ft: r.length,
          width_ft: r.width,
          thickness_ft: r.height,
          priority: r.priority,
          component_section: r.componentSection,
          component_element: r.componentElement,
          status: "open",
          batch_id: slabBatchId,
          created_by: actorId,
          updated_by: actorId,
        });
      }
      // Next row takes the next base number (children share this base's
      // number, so base+1 never collides with them).
      cursor = baseId;
    }

    const { error } = await supabase.from("slab_requirements").insert(insertRows);
    if (!error) {
      inserted = insertRows.length;
      lastError = "";
      break;
    }
    lastError = error.message;
    // 23505 = id collision (concurrent insert) → refetch max + retry.
    if (error.code !== "23505") break;
  }
  if (lastError) return { ok: false, error: lastError };
  return { ok: true, count: inserted, slabBatchId };
}

// Mig 155 — externally-cut slabs come in through the same import+approval
// flow, but land DIRECTLY at status 'cut_done' (Unassigned on /carving)
// with source_block_id NULL — they never went through our cutting. When
// the batch is flagged to_dispatch, they instead go STRAIGHT to dispatch:
// status 'completed' + direct_dispatched_at (mirrors carving → Direct
// Dispatch), so the dispatch incharge can pick them immediately.
const EXTERNAL_IMPORT_SUBMIT_ROLES: AppRole[] = [
  "owner", "team_head", "senior_incharge", "carving_head", "tender_manager", "developer",
];

/** Insert the slabs of an approved EXTERNAL batch. Same id-allocation +
 *  23505-retry as insertApprovedSlabRows, but status=cut_done (or
 *  completed when sent straight to dispatch), source_block_id NULL, and a
 *  per-row stock_location. Returns the slab group id. */
async function insertApprovedExternalSlabRows(
  supabase: ReturnType<typeof createAdminSupabaseClient>,
  actorId: string,
  temple: string,
  stone: string,
  cleaned: CleanImportRow[],
  toDispatch: boolean,
): Promise<{ ok: true; count: number; slabBatchId: string } | { ok: false; error: string }> {
  const { data: templeRow } = await supabase
    .from("temples")
    .select("code_prefix")
    .eq("name", temple)
    .single();
  const prefix = (templeRow as { code_prefix?: string } | null)?.code_prefix ?? "SLB";

  const slabBatchId = randomUUID();
  const now = new Date().toISOString();
  let inserted = 0;
  let lastError = "";
  for (let attempt = 0; attempt < 5; attempt++) {
    const { data: maxRow } = await supabase
      .from("slab_requirements")
      .select("id")
      .like("id", `${prefix}-%`)
      .order("id", { ascending: false })
      .limit(1)
      .maybeSingle();
    let cursor = (maxRow as { id?: string } | null)?.id ?? null;

    const insertRows: Array<Record<string, unknown>> = [];
    for (const r of cleaned) {
      const baseId = nextSlabCodeFromMaxId(cursor, prefix);
      for (let i = 0; i < r.quantity; i++) {
        insertRows.push({
          id: i === 0 ? baseId : `${baseId}-${i}`,
          label: r.label || temple,
          description: r.description,
          additional_description: r.additionalDescription,
          temple,
          stone,
          quality: r.quality,
          length_ft: r.length,
          width_ft: r.width,
          thickness_ft: r.height,
          priority: r.priority,
          component_section: r.componentSection,
          component_element: r.componentElement,
          stock_location: r.stockLocation,
          // External slabs skip our cutting pipeline entirely.
          source_block_id: null,
          // to_dispatch → straight onto a truck (Dispatch → Make Dispatch);
          // otherwise Unassigned (cut_done) for CNC / outsource / direct.
          status: toDispatch ? "completed" : "cut_done",
          ...(toDispatch ? { direct_dispatched_at: now, direct_dispatched_by: actorId } : {}),
          batch_id: slabBatchId,
          created_by: actorId,
          updated_by: actorId,
        });
      }
      cursor = baseId;
    }

    const { error } = await supabase.from("slab_requirements").insert(insertRows);
    if (!error) {
      inserted = insertRows.length;
      lastError = "";
      break;
    }
    lastError = error.message;
    if (error.code !== "23505") break;
  }
  if (lastError) return { ok: false, error: lastError };
  return { ok: true, count: inserted, slabBatchId };
}

/** Step 1 (external) — submit an external cut-slab import batch for
 *  approval. Identical plumbing to submitSlabImportBatchAction but tagged
 *  batch_type='external_slab' and carrying the to_dispatch flag + per-row
 *  stock locations. No slab rows are created here. */
export async function submitExternalSlabImportBatchAction(
  formData: FormData,
): Promise<{ ok: true; slabCount: number } | { ok: false; error: string }> {
  const { profile } = await requireAuth(EXTERNAL_IMPORT_SUBMIT_ROLES);
  const supabase = createAdminSupabaseClient();

  const temple = text(formData, "temple");
  const stone = text(formData, "stone");
  if (!temple) return { ok: false, error: "Temple is required" };
  if (!stone) return { ok: false, error: "Stone is required" };
  const toDispatch = text(formData, "to_dispatch") === "true";

  let rawRows: unknown;
  try {
    rawRows = JSON.parse(String(formData.get("rows") ?? "[]"));
  } catch {
    return { ok: false, error: "Bad rows payload — re-upload the file." };
  }
  const cleaned = cleanImportRows(rawRows);
  if (cleaned.length === 0) {
    return { ok: false, error: "No valid rows — each slab needs length, width and height." };
  }
  // Stock location is optional (mirrors the Required Sizes import — only
  // label/description/size/qty are mandatory); it's kept per row when filled.
  const totalSlabs = cleaned.reduce((s, r) => s + r.quantity, 0);
  if (totalSlabs > 10000) {
    return { ok: false, error: `Too many slabs in one import (${totalSlabs}). Max 10000 — split the file.` };
  }

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: "The Excel file is missing — re-upload it." };
  }
  if (file.size > 4 * 1024 * 1024) {
    return { ok: false, error: "Excel file too large (max 4 MB)." };
  }

  const batchId = randomUUID();
  const safeName = (file.name || "external-import.xlsx").replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 120);
  const filePath = `${batchId}/${safeName}`;
  const buffer = Buffer.from(await file.arrayBuffer());
  const { error: upErr } = await supabase.storage
    .from(IMPORT_FILE_BUCKET)
    .upload(filePath, buffer, {
      contentType: file.type || "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      upsert: false,
    });
  if (upErr) return { ok: false, error: `Couldn't store the Excel copy: ${upErr.message}` };

  const { error } = await supabase.from("slab_import_batches").insert({
    id: batchId,
    temple,
    stone,
    rows: cleaned,
    row_count: cleaned.length,
    slab_count: totalSlabs,
    file_path: filePath,
    file_name: file.name || safeName,
    status: "pending",
    batch_type: "external_slab",
    to_dispatch: toDispatch,
    submitted_by: profile.id,
  });
  if (error) return { ok: false, error: error.message };

  await logAudit(profile.id, "external_slab_import_submitted", "slab_import_batch", batchId, {
    temple, stone, rows: cleaned.length, slabs: totalSlabs, to_dispatch: toDispatch,
  });
  revalidatePath("/carving");
  revalidatePath("/tasks");
  return { ok: true, slabCount: totalSlabs };
}

/** Step 1 — submit an import batch for approval. Stores the reviewed rows
 *  as JSONB + the uploaded Excel as the audit copy. NO slab rows are
 *  created here — that happens at approval. */
export async function submitSlabImportBatchAction(
  formData: FormData,
): Promise<{ ok: true; slabCount: number } | { ok: false; error: string }> {
  const { profile } = await requireAuth(IMPORT_SUBMIT_ROLES);
  const supabase = createAdminSupabaseClient();

  const temple = text(formData, "temple");
  const stone = text(formData, "stone");
  if (!temple) return { ok: false, error: "Temple is required" };
  if (!stone) return { ok: false, error: "Stone is required" };

  // Mig 122 follow-on — no import password anymore: the batch can't
  // create slabs until a human approver signs off, which is a stronger
  // gate than the old shared password.

  let rawRows: unknown;
  try {
    rawRows = JSON.parse(String(formData.get("rows") ?? "[]"));
  } catch {
    return { ok: false, error: "Bad rows payload — re-upload the file." };
  }
  const cleaned = cleanImportRows(rawRows);
  if (cleaned.length === 0) {
    return { ok: false, error: "No valid rows — each slab needs length, width and height." };
  }
  const totalSlabs = cleaned.reduce((s, r) => s + r.quantity, 0);
  if (totalSlabs > 10000) {
    return { ok: false, error: `Too many slabs in one import (${totalSlabs}). Max 10000 — split the file.` };
  }

  // The uploaded Excel — kept as the audit copy of this batch.
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: "The Excel file is missing — re-upload it." };
  }
  if (file.size > 4 * 1024 * 1024) {
    return { ok: false, error: "Excel file too large (max 4 MB)." };
  }

  const batchId = randomUUID();
  const safeName = (file.name || "import.xlsx").replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 120);
  const filePath = `${batchId}/${safeName}`;
  const buffer = Buffer.from(await file.arrayBuffer());
  const { error: upErr } = await supabase.storage
    .from(IMPORT_FILE_BUCKET)
    .upload(filePath, buffer, {
      contentType: file.type || "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      upsert: false,
    });
  if (upErr) return { ok: false, error: `Couldn't store the Excel copy: ${upErr.message}` };

  const { error } = await supabase.from("slab_import_batches").insert({
    id: batchId,
    temple,
    stone,
    rows: cleaned,
    row_count: cleaned.length,
    slab_count: totalSlabs,
    file_path: filePath,
    file_name: file.name || safeName,
    status: "pending",
    submitted_by: profile.id,
  });
  if (error) return { ok: false, error: error.message };

  await logAudit(profile.id, "slab_import_submitted", "slab_import_batch", batchId, {
    temple, stone, rows: cleaned.length, slabs: totalSlabs,
  });
  revalidatePath("/slabs");
  revalidatePath("/tasks");
  return { ok: true, slabCount: totalSlabs };
}

/** Step 2a — approve a pending batch: the slabs are created at status
 *  'open' (visible on Required Sizes), the batch is closed. */
export async function approveSlabImportBatchAction(formData: FormData) {
  const { profile } = await requireAuth(IMPORT_APPROVER_ROLES);
  const supabase = createAdminSupabaseClient();
  const batchId = text(formData, "batch_id");
  if (!batchId) toast("/tasks/slab-imports", "Missing batch.");

  const { data: batch } = await supabase
    .from("slab_import_batches")
    .select("id, temple, stone, rows, status, submitted_by, batch_type, to_dispatch")
    .eq("id", batchId)
    .maybeSingle();
  if (!batch) toast("/tasks/slab-imports", "Batch not found.");
  const b = batch as {
    id: string; temple: string; stone: string; rows: unknown; status: string;
    submitted_by: string | null; batch_type?: string | null; to_dispatch?: boolean | null;
  };
  if (b.status !== "pending") toast("/tasks/slab-imports", "This batch was already reviewed.");

  const cleaned = cleanImportRows(b.rows);
  if (cleaned.length === 0) toast("/tasks/slab-imports", "Batch has no valid rows — reject it instead.");

  // Mig 155 — external batches land at cut_done (Unassigned) or, when
  // flagged, straight to dispatch (completed). Required-sizes batches
  // create slabs at status 'open' on Required Sizes (existing behaviour).
  const isExternal = b.batch_type === "external_slab";
  const toDispatch = isExternal && b.to_dispatch === true;
  const res = isExternal
    ? await insertApprovedExternalSlabRows(supabase, profile.id, b.temple, b.stone, cleaned, toDispatch)
    : await insertApprovedSlabRows(supabase, profile.id, b.temple, b.stone, cleaned);
  if (!res.ok) toast("/tasks/slab-imports", `Approve failed: ${res.error}`);

  await supabase
    .from("slab_import_batches")
    .update({
      status: "approved",
      reviewed_by: profile.id,
      reviewed_at: new Date().toISOString(),
      slab_batch_id: res.slabBatchId,
    })
    .eq("id", batchId)
    .eq("status", "pending");

  await logAudit(profile.id, isExternal ? "external_slab_import_approved" : "slab_import_approved", "slab_import_batch", batchId, {
    temple: b.temple, stone: b.stone, slabs: res.count, slab_batch_id: res.slabBatchId, to_dispatch: toDispatch,
  });
  // Record for the team — the submitter sees the status (and reviewer)
  // in the 🗂 Batches modal on Required Sizes.
  const landed = isExternal ? (toDispatch ? "sent straight to dispatch" : "added to Unassigned") : "added";
  await notify(isExternal ? "external_slab_import_approved" : "slab_import_approved", `${isExternal ? "External slab" : "Slab"} import approved — ${res.count} slabs for ${b.temple}`, {
    message: isExternal ? `Slabs ${landed}.` : undefined,
    entityType: "slab_import_batch",
    entityId: batchId,
    actorId: profile.id,
  });
  revalidatePath("/slabs");
  revalidatePath("/planning");
  revalidatePath("/carving");
  revalidatePath("/dispatch");
  revalidatePath("/tasks");
  toast("/tasks/slab-imports", `Approved — ${res.count} slab${res.count === 1 ? "" : "s"} ${isExternal ? landed : `added to ${b.temple}`}.`);
}

/** Step 2b — reject a pending batch (note optional). No slabs are created. */
export async function rejectSlabImportBatchAction(formData: FormData) {
  const { profile } = await requireAuth(IMPORT_APPROVER_ROLES);
  const supabase = createAdminSupabaseClient();
  const batchId = text(formData, "batch_id");
  const note = text(formData, "note") || null;
  if (!batchId) toast("/tasks/slab-imports", "Missing batch.");

  const { data: batch } = await supabase
    .from("slab_import_batches")
    .select("id, temple, slab_count, status, submitted_by")
    .eq("id", batchId)
    .maybeSingle();
  if (!batch) toast("/tasks/slab-imports", "Batch not found.");
  const b = batch as { id: string; temple: string; slab_count: number; status: string; submitted_by: string | null };
  if (b.status !== "pending") toast("/tasks/slab-imports", "This batch was already reviewed.");

  await supabase
    .from("slab_import_batches")
    .update({
      status: "rejected",
      reviewed_by: profile.id,
      reviewed_at: new Date().toISOString(),
      review_note: note,
    })
    .eq("id", batchId)
    .eq("status", "pending");

  await logAudit(profile.id, "slab_import_rejected", "slab_import_batch", batchId, { note });
  await notify("slab_import_rejected", `Slab import rejected — ${b.temple} (${b.slab_count} slabs)`, {
    message: note ?? undefined,
    entityType: "slab_import_batch",
    entityId: batchId,
    actorId: profile.id,
  });
  revalidatePath("/slabs");
  revalidatePath("/tasks");
  toast("/tasks/slab-imports", "Batch rejected.");
}

/** Load an OLDER page of import batches for the 🗂 Batches modal's "Load
 *  more" button. The page renders the first 40; each click fetches the next
 *  40 (older) so the team can scroll all the way back — e.g. to check whether
 *  a 30-Jun import ever landed. Entry roles see only their own submissions,
 *  mirroring the page's filter exactly. */
const IMPORT_BATCH_PAGE = 40;
const IMPORT_BATCH_ENTRY_ROLES: AppRole[] = ["slab_entry", "block_slab_entry"];
export async function loadMoreImportBatchesAction(
  offset: number,
): Promise<{ batches: ImportBatch[]; done: boolean }> {
  const { profile } = await requireAuth();
  const supabase = createAdminSupabaseClient();
  const from = Math.max(0, Math.floor(Number(offset) || 0));

  let q = supabase
    .from("slab_import_batches")
    .select("id, temple, stone, rows, row_count, slab_count, file_name, status, submitted_by, submitted_at, reviewed_by, reviewed_at, review_note, slab_batch_id")
    .order("submitted_at", { ascending: false })
    .range(from, from + IMPORT_BATCH_PAGE - 1);
  if (IMPORT_BATCH_ENTRY_ROLES.includes(profile.role)) q = q.eq("submitted_by", profile.id);
  const { data } = await q;

  type BatchRow = {
    id: string; temple: string; stone: string; rows: ImportBatchRowPreview[] | null;
    row_count: number | null; slab_count: number | null; file_name: string | null;
    status: string; submitted_by: string | null; submitted_at: string | null;
    reviewed_by: string | null; reviewed_at: string | null; review_note: string | null;
    slab_batch_id: string | null;
  };
  const rows = (data ?? []) as BatchRow[];
  const names = await getProfilesMap();
  const batches: ImportBatch[] = rows.map((b) => ({
    id: b.id, temple: b.temple, stone: b.stone,
    rows: Array.isArray(b.rows) ? b.rows : [],
    rowCount: b.row_count ?? 0, slabCount: b.slab_count ?? 0, fileName: b.file_name,
    status: (["pending", "approved", "rejected"].includes(b.status) ? b.status : "pending") as ImportBatch["status"],
    submittedByName: b.submitted_by ? (names[b.submitted_by] ?? null) : null,
    submittedAt: b.submitted_at,
    reviewedByName: b.reviewed_by ? (names[b.reviewed_by] ?? null) : null,
    reviewedAt: b.reviewed_at, reviewNote: b.review_note,
    slabBatchId: b.slab_batch_id ?? null,
  }));
  return { batches, done: batches.length < IMPORT_BATCH_PAGE };
}

/** The REAL slabs an approved batch created — their codes, size, and CURRENT
 *  status. Powers the "🔢 Codes" view on the Batches modal, so the team can
 *  see the actual slab numbers AND where each one is now (a batch may look
 *  "missing" from Required Sizes only because its slabs already moved on to
 *  cut_done / dispatched / etc.). Keyed by slab_requirements.batch_id, which
 *  equals slab_import_batches.slab_batch_id. Paginated for safety (a batch can
 *  hold up to 10,000 slabs). */
export async function getImportBatchSlabsAction(
  slabBatchId: string,
): Promise<{ ok: true; slabs: BatchSlab[] } | { ok: false; error: string }> {
  await requireAuth();
  const id = String(slabBatchId || "").trim();
  if (!id) return { ok: false, error: "This batch has no created slabs yet." };
  const admin = createAdminSupabaseClient();
  try {
    const rows = await fetchAllPaged<{ id: string; label: string | null; description: string | null; length_ft: number | string; width_ft: number | string; thickness_ft: number | string; status: string }>((from, to) =>
      admin
        .from("slab_requirements")
        .select("id, label, description, length_ft, width_ft, thickness_ft, status")
        .eq("batch_id", id)
        .order("id", { ascending: true })
        .range(from, to),
    );
    return {
      ok: true,
      slabs: rows.map((r) => ({
        id: r.id, label: r.label, description: r.description,
        length: Number(r.length_ft) || 0, width: Number(r.width_ft) || 0, height: Number(r.thickness_ft) || 0,
        status: r.status,
      })),
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not load the slabs." };
  }
}

/** Signed URL to download a batch's stored Excel audit copy. */
export async function getSlabImportFileUrlAction(
  batchId: string,
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  await requireAuth([...new Set([...IMPORT_SUBMIT_ROLES, ...IMPORT_APPROVER_ROLES])]);
  const supabase = createAdminSupabaseClient();
  const { data } = await supabase
    .from("slab_import_batches")
    .select("file_path")
    .eq("id", (batchId ?? "").trim())
    .maybeSingle();
  const path = (data as { file_path?: string | null } | null)?.file_path;
  if (!path) return { ok: false, error: "No file stored for this batch." };
  const { data: signed, error } = await supabase.storage
    .from(IMPORT_FILE_BUCKET)
    .createSignedUrl(path, 600);
  if (error || !signed?.signedUrl) return { ok: false, error: "Couldn't create the download link." };
  return { ok: true, url: signed.signedUrl };
}

// ────────────────────────────────────────────────────────────────────────────
// Slab Labels (reusable dropdown options for the "label" field)
// ────────────────────────────────────────────────────────────────────────────

export async function addSlabLabelAction(name: string): Promise<{ error: string } | undefined> {
  await requireAuth(["owner", "team_head", "senior_incharge", "slab_entry", "block_slab_entry"]);
  const admin = createAdminSupabaseClient();

  const trimmed = name.trim();
  if (!trimmed) return { error: "Label is required" };
  if (trimmed.length > 80) return { error: "Label must be under 80 characters" };

  const { error } = await admin
    .from("slab_labels")
    .insert({ name: trimmed, is_active: true });

  if (error) {
    if (error.code === "23505") return { error: "Label already exists" };
    return { error: error.message };
  }

  revalidatePath("/slabs");
  return undefined;
}

// ────────────────────────────────────────────────────────────────────────────
// Bulk actions — scoped to ONE batch_id at a time, so the UI can never select
// across unrelated slabs. The server re-verifies every target row actually
// shares the batch_id before touching it.
// ────────────────────────────────────────────────────────────────────────────

/** Delete multiple slabs that belong to the SAME batch_id. */
export async function bulkDeleteSlabsAction(formData: FormData) {
  const { profile } = await requireAuth(["owner", "team_head", "senior_incharge", "slab_entry", "block_slab_entry"]);
  const supabase = createAdminSupabaseClient();

  const batchId = text(formData, "batch_id");
  const idsRaw = text(formData, "ids");
  if (!batchId) toast("/slabs", "Missing batch ID");
  if (!idsRaw) toast("/slabs", "No slabs selected");

  let ids: string[];
  try {
    ids = JSON.parse(idsRaw);
    if (!Array.isArray(ids) || ids.some((x) => typeof x !== "string")) throw new Error();
  } catch {
    toast("/slabs", "Invalid selection");
    return;
  }
  if (ids.length === 0) toast("/slabs", "No slabs selected");

  // Server-side guard: every id must belong to the same batch_id, and entry
  // roles can only touch their own slabs.
  const { data: rows, error: readErr } = await supabase
    .from("slab_requirements")
    .select("id, batch_id, created_by")
    .in("id", ids);
  if (readErr) toast("/slabs", readErr.message);
  if (!rows || rows.length !== ids.length) toast("/slabs", "Some slabs no longer exist");

  const ENTRY_ROLES = ["slab_entry", "block_slab_entry"];
  const isEntry = ENTRY_ROLES.includes(profile.role);

  for (const r of rows!) {
    if (r.batch_id !== batchId) {
      toast("/slabs", "Selection crosses batches — refresh and try again");
    }
    if (isEntry && r.created_by !== profile.id) {
      toast("/slabs", "You can only delete slabs you added.");
    }
  }

  const { error: delErr } = await supabase.from("slab_requirements").delete().in("id", ids);
  if (delErr) {
    if (delErr.code === "23503") {
      // At least one is referenced — soft-archive all targets instead.
      await supabase
        .from("slab_requirements")
        .update({ status: "rejected", updated_by: profile.id, updated_at: new Date().toISOString() })
        .in("id", ids);
      await logAudit(profile.id, "archive_bulk", "slab", batchId, { ids, reason: "referenced_bulk_delete" });
      revalidatePath("/slabs");
      toast("/slabs", `${ids.length} slabs were referenced — archived as rejected`);
    }
    toast("/slabs", delErr.message);
  }

  await logAudit(profile.id, "delete_bulk", "slab", batchId, { ids });
  await notify("slab_deleted", `${ids.length} slabs deleted from batch`, {
    entityType: "slab",
    entityId: batchId,
    actorId: profile.id,
  });
  revalidatePath("/slabs");
  revalidatePath("/planning");
  redirect(`/slabs?toast=${ids.length}+slabs+deleted`);
}

/** Bulk-update fields on multiple slabs that share ONE batch_id. */
export async function bulkUpdateSlabsAction(formData: FormData) {
  const { profile } = await requireAuth(["owner", "team_head", "senior_incharge", "slab_entry", "block_slab_entry"]);
  const supabase = createAdminSupabaseClient();

  const batchId = text(formData, "batch_id");
  const idsRaw = text(formData, "ids");
  if (!batchId) toast("/slabs", "Missing batch ID");
  if (!idsRaw) toast("/slabs", "No slabs selected");

  let ids: string[];
  try {
    ids = JSON.parse(idsRaw);
    if (!Array.isArray(ids) || ids.some((x) => typeof x !== "string")) throw new Error();
  } catch {
    toast("/slabs", "Invalid selection");
    return;
  }
  if (ids.length === 0) toast("/slabs", "No slabs selected");

  // Same batch guard + ownership guard as bulkDelete
  const { data: rows, error: readErr } = await supabase
    .from("slab_requirements")
    .select("id, batch_id, created_by")
    .in("id", ids);
  if (readErr) toast("/slabs", readErr.message);
  if (!rows || rows.length !== ids.length) toast("/slabs", "Some slabs no longer exist");

  const ENTRY_ROLES = ["slab_entry", "block_slab_entry"];
  const isEntry = ENTRY_ROLES.includes(profile.role);
  for (const r of rows!) {
    if (r.batch_id !== batchId) toast("/slabs", "Selection crosses batches — refresh and try again");
    if (isEntry && r.created_by !== profile.id) toast("/slabs", "You can only edit slabs you added.");
  }

  // Shared fields — every one applies to every selected row.
  const stone = text(formData, "stone");
  if (!stone) toast("/slabs", "Stone type is required");

  const payload = {
    label: text(formData, "label"),
    description: text(formData, "description") || null,
    temple: text(formData, "temple"),
    stone,
    quality: text(formData, "quality") || null,
    length_ft: num(formData, "length_in"),
    width_ft: num(formData, "width_in"),
    thickness_ft: num(formData, "thickness_in"),
    priority: text(formData, "priority") === "true",
    status: text(formData, "status") || "open",
    updated_by: profile.id,
    updated_at: new Date().toISOString(),
  };

  const { error: upErr } = await supabase.from("slab_requirements").update(payload).in("id", ids);
  if (upErr) toast("/slabs", upErr.message);

  await logAudit(profile.id, "update_bulk", "slab", batchId, { ids, fields: Object.keys(payload) });
  revalidatePath("/slabs");
  revalidatePath("/planning");
  redirect(`/slabs?toast=${ids.length}+slabs+updated`);
}

// ── Admin cleanup — uncategorized open slabs (Daksh June 2026) ──────────
// Soft-archive every OPEN slab of a temple that has NEITHER Category 1 nor
// Category 2 (the bare rows in the Temple View "Unassigned" group). Archive
// = status 'rejected', which the Temple View EXCLUDES entirely (so they do
// NOT show like 'cancelled' does) and is fully recoverable. Export the Excel
// first (the route shares the same fetch). Admin only.
export async function archiveUncategorizedOpenSlabsAction(
  formData: FormData,
): Promise<{ ok: true; count: number } | { ok: false; error: string }> {
  const { profile } = await requireAuth(["owner", "developer", "senior_incharge"]);
  const supabase = createAdminSupabaseClient();

  const temple = text(formData, "temple");
  if (!temple) return { ok: false, error: "Temple is required." };

  const slabs = await fetchUncategorizedOpenSlabs(supabase, temple);
  const ids = slabs.map((s) => s.id);
  if (ids.length === 0) {
    return { ok: false, error: "Nothing to remove — no open, fully-uncategorized slabs for this temple." };
  }

  // Chunked update with a status='open' race guard so anything that advanced
  // since the page loaded is left untouched.
  const now = new Date().toISOString();
  let archived = 0;
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500);
    const { data, error } = await supabase
      .from("slab_requirements")
      .update({ status: "rejected", updated_by: profile.id, updated_at: now })
      .in("id", chunk)
      .eq("status", "open")
      .select("id");
    if (error) return { ok: false, error: error.message };
    archived += (data ?? []).length;
  }

  await logAudit(profile.id, "slabs_archived_uncategorized", "slab", "batch", {
    temple,
    count: archived,
    matched: ids.length,
    first_id: ids[0],
    last_id: ids[ids.length - 1],
  });
  revalidatePath("/temples");
  revalidatePath("/temples/cleanup");
  revalidatePath("/slabs");
  return { ok: true, count: archived };
}
