"use server";

import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { nextSlabCodeFromMaxId } from "./utils";
import { logAudit } from "@/lib/audit";
import { notify } from "@/lib/notifications";
import { verifyBulkImportPassword } from "@/lib/bulk-import-password";


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
export async function importSlabsAction(payload: {
  temple: string;
  stone: string;
  password: string;
  rows: Array<{
    label?: string | null;
    description?: string | null;
    length?: number | string | null;
    width?: number | string | null;
    height?: number | string | null;
    quantity?: number | string | null;
    quality?: string | null;
    priority?: boolean | null;
  }>;
}): Promise<{ ok: true; count: number } | { ok: false; error: string }> {
  const { profile } = await requireAuth([
    "owner",
    "team_head",
    "senior_incharge",
    "slab_entry",
    "developer",
  ]);
  const supabase = createAdminSupabaseClient();

  const temple = (payload?.temple ?? "").trim();
  const stone = (payload?.stone ?? "").trim();
  if (!temple) return { ok: false, error: "Temple is required" };
  if (!stone) return { ok: false, error: "Stone is required" };

  // Password gate — server-side comparison against the stored hash.
  const okPw = await verifyBulkImportPassword(payload?.password ?? "");
  if (!okPw) return { ok: false, error: "Wrong password" };

  const cleaned = (Array.isArray(payload?.rows) ? payload.rows : [])
    .map((r) => ({
      label: (r.label ?? "").toString().trim(),
      description: (r.description ?? "").toString().trim() || null,
      length: Number(r.length) || 0,
      width: Number(r.width) || 0,
      height: Number(r.height) || 0,
      quantity: Math.min(100, Math.max(1, Math.floor(Number(r.quantity) || 1))),
      quality: (r.quality ?? "").toString().trim() || null,
      priority: r.priority === true,
    }))
    // Every slab needs all three dimensions (stored as inches in *_ft).
    .filter((r) => r.length > 0 && r.width > 0 && r.height > 0);
  if (cleaned.length === 0) {
    return { ok: false, error: "No valid rows — each slab needs length, width and height." };
  }

  const totalSlabs = cleaned.reduce((s, r) => s + r.quantity, 0);
  if (totalSlabs > 1000) {
    return { ok: false, error: `Too many slabs in one import (${totalSlabs}). Max 1000 — split the file.` };
  }

  const { data: templeRow } = await supabase
    .from("temples")
    .select("code_prefix")
    .eq("name", temple)
    .single();
  const prefix = (templeRow as { code_prefix?: string } | null)?.code_prefix ?? "SLB";

  // One batch_id for the whole import = the deletable "group".
  const batchId = randomUUID();
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
          temple,
          stone,
          quality: r.quality,
          length_ft: r.length,
          width_ft: r.width,
          thickness_ft: r.height,
          priority: r.priority,
          status: "open",
          batch_id: batchId,
          created_by: profile.id,
          updated_by: profile.id,
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

  await logAudit(profile.id, "import_bulk", "slab", batchId, {
    temple,
    stone,
    rows: cleaned.length,
    slabs: inserted,
    batch_id: batchId,
  });
  revalidatePath("/slabs");
  revalidatePath("/planning");
  return { ok: true, count: inserted };
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
