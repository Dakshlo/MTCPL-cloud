/**
 * The ChatGPT half of MTCPL-AI.
 *
 * Mirrors the Claude loop in /api/ask-ai as closely as the two wire formats
 * allow: same system prompt, same tools, the same `runTool` implementation,
 * the same tool loop and the same streamed-text + tool_start/tool_end
 * callbacks. The caller cannot tell which provider produced a reply except
 * from the cost figure and the voice.
 *
 * ── Why /v1/responses and not /v1/chat/completions ────────────────────────
 * gpt-5.6-sol is a reasoning model, and chat/completions rejects the
 * combination outright:
 *
 *   "Function tools with reasoning_effort are not supported for gpt-5.6-sol
 *    in /v1/chat/completions. To use function tools, use /v1/responses or set
 *    reasoning_effort to 'none'."
 *
 * Setting reasoning_effort:'none' would work, but it would buy the most
 * expensive model on the menu and then switch off the thing you are paying
 * for — this assistant's job is cross-department reasoning over 32 tools.
 * So: the Responses API, with reasoning left at the model's default.
 *
 * Three things differ from chat/completions and are easy to get wrong:
 *   1. Tool definitions are FLAT — { type, name, description, parameters } —
 *      not nested under a `function` key.
 *   2. The system prompt goes in `instructions`, not a system message.
 *   3. Multi-turn threading uses `previous_response_id`. That matters
 *      specifically for a reasoning model: the server keeps the reasoning
 *      items between turns, so we send only the tool outputs on the next
 *      round instead of trying to re-serialise reasoning ourselves.
 *
 * Prompt caching needs no flag: OpenAI caches prompt prefixes over ~1k tokens
 * automatically and reports the hit in usage.input_tokens_details.cached_tokens,
 * which we bill at the cached rate. Our ~19k-token instructions-plus-tools
 * prefix is identical every request, so it should cache from question two on.
 *
 * Raw fetch rather than the `openai` SDK on purpose — one streaming endpoint,
 * and no new dependency in a project whose local builds are already fragile.
 */

import { runTool } from "./tools";
import { toOpenAiTools, type TokenBudget } from "./providers";

const OPENAI_URL = "https://api.openai.com/v1/responses";

export type OpenAiInMessage = {
  role: "user" | "assistant";
  content: string;
  images?: string[];
};

type InputPart =
  | { type: "input_text"; text: string }
  | { type: "input_image"; image_url: string };

/** An item in the Responses API `input` array. */
type InputItem =
  | { role: "user" | "assistant"; content: string | InputPart[] }
  | { type: "function_call_output"; call_id: string; output: string };

/** A function call assembled from streamed deltas, keyed by output item id. */
type PendingCall = { callId: string; name: string; args: string };

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

function toInputContent(m: OpenAiInMessage): string | InputPart[] {
  if (!m.images || m.images.length === 0) return m.content;
  const parts: InputPart[] = m.images.map((url) => ({
    type: "input_image" as const,
    image_url: url,
  }));
  if (m.content) parts.push({ type: "input_text", text: m.content });
  return parts.length > 0 ? parts : m.content;
}

/**
 * Run the conversation to completion, streaming text out through `onText`.
 * Returns accumulated token usage so the caller can price it.
 */
