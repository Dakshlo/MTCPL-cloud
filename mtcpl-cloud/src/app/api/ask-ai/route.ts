/**
 * POST /api/ask-ai
 *
 * Streaming chat endpoint with persistent session history, image attachments,
 * tool progress events, and a per-response cost readout in INR.
 *
 * Request body:
 *   {
 *     messages:   InMessage[]      // full conversation so far, incl. latest user msg
 *     sessionId?: string | null    // null/omitted on the very first message of a new chat
 *   }
 *
 *   InMessage = { role, content, images?: string[] }
 *     images: array of base64 data URLs (e.g. "data:image/jpeg;base64,…"),
 *             resized client-side to ≤1024 px before upload.
 *
 * Response: Server-Sent Events (SSE).
 *   event: session    data: <uuid>         // always fires first — current session id
 *   event: tool_start data: <toolName>     // when a Claude tool call begins
 *   event: tool_end   data: <toolName>     // when the tool call returns
 *   data: <text chunk>                     // assistant tokens as they arrive
 *   event: cost       data: <INR>          // total cost of this reply in rupees (2 decimals)
 *   event: done       data: [DONE]         // end of stream
 *   event: error      data: <message>      // on failure
 */

import Anthropic from "@anthropic-ai/sdk";
import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { buildSystemPrompt } from "@/lib/ai/system-prompt";
import { AI_TOOLS, runTool } from "@/lib/ai/tools";
import { checkAndIncrement } from "@/lib/ai/rate-limit";

const MAX_TOOL_ROUNDS = 5;
// Default upgraded to Opus 4.8 (Daksh Jul 2026) — the most capable model for
// this cross-department reasoning + bilingual (Hindi/English) formatting + tool
// selection job. Override with ASK_AI_MODEL=claude-sonnet-5 for a cheaper (still
// excellent) option, or claude-haiku-4-5 for the fastest/cheapest.
const MODEL = process.env.ASK_AI_MODEL || "claude-opus-4-8";
const USD_TO_INR = Number(process.env.USD_TO_INR) || 84; // rough conversion — set exact value via env

/**
 * Published per-million-token prices (USD). Prompt caching splits input into
 * "cache write" (full price + 25%) and "cache read" (10% of base). We accumulate
 * each bucket separately from finalMessage.usage and sum.
 *
 * Keys match the Anthropic model names. If an unlisted model is set we fall
 * back to Opus-4.8 rates so the ₹ counter still displays something sane.
 */
const PRICES_USD_PER_MTOK: Record<string, { in: number; out: number; cacheRead: number; cacheWrite: number }> = {
  "claude-opus-4-8":   { in: 5, out: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  "claude-opus-4-7":   { in: 5, out: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  "claude-sonnet-5":   { in: 3, out: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  "claude-sonnet-4-5": { in: 3, out: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  "claude-haiku-4-5":  { in: 1, out: 5,  cacheRead: 0.1, cacheWrite: 1.25 },
  "claude-opus-4-5":   { in: 15, out: 75, cacheRead: 1.5, cacheWrite: 18.75 },
};

type TokenBudget = {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
};

function costInr(model: string, u: TokenBudget): number {
  const p = PRICES_USD_PER_MTOK[model] ?? PRICES_USD_PER_MTOK["claude-sonnet-4-5"];
  const usd =
    (u.input * p.in +
      u.output * p.out +
      u.cacheRead * p.cacheRead +
      u.cacheWrite * p.cacheWrite) / 1_000_000;
  return usd * USD_TO_INR;
}

type InMessage = {
  role: "user" | "assistant";
  content: string;
  images?: string[];
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
function deriveTitle(firstUserMessage: string, hasImages: boolean): string {
  const cleaned = firstUserMessage.replace(/\s+/g, " ").trim();
  if (!cleaned && hasImages) return "📸 Photo question";
  if (cleaned.length <= 60) return cleaned || "Untitled chat";
  return cleaned.slice(0, 57) + "…";
}

/** Parse a data URL into { media_type, data } for Claude's base64 image source. */
function parseDataUrl(url: string): { mediaType: string; data: string } | null {
  const m = url.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (!m) return null;
  return { mediaType: m[1], data: m[2] };
}

/** Map our InMessage to Claude's MessageParam content. */
function toClaudeContent(m: InMessage): Anthropic.Messages.MessageParam["content"] {
  if (!m.images || m.images.length === 0) return m.content;
  const blocks: Anthropic.Messages.ContentBlockParam[] = [];
  for (const url of m.images) {
    const parsed = parseDataUrl(url);
    if (!parsed) continue;
    blocks.push({
      type: "image",
      source: {
        type: "base64",
        media_type: parsed.mediaType as "image/jpeg" | "image/png" | "image/gif" | "image/webp",
        data: parsed.data,
      },
    });
  }
  if (m.content) blocks.push({ type: "text", text: m.content });
  if (blocks.length === 0) return m.content; // fell through — treat as plain text
  return blocks;
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
  let activeSessionId = sessionId;
  if (!activeSessionId) {
    const firstUser = messages.find((m) => m.role === "user");
    const firstText = firstUser?.content ?? lastUserMessage.content;
    const firstHasImages = !!(firstUser?.images && firstUser.images.length > 0);
    const { data: created, error: createErr } = await admin
      .from("chat_sessions")
      .insert({ user_id: profile.id, title: deriveTitle(firstText, firstHasImages) })
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
    images: lastUserMessage.images && lastUserMessage.images.length > 0 ? lastUserMessage.images : null,
  });

  const anthropic = new Anthropic({ apiKey });
  const systemPrompt = buildSystemPrompt({ ownerName: profile.full_name || "there" });

  const conversation: Anthropic.Messages.MessageParam[] = messages.map((m) => ({
    role: m.role,
    content: toClaudeContent(m),
  }));

  // ── Streaming setup ──
  const stream = new ReadableStream({
    async start(controller) {
      controller.enqueue(sseEvent("session", activeSessionId as string));

      let rounds = 0;
      let accumulatedAssistantText = "";
      const totalUsage: TokenBudget = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

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

          // Accumulate token usage for cost display
          const u = finalMessage.usage;
          if (u) {
            totalUsage.input += u.input_tokens ?? 0;
            totalUsage.output += u.output_tokens ?? 0;
            totalUsage.cacheRead += u.cache_read_input_tokens ?? 0;
            totalUsage.cacheWrite += u.cache_creation_input_tokens ?? 0;
          }

          conversation.push({ role: "assistant", content: finalMessage.content });

          if (finalMessage.stop_reason === "tool_use") {
            const toolUses = finalMessage.content.filter(
              (b): b is Anthropic.Messages.ToolUseBlock => b.type === "tool_use",
            );
            if (toolUses.length === 0) break;

            const toolResults: Anthropic.Messages.ToolResultBlockParam[] = [];
            for (const use of toolUses) {
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
        await admin
          .from("chat_sessions")
          .update({ updated_at: new Date().toISOString() })
          .eq("id", activeSessionId);

        // Report cost last so the client displays it only on a clean finish
        const costRupees = costInr(MODEL, totalUsage);
        controller.enqueue(sseEvent("cost", costRupees.toFixed(2)));
        controller.enqueue(sseEvent("done", "[DONE]"));
        controller.close();
      } catch (err) {
        const msg = err instanceof Error ? err.message : "AI request failed";
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
