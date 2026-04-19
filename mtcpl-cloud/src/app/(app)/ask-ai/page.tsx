import { requireAuth } from "@/lib/auth";
import { AskAiChat } from "@/components/ask-ai-chat";

/**
 * Full-viewport dark chat page — the only page in the app that uses a dark
 * palette. The chat component fills the whole window via `position: fixed;
 * inset: 0` so it overlays the normal sidebar and header (the "back to
 * dashboard" link is rendered inside the chat component instead).
 */
export default async function AskAiPage() {
  const { profile } = await requireAuth(["owner", "developer"]);

  return <AskAiChat userName={profile.full_name || "there"} />;
}
