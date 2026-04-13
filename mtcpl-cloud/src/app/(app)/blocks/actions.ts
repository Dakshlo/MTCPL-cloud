"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireAuth } from "@/lib/auth";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { generateNextCode } from "./utils";
import { logAudit } from "@/lib/audit";


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
  const supabase = await createServerSupabaseClient();

  const { data: existingRows } = await supabase.from("blocks").select("id");
  const existingIds = (existingRows ?? []).map(r => r.id);
  const requestedId = textValue(formData, "id");

  const truck_no = textValue(formData, "truck_no") || null;
  const vendor_name = textValue(formData, "vendor_name") || null;
  const bill_no = textValue(formData, "bill_no") || null;

  const quality = textValue(formData, "quality") || null;

  const payload = {
    stone: textValue(formData, "stone") || "PinkStone",
    yard: numValue(formData, "yard", 1),
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
      revalidatePath("/blocks");
      revalidatePath("/dashboard");
      redirect("/blocks?toast=Block+added+successfully");
    }

    lastError = error.message;
    if (error.code !== "23505") throw new Error(error.message);

    existingIds.push(nextId);
    nextId = generateNextCode(existingIds);
    attempt++;
  }

  throw new Error(lastError || "Unable to generate a unique block ID. Please try again.");
}

export async function updateBlockAction(formData: FormData) {
  const { profile } = await requireAuth(["owner", "team_head", "block_slab_entry", "block_entry"]);
  const supabase = await createServerSupabaseClient();

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
  if (error) throw new Error(error.message);

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

  const { error } = await admin
    .from("vendors")
    .insert({ name: trimmed, vendor_type: "block_vendor", is_active: true });

  if (error) {
    if (error.code === "23505") return { error: "Vendor already exists" };
    return { error: error.message };
  }

  revalidatePath("/blocks");
  return undefined;
}

export async function deleteBlockAction(formData: FormData) {
  const { profile } = await requireAuth(["owner", "team_head", "block_slab_entry", "block_entry"]);
  const supabase = await createServerSupabaseClient();

  const id = textValue(formData, "delete_target_id") || textValue(formData, "id");

  if (!id) redirectWithToast("/blocks", "Block ID is missing");

  // Always soft-delete: mark as discarded so the block stays in history/export
  const { error } = await supabase
    .from("blocks")
    .update({ status: "discarded", updated_by: profile.id, updated_at: new Date().toISOString() })
    .eq("id", id);

  if (error) redirectWithToast("/blocks", error.message);

  await logAudit(profile.id, "delete", "block", id, { status: "discarded" });
  revalidatePath("/blocks");
  revalidatePath("/dashboard");
  redirectWithToast("/blocks", "Block removed and archived in history");
}
