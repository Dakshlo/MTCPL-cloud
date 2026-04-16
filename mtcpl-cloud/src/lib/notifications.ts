import { createAdminSupabaseClient } from "@/lib/supabase/admin";

/**
 * Fire-and-forget notification insert. Same contract as logAudit —
 * never throws, never breaks main flow.
 */
export async function notify(
  type: string,
  title: string,
  opts: {
    message?: string;
    entityType?: string;
    entityId?: string;
    actorId?: string;
    targetRoles?: string[];
  } = {}
) {
  try {
    const admin = createAdminSupabaseClient();
    await admin.from("notifications").insert({
      type,
      title,
      message: opts.message ?? null,
      entity_type: opts.entityType ?? null,
      entity_id: opts.entityId ?? null,
      actor_id: opts.actorId ?? null,
      target_roles: opts.targetRoles ?? ["team_head", "developer"],
    });
  } catch {
    // Notification insert should never break main flow
  }
}