export async function runOpenAiConversation(a: RunOpenAiArgs): Promise<TokenBudget> {
  const tools = toOpenAiTools();
  const usage: TokenBudget = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

  // First turn carries the whole conversation. Later turns carry only the
  // tool outputs and lean on previous_response_id for everything before.
  let input: InputItem[] = a.messages.map((m) => ({
    role: m.role,
    content: toInputContent(m),
  }));
  let previousResponseId: string | null = null;

  for (let round = 0; round < a.maxToolRounds; round++) {
    const body: Record<string, unknown> = {
      model: a.model,
      instructions: a.systemPrompt,
      input,
      tools,
      stream: true,
      max_output_tokens: 2048,
      // THE cost lever on a reasoning model, and it is not obvious: the
      // model's private thinking is billed as OUTPUT, i.e. at $30/Mtok on
      // gpt-5.6-sol — the dearest rate in the whole system. Left at the
      // model's default, a question that fans out over several tools thinks
      // again before every call and the reasoning alone can dominate the bill
      // (a daily-report question came to ₹34).
      //
      // "low" still reasons — it just stops it deliberating at length over
      // what is mostly tool selection and formatting. Raise it with
      // ASK_AI_OPENAI_EFFORT=medium|high if answers get shallow.
      reasoning: { effort: process.env.ASK_AI_OPENAI_EFFORT || "low" },
    };
    if (previousResponseId) body.previous_response_id = previousResponseId;

    const res = await fetch(OPENAI_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${a.apiKey}`,
      },
      signal: a.signal,
      body: JSON.stringify(body),
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
    const calls = new Map<string, PendingCall>();
    let responseId: string | null = null;

    streamLoop: while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // Frames are blank-line separated; keep the trailing partial frame.
      const frames = buffer.split("\n\n");
      buffer = frames.pop() ?? "";

      for (const frame of frames) {
        for (const line of frame.split("\n")) {
          if (!line.startsWith("data:")) continue;
          const payload = line.slice(5).trim();
          if (!payload) continue;
          if (payload === "[DONE]") break streamLoop;

          let ev: Record<string, unknown>;
          try {
            ev = JSON.parse(payload);
          } catch {
            continue; // skip an unparseable frame rather than kill the reply
          }

          const type = ev.type as string | undefined;
          if (!type) continue;

          // Assistant prose.
          if (type === "response.output_text.delta") {
            const delta = ev.delta as string | undefined;
            if (delta) a.onText(delta);
            continue;
          }

          // A new output item — a function call announces itself here, with
          // its call_id and name, before any arguments stream in.
          if (type === "response.output_item.added") {
            const item = ev.item as
              | { id?: string; type?: string; call_id?: string; name?: string }
              | undefined;
            if (item?.type === "function_call" && item.id) {
              calls.set(item.id, {
                callId: item.call_id ?? item.id,
                name: item.name ?? "",
                args: "",
              });
            }
            continue;
          }

          // Arguments arrive as a stream of JSON fragments.
          if (type === "response.function_call_arguments.delta") {
            const id = ev.item_id as string | undefined;
            const delta = ev.delta as string | undefined;
            if (id && delta) {
              const cur = calls.get(id);
              if (cur) cur.args += delta;
            }
            continue;
          }

          // Authoritative final arguments — prefer these over the accumulated
          // fragments when present.
          if (type === "response.function_call_arguments.done") {
            const id = ev.item_id as string | undefined;
            const args = ev.arguments as string | undefined;
            if (id && typeof args === "string") {
              const cur = calls.get(id);
              if (cur) cur.args = args;
            }
            continue;
          }

          // Terminal event: carries the response id (for threading) and usage.
          if (type === "response.completed" || type === "response.incomplete") {
            const r = ev.response as
              | {
                  id?: string;
                  usage?: {
                    input_tokens?: number;
                    output_tokens?: number;
                    input_tokens_details?: { cached_tokens?: number };
                  };
                }
              | undefined;
            if (r?.id) responseId = r.id;
            const u = r?.usage;
            if (u) {
              const cached = u.input_tokens_details?.cached_tokens ?? 0;
              const inTok = u.input_tokens ?? 0;
              // input_tokens INCLUDES cached — split so each bills at its rate.
              usage.input += Math.max(0, inTok - cached);
              usage.cacheRead += cached;
              usage.output += u.output_tokens ?? 0;
            }
            continue;
          }

          if (type === "response.created") {
            const r = ev.response as { id?: string } | undefined;
            if (r?.id) responseId = r.id;
            continue;
          }

          // The API reports its own failures as an event, not an HTTP status.
          if (type === "response.failed" || type === "error") {
            const r = ev.response as { error?: { message?: string } } | undefined;
            const direct = ev.message as string | undefined;
            throw new Error(r?.error?.message || direct || "OpenAI response failed");
          }
        }
      }
    }

    const pending = [...calls.values()].filter((c) => c.name);
    if (pending.length === 0) return usage; // plain answer — done

    // Thread the next round off this response so the server keeps the
    // reasoning context, and send only the tool outputs.
    previousResponseId = responseId;
    const outputs: InputItem[] = [];
    for (const c of pending) {
      a.onToolStart(c.name);
      let parsed: Record<string, unknown> = {};
      try {
        parsed = c.args ? (JSON.parse(c.args) as Record<string, unknown>) : {};
      } catch {
        // Malformed arguments are the model's error. Hand the tool an empty
        // object and let its own validation produce the message — same as a
        // bad call from Claude.
        parsed = {};
      }
      const resultJson = await runTool(c.name, parsed);
      a.onToolEnd(c.name);
      outputs.push({ type: "function_call_output", call_id: c.callId, output: resultJson });
    }
    input = outputs;
  }

  return usage;
}
