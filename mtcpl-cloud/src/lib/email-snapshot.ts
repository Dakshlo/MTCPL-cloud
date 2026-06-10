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

// How far back to read. The 5am/2pm crons always use "today"; the
// dashboard Refresh button lets the owner pick a wider window.
export type SnapshotRange = "today" | "yesterday" | "last_3_days" | "last_7_days";

const RANGE_LABELS: Record<SnapshotRange, string> = {
  today: "Today",
  yesterday: "Yesterday onward",
  last_3_days: "Last 3 days",
  last_7_days: "Last 7 days",
};

export function rangeLabel(r: string | null | undefined): string {
  return RANGE_LABELS[(r ?? "today") as SnapshotRange] ?? "Today";
}

function normalizeRange(r: string | null | undefined): SnapshotRange {
  return r === "yesterday" || r === "last_3_days" || r === "last_7_days" ? r : "today";
}

const IST_OFFSET_MS = 5.5 * 3600 * 1000;

// Start of the IST calendar day `daysAgo` days back, as a UTC Date —
// what IMAP's `since` filter wants. daysAgo: 0=today, 1=yesterday, etc.
function istStartOfDay(daysAgo: number): Date {
  const ist = new Date(Date.now() + IST_OFFSET_MS);
  const midnightIstAsUtc = Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate() - daysAgo) - IST_OFFSET_MS;
  return new Date(midnightIstAsUtc);
}

function sinceForRange(range: SnapshotRange): Date {
  const daysAgo = range === "today" ? 0 : range === "yesterday" ? 1 : range === "last_3_days" ? 2 : 6;
  return istStartOfDay(daysAgo);
}

const MAX_EMAILS = 60;
const MAX_BODY_CHARS = 1500;

// Google's own service mail (sign-in alerts, security/policy notices,
// account notifications) comes from these domains. Daksh: never show
// it, no matter how "urgent" it looks. Real people on gmail.com /
// googlemail.com are NOT affected — only Google-the-company senders.
function isGoogleServiceSender(address: string | undefined): boolean {
  if (!address) return false;
  const domain = address.toLowerCase().split("@")[1] ?? "";
  return domain === "google.com" || domain.endsWith(".google.com");
}

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
NOT important (drop): promotions, marketing, newsletters, social media notifications, OTP/verification codes, app notifications, spam. ALSO drop any email sent BY Google itself (sign-in/security alerts, account or policy notices, Google Workspace/Maps/Drive notifications) — mark these important=false even if they look urgent.

For every email in the input, return an item with the same idx. Mark important true/false. For important ones, write a 1-2 sentence summary that states EXACTLY what is in the email — concrete amounts, dates, account/invoice numbers, names, and what (if anything) the owner must do. Do not be vague ("a bank update") — be specific ("HDFC: Rs. 4,41,513 debited to Shree Marble on 9 Jun, balance Rs. 12,30,000"). urgency = action_needed only when he must actually do something.`;

// fromName = clean display name (what we show in bold); fromText keeps
// the full "Name <addr>" for the AI's context.
type FetchedEmail = { fromName: string; fromText: string; subject: string; date: string; body: string };

/** Read recent inbox mail over read-only IMAP, within the given range. */
async function fetchRecentEmails(range: SnapshotRange): Promise<FetchedEmail[]> {
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
      const since = sinceForRange(range);
      const uids = await client.search({ since }, { uid: true });
      const recent = (Array.isArray(uids) ? uids : []).slice(-MAX_EMAILS);
      if (recent.length > 0) {
        for await (const msg of client.fetch(recent.join(","), { source: true, uid: true }, { uid: true })) {
          if (!msg.source) continue;
          try {
            const parsed = await simpleParser(msg.source);
            const sender = parsed.from?.value?.[0];
            // Drop Google's own service mail entirely — never surfaced.
            if (isGoogleServiceSender(sender?.address)) continue;
            const fromName = (sender?.name ?? "").trim() || sender?.address || "(unknown sender)";
            const body = (parsed.text ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_BODY_CHARS);
            out.push({
              fromName,
              fromText: parsed.from?.text ?? fromName,
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

  const input = emails.map((e, idx) => ({ idx, from: e.fromText, subject: e.subject, date: e.date, body: e.body }));
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
      from: src.fromName,
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
export async function runEmailSnapshot(
  trigger: "cron" | "manual",
  range: string = "today",
): Promise<{ ok: boolean; error?: string; itemCount?: number }> {
  const admin = createAdminSupabaseClient();
  // Crons always read just today; only a manual refresh may widen the window.
  const effectiveRange: SnapshotRange = trigger === "cron" ? "today" : normalizeRange(range);
  try {
    const emails = await fetchRecentEmails(effectiveRange);
    const { overview, items } = await summarize(emails);
    const { error } = await admin.from("email_snapshots").insert({
      items,
      overview,
      scanned_count: emails.length,
      trigger,
      range: effectiveRange,
    });
    if (error) return { ok: false, error: error.message };
    return { ok: true, itemCount: items.length };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // Best-effort error row so the dashboard surfaces config problems.
    await admin
      .from("email_snapshots")
      .insert({ items: [], overview: null, scanned_count: 0, trigger, range: effectiveRange, error: msg })
      .then(() => {}, () => {});
    return { ok: false, error: msg };
  }
}
