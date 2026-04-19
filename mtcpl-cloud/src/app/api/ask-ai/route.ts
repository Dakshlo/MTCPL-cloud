/**
 * POST /api/ask-ai
 *
 * Streaming chat endpoint with persistent session history.
 *
 * Request body:
 *   {
 *     messages:   InMessage[]      // full conversation so far, incl. latest user msg
 *     sessionId?: string | null    // null/omitted on the very first message of a new chat
 *   }
 *
 * Response: Server-Sent Events (SSE).
 *   event: session   data: <uuid>     // always fires first — current session id
 *   data: <text chunk>                // assistant tokens as they arrive
 *   event: done      data: [DONE]     // end of stream
 *   event: error     data: <message>  // on failure
 */

import Anthropic from "@anthropic-ai/sdk";
import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { buildSystemPrompt } from "@/lib/ai/system-prompt";
import { AI_TOOLS, runTool } from "@/lib/ai/tools";
import { checkAndIncrement } from "@/lib/ai/rate-limit";

const MAX_TOOL_ROUNDS = 5;
const MODEL = process.env.ASK_AI_MODEL || "claude-sonnet-4-5";

type InMessage = {
  role: "user" | "assistant";
  content: string;
};

/** Encode a text chunk as one SSE `data:` line (plus trailing blank line). */
function sseLine(text: string): Uint8Array {
  const safe = text.replace(/\r/g, "").replace(/\n/g, "\\n");
  return new TextEncoder().encode(`data: ${safe}\n\n`);
}

function sseEvent(name: string, data: string): Uint8Array {
  return new TextEncoder().encode(`event: ${name}\ndata: ${data}\n\n`);
}

/** Derive a short title from the user's first message. */
function deriveTitle(firstUserMessage: string): string {
  const cleaned = firstUserMessage.replace(/\s+/g, " ").trim();
  if (cleaned.length <= 60) return cleaned;
  return cleaned.slice(0, 57) + "…";
}

export async function POST(req: Request) {
  // ── Auth ──
  let profile;
  try {
    const auth = await requireAuth(["owner", "developer"]);
    profile = auth.profile;
  } catch {
    return new Response("Unauthorized", { status: 401 });
  }

  // ── Rate limit ──
  const rl = checkAndIncrement(profile.id);
  if (!rl.ok) {
    return new Response(
      JSON.stringify({ error: `Daily limit reached. Resets at ${rl.resetAt}.` }),
      { status: 429, headers: { "Content-Type": "application/json" } },
    );
  }

  // ── Parse body ──
  let messages: InMessage[];
  let sessionId: string | null;
  try {
    const body = await req.json();
    messages = Array.isArray(body.messages) ? body.messages : [];
    sessionId = typeof body.sessionId === "string" ? body.sessionId : null;
  } catch {
    return new Response("Bad request", { status: 400 });
  }
  if (messages.length === 0) {
    return new Response("Empty messages", { status: 400 });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return new Response(
      JSON.stringify({ error: "ANTHROPIC_API_KEY is not configured." }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }

  const admin = createAdminSupabaseClient();
  const lastUserMessage = [...messages].reverse().find((m) => m.role === "user");
  if (!lastUserMessage) {
    return new Response("No user message", { status: 400 });
  }

  // ── Session bootstrap ──
  // If no sessionId: create one and derive its title from the first user
  // message. If sessionId is provided: verify the caller owns it.
  let activeSessionId = sessionId;
  if (!activeSessionId) {
    const firstUserMessage = messages.find((m) => m.role === "user")?.content ?? lastUserMessage.content;
    const { data: created, error: createErr } = await admin
      .from("chat_sessions")
      .insert({ user_id: profile.id, title: deriveTitle(firstUserMessage) })
      .select("id")
      .single();
    if (createErr || !created) {
      return new Response(
        JSON.stringify({ error: `Could not start chat: ${createErr?.message ?? "unknown"}` }),
        { status: 500, headers: { "Content-Type": "application/json" } },
      );
    }
    activeSessionId = created.id;
  } else {
    const { data: owned } = await admin
      .from("chat_sessions")
      .select("id")
      .eq("id", activeSessionId)
      .eq("user_id", profile.id)
      .single();
    if (!owned) {
      return new Response("Session not found or not yours", { status: 403 });
    }
  }

  // Save the incoming user message before we call Claude so it persists even
  // if the stream is interrupted.
  await admin.from("chat_messages").insert({
    session_id: activeSessionId,
    role: "user",
    content: lastUserMessage.content,
  });

  const anthropic = new Anthropic({ apiKey });
  const systemPrompt = buildSystemPrompt({ ownerName: profile.full_name || "there" });

  const conversation: Anthropic.Messages.MessageParam[] = messages.map((m) => ({
    role: m.role,
    content: m.content,
  }));

  // ── Streaming setup ──
  const stream = new ReadableStream({
    async start(controller) {
      // Always announce the session id first so the client can store it.
      controller.enqueue(sseEvent("session", activeSessionId as string));

      let rounds = 0;
      let accumulatedAssistantText = "";

      try {
        while (rounds < MAX_TOOL_ROUNDS) {
          rounds++;

          const modelStream = anthropic.messages.stream({
            model: MODEL,
            max_tokens: 2048,
            system: [
              {
                type: "text",
                text: systemPrompt,
                cache_control: { type: "ephemeral" },
              },
            ],
            tools: AI_TOOLS,
            messages: conversation,
          });

          modelStream.on("text", (textDelta: string) => {
            controller.enqueue(sseLine(textDelta));
            accumulatedAssistantText += textDelta;
          });

          const finalMessage = await modelStream.finalMessage();

          conversation.push({ role: "assistant", content: finalMessage.content });

          if (finalMessage.stop_reason === "tool_use") {
            const toolUses = finalMessage.content.filter(
              (b): b is Anthropic.Messages.ToolUseBlock => b.type === "tool_use",
            );
            if (toolUses.length === 0) break;

            const toolResults: Anthropic.Messages.ToolResultBlockParam[] = [];
            for (const use of toolUses) {
              // Let the client show a "🔍 Looking up…" indicator for the
              // duration of the tool call. One event per tool, per round.
              controller.enqueue(sseEvent("tool_start", use.name));
              const resultJson = await runTool(use.name, use.input as Record<string, unknown>);
              controller.enqueue(sseEvent("tool_end", use.name));
              toolResults.push({
                type: "tool_result",
                tool_use_id: use.id,
                content: resultJson,
              });
            }
            conversation.push({ role: "user", content: toolResults });
            continue;
          }

          break;
        }

        // Persist the full assistant reply after the stream ends.
        if (accumulatedAssistantText.trim()) {
          await admin.from("chat_messages").insert({
            session_id: activeSessionId,
            role: "assistant",
            content: accumulatedAssistantText,
          });
        }
        // Bump the session's updated_at so recent-chats list re-orders.
        await admin
          .from("chat_sessions")
          .update({ updated_at: new Date().toISOString() })
          .eq("id", activeSessionId);

        controller.enqueue(sseEvent("done", "[DONE]"));
        controller.close();
      } catch (err) {
        const msg = err instanceof Error ? err.message : "AI request failed";
        // Best-effort: still persist whatever assistant text we managed to
        // produce before the error.
        if (accumulatedAssistantText.trim()) {
          await admin.from("chat_messages").insert({
            session_id: activeSessionId,
            role: "assistant",
            content: accumulatedAssistantText,
          });
        }
        controller.enqueue(sseEvent("error", msg));
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
