"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
// Mig 081 follow-on — createServerSupabaseClient (user-context)
// removed. Every action in this file now goes through the admin
// client so RLS doesn't block writes; requireAuth() is the
// security gate.
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";
import { hashBulkImportPassword, BULK_IMPORT_PASSWORD_KEY } from "@/lib/bulk-import-password";

function text(fd: FormData, key: string) {
  const v = fd.get(key);
  return typeof v === "string" ? v.trim() : "";
}

// ── Stone Type Actions ──────────────────────────────────────────────────────

function adjustHex(hex: string, factor: number): string {
  const clean = hex.replace("#", "").padEnd(6, "0");
  const r = Math.min(255, Math.round(parseInt(clean.slice(0, 2), 16) * factor));
  const g = Math.min(255, Math.round(parseInt(clean.slice(2, 4), 16) * factor));
  const b = Math.min(255, Math.round(parseInt(clean.slice(4, 6), 16) * factor));
  return "#" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("");
}

// Daksh May 2026 (mig 081 follow-on) — same latent RLS bug as the
// temple actions below: stone_types has RLS enabled without an
// INSERT/UPDATE/DELETE policy for `authenticated`, so the
// user-context client (createServerSupabaseClient) was failing on
// every write. Hasn't surfaced because production stone types
// (PinkStone, WhiteStone, etc.) are stable — but the next time
// someone added a stone type it would have hit the same error
// Daksh just saw on temples. Pre-emptive fix while we're here.
export async function addStoneTypeAction(formData: FormData) {
  await requireAuth(["owner", "team_head", "senior_incharge", "developer"]);
  const admin = createAdminSupabaseClient();

  const name = text(formData, "name").replace(/\s+/g, "");
  const base = text(formData, "color") || "#C87A60";
  const rawCategory = text(formData, "stone_category").toLowerCase();
  const stone_category = rawCategory === "marble" ? "marble" : "sandstone";

  // Auto-derive 3 face colours from one base colour
  const color_top   = adjustHex(base, 1.35);  // lighten for top face
  const color_front = adjustHex(base, 0.80);  // darken for front face
  const color_side  = adjustHex(base, 1.10);  // slightly lighter for side face

  if (!name) redirect("/settings?toast=Stone+type+name+required");

  const { error } = await admin
    .from("stone_types")
    .insert({ name, color_top, color_front, color_side, stone_category });
  if (error) redirect(`/settings?toast=${encodeURIComponent(error.message)}`);

  revalidatePath("/settings");
  revalidatePath("/blocks");
  revalidatePath("/slabs");
  redirect(`/settings?toast=${encodeURIComponent(`${stone_category === "marble" ? "🗿 Marble" : "Sandstone"} "${name}" added`)}`);
}

/** Toggle a stone's category between sandstone and marble.
 *
 *  HARD-BLOCKED once any block or slab is using the stone — flipping
 *  PinkStone from sandstone to marble (or vice versa) would break how
 *  existing rows render (tonnes vs CFT). Safe only before any data
 *  is attached. The UI enforces this, but the action enforces it too
 *  in case of a direct POST. */
export async function setStoneCategoryAction(formData: FormData) {
  await requireAuth(["owner", "team_head", "senior_incharge", "developer"]);
  // Admin client throughout — RLS bypass needed for the update path
  // (mig 081 follow-on fix; see addStoneTypeAction note above).
  const admin = createAdminSupabaseClient();

  const id = text(formData, "id");
  const rawCategory = text(formData, "stone_category").toLowerCase();
  const stone_category = rawCategory === "marble" ? "marble" : "sandstone";

  if (!id) redirect("/settings?toast=Stone+id+required");

  // Look up the stone so we can sanity-check by name.
  const { data: stoneRow } = await admin
    .from("stone_types")
    .select("name")
    .eq("id", id)
    .maybeSingle();
  if (!stoneRow) redirect("/settings?toast=Stone+not+found");

  // Reject if anything is already using this stone.
  const [{ count: blockCount }, { count: slabCount }] = await Promise.all([
    admin.from("blocks").select("id", { count: "exact", head: true }).eq("stone", (stoneRow as { name: string }).name),
    admin.from("slab_requirements").select("id", { count: "exact", head: true }).eq("stone", (stoneRow as { name: string }).name),
  ]);
  const total = (blockCount ?? 0) + (slabCount ?? 0);
  if (total > 0) {
    redirect(
      `/settings?toast=${encodeURIComponent(
        `Cannot change category — ${blockCount ?? 0} block(s) and ${slabCount ?? 0} slab(s) already use "${(stoneRow as { name: string }).name}". Category is locked to preserve their display.`,
      )}`,
    );
  }

  const { error } = await admin
    .from("stone_types")
    .update({ stone_category })
    .eq("id", id);
  if (error) redirect(`/settings?toast=${encodeURIComponent(error.message)}`);

  revalidatePath("/settings");
  revalidatePath("/blocks");
  revalidatePath("/block-journey");
  redirect(`/settings?toast=${encodeURIComponent(`Category set to ${stone_category}`)}`);
}

