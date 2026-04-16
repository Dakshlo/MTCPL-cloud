"use server";

import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { getProfilesMap } from "@/lib/profiles";

export type NotificationItem = {
  id: string;
  type: string;
  title: string;
  message: string | null;
  entity_type: string | null;
  entity_id: string | null;
  actor_id: string | null;
  actor_name: string | null;
  is_read: boolean;
  created_at: string;
  synthetic?: boolean; // overdue alerts generated in memory
};

export async function getNotifications(
  userId: string,
  role: string
): Promise<{ notifications: NotificationItem[]; unreadCount: number }> {
  const admin = createAdminSupabaseClient();

  // 1. Fetch stored notifications for this role (last 30)
  const { data: rows } = await admin
    .from("notifications")
    .select("id, type, title, message, entity_type, entity_id, actor_id, read_by, created_at")
    .contains("target_roles", [role])
    .order("created_at", { ascending: false })
    .limit(30);

  const profilesMap = await getProfilesMap();

  const stored: NotificationItem[] = (rows ?? []).map((r) => ({
    id: r.id,
    type: r.type,
    title: r.title,
    message: r.message,
    entity_type: r.entity_type,
    entity_id: r.entity_id,
    actor_id: r.actor_id,
    actor_name: r.actor_id ? profilesMap[r.actor_id] ?? null : null,
    is_read: Array.isArray(r.read_by) && r.read_by.includes(userId),
    created_at: r.created_at,
  }));

  // 2. Generate synthetic overdue alerts (blocks cutting > 24h)
  const twentyFourAgo = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const { data: overdueBlocks } = await admin
    .from("cut_session_blocks")
    .select("id, block_id, updated_at")
    .eq("status", "cutting")
    .lt("updated_at", twentyFourAgo);

  const overdue: NotificationItem[] = (overdueBlocks ?? []).map((b) => {
    const hours = Math.floor(
      (Date.now() - new Date(b.updated_at).getTime()) / 3600000
    );
    const label = hours >= 48 ? `${Math.floor(hours / 24)}d ${hours % 24}h` : `${hours}h`;
    return {
      id: `overdue-${b.id}`,
      type: "cut_overdue",
      title: `Block ${b.block_id} overdue`,
      message: `Cutting for ${label} — attention required`,
      entity_type: "cut_session_block",
      entity_id: b.id,
      actor_id: null,
      actor_name: null,
      is_read: false,
      created_at: b.updated_at,
      synthetic: true,
    };
  });

  // 3. Merge: overdue at top, then stored
  const all = [...overdue, ...stored];
  const unreadCount = all.filter((n) => !n.is_read).length;

  return { notifications: all, unreadCount };
}

export async function markAllReadAction() {
  const { profile } = await requireAuth(["developer", "team_head"]);
  const admin = createAdminSupabaseClient();

  // Fetch all unread notifications for this role
  const { data: rows } = await admin
    .from("notifications")
    .select("id, read_by")
    .contains("target_roles", [profile.role]);

  if (!rows || rows.length === 0) return;

  // Filter to only those not already read by this user, then append
  const toUpdate = rows.filter(
    (r) => !Array.isArray(r.read_by) || !r.read_by.includes(profile.id)
  );

  for (const row of toUpdate) {
    const current = Array.isArray(row.read_by) ? row.read_by : [];
    await admin
      .from("notifications")
      .update({ read_by: [...current, profile.id] })
      .eq("id", row.id);
  }
}

export async function markOneReadAction(notificationId: string) {
  const { profile } = await requireAuth(["developer", "team_head"]);
  const admin = createAdminSupabaseClient();

  const { data: row } = await admin
    .from("notifications")
    .select("read_by")
    .eq("id", notificationId)
    .single();

  if (!row) return;

  const current = Array.isArray(row.read_by) ? row.read_by : [];
  if (current.includes(profile.id)) return;

  await admin
    .from("notifications")
    .update({ read_by: [...current, profile.id] })
    .eq("id", notificationId);
}
