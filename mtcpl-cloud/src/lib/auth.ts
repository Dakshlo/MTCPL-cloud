import { redirect } from "next/navigation";

import { createServerSupabaseClient } from "@/lib/supabase/server";
import type { AppRole, Profile } from "@/lib/types";

export function getDefaultRouteForRole(role?: AppRole | null) {
  switch (role) {
    case "owner":
    case "planner":
      return "/dashboard";
    case "block_entry":
      return "/blocks";
    case "slab_entry":
      return "/slabs";
    case "worker":
      return "/cutting";
    case "carving_assigner":
      return "/dashboard";
    case "vendor":
      return "/cutting";
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
    .select("id, full_name, phone, role, is_active")
    .eq("id", user.id)
    .single();

  return {
    user,
    profile: (profile as Profile | null) ?? null
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

  if (roles && roles.length && !roles.includes(ctx.profile.role)) {
    redirect(getDefaultRouteForRole(ctx.profile.role));
  }

  return ctx as any;
}