export async function deleteStoneTypeAction(formData: FormData) {
  await requireAuth(["owner", "team_head", "senior_incharge", "developer"]);
  // Admin client throughout — RLS bypass needed for the delete path
  // (mig 081 follow-on fix; see addStoneTypeAction note above).
  const admin = createAdminSupabaseClient();

  const id = text(formData, "id");
  const name = text(formData, "name");

  // Protect the two built-in types
  if (name === "PinkStone" || name === "WhiteStone") {
    redirect("/settings?toast=Cannot+delete+built-in+stone+types");
  }

  // Block deletion if any blocks or slabs still use this stone type
  const [{ count: blockCount }, { count: slabCount }] = await Promise.all([
    admin.from("blocks").select("id", { count: "exact", head: true }).eq("stone", name),
    admin.from("slab_requirements").select("id", { count: "exact", head: true }).eq("stone", name),
  ]);
  const total = (blockCount ?? 0) + (slabCount ?? 0);
  if (total > 0) {
    redirect(`/settings?toast=${encodeURIComponent(`Cannot delete — ${blockCount ?? 0} block(s) and ${slabCount ?? 0} slab(s) still use "${name}". Change their stone type first.`)}`);
  }

  const { error } = await admin.from("stone_types").delete().eq("id", id);
  if (error) redirect(`/settings?toast=${encodeURIComponent(error.message)}`);

  revalidatePath("/settings");
  revalidatePath("/blocks");
  redirect("/settings?toast=Stone+type+deleted");
}

// ── Temple Actions ───────────────────────────────────────────────────────────
//
// Daksh May 2026 (mig 081 follow-on) — these three actions used to
// instantiate the user-context Supabase client (createServerSupabase-
// Client). The `temples` table has RLS enabled but no INSERT/UPDATE/
// DELETE policy for the `authenticated` role, so every write through
// the user client was getting:
//   "new row violates row-level security policy for table 'temples'"
// Daksh hit this trying to add a temple — first hit since RLS landed
// because nobody had added a temple between then and now.
//
// Fix: switch to createAdminSupabaseClient() to bypass RLS. This is
// the same pattern every other write in the codebase uses (bills,
// vendors, messenger, carving review, stone-types operations
// elsewhere in this file, etc.). requireAuth() is the security gate;
// the database doesn't need its own write policy because writes only
// happen through these auth-gated server actions.
//
// Also added "developer" to the role allowlist — every other action
// in this file includes it; temple actions were the odd one out.

export async function addTempleAction(formData: FormData) {
  await requireAuth(["owner", "team_head", "senior_incharge", "developer"]);
  const admin = createAdminSupabaseClient();

  const name = text(formData, "name");
  const code_prefix = text(formData, "code_prefix").toUpperCase();
  const default_stone = text(formData, "default_stone") || "PinkStone";

  if (!name || !code_prefix) redirect("/settings?toast=Name+and+prefix+required");

  const { error } = await admin.from("temples").insert({ name, code_prefix, default_stone });
  if (error) redirect(`/settings?toast=${encodeURIComponent(error.message)}`);

  revalidatePath("/settings");
  revalidatePath("/slabs");
  redirect("/settings?toast=Temple+added");
}

export async function updateTempleAction(formData: FormData) {
  await requireAuth(["owner", "team_head", "senior_incharge", "developer"]);
  const admin = createAdminSupabaseClient();

  const id = text(formData, "id");
  // Daksh follow-on: temple name, code_prefix and default_stone
  // are now LOCKED after creation. Changing them mid-flow caused
  // problems (slab IDs, existing references). The edit form
  // surfaces them read-only; the server ignores any value the
  // client tries to send and only updates is_active. Form still
  // submits the original values via hidden inputs, but we don't
  // trust them — we only PATCH the status column.
  const is_active = formData.get("is_active") === "true";

  if (!id) redirect("/settings?toast=Missing+ID");

  const { error } = await admin
    .from("temples")
    .update({ is_active })
    .eq("id", id);
  if (error) redirect(`/settings?toast=${encodeURIComponent(error.message)}`);

  revalidatePath("/settings");
  revalidatePath("/slabs");
  redirect("/settings?toast=Temple+status+updated");
}

