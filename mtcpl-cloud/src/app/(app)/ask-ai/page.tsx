import { requireAuth } from "@/lib/auth";
import { AskAiChat } from "@/components/ask-ai-chat";
import { listRecentSessions } from "@/lib/ai/chat-sessions";

/**
 * Full-viewport dark chat page — the only page in the app that uses a dark
 * palette. The chat component fills the whole window via `position: fixed;
 * inset: 0` so it overlays the normal sidebar and header.
 *
 * Server-side we fetch the caller's recent sessions so the sidebar is
 * populated on first paint, no client-side round-trip needed.
 */
export default async function AskAiPage() {
  const { profile } = await requireAuth(["owner", "developer"]);
  const recentSessions = await listRecentSessions(30);

  return <AskAiChat userName={profile.full_name || "there"} initialRecentSessions={recentSessions} />;
}
