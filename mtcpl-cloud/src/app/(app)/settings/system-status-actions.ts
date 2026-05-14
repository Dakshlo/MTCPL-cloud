"use server";

// Server actions for the developer-only system maintenance toggle.
// Migration 031 created the global flag. Migration 036 added three
// per-department flags (production_status, finance_status,
// inventory_status). The same set of actions handles both: pass
// `department` in the form data, and the action targets the matching
// system_settings row. Omit it and you target the legacy global flag
// (back-compat for any existing callers).
//
// requireAuth + developer-role check gates every write.

import { revalidatePath } from "next/cache";
import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";
import { deptStatusKey } from "@/lib/system-status";
import type { Department } from "@/lib/departments";

type Result = { ok: true } | { ok: false; error: string };

const VALID_DEPTS: ReadonlyArray<Department> = ["production", "finance", "inventory"];

function resolveKey(formData: FormData): { key: string; auditLabel: string } {
  const raw = String(formData.get("department") || "").trim();
  if ((VALID_DEPTS as readonly string[]).includes(raw)) {
    return {
      key: deptStatusKey(raw as Department),
      auditLabel: raw,
    };
  }
  // Legacy / explicit "global" path — flips the system_status row
  // introduced by migration 031.
  return { key: "system_status", auditLabel: "global" };
}

async function setSystemDown(
  formData: FormData,
  down: boolean,
  message: string | null,
): Promise<Result> {
  const { profile } = await requireAuth();
  if (profile.role !== "developer") {
    return { ok: false, error: "Only a developer can change system status." };
  }
  const supabase = createAdminSupabaseClient();
  const { key, auditLabel } = resolveKey(formData);

  const { error } = await supabase
    .from("system_settings")
    .update({
      value: { down, message },
      updated_at: new Date().toISOString(),
      updated_by: profile.id,
    })
    .eq("key", key);

  if (error) {
    return {
      ok: false,
      error:
        error.message?.includes("system_settings") ||
        error.message?.toLowerCase().includes("does not exist")
          ? "system_settings table missing — run migrations 031 + 036 first."
          : error.message,
    };
  }

  void logAudit(
    profile.id,
    down ? "system_taken_down" : "system_brought_up",
    "system_settings",
    key,
    { scope: auditLabel, message },
  );

  // Force every page in the app to re-read on next request.
  revalidatePath("/", "layout");
  return { ok: true };
}

/** Toggle a department (or the global flag) DOWN. The Settings page
 *  posts `department` = 'production' / 'finance' / 'inventory'.
 *  Omitting `department` falls back to the global system_status row. */
export async function takeSystemDownAction(formData: FormData): Promise<Result> {
  const message = (String(formData.get("message") || "")).trim() || null;
  return setSystemDown(formData, true, message);
}

/** Toggle a department (or the global flag) UP. The SystemDownScreen
 *  posts no department, so it falls back to clearing the global flag
 *  — which is intentional: when the dev hits the recovery button on
 *  the lock screen, they're probably trying to unwedge the whole app.
 *  To bring up a specific department they use the Settings page. */
export async function bringSystemUpAction(formData: FormData): Promise<Result> {
  return setSystemDown(formData, false, null);
}

/** Void wrapper of bringSystemUpAction for direct `<form action>`
 *  usage on the SystemDownScreen. */
export async function bringSystemUpFormAction(formData: FormData) {
  const result = await bringSystemUpAction(formData);
  if (!result.ok) {
    console.error("[bringSystemUpFormAction] failed:", result.error);
  }
}
