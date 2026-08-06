"use server";

/**
 * The full-blackout switch. Developer only, one direction.
 *
 * Turning it ON takes every url of the system off the air for everybody,
 * including the person who pressed the button. There is intentionally no
 * "turn it off" action here, because there is no way to reach this page once
 * it is on — the Settings page is blacked out too. Coming back is a single
 * SQL statement in the Supabase editor; see src/lib/blackout.ts and
 * migration 218.
 *
 * That asymmetry is the design, not an oversight. A switch with an in-app
 * "off" is a switch an attacker with a session can also flip.
 */

import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";
import { clearBlackoutCache } from "@/lib/blackout";

type Result = { ok: true } | { ok: false; error: string };

/** Typed exactly, so a fat-fingered click cannot arm it. */
const CONFIRM_PHRASE = "BLACKOUT";

const isUuidActor = (id: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);

export async function engageBlackoutAction(formData: FormData): Promise<Result> {
  const { profile } = await requireAuth();
  if (profile.role !== "developer") {
    return { ok: false, error: "Only a developer can black the system out." };
  }

  const typed = String(formData.get("confirm") || "").trim();
  if (typed !== CONFIRM_PHRASE) {
    return { ok: false, error: `Type ${CONFIRM_PHRASE} exactly to confirm.` };
  }

  const supabase = createAdminSupabaseClient();
  const { data: rows, error } = await supabase
    .from("system_settings")
    .upsert(
      {
        key: "blackout",
        value: { on: true, at: new Date().toISOString(), by: profile.full_name || profile.id },
        updated_at: new Date().toISOString(),
        ...(isUuidActor(profile.id) ? { updated_by: profile.id } : {}),
      },
      { onConflict: "key" },
    )
    .select("key");

  if (error) return { ok: false, error: error.message };
  // A zero-row "success" is exactly how the maintenance toggle used to lie.
  if (!rows || rows.length === 0) {
    return { ok: false, error: "Nothing was saved — the system is NOT blacked out." };
  }

  // Audited BEFORE the cache flip, because a moment later this instance stops
  // serving anything at all.
  await logAudit(profile.id, "system_blackout_engaged", "system_settings", "blackout", {
    by: profile.full_name || null,
  }).catch(() => {});

  // Make this instance act on it immediately rather than waiting out the TTL.
  clearBlackoutCache();

  return { ok: true };
}
