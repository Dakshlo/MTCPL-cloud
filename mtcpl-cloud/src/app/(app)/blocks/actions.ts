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
  const { profile } = await requireAuth(["owner", "team_head", "block_slab_entry", "block_entry"]);
  const supabase = createAdminSupabaseClient();

  const { data: existingRows } = await supabase.from("blocks").select("id");
  const existingIds = (existingRows ?? []).map(r => r.id);
  const requestedId = textValue(formData, "id");

  const truck_no = textValue(formData, "truck_no") || null;
  const vendor_name = textValue(formData, "vendor_name") || null;
  const bill_no = textValue(formData, "bill_no") || null;

  const quality = textValue(formData, "quality") || null;

  const yardRaw = numValue(formData, "yard", 1);
  if (!isAllowedYard(yardRaw)) {
    redirectWithToast(
      "/blocks",
      `Yard ${yardRaw} is not allowed. Please pick one of: ${ALLOWED_YARDS.map(yardLabel).join(", ")}.`,
    );
  }

  const payload = {
    stone: textValue(formData, "stone") || "PinkStone",
    yard: yardRaw,
    category: "Fresh" as const,
    quality,
    length_ft: numValue(formData, "length_in", 0),
    width_ft: numValue(formData, "width_in", 0),
    height_ft: numValue(formData, "height_in", 0),
    status: "available" as const,
    ...(truck_no ? { truck_no } : {}),
    ...(vendor_name ? { vendor_name } : {}),
    ...(bill_no ? { bill_no } : {}),
    created_by: profile.id,
    updated_by: profile.id
  };

  let nextId = requestedId || generateNextCode(existingIds);
  let attempt = 0;
  let lastError: string | null = null;

  while (attempt < 5) {
    if (existingIds.includes(nextId)) {
      nextId = generateNextCode([...existingIds, nextId]);
    }

    const { error } = await supabase.from("blocks").insert({ ...payload, id: nextId });

    if (!error) {
      await logAudit(profile.id, "create", "block", nextId, { stone: payload.stone, yard: payload.yard, status: payload.status });
      await notify("blocks_added", `New block ${nextId} added (${payload.stone})`, {
        message: `${yardLabel(payload.yard)} · ${payload.length_ft}" × ${payload.width_ft}" × ${payload.height_ft}"`,
        entityType: "block",
        entityId: nextId,
        actorId: profile.id,
      });
      revalidatePath("/blocks");
      revalidatePath("/dashboard");
      redirect("/blocks?toast=Block+added+successfully");
    }

    lastError = error.message;
    // Duplicate-ID (unique-constraint): auto-retry with next generated code
    if (error.code === "23505") {
      existingIds.push(nextId);
      nextId = generateNextCode(existingIds);
      attempt++;
      continue;
    }
    // Any other error: surface the real message to the user via toast
    console.error("[addBlockAction] insert failed:", { code: error.code, message: error.message, details: error.details, payload });
    redirectWithToast("/blocks", `Could not add block: ${error.message}`);
  }

  redirectWithToast("/blocks", lastError || "Unable to generate a unique block ID. Please try again.");
}

export async function updateBlockAction(formData: FormData) {
  const { profile } = await requireAuth(["owner", "team_head", "block_slab_entry", "block_entry"]);
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

export async function addBlockVendorAction(name: string): Promise<{ error: string } | undefined> {
  await requireAuth(["owner", "team_head", "block_slab_entry", "block_entry"]);
  const admin = createAdminSupabaseClient(); // bypass RLS — vendors write policy is owner-only

  const trimmed = name.trim();
  if (!trimmed) return { error: "Vendor name is required" };

  // vendor_type enum accepts 'CNC' | 'Manual' | 'Outsource'. Block suppliers
  // don't have a dedicated type yet, so save them as 'Outsource' (jobwork)
  // — the blocks page now shows all active vendors regardless of type.
  const { error } = await admin
    .from("vendors")
    .insert({ name: trimmed, vendor_type: "Outsource", is_active: true });

  if (error) {
    if (error.code === "23505") return { error: "Vendor already exists" };
    return { error: error.message };
  }

  revalidatePath("/blocks");
  return undefined;
}

export async function deleteBlockAction(formData: FormData) {
  const { profile } = await requireAuth(["owner", "team_head", "block_slab_entry", "block_entry"]);
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
  const { profile } = await requireAuth(["owner", "team_head", "cutting_operator"]);
  const supabase = createAdminSupabaseClient();

  const blockId = textValue(formData, "block_id");
  const stone = textValue(formData, "stone") || "PinkStone";
  const yard = numValue(formData, "yard", 1);
  const slabIds = JSON.parse(String(formData.get("slab_ids") || "[]")) as string[];
  const remainders = JSON.parse(String(formData.get("remainders_json") || "[]")) as Array<{ id: string; l: number; w: number; h: number }>;
  const restock = String(formData.get("restock") || "") === "yes";

  if (!blockId || slabIds.length === 0) {
    throw new Error("Block and at least one slab are required.");
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
  const slabUpdate = await supabase
    .from("slab_requirements")
    .update({
      status: "cut_done",
      source_block_id: blockId,
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
  });

  // 5. Revalidate
  revalidatePath("/blocks");
  revalidatePath("/slabs");
  revalidatePath("/planning");
  revalidatePath("/cutting");
  revalidatePath("/dashboard");
}
