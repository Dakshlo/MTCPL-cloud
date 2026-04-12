import { createClient } from "@supabase/supabase-js";

/**
 * Admin Supabase client using the service role key.
 * Bypasses RLS entirely — use only in server-side owner/admin actions.
 * Requires SUPABASE_SERVICE_ROLE_KEY in environment variables.
 */
export function createAdminSupabaseClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY is not set. Add it to your .env.local and Vercel environment variables. " +
      "Get it from: Supabase Dashboard → Project Settings → API → service_role key."
    );
  }

  return createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
