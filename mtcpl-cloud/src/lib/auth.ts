import { redirect } from "next/navigation";

import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import type { AppRole, Profile } from "@/lib/types";

export function getDefaultRouteForRole(role?: AppRole | null) {
  switch (role) {
    case "developer":
    case "owner":
      return "/dashboard";
    case "team_head":
      return "/slabs";
    case "carving_head":
      return "/slabs/ready";
    case "dispatch":
    case "block_slab_entry":
    case "block_entry":
      return "/blocks";
    case "slab_entry":
      return "/slabs";
    case "cutting_operator":
      return "/cutting";
    case "carving_assigner":
      return "/dashboard";
    case "vendor":
      return "/cutting";
    case "slab_transfer":
      // Migration 025 — slab transfer runner. Lands on the transfer
      // dispatch list and works through pickups from there.
      return "/carving/transfer";
    case "biller":
      // Migration 028 — accounting bill entry. The biller's primary
      // action is "enter a new bill", so they land directly on the
      // entry form. /accounts/bills (their own submissions list) is
      // one click away via the sidebar.
      return "/accounts/bills/new";
    case "accountant":
      // Migration 028 — accountant lands on the due-bills dashboard
      // (aging buckets + multi-select propose-pay-today).
      return "/accounts";
    case "worker":
      return "/pending";
    default:
      return "/login";
  }
}

export function getDefaultRouteForProfile(profile?: Pick<Profile, "role" | "is_active"> | null) {
  if (!profile) {
    return "/login";
  }

  if (!profile.is_active) {
    return "/pending";
  }

  return getDefaultRouteForRole(profile.role);
}

const DEV_MOCK_PROFILE: Profile = {
  id: "dev-user-id",
  full_name: "Dev Owner",
  phone: null,
  role: "owner" as AppRole,
  vendor_id: null,
  vendor_name: null,
  is_active: true,
  theme_preference: null,
};

export async function getAuthContext() {
  if (process.env.NODE_ENV === "development" && process.env.DEV_BYPASS_AUTH === "1") {
    return { user: { id: "dev-user-id", email: "dev@local" } as any, profile: DEV_MOCK_PROFILE };
  }

  const supabase = await createServerSupabaseClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    return { user: null, profile: null as Profile | null };
  }

  // Use admin client for profile lookup — RLS should never block a user from seeing their own profile,
  // but using admin eliminates any policy edge-cases (e.g. new users with unusual roles).
  //
  // SELECT *  — listing each column by name turned out to be unsafe.
  // Migration 027 added `can_approve_cuts` and an explicit select that
  // referenced it pre-emptively in the deploy meant the query 400'd
  // for any environment where the migration hadn't run yet, the
  // existing profile silently disappeared from view, and the
  // auto-create branch below CLOBBERED real developer/owner rows
  // with a worker stub. `*` keeps this query forward-compatible
  // (any new column shows up automatically) and removes the
  // missing-column footgun entirely.
  const admin = createAdminSupabaseClient();
  type ProfileRow = {
    id: string;
    full_name: string | null;
    phone: string | null;
    role: AppRole;
    vendor_id: string | null;
    is_active: boolean;
    theme_preference?: "light" | "dark" | null;
    can_approve_cuts?: boolean;
  };
  let { data: profile } = (await admin
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single()) as { data: ProfileRow | null };

  // Auto-create profile if missing (trigger failed, or profile was deleted while auth user remains).
  // Uses upsert with `ignoreDuplicates: true` — never replaces an
  // existing row. Double-safety after the migration-027 incident
  // where a SELECT failure looked like a missing profile and a
  // plain INSERT here would have over-written real roles.
  if (!profile) {
    const phone = user.phone ?? null;
    const fullName = user.user_metadata?.full_name ?? "";
    await admin
      .from("profiles")
      .upsert(
        {
          id: user.id,
          full_name: fullName,
          phone,
          role: "worker",
          is_active: false,
        },
        { onConflict: "id", ignoreDuplicates: true },
      );

    const { data: newProfile } = (await admin
      .from("profiles")
      .select("*")
      .eq("id", user.id)
      .single()) as { data: ProfileRow | null };
    profile = newProfile;
  }

  let vendorName: string | null = null;
  if (profile?.vendor_id) {
    const { data: vendor } = await admin.from("vendors").select("name").eq("id", profile.vendor_id).single();
    vendorName = vendor?.name ?? null;
  }

  return {
    user,
    profile: profile
      ? ({
          ...profile,
          vendor_name: vendorName
        } as Profile)
      : null
  };
}

export async function requireAuth(roles?: AppRole[]): Promise<{ user: NonNullable<Awaited<ReturnType<typeof getAuthContext>>["user"]>; profile: NonNullable<Awaited<ReturnType<typeof getAuthContext>>["profile"]> }> {
  const ctx = await getAuthContext();

  if (!ctx.user || !ctx.profile) {
    redirect("/login");
  }

  if (!ctx.profile.is_active) {
    redirect("/pending");
  }

  // Developer role is a superuser — bypasses all role checks
  if (roles && roles.length && ctx.profile.role !== "developer" && !roles.includes(ctx.profile.role)) {
    redirect(getDefaultRouteForRole(ctx.profile.role));
  }

  return ctx as any;
}
