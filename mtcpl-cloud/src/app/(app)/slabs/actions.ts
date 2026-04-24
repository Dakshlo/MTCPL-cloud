"use server";

import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { generateSlabCode } from "./utils";
import { logAudit } from "@/lib/audit";
import { notify } from "@/lib/notifications";


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
  const { profile } = await requireAuth(["owner", "team_head", "slab_entry"]);
  const supabase = createAdminSupabaseClient();

  const temple = text(formData, "temple");
  if (!temple) toast("/slabs", "Temple is required");

  const qty = Math.min(50, Math.max(1, parseInt(text(formData, "quantity") || "1", 10)));

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

  // Insert with collision retry. generateSlabCode uses MAX(existing)+1
  // which is normally bulletproof — but it can collide when:
  //   (a) another user simultaneously submits (race), OR
  //   (b) a manually-inserted row has an id the parser skipped, OR
  //   (c) two temples share a code_prefix and the snapshot is stale.
  // Rather than failing with a cryptic "duplicate key" toast, refetch
  // and recompute up to 5 times — each attempt is cheap and converges
  // in one extra hop for any realistic collision.
  let baseId = "";
  let lastError: { message: string; code?: string } | null = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    // Explicit high limit — Supabase's default .select() cap is 1000,
    // which silently truncates once total slab count crosses that. A
    // truncated existingIds list means generateSlabCode computes a
    // MAX that's lower than reality → picks a baseId that's already
    // taken. Root cause of the "duplicate key" error we're retrying
    // around; this prevents the retry from ever being needed for
    // this reason.
    const { data: existing } = await supabase
      .from("slab_requirements")
      .select("id")
      .limit(100000);
    const existingIds = (existing ?? []).map((r) => r.id);
    baseId = generateSlabCode(existingIds, prefix);

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
    // Non-dup errors are real — bail immediately with the original message.
    if (error.code !== "23505") break;
    // 23505 = primary-key collision. Loop will refetch and try again.
  }
  if (lastError) toast("/slabs", lastError.message);

  await logAudit(profile.id, "create", "slab", baseId, { temple, qty, stone: common.stone, batch_id: batchId });
  revalidatePath("/slabs");
  revalidatePath("/planning");
  redirect(`/slabs?toast=${qty > 1 ? `${qty}+slabs+added` : "Slab+added"}`);
}

export async function updateSlabAction(formData: FormData) {
  const { profile } = await requireAuth(["owner", "team_head", "slab_entry"]);
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
  const { profile } = await requireAuth(["owner", "team_head", "slab_entry", "block_slab_entry"]);
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
// Slab Labels (reusable dropdown options for the "label" field)
// ────────────────────────────────────────────────────────────────────────────

export async function addSlabLabelAction(name: string): Promise<{ error: string } | undefined> {
  await requireAuth(["owner", "team_head", "slab_entry", "block_slab_entry"]);
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
  const { profile } = await requireAuth(["owner", "team_head", "slab_entry", "block_slab_entry"]);
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
  const { profile } = await requireAuth(["owner", "team_head", "slab_entry", "block_slab_entry"]);
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
