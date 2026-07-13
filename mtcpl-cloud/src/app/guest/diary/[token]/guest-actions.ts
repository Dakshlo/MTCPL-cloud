"use server";

/**
 * Work Diary GUEST reply (mig 201) — the no-login path behind the WhatsApp
 * mention ping. The token IS the credential: a valid, unexpired
 * work_diary_guest_links row identifies exactly one (entry, person) pair, so
 * the reply posts into that entry's chat under that person's name.
 *
 * Deliberately narrow: text-only remarks, no attachments, no manage actions.
 */

import { revalidatePath } from "next/cache";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";

type ActionResult = { ok: true } | { ok: false; error: string };

function txt(fd: FormData, key: string): string {
  const v = fd.get(key);
  return typeof v === "string" ? v.trim() : "";
}

export async function postGuestDiaryRemarkAction(formData: FormData): Promise<ActionResult> {
  const token = txt(formData, "token");
  const body = txt(formData, "body").slice(0, 2000);
  if (!token) return { ok: false, error: "Bad link." };
  if (!body) return { ok: false, error: "Write a message first." };

  const admin = createAdminSupabaseClient();
  const { data: lRow } = await admin
    .from("work_diary_guest_links")
    .select("id, entry_id, profile_id, expires_at")
    .eq("token", token)
    .maybeSingle();
  const link = lRow as { id: string; entry_id: string; profile_id: string; expires_at: string } | null;
  if (!link) return { ok: false, error: "This link is not valid." };
  if (new Date(link.expires_at).getTime() < Date.now()) return { ok: false, error: "This link has expired — open the Work Diary in the app instead." };

  const { data: eRow } = await admin
    .from("work_diary_entries")
    .select("id, closed_at")
    .eq("id", link.entry_id)
    .maybeSingle();
  const entry = eRow as { id: string; closed_at: string | null } | null;
  if (!entry) return { ok: false, error: "This activity no longer exists." };
  if (entry.closed_at) return { ok: false, error: "This activity is closed — no more messages." };

  // mentions col is mig 201 (same mig as this table), so no retry needed here.
  const { error } = await admin
    .from("work_diary_remarks")
    .insert({ entry_id: link.entry_id, author: link.profile_id, body, kind: "remark", mentions: [] } as never);
  if (error) return { ok: false, error: "Could not send — try again." };

  void logAudit(link.profile_id, "diary_guest_remark", "work_diary_entry", link.entry_id, { viaLink: true }).catch(() => {});
  revalidatePath(`/guest/diary/${token}`);
  revalidatePath("/diary");
  return { ok: true };
}
