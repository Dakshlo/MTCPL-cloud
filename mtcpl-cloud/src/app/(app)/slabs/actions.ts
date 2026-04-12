"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { generateSlabCode } from "./utils";

const SLAB_DELETE_CODE = process.env.BLOCK_DELETE_CODE || "1255";

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
  const { profile } = await requireAuth(["owner", "planner", "slab_entry"]);
  const supabase = await createServerSupabaseClient();

  const temple = text(formData, "temple");
  if (!temple) toast("/slabs", "Temple is required");

  const qty = Math.min(50, Math.max(1, parseInt(text(formData, "quantity") || "1", 10)));

  // Get prefix from temples table
  const { data: templeRow } = await supabase.from("temples").select("code_prefix").eq("name", temple).single();
  const prefix = templeRow?.code_prefix ?? "SLB";

  const { data: existing } = await supabase.from("slab_requirements").select("id");
  const existingIds = (existing ?? []).map(r => r.id);
  const baseId = generateSlabCode(existingIds, prefix);

  const common = {
    label: text(formData, "label") || temple,
    temple,
    stone: text(formData, "stone") || null,
    quality: text(formData, "quality") || null,
    length_ft: num(formData, "length_in"),
    width_ft: num(formData, "width_in"),
    thickness_ft: num(formData, "thickness_in"),
    priority: text(formData, "priority") === "true",
    status: "open" as const,
    created_by: profile.id,
    updated_by: profile.id,
  };

  // Build all rows: first gets base code (e.g. RM-0021), rest get RM-0021-1, RM-0021-2…
  const rows = Array.from({ length: qty }, (_, i) => ({
    ...common,
    id: i === 0 ? baseId : `${baseId}-${i}`,
  }));

  const { error } = await supabase.from("slab_requirements").insert(rows);
  if (error) toast("/slabs", error.message);

  revalidatePath("/slabs");
  revalidatePath("/planning");
  redirect(`/slabs?toast=${qty > 1 ? `${qty}+slabs+added` : "Slab+added"}`);
}

export async function updateSlabAction(formData: FormData) {
  const { profile } = await requireAuth(["owner", "planner", "slab_entry"]);
  const supabase = await createServerSupabaseClient();

  const id = text(formData, "id");
  if (!id) toast("/slabs", "Missing slab ID");

  const payload = {
    label: text(formData, "label"),
    temple: text(formData, "temple"),
    stone: text(formData, "stone") || null,
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

  revalidatePath("/slabs");
  revalidatePath("/planning");
  redirect("/slabs?toast=Slab+updated");
}

export async function deleteSlabAction(formData: FormData) {
  const { profile } = await requireAuth(["owner", "planner", "slab_entry"]);
  const supabase = await createServerSupabaseClient();

  const id = text(formData, "id");
  const code = text(formData, "delete_code");

  if (!id) toast("/slabs", "Missing ID");
  if (code !== SLAB_DELETE_CODE) toast("/slabs", "Incorrect delete code");

  const { error } = await supabase.from("slab_requirements").delete().eq("id", id);
  if (error) {
    if (error.code === "23503") {
      await supabase.from("slab_requirements").update({ status: "rejected", updated_by: profile.id }).eq("id", id);
      revalidatePath("/slabs");
      toast("/slabs", "Slab was referenced — archived as rejected");
    }
    toast("/slabs", error.message);
  }

  revalidatePath("/slabs");
  redirect("/slabs?toast=Slab+deleted");
}
