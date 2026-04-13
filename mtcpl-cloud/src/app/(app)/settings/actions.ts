"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";

function text(fd: FormData, key: string) {
  const v = fd.get(key);
  return typeof v === "string" ? v.trim() : "";
}

export async function addTempleAction(formData: FormData) {
  await requireAuth(["owner", "planner"]);
  const supabase = await createServerSupabaseClient();

  const name = text(formData, "name");
  const code_prefix = text(formData, "code_prefix").toUpperCase();

  if (!name || !code_prefix) redirect("/settings?toast=Name+and+prefix+required");

  const { error } = await supabase.from("temples").insert({ name, code_prefix });
  if (error) redirect(`/settings?toast=${encodeURIComponent(error.message)}`);

  revalidatePath("/settings");
  revalidatePath("/slabs");
  redirect("/settings?toast=Temple+added");
}

export async function updateTempleAction(formData: FormData) {
  await requireAuth(["owner", "planner"]);
  const supabase = await createServerSupabaseClient();

  const id = text(formData, "id");
  const name = text(formData, "name");
  const code_prefix = text(formData, "code_prefix").toUpperCase();
  const is_active = formData.get("is_active") === "true";

  if (!id) redirect("/settings?toast=Missing+ID");

  const { error } = await supabase.from("temples").update({ name, code_prefix, is_active }).eq("id", id);
  if (error) redirect(`/settings?toast=${encodeURIComponent(error.message)}`);

  revalidatePath("/settings");
  revalidatePath("/slabs");
  redirect("/settings?toast=Temple+updated");
}

export async function deleteTempleAction(formData: FormData) {
  await requireAuth(["owner", "planner"]);
  const supabase = await createServerSupabaseClient();

  const id = text(formData, "id");
  const { error } = await supabase.from("temples").delete().eq("id", id);
  if (error) redirect(`/settings?toast=${encodeURIComponent(error.message)}`);

  revalidatePath("/settings");
  redirect("/settings?toast=Temple+deleted");
}

export async function updateUserAction(formData: FormData) {
  const { profile: currentUser } = await requireAuth(["owner", "planner", "developer"]);
  const admin = createAdminSupabaseClient();

  const id = text(formData, "id");
  const requestedRole = text(formData, "role") || "block_entry";
  const full_name = text(formData, "full_name") || null;
  const is_active = formData.get("is_active") === "true";

  if (!id) redirect("/settings?toast=Missing+fields");
  if (id === currentUser.id) redirect("/settings?toast=Cannot+edit+your+own+account");

  // Developer accounts are protected — nobody can edit them
  const { data: target } = await admin.from("profiles").select("role").eq("id", id).single();
  if (target?.role === "developer") redirect("/settings?toast=Developer+account+is+protected");

  // Role assignment rules:
  // - Developer: can assign any role
  // - Planner: can assign planner/block_entry/worker only (not owner or developer)
  // - Owner: cannot change roles
  const PLANNER_ASSIGNABLE = ["planner", "block_entry", "slab_entry", "worker"];
  let role = requestedRole;
  if (currentUser.role === "owner") {
    // Owner cannot change roles — keep existing role
    role = target?.role ?? requestedRole;
  } else if (currentUser.role === "planner") {
    if (!PLANNER_ASSIGNABLE.includes(requestedRole)) {
      redirect("/settings?toast=Team+Head+cannot+assign+that+role");
    }
  }
  // developer: no restriction

  const { error } = await admin
    .from("profiles")
    .update({ role, is_active, ...(full_name !== null ? { full_name } : {}) })
    .eq("id", id);
  if (error) redirect(`/settings?toast=${encodeURIComponent(error.message)}`);

  revalidatePath("/settings");
  redirect("/settings?toast=User+updated");
}

export async function deleteUserAction(formData: FormData) {
  const { profile: currentUser } = await requireAuth(["owner"]);
  // Use admin client to bypass RLS when editing other users' profiles
  const admin = createAdminSupabaseClient();

  const id = text(formData, "id");
  if (!id) redirect("/settings?toast=Missing+ID");
  if (id === currentUser.id) redirect("/settings?toast=Cannot+remove+your+own+account");

  // Developer accounts are protected — nobody can deactivate them
  const { data: target } = await admin.from("profiles").select("role").eq("id", id).single();
  if (target?.role === "developer") redirect("/settings?toast=Developer+account+is+protected");

  // Soft-delete: mark inactive so they can't log in but data history is preserved
  const { error } = await admin.from("profiles").update({ is_active: false }).eq("id", id);
  if (error) redirect(`/settings?toast=${encodeURIComponent(error.message)}`);

  revalidatePath("/settings");
  redirect("/settings?toast=User+deactivated");
}
