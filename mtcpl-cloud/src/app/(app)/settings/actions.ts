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
  const { profile: currentUser } = await requireAuth(["owner"]);

  const id = text(formData, "id");
  const role = text(formData, "role") || "block_entry";
  const full_name = text(formData, "full_name") || null;
  const is_active = formData.get("is_active") === "true";

  if (!id) redirect("/settings?toast=Missing+fields");
  if (id === currentUser.id) redirect("/settings?toast=Cannot+edit+your+own+account");

  // Use admin client to bypass RLS — owner operations should never be blocked by policies
  let admin;
  try {
    admin = createAdminSupabaseClient();
  } catch {
    redirect("/settings?toast=" + encodeURIComponent("Service role key not configured — add SUPABASE_SERVICE_ROLE_KEY to environment variables."));
  }

  const { error } = await admin
    .from("profiles")
    .update({ role, is_active, ...(full_name !== null ? { full_name } : {}) })
    .eq("id", id);

  if (error) redirect(`/settings?toast=${encodeURIComponent(error.message)}`);

  revalidatePath("/settings");
  revalidatePath("/");
  redirect("/settings?toast=User+updated");
}

export async function deleteUserAction(formData: FormData) {
  const { profile: currentUser } = await requireAuth(["owner"]);

  const id = text(formData, "id");
  if (!id) redirect("/settings?toast=Missing+ID");
  if (id === currentUser.id) redirect("/settings?toast=Cannot+remove+your+own+account");

  let admin;
  try {
    admin = createAdminSupabaseClient();
  } catch {
    redirect("/settings?toast=" + encodeURIComponent("Service role key not configured — add SUPABASE_SERVICE_ROLE_KEY to environment variables."));
  }

  // Clear references to this user in blocks and slabs before deleting
  // (foreign key constraints on created_by / updated_by columns)
  await Promise.all([
    admin.from("blocks").update({ updated_by: null }).eq("updated_by", id),
    admin.from("blocks").update({ created_by: null }).eq("created_by", id),
    admin.from("slabs").update({ updated_by: null }).eq("updated_by", id),
    admin.from("slabs").update({ created_by: null }).eq("created_by", id),
  ]);

  const { error } = await admin
    .from("profiles")
    .delete()
    .eq("id", id);

  if (error) redirect(`/settings?toast=${encodeURIComponent(error.message)}`);

  revalidatePath("/settings");
  redirect("/settings?toast=User+removed");
}
