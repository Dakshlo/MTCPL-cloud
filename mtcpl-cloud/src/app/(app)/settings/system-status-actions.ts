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
import { DEPARTMENTS, type Department } from "@/lib/departments";
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

/* The dev-bypass profile's id is the literal "dev-user-id", not a uuid, so
 * writing it into updated_by fails the whole write in local development. */
const isUuidActor = (id: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);

/* Derived from DEPARTMENTS so it can never drift again.
 *
 * It had drifted badly: this was a hand-written ["production","finance",
 * "inventory"] while the app had grown to eight departments and the Settings
 * page was already rendering an Invoicing card. "invoicing" failed the
 * membership test and fell through to the global branch below — so pressing
 * "Take system down" on the INVOICING card locked the ENTIRE system, while the
 * card itself kept reading invoicing_status and still showed LIVE. Bringing it
 * back up cleared the global flag instead of the department's. That is the
 * "sometimes it doesn't work" the developer kept hitting (Daksh, Aug 2026). */
const VALID_DEPTS: ReadonlyArray<Department> = DEPARTMENTS.map((d) => d.id);

function resolveKey(formData: FormData): { key: string; auditLabel: string } {
  const raw = String(formData.get("department") || "").trim();
  if ((VALID_DEPTS as readonly string[]).includes(raw)) {
    return {
      key: deptStatusKey(raw as Department),
      auditLabel: raw,
    };
  }
  // Explicit "global" path — flips the system_status row from migration 031.
  // Reached only when `department` is empty; an unrecognised value is a bug,
  // so shout rather than silently nuking the whole system.
  if (raw) throw new Error(`Unknown department "${raw}" — refusing to fall back to the global flag.`);
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

  /* UPSERT, not UPDATE.
   *
   * This was `.update().eq("key", key)`, which matches zero rows when the
   * settings row does not exist yet — and PostgREST reports that as SUCCESS,
   * no error. Every department added after migration 036 (register,
   * maintenance, salary, vehicles) has no row, so the toggle reported "done"
   * and changed nothing at all. Upserting creates the row on first use, so a
   * new department works the day it is added.
   *
   * `.select()` is what makes the rowcount visible — without it we would be
   * trusting the same silence that caused the bug. */
  const { data: rows, error } = await supabase
    .from("system_settings")
    .upsert(
      {
        key,
        value: { down, message },
        updated_at: new Date().toISOString(),
        ...(isUuidActor(profile.id) ? { updated_by: profile.id } : {}),
      },
      { onConflict: "key" },
    )
    .select("key");

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
  if (!rows || rows.length === 0) {
    return { ok: false, error: `Nothing was saved for "${key}". The status has NOT changed.` };
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
