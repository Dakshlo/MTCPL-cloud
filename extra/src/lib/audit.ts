/**
 * Audit log integration point — REPLACE THIS STUB.
 *
 * The Personal Ledger module calls `logAudit(...)` after every
 * mutation (party added, invoice cancelled, PIN set, etc.) — this
 * is a CORE design property of the module, not optional. Every
 * personal-ledger action prefixes its audit row with
 * `personal_ledger_*` so a SQL search on the audit table can
 * surface the full history for any party / invoice / receipt.
 *
 * Contract:
 *   • Fire-and-forget OK — callers use `void logAudit(...)`.
 *   • Must not throw the caller's transaction on failure
 *     (best-effort, don't crash the request if the audit
 *     insert times out).
 *
 * Minimum viable implementation: write a row to an `audit_logs`
 * table with these columns. Schema:
 *
 *   CREATE TABLE audit_logs (
 *     id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 *     actor_profile_id UUID NOT NULL,
 *     action          TEXT NOT NULL,
 *     entity_kind     TEXT NOT NULL,
 *     entity_id       TEXT NOT NULL,
 *     details         JSONB NOT NULL DEFAULT '{}'::jsonb,
 *     created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
 *   );
 *
 * Real impl (Supabase):
 *
 *   import { createAdminSupabaseClient } from "./supabase-admin";
 *   export async function logAudit(
 *     actorProfileId: string,
 *     action: string,
 *     entityKind: string,
 *     entityId: string,
 *     details: Record<string, unknown> = {},
 *   ): Promise<void> {
 *     const supabase = createAdminSupabaseClient();
 *     await supabase.from("audit_logs").insert({
 *       actor_profile_id: actorProfileId,
 *       action,
 *       entity_kind: entityKind,
 *       entity_id: entityId,
 *       details,
 *     });
 *   }
 *
 * If you DELETE this audit-log integration entirely, you're
 * removing a property the original module was designed around.
 * That's your call, but be deliberate about it — don't just
 * silently no-op the function and lose the trail.
 */

export async function logAudit(
  _actorProfileId: string,
  _action: string,
  _entityKind: string,
  _entityId: string,
  _details: Record<string, unknown> = {},
): Promise<void> {
  // TODO: replace with real insert into your audit_logs table.
  // Until then, console-log so the trail at least exists in your
  // terminal during development. DO NOT ship this stub to prod.
  if (typeof console !== "undefined") {
    console.warn(
      "[personal-ledger][audit-stub]",
      JSON.stringify({
        actor: _actorProfileId,
        action: _action,
        entity: `${_entityKind}#${_entityId}`,
        details: _details,
      }),
    );
  }
}
