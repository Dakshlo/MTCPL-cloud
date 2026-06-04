/**
 * Shared marker for the cockpit "Power cut — all machines down" feature
 * (Daksh, June 2026).
 *
 * When a vendor presses the global power-cut button, every running /
 * idle CNC of that vendor is pushed into the SAME maintenance-pause
 * mechanism the per-machine "Maintenance" button uses (status =
 * 'maintenance' + maintenance_flagged_at), tagged with this exact
 * reason string. "Power's back — resume all" then finds + resumes only
 * the machines this power cut downed — never a machine that has a
 * genuine individual maintenance issue. Reuses existing columns, so no
 * schema migration is needed.
 *
 * Defined here (a plain module) rather than in the "use server" actions
 * file because that file may only export async server actions.
 */
export const POWER_CUT_REASON = "⚡ Power cut — all machines paused";