export async function deleteTempleAction(formData: FormData) {
  await requireAuth(["owner", "team_head", "senior_incharge", "developer"]);
  const admin = createAdminSupabaseClient();

  const id = text(formData, "id");
  const name = text(formData, "temple_name");

  // Block deletion if any slabs still reference this temple
  if (name) {
    const { count } = await admin
      .from("slab_requirements")
      .select("id", { count: "exact", head: true })
      .eq("temple", name);
    if ((count ?? 0) > 0) {
      redirect(`/settings?toast=${encodeURIComponent(`Cannot delete — ${count} slab(s) still belong to "${name}". Those slabs must be completed or removed first.`)}`);
    }
  }

  const { error } = await admin.from("temples").delete().eq("id", id);
  if (error) redirect(`/settings?toast=${encodeURIComponent(error.message)}`);

  revalidatePath("/settings");
  redirect("/settings?toast=Temple+deleted");
}

export async function updateUserAction(formData: FormData) {
  const { profile: currentUser } = await requireAuth(["owner", "team_head", "senior_incharge", "developer"]);
  const admin = createAdminSupabaseClient();

  const id = text(formData, "id");
  const requestedRole = text(formData, "role") || "block_slab_entry";
  const full_name = text(formData, "full_name") || null;
  const is_active = formData.get("is_active") === "true";
  // Daksh May 2026 — carving vendor binding. Form sends an empty
  // string when the picker is "— none —", which we coerce to NULL.
  // Only honored when the requested role is "vendor"; otherwise we
  // force NULL so a role change away from vendor doesn't leave a
  // stale binding behind.
  const requestedVendorIdRaw = text(formData, "vendor_id");
  const requestedVendorId = requestedVendorIdRaw ? requestedVendorIdRaw : null;

  if (!id) redirect("/settings?toast=Missing+fields");
  if (id === currentUser.id) redirect("/settings?toast=Cannot+edit+your+own+account");

  // Developer accounts are protected — nobody can edit them
  const { data: target } = await admin.from("profiles").select("role").eq("id", id).single();
  if (target?.role === "developer") redirect("/settings?toast=Developer+account+is+protected");

  // Role assignment rules:
  // - Developer: can assign any role including owner/developer
  // - Owner + Planner: can assign anything EXCEPT owner/developer.
  //   Daksh May 2026 — this list previously omitted carving_head,
  //   vendor (CNC OPERATOR), and slab_transfer even though the UI
  //   (UI_ROLES_PLANNER in /settings/page.tsx) offered them. So an
  //   owner picking "CARVING HEAD" / "CNC OPERATOR" / "SLAB TRANSFER"
  //   would hit "Cannot+assign+that+role" with no UI hint. Aligned
  //   the server allowlist with what the UI shows — owner can hand
  //   out every operational role but not promote to owner/developer
  //   (or to the privileged finance roles that need separate dev
  //   sign-off: accountant, accountant_star, crosscheck,
  //   cnc_expense_entry, storekeeper).
  const RESTRICTED_ASSIGNABLE = [
    // Mig 076 — owner can promote to senior_incharge (Rajesh-tier).
    // team_head cannot — a peer shouldn't be able to elevate another
    // team_head over themselves. Handled below by a tighter gate.
    "senior_incharge",
    "team_head",
    "carving_head",
    "block_slab_entry",
    "slab_entry",
    "block_entry",
    "cutting_operator",
    "vendor",
    "slab_transfer",
  ];
  const role = requestedRole;
  if (currentUser.role === "owner" || currentUser.role === "team_head" || currentUser.role === "senior_incharge") {
    if (!RESTRICTED_ASSIGNABLE.includes(requestedRole)) {
      redirect("/settings?toast=Cannot+assign+that+role");
    }
    // Senior_incharge is owner-promoted only; team_head can pick
    // every other role but not lift someone to senior-tier.
    if (
      requestedRole === "senior_incharge" &&
      currentUser.role === "team_head"
    ) {
      redirect("/settings?toast=Only+owner+can+promote+to+Senior+Incharge");
    }
  }
  // developer: no restriction

  // If transitioning to "vendor", require a vendor pick (otherwise the
  // role is meaningless — the vendor cockpit needs a vendor_id to
  // scope to). Validate that the picked vendor exists + is a carving
  // vendor (CNC or Manual) so a typo doesn't bind the user to a
  // random row.
  let vendorIdToSave: string | null = null;
  if (role === "vendor") {
    if (!requestedVendorId) {
      redirect("/settings?toast=Pick+a+carving+vendor+for+this+user");
    }
    const { data: vendorRow } = await admin
      .from("vendors")
      .select("id, vendor_type, is_active")
      .eq("id", requestedVendorId)
      .maybeSingle();
    if (!vendorRow) {
      redirect("/settings?toast=Vendor+not+found");
    }
    if (!vendorRow.is_active) {
      redirect("/settings?toast=Pick+an+active+vendor");
    }
    if (vendorRow.vendor_type !== "CNC" && vendorRow.vendor_type !== "Outsource") {
      redirect("/settings?toast=Not+a+carving+vendor");
    }
    vendorIdToSave = vendorRow.id;
  }
  // Roles other than "vendor" never carry a vendor_id; null any
  // stale binding so the JOIN in getAuthContext doesn't pick up
  // garbage if someone flips vendor → accountant.

  const { error } = await admin
    .from("profiles")
    .update({
      role,
      is_active,
      vendor_id: vendorIdToSave,
      ...(full_name !== null ? { full_name } : {}),
    })
    .eq("id", id);
  if (error) redirect(`/settings?toast=${encodeURIComponent(error.message)}`);

  revalidatePath("/settings");
  redirect("/settings?toast=User+updated");
}

