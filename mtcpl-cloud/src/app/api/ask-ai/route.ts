/**
 * POST /api/ask-ai
 *
 * Streaming chat endpoint. Accepts { messages } (conversation history) and
 * streams back plain-text chunks as Claude generates them. Runs a bounded
 * tool-use loop server-side so the model can query the database.
 *
 * Response format: Server-Sent Events (SSE). Each data line is a text
 * chunk. On end, we send a sentinel `data: [DONE]` and close.
 *
 * Auth: requireAuth(["owner", "developer"]) — matches the page route.
 * Rate limit: in-memory per-user daily cap (see lib/ai/rate-limit.ts).
 * Model: env var ASK_AI_MODEL with a sensible default.
 */

import Anthropic from "@anthropic-ai/sdk";
import { requireAuth } from "@/lib/auth";
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
  // Escape raw newlines so the browser's SSE parser doesn't split the payload.
  const safe = text.replace(/\r/g, "").replace(/\n/g, "\\n");
  return new TextEncoder().encode(`data: ${safe}\n\n`);
}

function sseEvent(name: string, data: string): Uint8Array {
  return new TextEncoder().encode(`event: ${name}\ndata: ${data}\n\n`);
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
  try {
    const body = await req.json();
    messages = Array.isArray(body.messages) ? body.messages : [];
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

  const anthropic = new Anthropic({ apiKey });
  const systemPrompt = buildSystemPrompt({ ownerName: profile.full_name || "there" });

  // Claude's message format. We mutate this across tool-use rounds.
  const conversation: Anthropic.Messages.MessageParam[] = messages.map((m) => ({
    role: m.role,
    content: m.content,
  }));

  // ── Streaming setup ──
  const stream = new ReadableStream({
    async start(controller) {
      let rounds = 0;
      try {
        while (rounds < MAX_TOOL_ROUNDS) {
          rounds++;

          // Start one model turn. `messages.stream` yields text_delta events
          // we can forward live; when the turn ends we inspect whether it
          // wants a tool call.
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

          // Forward text deltas as SSE
          modelStream.on("text", (textDelta: string) => {
            controller.enqueue(sseLine(textDelta));
          });

          // Await the final message to decide whether we loop for a tool
          const finalMessage = await modelStream.finalMessage();

          // Accumulate assistant content in the conversation so Claude sees
          // its own tool_use blocks next round
          conversation.push({ role: "assistant", content: finalMessage.content });

          // If the model stopped because it wants to use a tool, run them
          // and append tool_result blocks, then loop.
          if (finalMessage.stop_reason === "tool_use") {
            const toolUses = finalMessage.content.filter(
              (b): b is Anthropic.Messages.ToolUseBlock => b.type === "tool_use",
            );
            if (toolUses.length === 0) break;

            const toolResults: Anthropic.Messages.ToolResultBlockParam[] = [];
            for (const use of toolUses) {
              const resultJson = await runTool(use.name, use.input as Record<string, unknown>);
              toolResults.push({
                type: "tool_result",
                tool_use_id: use.id,
                content: resultJson,
              });
            }

            conversation.push({ role: "user", content: toolResults });
            continue; // next round
          }

          // Otherwise we're done. Send the DONE sentinel and finish.
          break;
        }

        controller.enqueue(sseEvent("done", "[DONE]"));
        controller.close();
      } catch (err) {
        const msg = err instanceof Error ? err.message : "AI request failed";
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
      // Helps Vercel / Nginx flush immediately
      "X-Accel-Buffering": "no",
    },
  });
}
