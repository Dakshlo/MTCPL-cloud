"use server";

/**
 * Server actions for the Ask AI "recent chats" sidebar.
 *
 * Access rules:
 *   - developer role  → sees every user's sessions, can read/delete/rename any
 *   - owner role      → sees only their own sessions (unchanged)
 *
 * All reads/writes go through createAdminSupabaseClient() (bypasses RLS) and
 * every action calls requireAuth() first to gate access to owner+developer.
 * RLS policies on the tables are a second line of defence for any other
 * code that ends up reading through the user's JWT client.
 */

import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { getProfilesMap } from "@/lib/profiles";

export type ChatSessionSummary = {
  id: string;
  title: string;
  updatedAt: string;
  messageCount: number;
  /** Owner user-id of this session — not always the current user when
   *  the viewer is developer. */
  userId: string;
  /** Human-readable owner name — the current user sees "you", other
   *  people's sessions show their name (developer-only scenario). */
  userName: string;
  /** true when session.user_id === profile.id of the caller. */
  isMine: boolean;
};

export type ChatMessageRow = {
  id: string;
  role: "user" | "assistant";
  content: string;
  images?: string[] | null;
  createdAt: string;
};

export type LoadedSession = {
  messages: ChatMessageRow[];
  owner: { userId: string; userName: string; isMine: boolean };
};

/** Recent sessions — all users' for developer, own only for owner. */
export async function listRecentSessions(limit = 30): Promise<ChatSessionSummary[]> {
  const { profile } = await requireAuth(["owner", "developer"]);
  const admin = createAdminSupabaseClient();
  const isDeveloper = profile.role === "developer";

  let query = admin
    .from("chat_sessions")
    .select("id, title, user_id, updated_at")
    .order("updated_at", { ascending: false })
    .limit(limit);
  if (!isDeveloper) query = query.eq("user_id", profile.id);

  const { data: sessions, error } = await query;
  if (error || !sessions || sessions.length === 0) return [];

  // Message counts in one query
  const { data: msgs } = await admin
    .from("chat_messages")
    .select("session_id")
    .in("session_id", sessions.map((s) => s.id));

  const countBySession = new Map<string, number>();
  for (const m of msgs ?? []) {
    countBySession.set(m.session_id, (countBySession.get(m.session_id) ?? 0) + 1);
  }

  // Resolve owner names only when needed (developer is the only role
  // that will see other people's sessions).
  const profilesMap = isDeveloper ? await getProfilesMap() : {};
  const fallbackSelf = profile.full_name || "you";

  return sessions.map((s) => {
    const isMine = s.user_id === profile.id;
    const userName = isMine
      ? fallbackSelf
      : (profilesMap[s.user_id] || "Unknown");
    return {
      id: s.id,
      title: s.title || "Untitled chat",
      updatedAt: s.updated_at,
      messageCount: countBySession.get(s.id) ?? 0,
      userId: s.user_id,
      userName,
      isMine,
    };
  });
}

/** Load all messages for one session, oldest first. Developer can read
 *  any session; owner can only read their own. */
export async function loadSessionMessages(sessionId: string): Promise<LoadedSession> {
  const { profile } = await requireAuth(["owner", "developer"]);
  const admin = createAdminSupabaseClient();
  const isDeveloper = profile.role === "developer";

  const { data: session } = await admin
    .from("chat_sessions")
    .select("user_id")
    .eq("id", sessionId)
    .single();

  const EMPTY: LoadedSession = {
    messages: [],
    owner: { userId: "", userName: "Unknown", isMine: false },
  };

  if (!session) return EMPTY;
  const isMine = session.user_id === profile.id;
  if (!isMine && !isDeveloper) return EMPTY;

  const { data: msgs, error } = await admin
    .from("chat_messages")
    .select("id, role, content, images, created_at")
    .eq("session_id", sessionId)
    .order("created_at", { ascending: true });
  if (error || !msgs) return EMPTY;

  // Resolve owner name for the header banner
  let userName = profile.full_name || "you";
  if (!isMine) {
    const profilesMap = await getProfilesMap();
    userName = profilesMap[session.user_id] || "Unknown";
  }

  const messages: ChatMessageRow[] = msgs.map((m) => ({
    id: m.id,
    role: m.role as "user" | "assistant",
    content: m.content,
    images: (m as { images?: string[] | null }).images ?? null,
    createdAt: m.created_at,
  }));

  return {
    messages,
    owner: { userId: session.user_id, userName, isMine },
  };
}

/** Delete a session (cascades to its messages). Developer can delete
 *  any session; owner can only delete their own. */
export async function deleteSession(sessionId: string): Promise<{ ok: true } | { error: string }> {
  const { profile } = await requireAuth(["owner", "developer"]);
  const admin = createAdminSupabaseClient();
  const isDeveloper = profile.role === "developer";

  const { data: session } = await admin
    .from("chat_sessions")
    .select("user_id")
    .eq("id", sessionId)
    .single();

  if (!session) return { error: "Session not found" };
  if (session.user_id !== profile.id && !isDeveloper) return { error: "Not allowed" };

  const { error } = await admin.from("chat_sessions").delete().eq("id", sessionId);
  if (error) return { error: error.message };
  return { ok: true };
}

/** Rename a session. Developer can rename any; owner can only rename their own. */
export async function renameSession(
  sessionId: string,
  title: string,
): Promise<{ ok: true } | { error: string }> {
  const { profile } = await requireAuth(["owner", "developer"]);
  const admin = createAdminSupabaseClient();
  const isDeveloper = profile.role === "developer";

  const trimmed = title.trim().slice(0, 120);
  if (!trimmed) return { error: "Title is required" };

  const { data: session } = await admin
    .from("chat_sessions")
    .select("user_id")
    .eq("id", sessionId)
    .single();
  if (!session) return { error: "Session not found" };
  if (session.user_id !== profile.id && !isDeveloper) return { error: "Not allowed" };

  const { error } = await admin
    .from("chat_sessions")
    .update({ title: trimmed })
    .eq("id", sessionId);
  if (error) return { error: error.message };
  return { ok: true };
}
