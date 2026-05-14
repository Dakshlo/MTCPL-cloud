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
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";
import { deptStatusKey } from "@/lib/system-status";
import type { Department } from "@/lib/departments";
import {
  DEV_BYPASS_COOKIE,
  DEV_BYPASS_MAX_AGE_SECONDS,
} from "@/lib/dev-bypass";

// Re-exporting non-async constants from this file would crash the
// Next.js build because of the "use server" directive — server-action
// modules may only export async functions. See src/lib/dev-bypass.ts
// for DEV_BYPASS_COOKIE / DEV_BYPASS_MAX_AGE_SECONDS, imported above
// and used below.

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

// ──────────────────────────────────────────────────────────────────
// Developer maintenance-bypass — admin override cookie
// ──────────────────────────────────────────────────────────────────
// Pattern: dev flips the global (or a per-department) maintenance
// flag. They land on the lock screen along with everyone else. From
// the lock screen the dev can either (a) bring the system back live
// for everyone, or (b) click "Access system anyway" — which sets the
// DEV_BYPASS_COOKIE on their browser session. The root layout, when
// it sees `down=true` on the maintenance check, looks up this cookie
// and only short-circuits to the lock screen if the cookie ISN'T set
// (or the user isn't a developer).
//
// Side effect: while in bypass mode the layout renders a yellow
// banner across the top of every page so the dev never forgets they
// have admin override on. Clearing it sends them back to the lock
// screen on the next request.

/** Form action — sets the bypass cookie on this dev's browser, then
 *  redirects to /dashboard. Strictly developer-only. Accepts a
 *  FormData param (unused) so it can wire straight into a
 *  `<form action={...}>` on the SystemDownScreen / banner. */
export async function enableDevMaintenanceBypassAction(_formData: FormData) {
  void _formData;
  const { profile } = await requireAuth();
  if (profile.role !== "developer") {
    // Quietly bounce — non-developers should never see this button.
    redirect("/");
  }
  const jar = await cookies();
  jar.set(DEV_BYPASS_COOKIE, "1", {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: DEV_BYPASS_MAX_AGE_SECONDS,
  });
  void logAudit(profile.id, "dev_maintenance_bypass_enabled", "profile", profile.id, {})
    .catch(() => {});
  redirect("/dashboard");
}

/** Form action — clears the bypass cookie. After this the dev sees
 *  the lock screen again on the next request (until they bring the
 *  system back live, or re-enable bypass). FormData param unused. */
export async function disableDevMaintenanceBypassAction(_formData: FormData) {
  void _formData;
  const { profile } = await requireAuth();
  const jar = await cookies();
  jar.delete(DEV_BYPASS_COOKIE);
  if (profile.role === "developer") {
    void logAudit(profile.id, "dev_maintenance_bypass_disabled", "profile", profile.id, {})
      .catch(() => {});
  }
  redirect("/");
}
