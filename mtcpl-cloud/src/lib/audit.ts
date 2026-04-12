import { createServerSupabaseClient } from "@/lib/supabase/server";

export async function logAudit(
  userId: string,
  action: string,
  entityType: string,
  entityId: string,
  details?: Record<string, unknown>
) {
  try {
    const supabase = await createServerSupabaseClient();
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
