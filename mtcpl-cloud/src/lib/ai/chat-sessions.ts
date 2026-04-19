"use server";

/**
 * Server actions for the Ask AI "recent chats" sidebar.
 *
 * All reads/writes go through createAdminSupabaseClient() (bypasses RLS) and
 * every action calls requireAuth() first to gate access to owner+developer.
 * RLS policies on the tables are a second line of defence for any other
 * code that ends up reading through the user's JWT client.
 */

import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";

export type ChatSessionSummary = {
  id: string;
  title: string;
  updatedAt: string;
  messageCount: number;
};

export type ChatMessageRow = {
  id: string;
  role: "user" | "assistant";
  content: string;
  images?: string[] | null;
  createdAt: string;
};

/** Recent sessions for the current user, newest-updated first. */
export async function listRecentSessions(limit = 30): Promise<ChatSessionSummary[]> {
  const { profile } = await requireAuth(["owner", "developer"]);
  const admin = createAdminSupabaseClient();

  const { data: sessions, error } = await admin
    .from("chat_sessions")
    .select("id, title, updated_at")
    .eq("user_id", profile.id)
    .order("updated_at", { ascending: false })
    .limit(limit);
  if (error || !sessions) return [];

  if (sessions.length === 0) return [];

  // Fetch message counts for all sessions in one query.
  const { data: msgs } = await admin
    .from("chat_messages")
    .select("session_id")
    .in("session_id", sessions.map((s) => s.id));

  const countBySession = new Map<string, number>();
  for (const m of msgs ?? []) {
    countBySession.set(m.session_id, (countBySession.get(m.session_id) ?? 0) + 1);
  }

  return sessions.map((s) => ({
    id: s.id,
    title: s.title || "Untitled chat",
    updatedAt: s.updated_at,
    messageCount: countBySession.get(s.id) ?? 0,
  }));
}

/** Load all messages for one session, oldest first. Verifies ownership. */
export async function loadSessionMessages(sessionId: string): Promise<ChatMessageRow[]> {
  const { profile } = await requireAuth(["owner", "developer"]);
  const admin = createAdminSupabaseClient();

  const { data: session } = await admin
    .from("chat_sessions")
    .select("user_id")
    .eq("id", sessionId)
    .single();

  if (!session || session.user_id !== profile.id) return [];

  const { data: msgs, error } = await admin
    .from("chat_messages")
    .select("id, role, content, images, created_at")
    .eq("session_id", sessionId)
    .order("created_at", { ascending: true });
  if (error || !msgs) return [];

  return msgs.map((m) => ({
    id: m.id,
    role: m.role as "user" | "assistant",
    content: m.content,
    images: (m as { images?: string[] | null }).images ?? null,
    createdAt: m.created_at,
  }));
}

/** Delete a session (cascades to its messages). Verifies ownership. */
export async function deleteSession(sessionId: string): Promise<{ ok: true } | { error: string }> {
  const { profile } = await requireAuth(["owner", "developer"]);
  const admin = createAdminSupabaseClient();

  const { data: session } = await admin
    .from("chat_sessions")
    .select("user_id")
    .eq("id", sessionId)
    .single();

  if (!session) return { error: "Session not found" };
  if (session.user_id !== profile.id) return { error: "Not allowed" };

  const { error } = await admin.from("chat_sessions").delete().eq("id", sessionId);
  if (error) return { error: error.message };
  return { ok: true };
}

/** Rename a session. Verifies ownership. */
export async function renameSession(
  sessionId: string,
  title: string,
): Promise<{ ok: true } | { error: string }> {
  const { profile } = await requireAuth(["owner", "developer"]);
  const admin = createAdminSupabaseClient();

  const trimmed = title.trim().slice(0, 120);
  if (!trimmed) return { error: "Title is required" };

  const { data: session } = await admin
    .from("chat_sessions")
    .select("user_id")
    .eq("id", sessionId)
    .single();
  if (!session) return { error: "Session not found" };
  if (session.user_id !== profile.id) return { error: "Not allowed" };

  const { error } = await admin
    .from("chat_sessions")
    .update({ title: trimmed })
    .eq("id", sessionId);
  if (error) return { error: error.message };
  return { ok: true };
}
