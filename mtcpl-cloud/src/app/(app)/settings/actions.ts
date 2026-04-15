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

// ── Stone Type Actions ──────────────────────────────────────────────────────

function adjustHex(hex: string, factor: number): string {
  const clean = hex.replace("#", "").padEnd(6, "0");
  const r = Math.min(255, Math.round(parseInt(clean.slice(0, 2), 16) * factor));
  const g = Math.min(255, Math.round(parseInt(clean.slice(2, 4), 16) * factor));
  const b = Math.min(255, Math.round(parseInt(clean.slice(4, 6), 16) * factor));
  return "#" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("");
}

export async function addStoneTypeAction(formData: FormData) {
  await requireAuth(["owner", "team_head", "developer"]);
  const supabase = await createServerSupabaseClient();

  const name = text(formData, "name").replace(/\s+/g, "");
  const base = text(formData, "color") || "#C87A60";

  // Auto-derive 3 face colours from one base colour
  const color_top   = adjustHex(base, 1.35);  // lighten for top face
  const color_front = adjustHex(base, 0.80);  // darken for front face
  const color_side  = adjustHex(base, 1.10);  // slightly lighter for side face

  if (!name) redirect("/settings?toast=Stone+type+name+required");

  const { error } = await supabase.from("stone_types").insert({ name, color_top, color_front, color_side });
  if (error) redirect(`/settings?toast=${encodeURIComponent(error.message)}`);

  revalidatePath("/settings");
  revalidatePath("/blocks");
  revalidatePath("/slabs");
  redirect("/settings?toast=Stone+type+added");
}

export async function deleteStoneTypeAction(formData: FormData) {
  await requireAuth(["owner", "team_head", "developer"]);
  const supabase = await createServerSupabaseClient();

  const id = text(formData, "id");
  const name = text(formData, "name");

  // Protect the two built-in types
  if (name === "PinkStone" || name === "WhiteStone") {
    redirect("/settings?toast=Cannot+delete+built-in+stone+types");
  }

  const { error } = await supabase.from("stone_types").delete().eq("id", id);
  if (error) redirect(`/settings?toast=${encodeURIComponent(error.message)}`);

  revalidatePath("/settings");
  revalidatePath("/blocks");
  redirect("/settings?toast=Stone+type+deleted");
}

// ── Temple Actions ───────────────────────────────────────────────────────────

export async function addTempleAction(formData: FormData) {
  await requireAuth(["owner", "team_head"]);
  const supabase = await createServerSupabaseClient();

  const name = text(formData, "name");
  const code_prefix = text(formData, "code_prefix").toUpperCase();
  const default_stone = text(formData, "default_stone") || "PinkStone";

  if (!name || !code_prefix) redirect("/settings?toast=Name+and+prefix+required");

  const { error } = await supabase.from("temples").insert({ name, code_prefix, default_stone });
  if (error) redirect(`/settings?toast=${encodeURIComponent(error.message)}`);

  revalidatePath("/settings");
  revalidatePath("/slabs");
  redirect("/settings?toast=Temple+added");
}

export async function updateTempleAction(formData: FormData) {
  await requireAuth(["owner", "team_head"]);
  const supabase = await createServerSupabaseClient();

  const id = text(formData, "id");
  const name = text(formData, "name");
  const code_prefix = text(formData, "code_prefix").toUpperCase();
  const default_stone = text(formData, "default_stone") || "PinkStone";
  const is_active = formData.get("is_active") === "true";

  if (!id) redirect("/settings?toast=Missing+ID");

  const { error } = await supabase.from("temples").update({ name, code_prefix, default_stone, is_active }).eq("id", id);
  if (error) redirect(`/settings?toast=${encodeURIComponent(error.message)}`);

  revalidatePath("/settings");
  revalidatePath("/slabs");
  redirect("/settings?toast=Temple+updated");
}

export async function deleteTempleAction(formData: FormData) {
  await requireAuth(["owner", "team_head"]);
  const supabase = await createServerSupabaseClient();

  const id = text(formData, "id");
  const { error } = await supabase.from("temples").delete().eq("id", id);
  if (error) redirect(`/settings?toast=${encodeURIComponent(error.message)}`);

  revalidatePath("/settings");
  redirect("/settings?toast=Temple+deleted");
}

export async function updateUserAction(formData: FormData) {
  const { profile: currentUser } = await requireAuth(["owner", "team_head", "developer"]);
  const admin = createAdminSupabaseClient();

  const id = text(formData, "id");
  const requestedRole = text(formData, "role") || "block_slab_entry";
  const full_name = text(formData, "full_name") || null;
  const is_active = formData.get("is_active") === "true";

  if (!id) redirect("/settings?toast=Missing+fields");
  if (id === currentUser.id) redirect("/settings?toast=Cannot+edit+your+own+account");

  // Developer accounts are protected — nobody can edit them
  const { data: target } = await admin.from("profiles").select("role").eq("id", id).single();
  if (target?.role === "developer") redirect("/settings?toast=Developer+account+is+protected");

  // Role assignment rules:
  // - Developer: can assign any role including owner/developer
  // - Owner + Planner: can assign any role EXCEPT owner and developer
  const RESTRICTED_ASSIGNABLE = ["team_head", "block_slab_entry", "slab_entry", "block_entry", "cutting_operator"];
  let role = requestedRole;
  if (currentUser.role === "owner" || currentUser.role === "team_head") {
    if (!RESTRICTED_ASSIGNABLE.includes(requestedRole)) {
      redirect("/settings?toast=Cannot+assign+that+role");
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

export async function updateOwnNameAction(formData: FormData) {
  const { profile: currentUser } = await requireAuth([
    "owner", "team_head", "developer", "block_slab_entry",
    "slab_entry", "block_entry", "cutting_operator",
  ]);
  const admin = createAdminSupabaseClient();

  const full_name = text(formData, "full_name").trim();
  if (!full_name) redirect("/settings?toast=Name+cannot+be+empty");

  const { error } = await admin
    .from("profiles")
    .update({ full_name })
    .eq("id", currentUser.id);
  if (error) redirect(`/settings?toast=${encodeURIComponent(error.message)}`);

  revalidatePath("/settings");
  redirect("/settings?toast=Your+name+updated");
}

export async function deleteUserAction(formData: FormData) {
  const { profile: currentUser } = await requireAuth(["owner", "developer"]);
  const admin = createAdminSupabaseClient();

  const id = text(formData, "id");
  if (!id) redirect("/settings?toast=Missing+ID");
  if (id === currentUser.id) redirect("/settings?toast=Cannot+remove+your+own+account");

  // Developer accounts are protected — nobody can remove them
  const { data: target } = await admin.from("profiles").select("role").eq("id", id).single();
  if (target?.role === "developer") redirect("/settings?toast=Developer+account+is+protected");

  // Try hard delete first — works for users with no linked data (new accounts)
  const { error: deleteError } = await admin.from("profiles").delete().eq("id", id);

  if (!deleteError) {
    // Fully deleted
    revalidatePath("/settings");
    redirect("/settings?toast=User+removed");
  }

  // FK constraint (code 23503) means this user has linked records — soft-delete instead
  if (deleteError.code === "23503") {
    const { error: deactivateError } = await admin.from("profiles").update({ is_active: false }).eq("id", id);
    if (deactivateError) redirect(`/settings?toast=${encodeURIComponent(deactivateError.message)}`);
    revalidatePath("/settings");
    redirect("/settings?toast=User+deactivated+(has+linked+data)");
  }

  redirect(`/settings?toast=${encodeURIComponent(deleteError.message)}`);
}
