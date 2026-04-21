"use server";

/**
 * Server action for persisting a user's theme preference to their
 * profile row. Called fire-and-forget from ThemeToggle so next time
 * the user logs in (on any device) the same theme applies.
 *
 * Pairs with migration 009_theme_preference.sql which adds the
 * profiles.theme_preference column.
 */

import { requireAuth } from "./auth";
import { createAdminSupabaseClient } from "./supabase/admin";

export async function updateThemePreferenceAction(theme: "light" | "dark"): Promise<{ ok: true } | { error: string }> {
  try {
    const { profile } = await requireAuth();
    if (theme !== "light" && theme !== "dark") {
      return { error: "Invalid theme value" };
    }
    const admin = createAdminSupabaseClient();
    const { error } = await admin
      .from("profiles")
      .update({ theme_preference: theme })
      .eq("id", profile.id);
    if (error) return { error: error.message };
    return { ok: true };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Unknown error" };
  }
}
