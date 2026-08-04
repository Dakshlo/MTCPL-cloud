/**
 * MTCPL-AI model providers.
 *
 * The assistant can answer through either Anthropic (Claude) or OpenAI
 * (ChatGPT). BOTH run the identical brain:
 *
 *   - the same system prompt   (buildSystemPrompt, src/lib/ai/system-prompt.ts)
 *   - the same 32 tools        (AI_TOOLS, src/lib/ai/tools.ts)
 *   - the same tool loop + the same SSE event contract to the browser
 *
 * Only the wire format differs, which is what this file normalises. The point
 * is that switching provider changes the cost and the voice a little — never
 * what the assistant can see or do.
 *
 * ── On cost (Daksh, Aug 2026) ─────────────────────────────────────────────
 * The reason this file exists is a bill of ₹20-40 per question. Worth being
 * precise about where that goes, because the intuition "OpenAI is cheaper"
 * is not true at the top of the range:
 *
 *     claude-opus-4-8   $5 in  / $25 out   per Mtok
 *     gpt-5.6-sol       $5 in  / $30 out   per Mtok   ← OpenAI's flagship
 *
 * Same input price, HIGHER output price. Switching to the most advanced
 * OpenAI model will not save money. The saving lives in the tier, on either
 * side: gpt-5.6-luna is $0.20/$1.20 and claude-haiku-4-5 is $1/$5, i.e.
 * 20-25x cheaper than either flagship.
 *
 * The other half of the bill is volume, not rate. Every request ships ~11k
 * tokens of system prompt and ~8k tokens of tool schemas, and a tool round
 * re-sends all of it. That is why prompt caching is switched on for both
 * providers below — a cache hit bills those at 10%.
 */

import { AI_TOOLS } from "./tools";

export type ProviderId = "claude" | "openai";

export const PROVIDER_IDS: ProviderId[] = ["claude", "openai"];

export function isProviderId(v: unknown): v is ProviderId {
  return v === "claude" || v === "openai";
}

/** Per-million-token prices in USD. `cacheRead` is the discounted rate for
 *  input served from the prompt cache; `cacheWrite` is Anthropic's one-off
 *  surcharge for populating it (OpenAI has no equivalent, so it equals `in`). */
export type ModelPrice = { in: number; out: number; cacheRead: number; cacheWrite: number };

export const PRICES_USD_PER_MTOK: Record<string, ModelPrice> = {
  // ── Anthropic ──
  "claude-opus-4-8":   { in: 5,  out: 25, cacheRead: 0.5,  cacheWrite: 6.25 },
  "claude-opus-4-7":   { in: 5,  out: 25, cacheRead: 0.5,  cacheWrite: 6.25 },
  "claude-sonnet-5":   { in: 3,  out: 15, cacheRead: 0.3,  cacheWrite: 3.75 },
  "claude-sonnet-4-6": { in: 3,  out: 15, cacheRead: 0.3,  cacheWrite: 3.75 },
  "claude-sonnet-4-5": { in: 3,  out: 15, cacheRead: 0.3,  cacheWrite: 3.75 },
  "claude-haiku-4-5":  { in: 1,  out: 5,  cacheRead: 0.1,  cacheWrite: 1.25 },
  "claude-opus-4-5":   { in: 15, out: 75, cacheRead: 1.5,  cacheWrite: 18.75 },
  // ── OpenAI (verified against developers.openai.com/api/docs/pricing,
  //    4 Aug 2026). No cache-write surcharge, so cacheWrite === in. ──
  "gpt-5.6-sol":       { in: 5,    out: 30,  cacheRead: 0.5,   cacheWrite: 5 },
  "gpt-5.5":           { in: 5,    out: 30,  cacheRead: 0.5,   cacheWrite: 5 },
  "gpt-5.6-luna":      { in: 0.2,  out: 1.2, cacheRead: 0.02,  cacheWrite: 0.2 },
  "gpt-5-mini":        { in: 0.25, out: 2,   cacheRead: 0.025, cacheWrite: 0.25 },
  "gpt-5-nano":        { in: 0.05, out: 0.4, cacheRead: 0.005, cacheWrite: 0.05 },
  "gpt-4o":            { in: 2.5,  out: 10,  cacheRead: 1.25,  cacheWrite: 2.5 },
  "gpt-4o-mini":       { in: 0.15, out: 0.6, cacheRead: 0.075, cacheWrite: 0.15 },
};

/** Fallback so an unlisted model still shows a sane ₹ figure rather than 0. */
const FALLBACK_PRICE: ModelPrice = { in: 5, out: 25, cacheRead: 0.5, cacheWrite: 6.25 };

