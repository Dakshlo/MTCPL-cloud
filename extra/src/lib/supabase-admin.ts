/**
 * Supabase admin client integration point — REPLACE THIS STUB.
 *
 * The Personal Ledger module uses a service-role Supabase client
 * for all writes (and most reads) because every query carries an
 * explicit `eq("owner_profile_id", profile.id)` filter — RLS is
 * the safety net but the app trusts itself first.
 *
 * Contract:
 *   • Must return a Supabase JS client created with the
 *     SUPABASE_SERVICE_ROLE_KEY (NOT the anon key).
 *   • The key must NEVER be exposed to the browser. This file
 *     should only be imported by server components and server
 *     actions.
 *
 * Typical implementation (Supabase JS v2):
 *
 *   import { createClient } from "@supabase/supabase-js";
 *
 *   export function createAdminSupabaseClient() {
 *     return createClient(
 *       process.env.NEXT_PUBLIC_SUPABASE_URL!,
 *       process.env.SUPABASE_SERVICE_ROLE_KEY!,
 *       { auth: { persistSession: false } },
 *     );
 *   }
 *
 * Note the import path expected by the personal-ledger code:
 *   `@/lib/supabase-admin`   (this file)
 *
 * If your project uses `@/lib/supabase/admin` instead, either
 * rename this file or update the import path at the call sites.
 */

// TODO: install @supabase/supabase-js and uncomment the real impl.
// import { createClient } from "@supabase/supabase-js";

export function createAdminSupabaseClient(): never {
  throw new Error(
    "[personal-ledger] createAdminSupabaseClient() not wired up — replace the stub in src/lib/supabase-admin.ts. Install @supabase/supabase-js, then return createClient(URL, SERVICE_ROLE_KEY).",
  );
}
