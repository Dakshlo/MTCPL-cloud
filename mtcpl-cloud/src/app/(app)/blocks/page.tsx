import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { BlocksManager } from "@/components/blocks-manager";
import { requireAuth } from "@/lib/auth";
import type { Stone } from "@/lib/types";
import { createServerSupabaseClient } from "@/lib/supabase/server";

const BLOCK_DELETE_CODE = process.env.BLOCK_DELETE_CODE || "1255";
const LEGACY_DELETE_CODES = ["1255", "MTCPL-DELETE"];

function textValue(formData: FormData, key: string) {
  const raw = formData.get(key);
  return typeof raw === "string" ? raw.trim() : "";
}

function numValue(formData: FormData, key: string, fallback = 0) {
  const parsed = Number(formData.get(key));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function inchesToFeet(value: number) {
  return Math.round((value / 12) * 100) / 100;
}

function currentMonthPrefix() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  return `BLK-${year}${month}-`;
}

function nextCode(ids: string[]) {
  const prefix = currentMonthPrefix();
  const maxForMonth = ids.reduce((highest, id) => {
    const match = String(id).match(/^BLK-(\d{6})-(\d{4})$/);
    if (!match || `${prefix}` !== `BLK-${match[1]}-`) return highest;
    return Math.max(highest, Number(match[2]));
  }, 0);

  return `${prefix}${String(maxForMonth + 1).padStart(4, "0")}`;
}

function redirectWithToast(path: string, message: string) {
  redirect(`${path}?toast=${encodeURIComponent(message)}`);
}

async function addBlockAction(formData: FormData) {
  "use server";

  const { profile } = await requireAuth(["owner", "planner", "block_entry"]);
  const supabase = await createServerSupabaseClient();
  const { data: existingRows } = await supabase.from("blocks").select("id");
  const existingIds = (existingRows ?? []).map((row) => row.id);
  const requestedId = textValue(formData, "id");

  const payload = {
    stone: (textValue(formData, "stone") || "PinkStone") as Stone,
    yard: numValue(formData, "yard", 1),
    category: textValue(formData, "category") || "Fresh",
    length_ft: inchesToFeet(numValue(formData, "length_in", 0)),
    width_ft: inchesToFeet(numValue(formData, "width_in", 0)),
    height_ft: inchesToFeet(numValue(formData, "height_in", 0)),
    status: textValue(formData, "status") || "available",
    created_by: profile.id,
    updated_by: profile.id
  };

  const id = !requestedId || existingIds.includes(requestedId) ? nextCode(existingIds) : requestedId;
  const { error } = await supabase.from("blocks").insert({ ...payload, id });

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath("/blocks");
  revalidatePath("/dashboard");
  redirectWithToast("/blocks", "Block added successfully");
}

async function updateBlockAction(formData: FormData) {
  "use server";

  const { profile } = await requireAuth(["owner", "planner", "block_entry"]);
  const supabase = await createServerSupabaseClient();

  const originalId = textValue(formData, "original_id");
  const nextId = textValue(formData, "id");

  if (!originalId || !nextId) {
    throw new Error("Block code is required.");
  }

  const payload = {
    id: nextId,
    stone: (textValue(formData, "stone") || "PinkStone") as Stone,
    yard: numValue(formData, "yard", 1),
    category: textValue(formData, "category") || "Fresh",
    length_ft: inchesToFeet(numValue(formData, "length_in", 0)),
    width_ft: inchesToFeet(numValue(formData, "width_in", 0)),
    height_ft: inchesToFeet(numValue(formData, "height_in", 0)),
    status: textValue(formData, "status") || "available",
    updated_by: profile.id,
    updated_at: new Date().toISOString()
  };

  const { error } = await supabase.from("blocks").update(payload).eq("id", originalId);
  if (error) {
    throw new Error(error.message);
  }

  revalidatePath("/blocks");
  revalidatePath("/dashboard");
  redirectWithToast("/blocks", "Block updated");
}

async function deleteBlockAction(formData: FormData) {
  "use server";

  const { profile } = await requireAuth(["owner", "planner", "block_entry"]);
  const supabase = await createServerSupabaseClient();
  const id = textValue(formData, "delete_target_id");
  const deleteCode = textValue(formData, "delete_code");

  if (![BLOCK_DELETE_CODE, ...LEGACY_DELETE_CODES].includes(deleteCode)) {
    redirectWithToast("/blocks", "Delete code is incorrect. Block was not deleted.");
  }

  const { error } = await supabase.from("blocks").delete().eq("id", id);
  if (error) {
    if (error.code === "23503") {
      const archive = await supabase
        .from("blocks")
        .update({
          status: "discarded",
          updated_by: profile.id,
          updated_at: new Date().toISOString()
        })
        .eq("id", id);

      if (archive.error) {
        throw new Error(archive.error.message);
      }

      revalidatePath("/blocks");
      revalidatePath("/dashboard");
      redirectWithToast("/blocks", "Block was referenced and has been archived");
    }

    throw new Error(error.message);
  }

  revalidatePath("/blocks");
  revalidatePath("/dashboard");
  redirectWithToast("/blocks", "Block deleted");
}

export default async function BlocksPage() {
  await requireAuth(["owner", "planner", "block_entry"]);
  const supabase = await createServerSupabaseClient();

  const [{ data: blocks, error }, { data: allIds }] = await Promise.all([
    supabase
      .from("blocks")
      .select("id, stone, yard, category, length_ft, width_ft, height_ft, status, created_at")
      .order("created_at", { ascending: false })
      .limit(300),
    supabase.from("blocks").select("id")
  ]);

  if (error) {
    throw new Error(error.message);
  }

  return (
    <BlocksManager
      addAction={addBlockAction}
      blocks={(blocks ?? []) as any}
      deleteAction={deleteBlockAction}
      suggestedId={nextCode((allIds ?? []).map((row) => row.id))}
      updateAction={updateBlockAction}
    />
  );
}
