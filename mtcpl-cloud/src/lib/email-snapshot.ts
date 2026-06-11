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
  // uid + date let the dashboard open the FULL email on demand (read-
  // only, fetched live — never stored). Optional so older stored
  // snapshots that predate this still render.
  uid?: number;
  date?: string;
  // Stable, globally-unique key (the email's Message-ID, or a fallback
  // hash) — used to DEDUPE the archive so re-scanning overlapping ranges
  // keeps just one copy of each email.
  messageId?: string;
};

// The full email, fetched live when the owner opens a card. NEVER
// stored — only the summary above is persisted.
export type FullMessage = {
  from: string;
  subject: string;
  date: string;
  bodyText: string;
  attachments: Array<{ index: number; filename: string; mime: string; size: number }>;
};

// How far back to read. The 5am/2pm crons always use "today"; the
// dashboard Refresh button lets the owner pick a wider window.
export type SnapshotRange = "today" | "yesterday" | "last_3_days" | "last_7_days" | "last_month";

const RANGE_LABELS: Record<SnapshotRange, string> = {
  today: "Today",
  yesterday: "Yesterday onward",
  last_3_days: "Last 3 days",
  last_7_days: "Last 7 days",
  last_month: "Last 1 month",
};

export function rangeLabel(r: string | null | undefined): string {
  return RANGE_LABELS[(r ?? "today") as SnapshotRange] ?? "Today";
}

function normalizeRange(r: string | null | undefined): SnapshotRange {
  return r === "yesterday" || r === "last_3_days" || r === "last_7_days" || r === "last_month" ? r : "today";
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
  const daysAgo =
    range === "today" ? 0 :
    range === "yesterday" ? 1 :
    range === "last_3_days" ? 2 :
    range === "last_7_days" ? 6 :
    30; // last_month
  return istStartOfDay(daysAgo);
}

