"use server";

/**
 * Remember which language a person reads the email snapshot in (mig 224).
 *
 * On the profile rather than in the browser because Daksh asked for the
 * PERSON's choice to stick — sign in from the office desktop or a laptop
 * and the snapshot should already be in the language you read.
 *
 * Writes with .select() so a zero-row update is caught: Supabase reports
 * success for an update that matched nothing, which is exactly what
 * happens under the dev mock (its id is not a uuid) and would happen for
 * any id that stopped existing. A toggle that silently forgets is worse
 * than one that says it failed.
 */

import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";

export type SnapshotLang = "en" | "hi";

export async function setSnapshotLangAction(
  lang: SnapshotLang,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const { profile } = await requireAuth();
    if (lang !== "en" && lang !== "hi") return { ok: false, error: "Unknown language." };

    const admin = createAdminSupabaseClient();
    const { data, error } = await admin
      .from("profiles")
      .update({ snapshot_lang: lang } as never)
      .eq("id", profile.id)
      .select("id");
    if (error) return { ok: false, error: error.message };
    if (!data || data.length === 0) return { ok: false, error: "Could not find your profile to save onto." };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed." };
  }
}
