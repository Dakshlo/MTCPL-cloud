"use server";

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

  const { data: existing } = await supabase.from("slab_requirements").select("id");
  const existingIds = (existing ?? []).map(r => r.id);
  const baseId = generateSlabCode(existingIds, prefix);

  const stone = text(formData, "stone");
  if (!stone) toast("/slabs", "Stone type is required");

  const common = {
    label: text(formData, "label") || temple,
    temple,
    stone,
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

  await logAudit(profile.id, "create", "slab", baseId, { temple, qty, stone: common.stone });
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
  const { profile } = await requireAuth(["owner", "team_head", "slab_entry"]);
  const supabase = createAdminSupabaseClient();

  const id = text(formData, "id");

  if (!id) toast("/slabs", "Missing ID");

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