// A 1-month manual pull can return many emails, so the cap scales with the
// window (the cron's "today" stays small and cheap). Kept modest so the
// whole run fits inside the serverless time budget.
function maxEmailsForRange(range: SnapshotRange): number {
  return range === "last_month" ? 70 : range === "last_7_days" ? 60 : 40;
}

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
// the full "Name <addr>" for the AI's context. uid lets us re-open the
// full email later (read-only, on demand). messageId is the dedup key.
type FetchedEmail = { uid: number; messageId: string; fromName: string; fromText: string; subject: string; date: string; body: string };

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
      const recent = (Array.isArray(uids) ? uids : []).slice(-maxEmailsForRange(range));
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
            const subject = parsed.subject ?? "(no subject)";
            const date = parsed.date ? parsed.date.toISOString() : "";
            // Dedup key: the email's Message-ID (globally unique & stable);
            // fall back to sender+subject+date when a header is missing.
            const messageId = (parsed.messageId ?? "").trim() || `fallback:${fromName}|${subject}|${date}`;
            out.push({
              uid: typeof msg.uid === "number" ? msg.uid : 0,
              messageId,
              fromName,
              fromText: parsed.from?.text ?? fromName,
              subject,
              date,
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

const FULL_BODY_MAX_CHARS = 100_000; // generous — show the whole email
const ATTACHMENT_MAX_BYTES = 25 * 1024 * 1024; // 25 MB per attachment

function openImapClient(): ImapFlow {
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;
  if (!user || !pass) {
    throw new Error("Email snapshot not configured — set GMAIL_USER and GMAIL_APP_PASSWORD in Vercel.");
  }
  return new ImapFlow({ host: "imap.gmail.com", port: 993, secure: true, auth: { user, pass }, logger: false });
}

// Keep real file attachments, skip inline/embedded images (cid: logos
// etc.) so the owner sees the documents that matter.
function isRealAttachment(a: { filename?: string; contentDisposition?: string; related?: boolean }): boolean {
  if (a.related) return false;
  if (a.contentDisposition === "attachment") return true;
  return !!a.filename;
}

/** Open ONE email in full, read-only, by UID. Body is fetched live and
 *  never stored — only the summary persists. */
export async function fetchFullMessage(uid: number): Promise<FullMessage | null> {
  const client = openImapClient();
  await client.connect();
  try {
    const lock = await client.getMailboxLock("INBOX", { readOnly: true });
    try {
      const msg = await client.fetchOne(String(uid), { source: true }, { uid: true });
      if (!msg || !msg.source) return null;
      const parsed = await simpleParser(msg.source);
      const sender = parsed.from?.value?.[0];
      const fromName = (sender?.name ?? "").trim() || sender?.address || "(unknown sender)";
      let bodyText = (parsed.text ?? "").trim();
      if (!bodyText && parsed.html) {
        // HTML-only email — strip tags to plain words.
        bodyText = String(parsed.html).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      }
      const atts = (parsed.attachments ?? [])
        .filter((a) => isRealAttachment(a))
        .map((a, index) => ({
          index,
          filename: a.filename || `attachment-${index + 1}`,
          mime: a.contentType || "application/octet-stream",
          size: typeof a.size === "number" ? a.size : 0,
        }));
      return {
        from: parsed.from?.text ?? fromName,
        subject: parsed.subject ?? "(no subject)",
        date: parsed.date ? parsed.date.toISOString() : "",
        bodyText: bodyText.slice(0, FULL_BODY_MAX_CHARS),
        attachments: atts,
      };
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => {});
  }
}

/** Stream a single attachment's bytes, read-only, by UID + index. */
export async function fetchAttachment(
  uid: number,
  index: number,
): Promise<{ filename: string; mime: string; content: Buffer } | null> {
  const client = openImapClient();
  await client.connect();
  try {
    const lock = await client.getMailboxLock("INBOX", { readOnly: true });
    try {
      const msg = await client.fetchOne(String(uid), { source: true }, { uid: true });
      if (!msg || !msg.source) return null;
      const parsed = await simpleParser(msg.source);
      const atts = (parsed.attachments ?? []).filter((a) => isRealAttachment(a));
      const a = atts[index];
      if (!a || !a.content) return null;
      const content = Buffer.isBuffer(a.content) ? a.content : Buffer.from(a.content as Uint8Array);
      if (content.byteLength > ATTACHMENT_MAX_BYTES) return null;
      return { filename: a.filename || `attachment-${index + 1}`, mime: a.contentType || "application/octet-stream", content };
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => {});
  }
}

const SUMMARIZE_BATCH = 15;       // emails per Claude call
const SUMMARIZE_CONCURRENCY = 3;  // calls running at once

/** Summarize ONE batch of emails — returns the important ones. JSON parse
 *  errors yield [] (skip the batch); API errors propagate to the caller. */
async function summarizeBatch(anthropic: Anthropic, model: string, emails: FetchedEmail[]): Promise<SnapshotItem[]> {
  const input = emails.map((e, idx) => ({ idx, from: e.fromText, subject: e.subject, date: e.date, body: e.body }));
  const response = await anthropic.messages.create({
    model,
    max_tokens: 8000,
    thinking: { type: "adaptive" },
    output_config: { format: { type: "json_schema", schema: SUMMARY_SCHEMA } },
    messages: [{ role: "user", content: `${SUMMARY_PROMPT}\n\nEMAILS (JSON):\n${JSON.stringify(input)}` }],
  });
  const text = response.content.find((b) => b.type === "text")?.text ?? "";
  let parsed: { items?: Array<{ idx: number; important: boolean; category: string; urgency: "action_needed" | "fyi"; summary: string }> };
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }
  const items: SnapshotItem[] = [];
  for (const it of parsed.items ?? []) {
    if (!it.important) continue;
    const src = emails[it.idx];
    if (!src) continue;
    items.push({
      from: src.fromName,
      subject: src.subject,
      summary: it.summary,
      category: it.category,
      urgency: it.urgency === "action_needed" ? "action_needed" : "fyi",
      uid: src.uid,
      date: src.date,
      messageId: src.messageId,
    });
  }
  return items;
}

/** Ask Claude which emails matter + what they say. Processes emails in
 *  small batches with limited concurrency — a single huge call over a month
 *  of email is slow and can blow the function's time/token budget (the cause
 *  of the "Refresh failed" timeout). Batching keeps each call fast. */
async function summarize(emails: FetchedEmail[]): Promise<{ overview: string; items: SnapshotItem[] }> {
  if (emails.length === 0) {
    return { overview: "No new emails in this period.", items: [] };
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is not set.");
  }
  const anthropic = new Anthropic();
  const model = process.env.EMAIL_SNAPSHOT_MODEL || "claude-sonnet-4-6";

  const batches: FetchedEmail[][] = [];
  for (let i = 0; i < emails.length; i += SUMMARIZE_BATCH) batches.push(emails.slice(i, i + SUMMARIZE_BATCH));

  const out: SnapshotItem[][] = new Array(batches.length).fill(null).map(() => []);
  let nextIdx = 0;
  let firstError: unknown = null;
  async function worker() {
    while (nextIdx < batches.length) {
      const i = nextIdx++;
      try {
        out[i] = await summarizeBatch(anthropic, model, batches[i]);
      } catch (e) {
        if (!firstError) firstError = e;
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(SUMMARIZE_CONCURRENCY, batches.length) }, worker));

  const items = out.flat();
  // If every batch errored and nothing came back, surface the real error
  // (so the dashboard shows it) instead of silently storing an empty run.
  if (items.length === 0 && firstError) {
    throw firstError instanceof Error ? firstError : new Error(String(firstError));
  }
  // Action-needed first.
  items.sort((a, b) => (a.urgency === b.urgency ? 0 : a.urgency === "action_needed" ? -1 : 1));
  const actionCount = items.filter((i) => i.urgency === "action_needed").length;
  const overview =
    items.length === 0
      ? `Scanned ${emails.length} email${emails.length === 1 ? "" : "s"} — nothing important.`
      : `${items.length} important${actionCount ? `, ${actionCount} need action` : ""} (of ${emails.length} scanned).`;
  return { overview, items };
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

    // Persist each important email into the deduplicated archive (mig 121).
    // Upsert on dedup_key so re-scanning overlapping ranges keeps ONE copy.
    // Best-effort — never fail the run if the archive table isn't there yet.
    if (items.length > 0) {
      const rows = items
        .filter((it) => it.messageId)
        .map((it) => ({
          dedup_key: it.messageId as string,
          uid: it.uid ?? null,
          from_name: it.from,
          subject: it.subject,
          summary: it.summary,
          category: it.category,
          urgency: it.urgency,
          email_date: it.date || null,
          last_scanned_at: new Date().toISOString(),
        }));
      if (rows.length > 0) {
        await admin
          .from("email_messages")
          .upsert(rows, { onConflict: "dedup_key" })
          .then(() => {}, () => {});
      }
    }

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
