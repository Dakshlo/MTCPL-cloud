import { createAdminSupabaseClient } from "@/lib/supabase/admin";

/** Map of profile id → human-readable display name */
export type ProfilesMap = Record<string, string>;

export async function getProfilesMap(): Promise<ProfilesMap> {
  const supabase = createAdminSupabaseClient();
  const { data } = await supabase
    .from("profiles")
    .select("id, full_name, vendor_name, phone");
  const map: ProfilesMap = {};
  for (const p of data ?? []) {
    map[p.id] = p.full_name || p.vendor_name || p.phone || "Unknown";
  }
  return map;
}
