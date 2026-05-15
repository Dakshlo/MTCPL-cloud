import { createAdminSupabaseClient } from "@/lib/supabase/admin";

/**
 * Append an audit-log row. Mirrors `notify()` — fire-and-forget,
 * never throws, never breaks the main flow.
 *
 * Uses the ADMIN client (service role) so the insert bypasses RLS.
 * Before May 2026 this used the user-session client; after
 * migration 029 enabled RLS on every public table with only a
 * SELECT policy, the INSERT silently started failing and the audit
 * log stopped recording. Switching to admin client matches what
 * notify() already does and keeps the contract consistent.
 */
export async function logAudit(
  userId: string,
  action: string,
  entityType: string,
  entityId: string,
  details?: Record<string, unknown>
) {
  try {
    const supabase = createAdminSupabaseClient();
    await supabase.from("audit_logs").insert({
      user_id: userId,
      action,
      entity_type: entityType,
      entity_id: entityId,
      details: details ?? null,
    });
  } catch {
    // Audit logging should never break main flow
  }
}
