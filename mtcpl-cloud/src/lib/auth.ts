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
      // Daksh (May 2026): Total Ready Sizes removed from the
      // carving_head sidebar — they already have Ready Sizes Stock
      // (the actionable bucket view at /slabs/ready/for-carving), and
      // having both was redundant for the carving role. Landing page
      // moved to the actionable view too. Side effect: when Parth or
      // any future carving_head clicks a page they don't have access
      // to, they bounce back to a useful workspace instead of a
      // verification list they don't own.
      return "/slabs/ready/for-carving";
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
      // Daksh May 2026 — was "/cutting" historically, but /cutting's
      // requireAuth gate doesn't accept the vendor role, so any
      // vendor user landed in a redirect loop (cutting → vendor's
      // default → cutting → ...). Their actual workspace is the CNC
      // cockpit at /vendor (it auto-scopes to profile.vendor_id),
      // which is what they should see on login anyway.
      return "/vendor";
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
      // Mig 037 expands accountant duties to include bill entry too.
      return "/accounts";
    case "crosscheck":
      // Mig 037 — crosscheck role's only job is the bill verification
      // gate. Their natural landing is the audit queue.
      // Mig 041 adds an Inventory Audit queue to the same human's
      // plate, but the bill queue is still the primary daily duty,
      // so the bill audit stays as the default landing.
      return "/accounts/approvals";
    case "accountant_star":
      // Mig 053 — UTR / bank-statement recheck. Lands on the
      // dedicated Final Audit queue.
      return "/accounts/final-audit";
    case "cnc_expense_entry":
      // Mig 054 — single-page portal for CNC operational expense
      // entry. The role has no other surface in the app; this is
      // their entire workspace.
      return "/carving/expenses";
    case "storekeeper":
      // Mig 041 — yard employee. The scaffolding board is the
      // primary workspace; everything else (issue/return forms,
      // sites, catalog) is a click away from there.
      return "/inventory/scaffolding";
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
    can_approve_bills?: boolean;
    active_department?: "production" | "finance" | "inventory" | "invoicing" | null;
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
