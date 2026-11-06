import { after } from "next/server";

import { createAdminSupabaseClient } from "@/lib/supabase/admin";

/**
 * Write an audit row.
 *
 * NOBODY WAITS FOR THIS. Daksh Nov 2026 — the function already
 * swallowed its own errors ("audit logging should never break main
 * flow"), yet 27 finance actions still `await` it, so every Hold
 * amount / Settle / Approve made the user sit through an extra
 * round trip to the audit table before the action could return.
 *
 * It is handed to Next's `after()` instead: the response goes out
 * immediately and the platform keeps the function alive long enough
 * to finish the insert. That is the important difference from a bare
 * `void logAudit(...)`, which on a serverless host can be killed the
 * moment the response is flushed — around thirty call sites were
 * already doing that and quietly risking a lost audit row.
 *
 * Callers can keep `await`ing it; the await now costs nothing.
 */
export async function logAudit(
  userId: string,
  action: string,
  entityType: string,
  entityId: string,
  details?: Record<string, unknown>
) {
  const write = async () => {
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
  };

  try {
    after(write);
  } catch {
    // Outside a request scope — a script, a test, a cron tick. There is
    // no response to run after, so just do it inline.
    await write();
  }
}
