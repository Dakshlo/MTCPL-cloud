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

const DEV_MOCK_PROFILE = {
  id: "dev-user-id",
  full_name: "Dev Owner",
  phone: null,
  role: "owner" as AppRole,
  vendor_id: null,
  vendor_name: null,
  is_active: true,
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
  // but using admin eliminates any policy edge-cases (e.g. new users with unusual roles)
  const admin = createAdminSupabaseClient();
  const { data: profile } = await admin
    .from("profiles")
    .select("id, full_name, phone, role, vendor_id, is_active")
    .eq("id", user.id)
    .single();

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
