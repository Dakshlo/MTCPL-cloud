import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { createAdminSupabaseClient } from "./admin";
import type { AppRole } from "@/lib/types";

/**
 * Returns admin client for developer role (bypasses RLS so developer sees all data),
 * regular session client for everyone else.
 */
export async function createDataClient(role: AppRole) {
  if (role === "developer") return createAdminSupabaseClient();
  return createServerSupabaseClient();
}

export async function createServerSupabaseClient() {
  const cookieStore = await cookies();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!url || !key) {
    throw new Error("Missing Supabase environment variables.");
  }

  return createServerClient(url, key, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value, options }) => {
          cookieStore.set(name, value, options);
        });
      }
    }
  });
}
