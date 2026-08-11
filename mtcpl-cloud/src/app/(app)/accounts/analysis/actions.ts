"use server";

/**
 * Finance Analysis — the ONLY writes this page owns.
 *
 * The payment planner itself never touches finance data (Daksh: "don't
 * change any data, just read"). What DOES persist is dad's own
 * metadata about vendors:
 *
 *   • fa_vendor_meta   — per-vendor mood (😊😐😠) + money-pressure
 *                        (🧊⏳🔥) dials feeding the planner's scoring.
 *   • fa_vendor_groups — firms clubbed as one person ("mukesh ji" runs
 *                        four firms; paying any of them counts as
 *                        paying him).
 *
 * Both live in app_settings (key/value jsonb) — the same store the
 * WhatsApp toggles use — so this needs NO migration and touches no
 * bills/payments table. Deleting the two keys resets the feature.
 *
 * Gate matches the page exactly: developer, or the owner account whose
 * name contains NARESH. Server-enforced here because server actions
 * are their own endpoints — the page's redirect() protects nothing.
 */

import { revalidatePath } from "next/cache";

import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import type { PayMetaMap, VendorPayMeta, VendorGroup } from "./recommend";

const META_KEY = "fa_vendor_meta";
const GROUPS_KEY = "fa_vendor_groups";

async function requirePlannerAccess() {
  const { profile } = await requireAuth();
  const upperName = (profile.full_name ?? "").toUpperCase();
  const allowed =
    profile.role === "developer" ||
    (profile.role === "owner" && upperName.includes("NARESH"));
  if (!allowed) throw new Error("Not allowed.");
  return profile;
}

/** app_settings.updated_by is a uuid column; the dev-bypass mock user
 *  id ("dev-user-id") isn't one, so guard rather than 22P02 the write. */
function asUuid(id: string): string | null {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id) ? id : null;
}

const MOODS = ["good", "avg", "bad"] as const;
const URGENCIES = ["chill", "normal", "high"] as const;

/** Set / clear one vendor's dials. The client sends the vendor's FULL
 *  desired meta (or null to clear) rather than a patch — two quick taps
 *  then can't clobber each other: whichever save lands last carries
 *  both fields. Read-modify-write on the single jsonb blob is fine
 *  here; the page is two named users. */
export async function saveVendorPayMetaAction(
  vendorId: string,
  full: VendorPayMeta | null,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const profile = await requirePlannerAccess();
    if (!vendorId || typeof vendorId !== "string") return { ok: false, error: "Bad vendor id." };
    const clean: VendorPayMeta = {};
    if (full?.mood != null) {
      if (!MOODS.includes(full.mood)) return { ok: false, error: "Bad mood." };
      clean.mood = full.mood;
    }
    if (full?.urgency != null) {
      if (!URGENCIES.includes(full.urgency)) return { ok: false, error: "Bad urgency." };
      clean.urgency = full.urgency;
    }

    const admin = createAdminSupabaseClient();
    const { data: row } = await admin
      .from("app_settings")
      .select("value")
      .eq("key", META_KEY)
      .maybeSingle();

    const map: PayMetaMap =
      row?.value && typeof row.value === "object" ? (row.value as PayMetaMap) : {};
    if (Object.keys(clean).length === 0) delete map[vendorId];
    else map[vendorId] = clean;

    const { error } = await admin.from("app_settings").upsert({
      key: META_KEY,
      value: map,
      updated_at: new Date().toISOString(),
      updated_by: asUuid(profile.id),
    });
    if (error) return { ok: false, error: error.message };

    revalidatePath("/accounts/analysis");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed." };
  }
}

/** Replace the whole group list (it's tiny — a handful of people).
 *  Client sends the full desired state; server validates shape. */
export async function saveVendorGroupsAction(
  groups: VendorGroup[],
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const profile = await requirePlannerAccess();
    if (!Array.isArray(groups) || groups.length > 100) return { ok: false, error: "Bad groups." };

    const clean: VendorGroup[] = [];
    const seenVendor = new Set<string>();
    for (const g of groups) {
      const name = String(g?.name ?? "").trim().slice(0, 80);
      const ids = Array.isArray(g?.vendorIds)
        ? [...new Set(g.vendorIds.filter((x) => typeof x === "string" && x.length < 64))]
        : [];
      // A one-firm "group" is meaningless; a vendor can only belong to
      // one person.
      const unique = ids.filter((id) => !seenVendor.has(id));
      if (!name || unique.length < 2) continue;
      unique.forEach((id) => seenVendor.add(id));
      clean.push({ id: String(g.id ?? `g${clean.length}`).slice(0, 40), name, vendorIds: unique });
    }

    const admin = createAdminSupabaseClient();
    const { error } = await admin.from("app_settings").upsert({
      key: GROUPS_KEY,
      value: { groups: clean },
      updated_at: new Date().toISOString(),
      updated_by: asUuid(profile.id),
    });
    if (error) return { ok: false, error: error.message };

    revalidatePath("/accounts/analysis");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed." };
  }
}
