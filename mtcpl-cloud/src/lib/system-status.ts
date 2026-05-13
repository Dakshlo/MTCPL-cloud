import { createAdminSupabaseClient } from "@/lib/supabase/admin";

/**
 * Global system maintenance flag (migration 031).
 *
 * Returned from a single row in `system_settings` (key=`system_status`).
 * The layout calls this on every authenticated page-load — if `down`
 * is true, every non-developer is short-circuited to the maintenance
 * screen.
 *
 * SAFETY-FIRST: any failure path (table missing, query error, malformed
 * JSON) returns `{ down: false }`. This means:
 *   • Deploying the code without running migration 031 = app keeps working.
 *   • Database glitch mid-request = app keeps working.
 *   • The ONLY way the maintenance screen kicks in is when the row
 *     explicitly has `value.down === true`.
 *
 * Conservative by design — better to show the app when the flag is
 * ambiguous than to accidentally lock everyone out.
 */
export type SystemStatus = {
  down: boolean;
  message: string | null;
  updatedAt: string | null;
  updatedBy: string | null;
};

export async function getSystemStatus(): Promise<SystemStatus> {
  const fallback: SystemStatus = {
    down: false,
    message: null,
    updatedAt: null,
    updatedBy: null,
  };
  try {
    const supabase = createAdminSupabaseClient();
    const { data, error } = await supabase
      .from("system_settings")
      .select("value, updated_at, updated_by")
      .eq("key", "system_status")
      .maybeSingle();
    if (error || !data) return fallback;
    const raw = data.value as unknown;
    if (!raw || typeof raw !== "object") return fallback;
    const obj = raw as { down?: unknown; message?: unknown };
    return {
      down: obj.down === true,
      message:
        typeof obj.message === "string" && obj.message.trim() !== ""
          ? obj.message
          : null,
      updatedAt: (data.updated_at as string | null) ?? null,
      updatedBy: (data.updated_by as string | null) ?? null,
    };
  } catch {
    return fallback;
  }
}
