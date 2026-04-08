import { redirect } from "next/navigation";

import { createServerSupabaseClient } from "@/lib/supabase/server";
import type { AppRole, Profile } from "@/lib/types";

export function getDefaultRouteForRole(role?: AppRole | null) {
  switch (role) {
    case "owner":
    case "planner":
    case "dispatch":
      return "/dashboard";
    case "block_entry":
      return "/blocks";
    case "slab_entry":
      return "/slabs";
    case "worker":
      return "/cutting";
    case "carving_assigner":
      return "/carving-assign";
    case "vendor":
      return "/carving";
    default:
      return "/login";
  }
}

export async function getAuthContext() {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    return { user: null, profile: null as Profile | null };
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, full_name, phone, role, vendor_id, is_active")
    .eq("id", user.id)
    .single();

  let vendorName: string | null = null;
  if (profile?.vendor_id) {
    const { data: vendor } = await supabase.from("vendors").select("name").eq("id", profile.vendor_id).single();
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

export async function requireAuth(roles?: AppRole[]) {
  const ctx = await getAuthContext();

  if (!ctx.user || !ctx.profile || !ctx.profile.is_active) {
    redirect("/login");
  }

  if (roles && roles.length && !roles.includes(ctx.profile.role)) {
    redirect(getDefaultRouteForRole(ctx.profile.role));
  }

  return ctx;
}
