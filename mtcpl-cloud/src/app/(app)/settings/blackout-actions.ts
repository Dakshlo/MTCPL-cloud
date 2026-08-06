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
import {
  clearBlackoutCache,
  isValidBlackoutHours,
  isValidBlackoutMode,
  BLACKOUT_HOURS,
} from "@/lib/blackout";

type Result = { ok: true; until: string } | { ok: false; error: string };

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

  /* A duration is mandatory and is re-checked here, not just in the browser.
     The client sends a number from a fixed set of buttons, but a server action
     is a public endpoint — without this check a crafted request could arm a
     blackout with no expiry, which is the one state this feature exists to
     avoid. */
  const hours = Number(formData.get("hours"));
  if (!isValidBlackoutHours(hours)) {
    return { ok: false, error: `Choose how long: ${BLACKOUT_HOURS.join(", ")} hours.` };
  }

  /* Re-validated server-side for the same reason as the duration: a server
     action is a public endpoint. An unrecognised mode falls back to the bare
     error page, which is the option that reveals nothing and cannot send
     anyone anywhere unexpected. */
  const rawMode = formData.get("mode");
  const mode = isValidBlackoutMode(rawMode) ? rawMode : "error";

  const now = new Date();
  const until = new Date(now.getTime() + hours * 3_600_000).toISOString();

  const supabase = createAdminSupabaseClient();
  const { data: rows, error } = await supabase
    .from("system_settings")
    .upsert(
      {
        key: "blackout",
        value: {
          on: true,
          at: now.toISOString(),
          until,
          hours,
          mode,
          by: profile.full_name || profile.id,
        },
        updated_at: now.toISOString(),
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
    hours,
    until,
    mode,
  }).catch(() => {});

  // Make this instance act on it immediately rather than waiting out the TTL.
  clearBlackoutCache();

  return { ok: true, until };
}