export type TokenBudget = {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
};

export function costInr(model: string, u: TokenBudget, usdToInr: number): number {
  const p = PRICES_USD_PER_MTOK[model] ?? FALLBACK_PRICE;
  const usd =
    (u.input * p.in +
      u.output * p.out +
      u.cacheRead * p.cacheRead +
      u.cacheWrite * p.cacheWrite) / 1_000_000;
  return usd * usdToInr;
}

/**
 * Which model each provider answers with.
 *
 * Both are env-overridable so the cost/quality trade-off can be changed
 * without a deploy:
 *   ASK_AI_MODEL=claude-haiku-4-5
 *   ASK_AI_OPENAI_MODEL=gpt-5.6-luna
 */
export function modelFor(provider: ProviderId): string {
  if (provider === "openai") {
    return process.env.ASK_AI_OPENAI_MODEL || "gpt-5.6-sol";
  }
  return process.env.ASK_AI_MODEL || "claude-opus-4-8";
}

export function apiKeyFor(provider: ProviderId): string | undefined {
  if (provider === "openai") {
    // Two accepted names. OPENAI_API_KEY is the conventional one; MTCPL_GPT is
    // what the key was actually filed under in Vercel (Daksh, Aug 2026), and
    // renaming a live secret is a worse idea than accepting both.
    return process.env.OPENAI_API_KEY || process.env.MTCPL_GPT;
  }
  return process.env.ANTHROPIC_API_KEY;
}

export function missingKeyMessage(provider: ProviderId): string {
  return provider === "openai"
    ? "No OpenAI key found. Set OPENAI_API_KEY or MTCPL_GPT — in .env.local for local use, and in the Vercel project settings for the live site. A new or changed Vercel variable only takes effect after a redeploy."
    : "ANTHROPIC_API_KEY is not configured.";
}

/** Human label for the picker + the saved-message footer. */
export function providerLabel(provider: ProviderId): string {
  return provider === "openai" ? "ChatGPT" : "Claude";
}

// ──────────────────────────────────────────────────────────────────
// Tool schema translation
// ──────────────────────────────────────────────────────────────────

export type OpenAiTool = {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
};

/**
 * AI_TOOLS is authored in Anthropic's shape ({ name, description,
 * input_schema }). OpenAI wants ({ type:"function", function:{ name,
 * description, parameters } }) with the identical JSON Schema inside.
 *
 * Deliberately a pure re-wrap: the schemas themselves are NOT rewritten, so
 * both providers see byte-identical tool contracts and `runTool` stays the
 * single implementation for both.
 */
export function toOpenAiTools(): OpenAiTool[] {
  return AI_TOOLS.map((t) => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description ?? "",
      parameters: (t.input_schema ?? { type: "object", properties: {} }) as Record<string, unknown>,
    },
  }));
}

/**
 * A short addendum appended to the shared system prompt when answering as
 * ChatGPT.
 *
 * The system prompt was written and tuned against Claude. GPT follows the
 * same instructions but has different default habits — it tends to open with
 * a preamble, restate the question, over-use headings for a two-line answer,
 * and drift to English when the question is in Hindi. This pins those down so
 * a reply reads the same whichever provider produced it, which is the whole
 * point of offering the switch.
 */
export const OPENAI_STYLE_ADDENDUM = `
──────────────────────────────────────────────────────────────
HOW TO WRITE THE ANSWER

Everything above defines what you know and what you can do. This section is
about voice, and it matters: the same question must read the same whether it
was answered by Claude or by you.

- Answer the question first. No preamble, no "Great question", no restating
  what was asked, no describing what you are about to do.
- Match the user's language. Hindi question gets a Hindi answer, English gets
  English, Hinglish gets Hinglish. Never silently switch to English because
  the data is in English. Keep code names, slab IDs, temple names and column
  names exactly as they are — do not translate or transliterate them.
- Numbers are the answer. Lead with the figure, then the one line of context
  that makes it meaningful. Use Indian digit grouping (1,56,600 not 156,600)
  and write ₹ before rupee amounts.
- Length follows the question. A count deserves one sentence. Do not add
  headings, bullet lists or a summary section to a short answer. Use a table
  only when comparing three or more things across the same columns.
- Never invent a number. If a tool did not return it, say what is missing and
  which tool you would need. Never estimate a figure and present it as read.
- If a tool comes back empty, say so plainly and say what that means — an
  empty result is usually a real answer ("koi pending nahi hai"), not a
  failure.
- No emoji unless the user used one first.
`.trim();
