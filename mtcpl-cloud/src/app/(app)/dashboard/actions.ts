"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";

export async function pushSlabAlertAction(formData: FormData) {
  await requireAuth(["owner", "developer"]);
  const admin = createAdminSupabaseClient();

  const id       = formData.get("id") as string;
  const deadline = formData.get("deadline") as string | null;
  const note     = (formData.get("note") as string | null)?.trim() || null;

  if (!id) redirect("/dashboard?toast=Missing+slab+ID");

  const { error } = await admin
    .from("slab_requirements")
    .update({
      priority: true,
      ...(deadline ? { deadline } : {}),
      ...(note     ? { priority_note: note } : {}),
    })
    .eq("id", id);

  if (error) redirect(`/dashboard?toast=${encodeURIComponent(error.message)}`);

  revalidatePath("/dashboard");
  revalidatePath("/slabs");
  revalidatePath("/cutting");
  redirect("/dashboard?pushed=1");
}

export async function clearSlabAlertAction(formData: FormData) {
  await requireAuth(["owner", "developer"]);
  const admin = createAdminSupabaseClient();

  const id = formData.get("id") as string;
  if (!id) return;

  await admin
    .from("slab_requirements")
    .update({ priority: false, deadline: null, priority_note: null })
    .eq("id", id);

  revalidatePath("/dashboard");
  revalidatePath("/slabs");
  revalidatePath("/cutting");
}
