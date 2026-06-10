// ──────────────────────────────────────────────────────────────────
// Owner email snapshot (Daksh, June 2026)
//
// Reads the owner's Gmail inbox over IMAP — STRICTLY READ-ONLY:
//   • IMAP is a retrieval protocol; sending mail needs SMTP, which this
//     module does not import, configure, or speak. It CANNOT send,
//     reply, forward, delete, or modify anything.
//   • The mailbox is additionally opened with readOnly:true, so even
//     "mark as read" flags are never written.
//
// Claude then picks the IMPORTANT emails and summarizes what each one
// actually says (amounts, deadlines, who wants what). Only those
// summaries are stored (mig 119) — never full email bodies.
//
// Env: GMAIL_USER, GMAIL_APP_PASSWORD (Google App Password),
//      ANTHROPIC_API_KEY, EMAIL_SNAPSHOT_MODEL (optional).
// ──────────────────────────────────────────────────────────────────

import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import Anthropic from "@anthropic-ai/sdk";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";

export type SnapshotItem = {
  from: string;
  subject: string;
  summary: string;
  category: string;
  urgency: "action_needed" | "fyi";
};

const LOOKBACK_HOURS = 40; // covers the gap between runs with margin
const MAX_EMAILS = 40;
const MAX_BODY_CHARS = 1500;

const SUMMARY_SCHEMA = {
  type: "object",
  properties: {
    overview: {
      type: "string",
      description: "One line for the dashboard header, e.g. '14 emails — 2 need action, 3 worth knowing.'",
    },
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          idx: { type: "integer", description: "Index of the email in the input list" },
          important: { type: "boolean" },
          category: {
            type: "string",
            enum: ["bank_payment", "government_gst", "client", "vendor", "legal", "other"],
          },
          urgency: { type: "string", enum: ["action_needed", "fyi"] },
          summary: {
            type: "string",
            description: "1-2 sentences with the EXACT facts: amounts, dates, names, what is being asked",
          },
        },
        required: ["idx", "important", "category", "urgency", "summary"],
        additionalProperties: false,
      },
    },
  },
  required: ["overview", "items"],
  additionalProperties: false,
} as const;

const SUMMARY_PROMPT = `You are screening the inbox of the OWNER of MATESHWARI TEMPLE CONSTRUCTION PVT LTD (MTCPL), a stone/marble temple-construction business in India, so he sees only what matters on his dashboard.

IMPORTANT emails (keep): bank/payment alerts and statements, UPI/NEFT/RTGS confirmations, GST/income-tax/government notices, clients or temples writing about projects or payments, vendors asking for something, legal/insurance/compliance, anything with money amounts or deadlines that concern the business or the owner personally.
NOT important (drop): promotions, marketing, newsletters, social media notifications, OTP/verification codes, app notifications, spam.

For every email in the input, return an item with the same idx. Mark important true/false. For important ones, write a 1-2 sentence summary that states EXACTLY what is in the email — concrete amounts, dates, account/invoice numbers, names, and what (if anything) the owner must do. Do not be vague ("a bank update") — be specific ("HDFC: Rs. 4,41,513 debited to Shree Marble on 9 Jun, balance Rs. 12,30,000"). urgency = action_needed only when he must actually do something.`;

type FetchedEmail = { from: string; subject: string; date: string; body: string };

/** Read recent inbox mail over read-only IMAP. */
async function fetchRecentEmails(): Promise<FetchedEmail[]> {
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;
  if (!user || !pass) {
    throw new Error("Email snapshot not configured — set GMAIL_USER and GMAIL_APP_PASSWORD in Vercel.");
  }

  const client = new ImapFlow({
    host: "imap.gmail.com",
    port: 993,
    secure: true,
    auth: { user, pass },
    logger: false,
  });

  const out: FetchedEmail[] = [];
  await client.connect();
  try {
    // readOnly — the session can't even set a \Seen flag.
    const lock = await client.getMailboxLock("INBOX", { readOnly: true });
    try {
      const since = new Date(Date.now() - LOOKBACK_HOURS * 3600 * 1000);
      const uids = await client.search({ since }, { uid: true });
      const recent = (Array.isArray(uids) ? uids : []).slice(-MAX_EMAILS);
      if (recent.length > 0) {
        for await (const msg of client.fetch(recent.join(","), { source: true, uid: true }, { uid: true })) {
          if (!msg.source) continue;
          try {
            const parsed = await simpleParser(msg.source);
            const body = (parsed.text ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_BODY_CHARS);
            out.push({
              from: parsed.from?.text ?? "(unknown sender)",
              subject: parsed.subject ?? "(no subject)",
              date: parsed.date ? parsed.date.toISOString() : "",
              body,
            });
          } catch {
            // Unparseable message — skip it rather than failing the run.
          }
        }
      }
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => {});
  }
  return out;
}

/** Ask Claude which emails matter + what they say. */
async function summarize(emails: FetchedEmail[]): Promise<{ overview: string; items: SnapshotItem[] }> {
  if (emails.length === 0) {
    return { overview: "No new emails in this period.", items: [] };
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is not set.");
  }
  const anthropic = new Anthropic();
  const model = process.env.EMAIL_SNAPSHOT_MODEL || "claude-sonnet-4-6";

  const input = emails.map((e, idx) => ({ idx, from: e.from, subject: e.subject, date: e.date, body: e.body }));
  const response = await anthropic.messages.create({
    model,
    max_tokens: 8000,
    thinking: { type: "adaptive" },
    output_config: { format: { type: "json_schema", schema: SUMMARY_SCHEMA } },
    messages: [
      {
        role: "user",
        content: `${SUMMARY_PROMPT}\n\nEMAILS (JSON):\n${JSON.stringify(input)}`,
      },
    ],
  });

  const text = response.content.find((b) => b.type === "text")?.text ?? "";
  const parsed = JSON.parse(text) as {
    overview: string;
    items: Array<{ idx: number; important: boolean; category: string; urgency: "action_needed" | "fyi"; summary: string }>;
  };

  const items: SnapshotItem[] = [];
  for (const it of parsed.items) {
    if (!it.important) continue;
    const src = emails[it.idx];
    if (!src) continue;
    items.push({
      from: src.from,
      subject: src.subject,
      summary: it.summary,
      category: it.category,
      urgency: it.urgency === "action_needed" ? "action_needed" : "fyi",
    });
  }
  // Action-needed first.
  items.sort((a, b) => (a.urgency === b.urgency ? 0 : a.urgency === "action_needed" ? -1 : 1));
  return { overview: parsed.overview, items };
}

/** Full run: fetch → summarize → store. Always writes a row (with `error`
 *  set on failure) so the dashboard can show what happened. */
export async function runEmailSnapshot(trigger: "cron" | "manual"): Promise<{ ok: boolean; error?: string; itemCount?: number }> {
  const admin = createAdminSupabaseClient();
  try {
    const emails = await fetchRecentEmails();
    const { overview, items } = await summarize(emails);
    const { error } = await admin.from("email_snapshots").insert({
      items,
      overview,
      scanned_count: emails.length,
      trigger,
    });
    if (error) return { ok: false, error: error.message };
    return { ok: true, itemCount: items.length };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // Best-effort error row so the dashboard surfaces config problems.
    await admin
      .from("email_snapshots")
      .insert({ items: [], overview: null, scanned_count: 0, trigger, error: msg })
      .then(() => {}, () => {});
    return { ok: false, error: msg };
  }
}
