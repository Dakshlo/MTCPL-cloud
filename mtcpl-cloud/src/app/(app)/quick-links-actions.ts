"use server";

/**
 * Pinned links for the ⌘K palette (mig 221, Daksh Aug 2026).
 *
 * Up to six pages a person keeps returning to, saved on their own profile.
 *
 * Every href is checked against the nav registry FOR THAT USER before it is
 * stored: a pin is a door, and a door to a page you may not open should not
 * exist. The palette re-checks on render too, so losing a role quietly removes
 * the pin rather than leaving a link that 403s.
 */

import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { MAX_QUICK_LINKS, canUseQuickSearch, pagesFor } from "@/lib/nav-registry";
import { revalidatePath } from "next/cache";

export async function saveQuickLinksAction(
  hrefs: string[],
): Promise<{ ok: true; saved: string[] } | { ok: false; error: string }> {
  try {
    const { profile } = await requireAuth();
    // Only roles that HAVE the palette may save pins for it.
    if (!canUseQuickSearch(profile.role)) return { ok: false, error: "Not allowed." };
    if (!Array.isArray(hrefs)) return { ok: false, error: "Bad input." };

    // What this user is actually allowed to reach, by role — not by what the
    // client sent. An unknown or forbidden href is dropped, not stored.
    const allowed = new Set(
      pagesFor(profile.role, null, { can_assign_carving: (profile as { can_assign_carving?: boolean | null }).can_assign_carving })
        .map((p) => p.href),
    );

    const seen = new Set<string>();
    const clean = hrefs
      .map((h) => String(h ?? "").trim())
      .filter((h) => allowed.has(h))
      .filter((h) => (seen.has(h) ? false : (seen.add(h), true)))
      .slice(0, MAX_QUICK_LINKS);

    const admin = createAdminSupabaseClient();
    // .select() so a zero-row update is caught. Without it Supabase reports
    // success for an update that matched nothing — which is exactly what
    // happens under the dev mock, whose id is not a uuid, and would happen in
    // production for any id that stopped existing. Silent no-ops are worse
    // than errors.
    const { data, error } = await admin
      .from("profiles")
      .update({ quick_links: clean } as never)
      .eq("id", profile.id)
      .select("id");
    if (error) return { ok: false, error: error.message };
    if (!data || data.length === 0) return { ok: false, error: "Could not find your profile to save onto." };

    revalidatePath("/", "layout");
    return { ok: true, saved: clean };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed." };
  }
}
