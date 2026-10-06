// ──────────────────────────────────────────────────────────────────
// The wardrobe QR — token lookup and the rules that go with it (mig 229).
//
// Shared by the guest page and the guest action so the token is checked
// the same way in both. The page check is a courtesy (it decides what to
// render); the ACTION check is the control, and it re-reads the token
// from the database on every take.
// ──────────────────────────────────────────────────────────────────

import { createAdminSupabaseClient } from "@/lib/supabase/admin";

export type ToolStoreLink = {
  id: string;
  token: string;
  label: string;
  dailyCap: number;
};

/** Why a scan did not open a working screen. The guest page turns each of
 *  these into a plain sentence — never a stack trace, never "invalid
 *  token", which tells a worker standing at a cupboard nothing. */
export type LinkProblem = "unknown" | "revoked" | "capped";

/** Resolve a token to a live link, or say why not.
 *
 *  `is_active` and `revoked_at` are both checked: revoking sets both, but
 *  a half-written revoke must still fail closed. */
export async function resolveToolStoreLink(
  token: string,
): Promise<{ link: ToolStoreLink } | { problem: LinkProblem }> {
  const clean = (token || "").trim();
  if (!clean) return { problem: "unknown" };

  const admin = createAdminSupabaseClient();
  const { data, error } = await admin
    .from("cnc_tool_store_links")
    .select("id, token, label, is_active, daily_cap, revoked_at")
    .eq("token", clean)
    .maybeSingle();

  if (error || !data) return { problem: "unknown" };
  const row = data as {
    id: string; token: string; label: string;
    is_active: boolean; daily_cap: number; revoked_at: string | null;
  };
  if (!row.is_active || row.revoked_at) return { problem: "revoked" };

  return {
    link: { id: row.id, token: row.token, label: row.label, dailyCap: row.daily_cap },
  };
}

/** Midnight IST today, as an ISO instant — the window the daily cap counts. */
export function istDayStartIso(now = Date.now()): string {
  const ist = new Date(now + 5.5 * 3_600_000);
  const y = ist.getUTCFullYear();
  const m = String(ist.getUTCMonth() + 1).padStart(2, "0");
  const d = String(ist.getUTCDate()).padStart(2, "0");
  // 00:00 IST == 18:30 UTC the previous day
  return new Date(`${y}-${m}-${d}T00:00:00+05:30`).toISOString();
}

/** Takes already recorded through this sticker today (IST). Undone rows
 *  still count — the cap is about write volume, not stock. */
export async function takesThroughLinkToday(linkId: string): Promise<number> {
  const admin = createAdminSupabaseClient();
  const { count } = await admin
    .from("cnc_tool_movements")
    .select("id", { count: "exact", head: true })
    .eq("guest_link_id", linkId)
    .gte("created_at", istDayStartIso());
  return count ?? 0;
}

/** A take may be at most this many units in one go. A cupboard tool goes
 *  out in ones and twos; 50 is a fat-finger, not a withdrawal. */
export const GUEST_MAX_QTY = 50;
