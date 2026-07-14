"use server";

/**
 * Work Diary GUEST reply (mig 201) — the no-login path behind the WhatsApp
 * mention ping. The token IS the credential: a valid, unexpired
 * work_diary_guest_links row identifies exactly one (entry, person) pair, so
 * the reply posts into that entry's chat under that person's name.
 *
 * Supports attachments: the browser uploads straight to storage via a
 * token-gated signed URL (bypasses the server-action body limit for big phone
 * photos), then submits only the file metadata — same machinery as the in-app
 * diary, and the files land in the same work_diary_files table (mig 186).
 */

import { revalidatePath } from "next/cache";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";

type ActionResult = { ok: true } | { ok: false; error: string };
type Admin = ReturnType<typeof createAdminSupabaseClient>;

const DIARY_BUCKET = "work-diary";

function txt(fd: FormData, key: string): string {
  const v = fd.get(key);
  return typeof v === "string" ? v.trim() : "";
}

type FileMeta = { name: string; path: string; mime: string | null; size: number | null };
function filesFrom(fd: FormData): FileMeta[] {
  try {
    const raw = JSON.parse(txt(fd, "files") || "[]");
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((f) => f && typeof f.name === "string" && typeof f.path === "string")
      .map((f) => ({ name: String(f.name).slice(0, 300), path: String(f.path), mime: f.mime ? String(f.mime) : null, size: Number(f.size) || null }));
  } catch {
    return [];
  }
}

/** Resolve the guest token → the (entry, person) it authorizes, if still live. */
async function resolveGuestLink(
  admin: Admin,
  token: string,
): Promise<
  | { ok: true; link: { id: string; entry_id: string; profile_id: string }; closed: boolean }
  | { ok: false; error: string }
> {
  if (!token) return { ok: false, error: "Bad link." };
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
  return { ok: true, link: { id: link.id, entry_id: link.entry_id, profile_id: link.profile_id }, closed: !!entry.closed_at };
}

/** Hand the guest signed upload URLs (token-gated mirror of the in-app action). */
export async function prepareGuestDiaryUploadsAction(
  formData: FormData,
): Promise<{ ok: true; uploads: Array<{ name: string; path: string; token: string }> } | { ok: false; error: string }> {
  const token = txt(formData, "token");
  const admin = createAdminSupabaseClient();
  const gate = await resolveGuestLink(admin, token);
  if (!gate.ok) return gate;
  if (gate.closed) return { ok: false, error: "This activity is closed — no more messages." };

  let names: Array<{ name: string }> = [];
  try {
    const raw = JSON.parse(txt(formData, "names") || "[]");
    if (Array.isArray(raw)) names = raw.filter((n) => n && typeof n.name === "string");
  } catch { /* ignore */ }
  if (names.length === 0) return { ok: false, error: "No files to upload." };
  if (names.length > 15) return { ok: false, error: "Max 15 files at once." };

  try { await admin.storage.createBucket(DIARY_BUCKET, { public: true }); } catch { /* already exists */ }

  const month = new Date().toISOString().slice(0, 7); // yyyy-mm folder
  const uploads: Array<{ name: string; path: string; token: string }> = [];
  for (const n of names) {
    const safe = n.name.replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 120) || "file";
    const path = `${month}/${crypto.randomUUID()}-${safe}`;
    const { data, error } = await admin.storage.from(DIARY_BUCKET).createSignedUploadUrl(path);
    if (error || !data) return { ok: false, error: error?.message || "Could not prepare the upload." };
    uploads.push({ name: n.name, path, token: data.token });
  }
  return { ok: true, uploads };
}

export async function postGuestDiaryRemarkAction(formData: FormData): Promise<ActionResult> {
  const token = txt(formData, "token");
  const body = txt(formData, "body").slice(0, 2000);
  const files = filesFrom(formData);
  if (!token) return { ok: false, error: "Bad link." };
  if (!body && files.length === 0) return { ok: false, error: "Write a message (or attach a file) first." };

  const admin = createAdminSupabaseClient();
  const gate = await resolveGuestLink(admin, token);
  if (!gate.ok) return gate;
  if (gate.closed) return { ok: false, error: "This activity is closed — no more messages." };
  const link = gate.link;

  // mentions col is mig 201 (same mig as the guest-links table), so no retry.
  const { data: r, error } = await admin
    .from("work_diary_remarks")
    .insert({ entry_id: link.entry_id, author: link.profile_id, body, kind: "remark", mentions: [] } as never)
    .select("id")
    .single();
  if (error || !r) return { ok: false, error: "Could not send — try again." };

  if (files.length > 0) {
    await admin.from("work_diary_files").insert(
      files.map((f) => ({ entry_id: link.entry_id, remark_id: (r as { id: string }).id, name: f.name, path: f.path, mime: f.mime, size: f.size, uploaded_by: link.profile_id })),
    );
  }

  void logAudit(link.profile_id, "diary_guest_remark", "work_diary_entry", link.entry_id, { viaLink: true, files: files.length }).catch(() => {});
  revalidatePath(`/guest/diary/${token}`);
  revalidatePath("/diary");
  return { ok: true };
}
