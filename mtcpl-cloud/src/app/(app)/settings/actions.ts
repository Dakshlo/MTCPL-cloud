"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { createServerSupabaseClient } from "@/lib/supabase/server";

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
  const supabase = await createServerSupabaseClient();

  const id = text(formData, "id");
  const role = text(formData, "role");
  const is_active = formData.get("is_active") === "true";

  if (!id || !role) redirect("/settings?toast=Missing+fields");
  if (id === currentUser.id) redirect("/settings?toast=Cannot+edit+your+own+account");

  const { error } = await supabase.from("profiles").update({ role, is_active }).eq("id", id);
  if (error) redirect(`/settings?toast=${encodeURIComponent(error.message)}`);

  revalidatePath("/settings");
  redirect("/settings?toast=User+updated");
}
