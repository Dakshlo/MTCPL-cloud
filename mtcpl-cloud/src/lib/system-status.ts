import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import type { Department } from "@/lib/departments";

/**
 * System maintenance flag.
 *
 * Migration 031 introduced a single global flag at
 * `system_settings.key = 'system_status'`. Migration 036 added three
 * per-department flags — `production_status`, `finance_status`,
 * `inventory_status` — using the same JSONB shape (`{down, message}`).
 * The legacy global key is preserved for back-compat / global-override
 * but the layout now consults per-department flags first.
 *
 * SAFETY-FIRST: any failure path (table missing, row missing, malformed
 * JSON) returns `{ down: false }`. This means:
 *   • Deploying without running the relevant migration = app stays live.
 *   • Database glitch mid-request = app stays live.
 *   • The ONLY way the maintenance screen kicks in is when the row
 *     explicitly has `value.down === true`.
 */
export type SystemStatus = {
  down: boolean;
  message: string | null;
  updatedAt: string | null;
  updatedBy: string | null;
};

const FALLBACK: SystemStatus = {
  down: false,
  message: null,
  updatedAt: null,
  updatedBy: null,
};

/** Map a Department id to its system_settings row key. */
export function deptStatusKey(dept: Department): string {
  return `${dept}_status`;
}

async function readStatusByKey(key: string): Promise<SystemStatus> {
  try {
    const supabase = createAdminSupabaseClient();
    const { data, error } = await supabase
      .from("system_settings")
      .select("value, updated_at, updated_by")
      .eq("key", key)
      .maybeSingle();
    if (error || !data) return FALLBACK;
    const raw = data.value as unknown;
    if (!raw || typeof raw !== "object") return FALLBACK;
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
    return FALLBACK;
  }
}

/** Legacy global flag from migration 031. The root layout calls this
 *  in addition to the per-department flag — if EITHER says down,
 *  the lock screen renders. Kept so a developer can still take the
 *  whole app offline in one click. */
export async function getSystemStatus(): Promise<SystemStatus> {
  return readStatusByKey("system_status");
}

/** Per-department flag from migration 036. Falls back safely to
 *  `down: false` if the row is missing (migration not yet applied
 *  in this environment). */
export async function getDepartmentStatus(
  dept: Department,
): Promise<SystemStatus> {
  return readStatusByKey(deptStatusKey(dept));
}

/** Composite check used by the root layout: returns the FIRST down
 *  status it finds across (a) the global flag and (b) the
 *  department-specific flag. Returns FALLBACK if both are up. */
export async function getEffectiveStatus(
  dept: Department,
): Promise<SystemStatus & { source: "global" | "department" | null }> {
  const [global, perDept] = await Promise.all([
    getSystemStatus(),
    getDepartmentStatus(dept),
  ]);
  if (global.down) return { ...global, source: "global" };
  if (perDept.down) return { ...perDept, source: "department" };
  return { ...FALLBACK, source: null };
}