export async function updateOwnNameAction(formData: FormData) {
  // Daksh May 2026 — locked to developer. Multiple role gates key
  // off the display name (sidebar grants RAJESH / NARESH dashboard
  // access by name match), and a self-rename would silently revoke
  // those grants. UI no longer renders the form for non-devs, but
  // a stale tab / scripted POST is still blocked here.
  const { profile: currentUser } = await requireAuth(["developer"]);
  const admin = createAdminSupabaseClient();

  const full_name = text(formData, "full_name").trim();
  if (!full_name) redirect("/settings?toast=Name+cannot+be+empty");

  const { error } = await admin
    .from("profiles")
    .update({ full_name })
    .eq("id", currentUser.id);
  if (error) redirect(`/settings?toast=${encodeURIComponent(error.message)}`);

  revalidatePath("/settings");
  redirect("/settings?toast=Your+name+updated");
}

export async function deleteUserAction(formData: FormData) {
  const { profile: currentUser } = await requireAuth(["owner", "developer"]);
  const admin = createAdminSupabaseClient();

  const id = text(formData, "id");
  if (!id) redirect("/settings?toast=Missing+ID");
  if (id === currentUser.id) redirect("/settings?toast=Cannot+remove+your+own+account");

  // Developer accounts are protected — nobody can remove them
  const { data: target } = await admin.from("profiles").select("role").eq("id", id).single();
  if (target?.role === "developer") redirect("/settings?toast=Developer+account+is+protected");

  // NULL out every FK column that references this user across all tables.
  // These columns have no ON DELETE clause (defaults to RESTRICT), so we must
  // clear them before the profile row can be removed.
  await Promise.all([
    admin.from("blocks").update({ created_by: null }).eq("created_by", id),
    admin.from("blocks").update({ updated_by: null }).eq("updated_by", id),
    admin.from("slab_requirements").update({ created_by: null }).eq("created_by", id),
    admin.from("slab_requirements").update({ updated_by: null }).eq("updated_by", id),
    admin.from("cut_sessions").update({ planned_by: null }).eq("planned_by", id),
    admin.from("cut_sessions").update({ approved_by: null }).eq("approved_by", id),
    admin.from("carving_items").update({ assigned_by: null }).eq("assigned_by", id),
    admin.from("carving_items").update({ review_approved_by: null }).eq("review_approved_by", id),
    admin.from("dispatch_logs").update({ dispatched_by: null }).eq("dispatched_by", id),
    admin.from("carving_job_events").update({ user_id: null }).eq("user_id", id),
  ]);

  // Delete from auth.users — cascades automatically to profiles
  const { error: authError } = await admin.auth.admin.deleteUser(id);
  if (authError) redirect(`/settings?toast=${encodeURIComponent(authError.message)}`);

  revalidatePath("/settings");
  redirect("/settings?toast=User+permanently+deleted");
}

// ── Bulk slab-import password (Daksh June 2026) ─────────────────────
// Sets the password the /slabs/import flow asks for before committing a
// bulk add. Stored HASHED in system_settings (no migration). Only
// owner / developer / senior_incharge may change it.
export async function setBulkImportPasswordAction(formData: FormData) {
  const { profile } = await requireAuth(["owner", "developer", "senior_incharge"]);
  const admin = createAdminSupabaseClient();

  const pw = text(formData, "password");
  if (pw.length < 3) {
    redirect("/settings?toast=Password+must+be+at+least+3+characters");
  }

  const { error } = await admin.from("system_settings").upsert(
    {
      key: BULK_IMPORT_PASSWORD_KEY,
      value: { hash: hashBulkImportPassword(pw) },
      updated_at: new Date().toISOString(),
      updated_by: profile.id,
    },
    { onConflict: "key" },
  );
  if (error) {
    redirect(
      `/settings?toast=${encodeURIComponent(
        error.message?.toLowerCase().includes("system_settings")
          ? "system_settings table missing — run migration 031 first."
          : error.message,
      )}`,
    );
  }

  await logAudit(profile.id, "bulk_import_password_set", "system_settings", BULK_IMPORT_PASSWORD_KEY, {});
  revalidatePath("/settings");
  redirect("/settings?toast=Bulk+import+password+updated");
}
