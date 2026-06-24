"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { generateNextCode } from "./utils";
import { logAudit } from "@/lib/audit";
import { notify } from "@/lib/notifications";
import { ALLOWED_YARDS, isAllowedYard, yardLabel } from "@/lib/yards";


function numValue(formData: FormData, key: string, fallback = 0) {
  const raw = formData.get(key);
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function textValue(formData: FormData, key: string) {
  const raw = formData.get(key);
  return typeof raw === "string" ? raw.trim() : "";
}

function redirectWithToast(path: string, message: string): never {
  redirect(`${path}?toast=${encodeURIComponent(message)}`);
}

export async function addBlockAction(formData: FormData) {
  const { profile } = await requireAuth(["owner", "team_head", "senior_incharge", "block_slab_entry", "block_entry"]);
  const supabase = createAdminSupabaseClient();

  // Explicit high limit so the next-code picker sees every block. Without
  // it, Supabase caps .select() at 1000 rows by default — crossing that
  // threshold would silently make the picker suggest IDs that are already
  // taken and blow up with a pkey violation. 100k row cap is far beyond
  // any realistic block inventory.
  const { data: existingRows } = await supabase.from("blocks").select("id").limit(100000);
  const existingIds = (existingRows ?? []).map(r => r.id);
  const requestedId = textValue(formData, "id");

  const truck_no = textValue(formData, "truck_no") || null;
  const vendor_name = textValue(formData, "vendor_name") || null;
  const bill_no = textValue(formData, "bill_no") || null;
  const existingStock = textValue(formData, "existing_stock") === "1";

  // Logistics are mandatory for fresh stock; the "Existing stock" toggle on the
  // form is the explicit escape hatch for old blocks with no bill/truck record.
  if (!existingStock && !(truck_no && vendor_name && bill_no)) {
    redirectWithToast("/blocks", "Truck No., Vendor and Bill No. are required. Turn on “Existing stock” to add without them.");
  }

  const quality = textValue(formData, "quality") || null;

  const yardRaw = numValue(formData, "yard", 1);
  if (!isAllowedYard(yardRaw)) {
    redirectWithToast(
      "/blocks",
      `Yard ${yardRaw} is not allowed. Please pick one of: ${ALLOWED_YARDS.map(yardLabel).join(", ")}.`,
    );
  }

  // Multi-block: the form posts blocks_json = [{l,w,h}, …]. Fall back to the
  // legacy single length_in/width_in/height_in fields if it's absent.
  type Dim = { l: number; w: number; h: number };
  let dims: Dim[] = [];
  const blocksJson = textValue(formData, "blocks_json");
  if (blocksJson) {
    // New multi-block form. Require at least one fully-dimensioned block — do
    // NOT silently fall back to the legacy single path (that would insert a
    // 0×0×0 junk block if every row was left blank).
    try {
      const arr = JSON.parse(blocksJson) as Array<{ l?: unknown; w?: unknown; h?: unknown }>;
      dims = arr
        .map((d) => ({ l: Number(d.l) || 0, w: Number(d.w) || 0, h: Number(d.h) || 0 }))
        .filter((d) => d.l > 0 && d.w > 0 && d.h > 0);
    } catch {
      dims = [];
    }
    if (dims.length === 0) {
      redirectWithToast("/blocks", "Enter dimensions for at least one block.");
    }
  } else {
    // Legacy single-block fallback (older clients / other callers).
    dims = [{ l: numValue(formData, "length_in", 0), w: numValue(formData, "width_in", 0), h: numValue(formData, "height_in", 0) }];
  }

  const payloadBase = {
    stone: textValue(formData, "stone") || "PinkStone",
    yard: yardRaw,
    category: "Fresh" as const,
    quality,
    status: "available" as const,
    ...(truck_no ? { truck_no } : {}),
    ...(vendor_name ? { vendor_name } : {}),
    ...(bill_no ? { bill_no } : {}),
    created_by: profile.id,
    updated_by: profile.id,
  };

  const idPool = [...existingIds];
  const created: string[] = [];

  for (let i = 0; i < dims.length; i++) {
    // First block honours the operator's typed starting code; the rest are
    // auto-generated so every block gets a distinct id.
    let nextId = i === 0 && requestedId ? requestedId : generateNextCode(idPool);
    let inserted = false;

    for (let attempt = 0; attempt < 6 && !inserted; attempt++) {
      if (idPool.includes(nextId)) nextId = generateNextCode(idPool);
      const { error } = await supabase
        .from("blocks")
        .insert({ ...payloadBase, id: nextId, length_ft: dims[i].l, width_ft: dims[i].w, height_ft: dims[i].h });
      if (!error) {
        inserted = true;
        idPool.push(nextId);
        created.push(nextId);
      } else if (error.code === "23505") {
        idPool.push(nextId);
        nextId = generateNextCode(idPool);
      } else {
        console.error("[addBlockAction] insert failed:", { code: error.code, message: error.message, details: error.details });
        redirectWithToast("/blocks", `Could not add block: ${error.message}`);
      }
    }
    if (!inserted) {
      redirectWithToast("/blocks", created.length ? `Added ${created.length}, then hit a duplicate ID. Refresh and retry the rest.` : "Unable to generate a unique block ID. Please try again.");
    }
  }

  await logAudit(profile.id, "create", "block", created[0], { stone: payloadBase.stone, yard: payloadBase.yard, count: created.length, ids: created });
  await notify("blocks_added", created.length > 1 ? `${created.length} blocks added (${payloadBase.stone})` : `New block ${created[0]} added (${payloadBase.stone})`, {
    message: `${yardLabel(payloadBase.yard)} · ${created.join(", ")}`,
    entityType: "block",
    entityId: created[0],
    actorId: profile.id,
  });
  revalidatePath("/blocks");
  revalidatePath("/dashboard");
  redirect(`/blocks?toast=${encodeURIComponent(created.length > 1 ? `${created.length} blocks added` : "Block added successfully")}`);
}

export async function updateBlockAction(formData: FormData) {
  const { profile } = await requireAuth(["owner", "team_head", "senior_incharge", "block_slab_entry", "block_entry"]);
  const supabase = createAdminSupabaseClient();

  const originalId = textValue(formData, "original_id");
  const nextId = textValue(formData, "id");

  if (!originalId || !nextId) throw new Error("Block ID is required.");

  // Logistics — store empty string as null
  const truck_no = textValue(formData, "truck_no") || null;
  const vendor_name = textValue(formData, "vendor_name") || null;
  const bill_no = textValue(formData, "bill_no") || null;

  const payload = {
    id: nextId,
    stone: textValue(formData, "stone") || "PinkStone",
    yard: numValue(formData, "yard", 1),
    quality: textValue(formData, "quality") || null,
    length_ft: numValue(formData, "length_in", 0),
    width_ft: numValue(formData, "width_in", 0),
    height_ft: numValue(formData, "height_in", 0),
    status: textValue(formData, "status") || "available",
    truck_no,
    vendor_name,
    bill_no,
    updated_by: profile.id,
    updated_at: new Date().toISOString()
  };

  const { error } = await supabase.from("blocks").update(payload).eq("id", originalId);
  if (error) {
    console.error("[updateBlockAction] update failed:", { code: error.code, message: error.message, details: error.details, payload });
    redirectWithToast("/blocks", `Could not update block: ${error.message}`);
  }

  await logAudit(profile.id, "update", "block", originalId, { new_id: nextId, status: payload.status });
  revalidatePath("/blocks");
  revalidatePath("/dashboard");
  redirect("/blocks?toast=Block+updated");
}

export async function addBlockVendorAction(
  name: string
): Promise<{ error: string } | { ok: true; canonicalName: string }> {
  await requireAuth(["owner", "team_head", "senior_incharge", "block_slab_entry", "block_entry"]);
  const admin = createAdminSupabaseClient(); // bypass RLS — vendors write policy is owner-only

  const trimmed = name.trim();
  if (!trimmed) return { error: "Vendor name is required" };

  // Defensive dedup: case + whitespace-insensitive match against existing
  // vendors. If "ANSU MARBLE" already exists and the user types
  // "Ansu Marble", reuse the existing row instead of creating a dupe
  // (which would sneak past the DB unique constraint because the casing
  // differs at the byte level). Mirrors the migration 010 cleanup for
  // brand-new rows going forward.
  const norm = (s: string) => s.replace(/\s+/g, "").toUpperCase();
  const { data: existing } = await admin.from("vendors").select("name");
  const match = (existing ?? []).find((v) => norm(v.name) === norm(trimmed));
  if (match) {
    revalidatePath("/blocks");
    return { ok: true, canonicalName: match.name };
  }

  // Block suppliers are a dedicated vendor_type = 'block_vendor' in prod.
  // Carving vendors use 'CNC' or 'Outsource'. Keeping them separate is what
  // lets the blocks page dropdown show only actual stone suppliers,
  // not carving workshops.
  const { error } = await admin
    .from("vendors")
    .insert({ name: trimmed, vendor_type: "block_vendor", is_active: true });

  if (error) {
    if (error.code === "23505") return { error: "Vendor already exists" };
    return { error: error.message };
  }

  revalidatePath("/blocks");
  return { ok: true, canonicalName: trimmed };
}

export async function deleteBlockAction(formData: FormData) {
  const { profile } = await requireAuth(["owner", "team_head", "senior_incharge", "block_slab_entry", "block_entry"]);
  const supabase = createAdminSupabaseClient();

  const id = textValue(formData, "delete_target_id") || textValue(formData, "id");

  if (!id) redirectWithToast("/blocks", "Block ID is missing");

  // Entry roles can only delete blocks they personally added
  const ENTRY_ROLES = ["block_entry", "block_slab_entry"];
  if (ENTRY_ROLES.includes(profile.role)) {
    const { data: block } = await supabase.from("blocks").select("created_by").eq("id", id).single();
    if (block?.created_by !== profile.id) {
      redirectWithToast("/blocks", "You can only delete blocks you added.");
    }
  }

  // Always soft-delete: mark as discarded so the block stays in history/export
  const { error } = await supabase
    .from("blocks")
    .update({ status: "discarded", updated_by: profile.id, updated_at: new Date().toISOString() })
    .eq("id", id);

  if (error) redirectWithToast("/blocks", error.message);

  await logAudit(profile.id, "delete", "block", id, { status: "discarded" });
  await notify("block_deleted", `Block ${id} archived/deleted`, {
    entityType: "block",
    entityId: id,
    actorId: profile.id,
  });
  revalidatePath("/blocks");
  revalidatePath("/dashboard");
  redirectWithToast("/blocks", "Block removed and archived in history");
}

export async function manualCutBlockAction(formData: FormData) {
  const { profile } = await requireAuth(["owner", "team_head", "senior_incharge", "cutting_operator"]);
  const supabase = createAdminSupabaseClient();

  const blockId = textValue(formData, "block_id");
  const stone = textValue(formData, "stone") || "PinkStone";
  const yard = numValue(formData, "yard", 1);
  const slabIds = JSON.parse(String(formData.get("slab_ids") || "[]")) as string[];
  const remainders = JSON.parse(String(formData.get("remainders_json") || "[]")) as Array<{ id: string; l: number; w: number; h: number }>;
  const restock = String(formData.get("restock") || "") === "yes";
  // Daksh May 2026 — where are the cut slabs being placed (e.g.
  // "Yard 4", "Shade B rack 12"). Mirrors what the formal cutting
  // flow's finish_block_cut RPC captures (mig 020). Required so the
  // labels print sheet + the AI lookup can answer "where is this
  // slab now". Trimmed; capped to 100 chars to match column.
  const stockLocation = textValue(formData, "stock_location").slice(0, 100);

  if (!blockId || slabIds.length === 0) {
    throw new Error("Block and at least one slab are required.");
  }
  if (!stockLocation) {
    throw new Error(
      "Stock location is required — tell us where the cut slabs are being placed (Yard / rack / shade).",
    );
  }

  // 1. Consume block (race-condition guard: only if still available)
  const blockUpdate = await supabase
    .from("blocks")
    .update({ status: "consumed", updated_by: profile.id, updated_at: new Date().toISOString() })
    .eq("id", blockId)
    .eq("status", "available")
    .select("id");
  if (blockUpdate.error) throw new Error(blockUpdate.error.message);
  if (!blockUpdate.data?.length) {
    throw new Error(`Block ${blockId} is no longer available — refresh and try again.`);
  }

  // 2. Mark slabs cut_done (race-condition guard: only if still open)
  //    + stamp the stock_location so the labels print + Find ID work.
  const slabUpdate = await supabase
    .from("slab_requirements")
    .update({
      status: "cut_done",
      source_block_id: blockId,
      stock_location: stockLocation,
      updated_by: profile.id,
      updated_at: new Date().toISOString(),
    })
    .in("id", slabIds)
    .eq("status", "open")
    .select("id");
  if (slabUpdate.error) throw new Error(slabUpdate.error.message);
  if ((slabUpdate.data?.length ?? 0) !== slabIds.length) {
    // Roll back block status so it isn't orphaned
    await supabase.from("blocks").update({ status: "available", updated_by: profile.id, updated_at: new Date().toISOString() }).eq("id", blockId);
    throw new Error("One or more slabs were already taken. Refresh and try again.");
  }

  // 3. Optional remainder restock
  const restockedIds: string[] = [];
  if (restock && remainders.length > 0) {
    for (const piece of remainders) {
      if (piece.l > 0 && piece.w > 0 && piece.h > 0) {
        const { error } = await supabase.from("blocks").insert({
          id: piece.id,
          stone,
          yard,
          category: "Reused",
          length_ft: piece.l,
          width_ft: piece.w,
          height_ft: piece.h,
          status: "available",
          created_by: profile.id,
          updated_by: profile.id,
        });
        if (error) throw new Error(`Failed to create block ${piece.id}: ${error.message}`);
        restockedIds.push(piece.id);
      }
    }
  }

  // 4. Audit
  await logAudit(profile.id, "manual_cut_block", "block", blockId, {
    slabs: slabIds,
    restocked_blocks: restockedIds,
    restock,
    stock_location: stockLocation,
  });

  // 5. Revalidate
  revalidatePath("/blocks");
  revalidatePath("/slabs");
  revalidatePath("/slabs/ready");
  revalidatePath("/slabs/ready/for-carving");
  revalidatePath("/planning");
  revalidatePath("/cutting");
  revalidatePath("/dashboard");
  // Mig 076 round 3 — Block Journey shows per-block yield. After
  // a manual cut it needs to recompute or the card still reads
  // "0.00 CFT yield" until the cache TTL elapses. Daksh flagged
  // this exact symptom on MT-B-387 with 7 ROHTAK slabs cut.
  revalidatePath("/block-journey");
}

/**
 * Undo a marble block cut — restore the block to "available" and put
 * its linked slabs back into the "open" pool with source_block_id
 * cleared. Used by the Marble Cutting Log undo button.
 *
 * Refuses if any linked slab is already dispatched / completed
 * (those have left the building — undoing would orphan downstream
 * records). Cleans up any stray cut_session_blocks rows in case the
 * block went through the formal cutting flow.
 *
 * Auth: developer / owner / team_head only.
 */
export async function undoMarbleCutAction(
  blockId: string,
): Promise<{ success?: boolean; error?: string; resetSlabCount?: number }> {
  const { profile } = await requireAuth(["owner", "team_head", "senior_incharge", "developer"]);
  const supabase = createAdminSupabaseClient();

  if (!blockId || typeof blockId !== "string") {
    return { error: "Missing block id." };
  }

  // 1. Confirm the block exists and snapshot prior state for audit
  const { data: block, error: blockReadErr } = await supabase
    .from("blocks")
    .select("id, status, stone, category")
    .eq("id", blockId)
    .single();
  if (blockReadErr || !block) {
    return { error: `Block ${blockId} not found.` };
  }

  // 2. Find every slab linked to this block
  const { data: slabs, error: slabReadErr } = await supabase
    .from("slab_requirements")
    .select("id, status, label")
    .eq("source_block_id", blockId);
  if (slabReadErr) {
    return { error: `Could not read linked slabs: ${slabReadErr.message}` };
  }
  const linkedSlabs = slabs ?? [];

  // 3. Safety: if any slab is already dispatched or completed, refuse.
  // Those have moved past cutting and undoing them would orphan
  // downstream records.
  const lockedStatuses = new Set(["dispatched", "completed"]);
  const locked = linkedSlabs.filter((s) => lockedStatuses.has(s.status));
  if (locked.length > 0) {
    return {
      error: `Cannot undo — ${locked.length} slab(s) already ${locked[0].status}: ${locked
        .map((s) => s.id)
        .slice(0, 5)
        .join(", ")}${locked.length > 5 ? "…" : ""}. Resolve those records first.`,
    };
  }

  // 4. Reset slabs → open, clear source_block_id
  if (linkedSlabs.length > 0) {
    const { error } = await supabase
      .from("slab_requirements")
      .update({
        status: "open",
        source_block_id: null,
        updated_by: profile.id,
        updated_at: new Date().toISOString(),
      })
      .eq("source_block_id", blockId);
    if (error) {
      return { error: `Failed to reset slabs: ${error.message}` };
    }
  }

  // 5. Reset block → available
  const { error: blockUpdateErr } = await supabase
    .from("blocks")
    .update({
      status: "available",
      updated_by: profile.id,
      updated_at: new Date().toISOString(),
    })
    .eq("id", blockId);
  if (blockUpdateErr) {
    return { error: `Failed to reset block: ${blockUpdateErr.message}` };
  }

  // 6. Clear any cut_session_blocks rows for this block (in case the
  // block also went through the formal cut-session flow). Best-effort
  // — failure here doesn't block the undo.
  await supabase.from("cut_session_blocks").delete().eq("block_id", blockId);

  // 7. Audit
  await logAudit(profile.id, "undo_manual_cut", "block", blockId, {
    prior_block_status: block.status,
    slab_ids: linkedSlabs.map((s) => s.id),
    slab_count: linkedSlabs.length,
    reset_to: { block: "available", slabs: "open" },
  });

  revalidatePath("/blocks");
  revalidatePath("/slabs");
  revalidatePath("/planning");
  revalidatePath("/cutting");
  revalidatePath("/dashboard");
  revalidatePath("/block-journey");

  return { success: true, resetSlabCount: linkedSlabs.length };
}
