"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { notify } from "@/lib/notifications";

// NOTE: the old `getNowBandData` action (and its NowBandData / NowOperator /
// NowAlert types, plus the cft/istToday/timeAgo helpers) was removed along
// with the NowBand UI. If you ever restore that widget, pull the logic from
// git history (`git log --all --full-history -- src/app/(app)/dashboard/actions.ts`).

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

  if (!id) redirect("/dashboard/push-urgent?toast=Missing+slab+ID");

  const { error } = await admin
    .from("slab_requirements")
    .update({
      priority: true,
      ...(deadline ? { deadline } : {}),
      ...(note     ? { priority_note: note } : {}),
    })
    .eq("id", id);

  if (error) redirect(`/dashboard/push-urgent?toast=${encodeURIComponent(error.message)}`);

  await notify("priority_pushed", `Slab ${id} marked urgent`, {
    message: note ?? undefined,
    entityType: "slab",
    entityId: id,
  });

  revalidatePath("/dashboard");
  revalidatePath("/dashboard/push-urgent");
  revalidatePath("/slabs");
  revalidatePath("/cutting");
  redirect("/dashboard/push-urgent?pushed=1");
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
  revalidatePath("/dashboard/push-urgent");
  revalidatePath("/slabs");
  revalidatePath("/cutting");
}
