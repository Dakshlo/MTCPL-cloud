"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";

export async function pushSlabAlertAction(formData: FormData) {
  await requireAuth(["owner", "developer"]);
  const admin = createAdminSupabaseClient();

  const id             = formData.get("id") as string;
  const deadlineMonth  = formData.get("deadline_month") as string | null;
  const deadlineDay    = formData.get("deadline_day") as string | null;
  const note           = (formData.get("note") as string | null)?.trim() || null;

  // Construct date from month+day using current year (or next year if date already passed)
  let deadline: string | null = null;
  if (deadlineMonth && deadlineDay) {
    const now = new Date();
    const year = now.getFullYear();
    const candidate = `${year}-${deadlineMonth}-${deadlineDay}`;
    // If the date has already passed this year, use next year
    deadline = new Date(candidate) < now ? `${year + 1}-${deadlineMonth}-${deadlineDay}` : candidate;
  }

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
