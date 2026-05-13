"use server";

// Server actions for the developer-only system maintenance toggle.
// Migration 031 created the row. These actions just flip its `down`
// field. requireAuth + role-check on the developer role gate both
// directions.

import { revalidatePath } from "next/cache";
import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";

type Result = { ok: true } | { ok: false; error: string };

async function setSystemDown(down: boolean, message: string | null): Promise<Result> {
  const { profile } = await requireAuth();
  if (profile.role !== "developer") {
    return { ok: false, error: "Only a developer can change system status." };
  }
  const supabase = createAdminSupabaseClient();

  const { error } = await supabase
    .from("system_settings")
    .update({
      value: { down, message },
      updated_at: new Date().toISOString(),
      updated_by: profile.id,
    })
    .eq("key", "system_status");

  if (error) {
    // Most likely: migration 031 wasn't run on this environment.
    // Surface a clear, actionable error.
    return {
      ok: false,
      error:
        error.message?.includes("system_settings") ||
        error.message?.toLowerCase().includes("does not exist")
          ? "system_settings table missing — run migration 031 first."
          : error.message,
    };
  }

  void logAudit(
    profile.id,
    down ? "system_taken_down" : "system_brought_up",
    "system_settings",
    "system_status",
    { message },
  );

  // Force every page in the app to re-read the flag on next request.
  revalidatePath("/", "layout");
  return { ok: true };
}

/** Toggle the maintenance flag on. Visible only to developers via the
 *  Settings page's System Status section, behind a double-confirm dialog. */
export async function takeSystemDownAction(formData: FormData): Promise<Result> {
  const message = (String(formData.get("message") || "")).trim() || null;
  return setSystemDown(true, message);
}

/** Toggle the maintenance flag off. Shown to developers on the
 *  full-screen maintenance page itself (so they can bring it back
 *  without being locked out), AND on the Settings page. */
export async function bringSystemUpAction(_formData: FormData): Promise<Result> {
  return setSystemDown(false, null);
}

/** Void wrapper of bringSystemUpAction for direct `<form action>`
 *  usage on the SystemDownScreen (which has no client-side
 *  result-handling — `revalidatePath('/', 'layout')` inside the
 *  inner action causes the screen to re-render with the flag
 *  flipped). On the rare error case (DB unreachable mid-toggle) we
 *  log server-side and the screen stays — developer can retry. */
export async function bringSystemUpFormAction(formData: FormData) {
  const result = await bringSystemUpAction(formData);
  if (!result.ok) {
    console.error("[bringSystemUpFormAction] failed:", result.error);
  }
}
