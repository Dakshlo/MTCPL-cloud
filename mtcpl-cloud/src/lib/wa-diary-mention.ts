// Work Diary @mention → WhatsApp ping (mig 201, Daksh Jul 2026).
//
// When someone is @-mentioned in an activity's chat, they get a WhatsApp
// template with: the activity name, who mentioned them, the message, and a
// TEMPORARY no-login link (/guest/diary/<token>, 48 h) where they can read the
// thread and reply straight into the chat from their phone.
//
// DORMANT until env MSG91_WA_DIARY_MENTION_TEMPLATE is set (same pattern as the
// other WA features). Template body vars:
//   {{1}} who mentioned (sender name)
//   {{2}} activity title
//   {{3}} the message (trimmed ~350 chars)
//   {{4}} the guest link URL
// Best-effort end to end — a WA failure must never block the remark itself.

import { randomUUID } from "crypto";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { sendWhatsAppTemplate, normalizeIndianMobile } from "@/lib/wa-send";
import { logAudit } from "@/lib/audit";

type Admin = ReturnType<typeof createAdminSupabaseClient>;

const LINK_TTL_HOURS = 48;

/** The app's public origin for links sent OUT (WhatsApp). Priority:
 *  APP_BASE_URL env → Vercel's production domain → localhost (dev). */
export function appBaseUrl(): string {
  const explicit = (process.env.APP_BASE_URL ?? "").trim();
  if (explicit) return explicit.replace(/\/+$/, "");
  const prod = (process.env.VERCEL_PROJECT_PRODUCTION_URL ?? "").trim();
  if (prod) return `https://${prod}`;
  return "http://localhost:3000";
}

/** Create a 48-h guest link for one profile on one entry. Returns the URL, or
 *  null when the table is missing (pre-mig-201). */
async function createGuestLink(admin: Admin, entryId: string, profileId: string, createdBy: string): Promise<string | null> {
  const token = randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, "").slice(0, 8);
  const expiresAt = new Date(Date.now() + LINK_TTL_HOURS * 3600 * 1000).toISOString();
  const { error } = await admin
    .from("work_diary_guest_links")
    .insert({ token, entry_id: entryId, profile_id: profileId, created_by: createdBy, expires_at: expiresAt });
  if (error) return null; // pre-mig-201
  return `${appBaseUrl()}/guest/diary/${token}`;
}

/** Fire the mention pings (call with `void ...catch(() => {})`). */
export async function sendDiaryMentionPings(opts: {
  admin: Admin;
  entryId: string;
  activity: string;
  senderId: string;
  senderName: string;
  body: string;
  mentionIds: string[];
}): Promise<void> {
  const template = (process.env.MSG91_WA_DIARY_MENTION_TEMPLATE ?? "").trim();
  if (!template) return; // dormant until the template is approved + set
  const targets = [...new Set(opts.mentionIds)].filter((id) => id && id !== opts.senderId);
  if (targets.length === 0) return;

  const { data: profRows } = await opts.admin
    .from("profiles")
    .select("id, full_name, phone")
    .in("id", targets);
  const profs = (profRows ?? []) as Array<{ id: string; full_name: string | null; phone: string | null }>;

  const message = (opts.body || "").replace(/\s+/g, " ").trim().slice(0, 350) || "(file attached)";

  for (const p of profs) {
    const to = normalizeIndianMobile(p.phone);
    if (!to) continue;
    try {
      const link = await createGuestLink(opts.admin, opts.entryId, p.id, opts.senderId);
      await sendWhatsAppTemplate({
        to: [to],
        templateName: template,
        components: {
          body_1: { type: "text", value: opts.senderName },
          body_2: { type: "text", value: opts.activity.slice(0, 120) },
          body_3: { type: "text", value: message },
          body_4: { type: "text", value: link ?? appBaseUrl() + "/diary" },
        },
      });
      void logAudit(opts.senderId, "diary_mention_wa_sent", "work_diary_entry", opts.entryId, { to: p.id, name: p.full_name }).catch(() => {});
    } catch {
      /* never block the remark on a WA failure */
    }
  }
}
