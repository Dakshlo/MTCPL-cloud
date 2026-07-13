/**
 * Auth integration point — REPLACE THIS STUB before running.
 *
 * The Personal Ledger module expects an async `requireAuth()` that
 * returns the current user's profile. Wire it up to whatever auth
 * provider your project uses (Supabase Auth, NextAuth, Clerk, etc).
 *
 * Contract:
 *   • Must return `{ profile: { id: string; role?: string; ... } }`
 *     where `profile.id` is a STABLE per-user identifier (UUID,
 *     email, etc) — it's used as `owner_profile_id` on every row.
 *   • Must redirect to /login (or throw) if the user is not
 *     signed in. The module's pages assume a logged-in caller.
 *
 * In the original MTCPL Cloud app this lives at src/lib/auth.ts
 * and uses Supabase Auth + a `profiles` table. Adapt to your stack.
 */

import type { Profile } from "./personal-ledger-types";

export async function requireAuth(): Promise<{ profile: Profile }> {
  // TODO: replace with your real auth. Examples:
  //
  // ─ Supabase Auth + profiles table ─
  //   const supabase = await createServerSupabaseClient();
  //   const { data: { user } } = await supabase.auth.getUser();
  //   if (!user) redirect("/login");
  //   const { data: profile } = await supabase
  //     .from("profiles").select("id, role").eq("id", user.id).single();
  //   return { profile };
  //
  // ─ NextAuth ─
  //   const session = await getServerSession(authOptions);
  //   if (!session?.user?.id) redirect("/login");
  //   return { profile: { id: session.user.id, role: "owner" } };
  //
  // ─ Single-user / dev mode ─
  //   return { profile: { id: "single-user", role: "owner" } };
  //
  throw new Error(
    "[personal-ledger] requireAuth() not wired up — replace the stub in src/lib/auth.ts before using the Personal Ledger module.",
  );
}
