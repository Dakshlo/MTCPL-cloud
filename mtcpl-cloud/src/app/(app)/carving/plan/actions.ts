"use server";

// ──────────────────────────────────────────────────────────────────
// Carving Plan — quick-tag action (mig 215). Bulk-sets carving_method
// on a set of slabs from the Undecided queue (or re-routes tagged
// ones). Guide-not-gate philosophy everywhere else, but this IS the
// deliberate decision surface, so it writes unconditionally (unlike
// the auto-stamps, which only fill NULL).
// ──────────────────────────────────────────────────────────────────

import { revalidatePath } from "next/cache";
import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { chunkIds } from "@/lib/paginate";
import { logAudit } from "@/lib/audit";
import { parseCarvingMethodInput } from "@/lib/carving-method";

// Same office set as the /carving/plan page itself.
const ALLOWED = ["developer", "owner", "carving_head", "senior_incharge", "tender_manager"];

export async function setCarvingMethodBulkAction(
  formData: FormData,
): Promise<{ ok: true; count: number } | { ok: false; error: string }> {
  const { profile } = await requireAuth();
  if (!ALLOWED.includes(profile.role)) {
    return { ok: false, error: "Not authorised to set carving routes." };
  }
  const admin = createAdminSupabaseClient();

  let ids: string[] = [];
  try {
    const parsed = JSON.parse(String(formData.get("ids") ?? "[]"));
    if (Array.isArray(parsed)) ids = parsed.filter((x): x is string => typeof x === "string" && x.trim().length > 0);
  } catch {
    /* fall through to the empty check */
  }
  if (ids.length === 0) return { ok: false, error: "No slabs selected." };

  const methodRaw = String(formData.get("method") ?? "");
  // "" is a legal clear-to-nil; anything else must parse to a real method.
  const method = methodRaw === "" ? null : parseCarvingMethodInput(methodRaw);
  if (methodRaw !== "" && method === null) {
    return { ok: false, error: "Unknown carving method." };
  }

  const now = new Date().toISOString();
  // Dev-bypass mock id ("dev-user-id") is not a uuid — writing it into the
  // uuid updated_by column 500s in local dev only. Real logins always have
  // uuid ids, so production behaviour is unchanged.
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(profile.id);
  let count = 0;
  // chunkIds — a big tick-all selection must never hit the PostgREST cap
  // or an over-long .in() URL.
  for (const chunk of chunkIds(ids)) {
    const { data, error } = await admin
      .from("slab_requirements")
      .update({ carving_method: method, ...(isUuid ? { updated_by: profile.id } : {}), updated_at: now })
      .in("id", chunk)
      // A route may only be set BEFORE carving starts. Once a slab is
      // assigned to a vendor / on a machine / carved / dispatched the
      // decision is already executed, so re-routing it would only corrupt
      // the plan totals (Daksh, Aug 2026). Cancelled + rejected stay out
      // too. Enforced here, not just in the UI.
      .in("status", ["open", "planned", "cutting", "cut_done"])
      .select("id");
    if (error) return { ok: false, error: error.message };
    count += (data ?? []).length;
  }

  await logAudit(profile.id, "carving_method_bulk_set", "slab", "batch", {
    ids,
    method,
    requested: ids.length,
    updated: count,
  });

  revalidatePath("/carving/plan");
  revalidatePath("/carving");
  revalidatePath("/slabs");
  return { ok: true, count };
}
