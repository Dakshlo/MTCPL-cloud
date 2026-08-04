/**
 * The ChatGPT half of MTCPL-AI.
 *
 * Mirrors the Claude loop in /api/ask-ai as closely as the two wire formats
 * allow: same system prompt, same tools (re-wrapped by providers.ts), same
 * `runTool` implementation, same streamed-text + tool_start/tool_end
 * callbacks. The caller cannot tell which provider produced a reply except
 * from the cost figure and the voice.
 *
 * Raw fetch rather than the `openai` SDK on purpose — this is one streaming
 * endpoint, and a dependency-free implementation avoids adding a package to a
 * project whose local builds are already fragile.
 *
 * Prompt caching needs no flag here: OpenAI caches prompt prefixes over ~1k
 * tokens automatically and reports the hit in
 * `usage.prompt_tokens_details.cached_tokens`, which we bill at the cached
 * rate. Our ~19k-token system-prompt-plus-tools prefix is identical on every
 * request, so it should cache from the second question onward.
 */

import { runTool } from "./tools";
import { toOpenAiTools, type TokenBudget } from "./providers";

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";

export type OpenAiInMessage = {
  role: "user" | "assistant";
  content: string;
  images?: string[];
};

type OaContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

type OaMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string | OaContentPart[] }
  | {
      role: "assistant";
      content: string | null;
      tool_calls?: Array<{ id: string; type: "function"; function: { name: string; arguments: string } }>;
    }
  | { role: "tool"; tool_call_id: string; content: string };

/** A tool call assembled from streamed deltas. */
type PendingCall = { id: string; name: string; args: string };

export type RunOpenAiArgs = {
  apiKey: string;
  model: string;
  systemPrompt: string;
  messages: OpenAiInMessage[];
  maxToolRounds: number;
  onText: (delta: string) => void;
  onToolStart: (name: string) => void;
  onToolEnd: (name: string) => void;
  signal?: AbortSignal;
};

function toOaUserContent(m: OpenAiInMessage): string | OaContentPart[] {
  if (!m.images || m.images.length === 0) return m.content;
  const parts: OaContentPart[] = m.images.map((url) => ({
    type: "image_url" as const,
    image_url: { url },
  }));
  if (m.content) parts.push({ type: "text", text: m.content });
  return parts.length > 0 ? parts : m.content;
}

/**
 * Run the conversation to completion, streaming text out through `onText`.
 * Returns the accumulated token usage so the caller can price it.
 */
export async function runOpenAiConversation(a: RunOpenAiArgs): Promise<TokenBudget> {
  const tools = toOpenAiTools();
  const usage: TokenBudget = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

  const conversation: OaMessage[] = [
    { role: "system", content: a.systemPrompt },
    ...a.messages.map((m): OaMessage =>
      m.role === "assistant"
        ? { role: "assistant", content: m.content }
        : { role: "user", content: toOaUserContent(m) },
    ),
  ];

  for (let round = 0; round < a.maxToolRounds; round++) {
    const res = await fetch(OPENAI_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${a.apiKey}`,
      },
      signal: a.signal,
      body: JSON.stringify({
        model: a.model,
        messages: conversation,
        tools,
        stream: true,
        // Ask for the usage block on the final chunk so the ₹ readout is real
        // rather than estimated.
        stream_options: { include_usage: true },
        // The GPT-5 family rejects the legacy `max_tokens` name.
        max_completion_tokens: 2048,
      }),
    });

    if (!res.ok || !res.body) {
      const detail = await res.text().catch(() => "");
      let msg = `OpenAI HTTP ${res.status}`;
      try {
        const j = JSON.parse(detail);
        if (j?.error?.message) msg = j.error.message;
      } catch {
        if (detail) msg = `${msg}: ${detail.slice(0, 300)}`;
      }
      throw new Error(msg);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let finishReason: string | null = null;
    let assistantText = "";
    const calls = new Map<number, PendingCall>();

    // ── Read the SSE stream ──
    streamLoop: while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // Frames are separated by a blank line; a frame may hold several
      // `data:` lines. Keep the trailing partial frame in the buffer.
      const frames = buffer.split("\n\n");
      buffer = frames.pop() ?? "";

      for (const frame of frames) {
        for (const line of frame.split("\n")) {
          if (!line.startsWith("data:")) continue;
          const payload = line.slice(5).trim();
          if (!payload) continue;
          if (payload === "[DONE]") break streamLoop;

          let chunk: Record<string, unknown>;
          try {
            chunk = JSON.parse(payload);
          } catch {
            continue; // ignore a frame we can't parse rather than kill the reply
          }

          // The usage-only chunk arrives last and carries no choices.
          const u = chunk.usage as
            | { prompt_tokens?: number; completion_tokens?: number; prompt_tokens_details?: { cached_tokens?: number } }
            | undefined;
          if (u) {
            const cached = u.prompt_tokens_details?.cached_tokens ?? 0;
            const prompt = u.prompt_tokens ?? 0;
            // prompt_tokens INCLUDES the cached ones — split so each half is
            // billed at its own rate.
            usage.input += Math.max(0, prompt - cached);
            usage.cacheRead += cached;
            usage.output += u.completion_tokens ?? 0;
          }

          const choice = (chunk.choices as Array<Record<string, unknown>> | undefined)?.[0];
          if (!choice) continue;
          if (typeof choice.finish_reason === "string") finishReason = choice.finish_reason;

          const delta = choice.delta as
            | {
                content?: string | null;
                tool_calls?: Array<{
                  index: number;
                  id?: string;
                  function?: { name?: string; arguments?: string };
                }>;
              }
            | undefined;
          if (!delta) continue;

          if (typeof delta.content === "string" && delta.content) {
            assistantText += delta.content;
            a.onText(delta.content);
          }

          // Tool calls stream in fragments: the id and name usually arrive on
          // the first delta for an index, then `arguments` accumulates as a
          // string across many deltas.
          for (const tc of delta.tool_calls ?? []) {
            const cur = calls.get(tc.index) ?? { id: "", name: "", args: "" };
            if (tc.id) cur.id = tc.id;
            if (tc.function?.name) cur.name = tc.function.name;
            if (tc.function?.arguments) cur.args += tc.function.arguments;
            calls.set(tc.index, cur);
          }
        }
      }
    }

    const pending = [...calls.values()].filter((c) => c.name);
    if (finishReason !== "tool_calls" || pending.length === 0) {
      return usage; // plain answer — done
    }

    conversation.push({
      role: "assistant",
      content: assistantText || null,
      tool_calls: pending.map((c) => ({
        id: c.id,
        type: "function" as const,
        function: { name: c.name, arguments: c.args || "{}" },
      })),
    });

    for (const c of pending) {
      a.onToolStart(c.name);
      let parsed: Record<string, unknown> = {};
      try {
        parsed = c.args ? (JSON.parse(c.args) as Record<string, unknown>) : {};
      } catch {
        // Malformed arguments are the model's error, not ours. Hand the tool
        // an empty object and let its own validation produce the message —
        // same as a bad call from Claude.
        parsed = {};
      }
      const resultJson = await runTool(c.name, parsed);
      a.onToolEnd(c.name);
      conversation.push({ role: "tool", tool_call_id: c.id, content: resultJson });
    }
  }

  return usage;
}
