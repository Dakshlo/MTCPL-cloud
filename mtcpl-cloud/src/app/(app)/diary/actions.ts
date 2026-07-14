"use server";

/**
 * Work Diary server actions (mig 185) — the digital "kaam ka register".
 *
 * Rules (Daksh + Naresh, Jul 2026):
 *   • every logged-in user can create entries and REMARK on entries they're in;
 *   • MANAGE (close / reopen / urgent toggle / edit included people) and DELETE —
 *     only the creator (or owner/developer); other includeds can only remark;
 *   • groups are shared quick-pick member sets; delete = creator/owner/dev.
 *
 * All actions return { ok } instead of redirecting so the drawer / modal can
 * stay open and router.refresh() in place.
 */

import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";
import { revalidatePath } from "next/cache";
import { sendDiaryMentionPings } from "@/lib/wa-diary-mention";

type ActionResult = { ok: true } | { ok: false; error: string };
type Admin = ReturnType<typeof createAdminSupabaseClient>;

function txt(fd: FormData, key: string): string {
  const v = fd.get(key);
  return typeof v === "string" ? v.trim() : "";
}
function ids(fd: FormData, key: string): string[] {
  try {
    const raw = JSON.parse(txt(fd, key) || "[]");
    return Array.isArray(raw) ? raw.filter((x) => typeof x === "string" && x) : [];
  } catch {
    return [];
  }
}
const isBoss = (role: string) => role === "owner" || role === "developer";

// ── File attachments (mig 186) ──────────────────────────────────────
// The browser uploads DIRECTLY to the public "work-diary" bucket via signed
// upload URLs (no server body-size limit — any file type/size), then the
// create/remark action records the metadata rows here.

const DIARY_BUCKET = "work-diary";

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

/** Best-effort (pre-mig-186 just skips) — record attachment rows. */
async function insertDiaryFiles(admin: Admin, entryId: string, remarkId: string | null, files: FileMeta[], uploadedBy: string) {
  if (files.length === 0) return;
  await admin.from("work_diary_files").insert(files.map((f) => ({ entry_id: entryId, remark_id: remarkId, name: f.name, path: f.path, mime: f.mime, size: f.size, uploaded_by: uploadedBy })));
}

/** Hand the browser signed upload URLs for direct-to-storage uploads. */
export async function prepareDiaryUploadsAction(
  formData: FormData,
): Promise<{ ok: true; uploads: Array<{ name: string; path: string; token: string }> } | { ok: false; error: string }> {
  const { profile } = await requireAuth();
  const admin = createAdminSupabaseClient();
  void profile;

  let names: Array<{ name: string }> = [];
  try {
    const raw = JSON.parse(txt(formData, "names") || "[]");
    if (Array.isArray(raw)) names = raw.filter((n) => n && typeof n.name === "string");
  } catch { /* ignore */ }
  if (names.length === 0) return { ok: false, error: "No files to upload." };
  if (names.length > 15) return { ok: false, error: "Max 15 files at once." };

  // Lazily ensure the bucket exists (same pattern as dev-transfer).
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

/** Load an entry + this profile's rights on it.
 *   • allowed = boss / creator / included  → may REMARK;
 *   • manage  = boss / creator only        → may close, reopen, urgent, edit people. */
async function loadEntryFor(admin: Admin, entryId: string, profileId: string, role: string) {
  const { data: e } = await admin
    .from("work_diary_entries")
    .select("id, activity, created_by, closed_at")
    .eq("id", entryId)
    .maybeSingle();
  const entry = e as { id: string; activity: string; created_by: string; closed_at: string | null } | null;
  if (!entry) return { entry: null, allowed: false, manage: false, participant: false };
  const { data: p } = await admin
    .from("work_diary_participants")
    .select("profile_id")
    .eq("entry_id", entryId)
    .eq("profile_id", profileId)
    .maybeSingle();
  const participant = !!p;
  const manage = isBoss(role) || entry.created_by === profileId;
  const allowed = manage || participant;
  return { entry, allowed, manage, participant };
}

// Shown when a non-creator, non-boss tries a manage action.
const MANAGE_DENIED = "Only the person who started this activity (or the owner) can change or close it.";

/** New register entry — activity + due date + at least one included user. */
export async function createDiaryEntryAction(formData: FormData): Promise<ActionResult> {
  const { profile } = await requireAuth();
  const admin = createAdminSupabaseClient();

  // Register style — the activity is written in CAPITALS (Daksh).
  const activity = txt(formData, "activity").toUpperCase();
  // Due date is OPTIONAL (Daksh) — a plain note needs no deadline; date-related
  // info (due / overdue) only shows when a date is actually set.
  const dueDate = txt(formData, "due_date") || null;
  // The creator can be the ONLY person included — that's a personal entry
  // (Naresh maintains his own work); others can be added later via Manage people.
  const people = [...new Set(ids(formData, "participants"))];
  const urgent = txt(formData, "urgent") === "1";
  if (!activity) return { ok: false, error: "Write the activity." };
  if (people.length === 0) return { ok: false, error: "Include at least one person (you can pick just yourself)." };

  const base = { activity, details: txt(formData, "details") || null, created_by: profile.id, due_date: dueDate };
  // urgent col is mig 186 — retry without it on a pre-migration schema.
  let ins = await admin.from("work_diary_entries").insert({ ...base, urgent } as never).select("id").single();
  if (ins.error) ins = await admin.from("work_diary_entries").insert(base as never).select("id").single();
  const { data: row, error } = ins;
  if (error || !row) return { ok: false, error: error?.message || "Failed to create the entry." };
  const entryId = (row as { id: string }).id;
  await insertDiaryFiles(admin, entryId, null, filesFrom(formData), profile.id);

  const { error: pErr } = await admin
    .from("work_diary_participants")
    .insert(people.map((pid) => ({ entry_id: entryId, profile_id: pid })));
  if (pErr) {
    await admin.from("work_diary_entries").delete().eq("id", entryId);
    return { ok: false, error: "Failed to add the included users." };
  }

  // Optionally save this member set as a reusable group.
  const groupName = txt(formData, "save_group_name");
  if (groupName) {
    const { data: g } = await admin
      .from("work_diary_groups")
      .insert({ name: groupName, created_by: profile.id })
      .select("id")
      .single();
    if (g) await admin.from("work_diary_group_members").insert(people.map((pid) => ({ group_id: (g as { id: string }).id, profile_id: pid })));
  }

  void logAudit(profile.id, "diary_entry_created", "work_diary_entry", entryId, { activity, dueDate, people: people.length });
  revalidatePath("/diary");
  revalidatePath("/", "layout");
  return { ok: true };
}

/** Add / remove included users on an existing entry — CREATOR or owner/dev only.
 *  Replaces the whole participant set (must keep at least one). */
export async function updateDiaryParticipantsAction(formData: FormData): Promise<ActionResult> {
  const { profile } = await requireAuth();
  const admin = createAdminSupabaseClient();
  const entryId = txt(formData, "entry_id");
  const people = [...new Set(ids(formData, "participants"))];
  if (!entryId) return { ok: false, error: "Missing entry." };
  if (people.length === 0) return { ok: false, error: "Keep at least one person included." };

  const { entry, manage } = await loadEntryFor(admin, entryId, profile.id, profile.role);
  if (!entry) return { ok: false, error: "Entry not found." };
  if (!manage) return { ok: false, error: MANAGE_DENIED };

  await admin.from("work_diary_participants").delete().eq("entry_id", entryId);
  const { error } = await admin.from("work_diary_participants").insert(people.map((pid) => ({ entry_id: entryId, profile_id: pid })));
  if (error) return { ok: false, error: error.message };

  void logAudit(profile.id, "diary_participants_updated", "work_diary_entry", entryId, { count: people.length });
  revalidatePath("/diary");
  revalidatePath("/", "layout");
  return { ok: true };
}

/** Status remark on an entry — creator / included / owner / developer.
 *  Mig 201 — may carry @MENTIONS (ids), restricted to people INCLUDED in this
 *  entry; each mentioned person gets a WhatsApp ping with a guest reply link. */
export async function addDiaryRemarkAction(formData: FormData): Promise<ActionResult> {
  const { profile } = await requireAuth();
  const admin = createAdminSupabaseClient();
  const entryId = txt(formData, "entry_id");
  const body = txt(formData, "body");
  const files = filesFrom(formData);
  if (!entryId) return { ok: false, error: "Missing entry." };
  if (!body && files.length === 0) return { ok: false, error: "Write a remark (or attach a file) first." };

  const { entry, allowed } = await loadEntryFor(admin, entryId, profile.id, profile.role);
  if (!entry) return { ok: false, error: "Entry not found." };
  if (!allowed) return { ok: false, error: "You're not included in this entry." };

  // Mentions may only point at people actually ON this entry (its included
  // list + the creator) — anything else posted is silently dropped.
  let mentions = [...new Set(ids(formData, "mentions"))];
  if (mentions.length > 0) {
    const { data: ps } = await admin.from("work_diary_participants").select("profile_id").eq("entry_id", entryId);
    const onEntry = new Set(((ps ?? []) as Array<{ profile_id: string }>).map((p) => p.profile_id));
    onEntry.add(entry.created_by);
    mentions = mentions.filter((id) => onEntry.has(id));
  }

  // mentions col is mig 201 — retry without it on a pre-migration schema.
  let ins = await admin.from("work_diary_remarks").insert({ entry_id: entryId, author: profile.id, body, kind: "remark", mentions } as never).select("id").single();
  if (ins.error) ins = await admin.from("work_diary_remarks").insert({ entry_id: entryId, author: profile.id, body, kind: "remark" }).select("id").single();
  const { data: r, error } = ins;
  if (error || !r) return { ok: false, error: error?.message || "Failed to add the remark." };
  await insertDiaryFiles(admin, entryId, (r as { id: string }).id, files, profile.id);

  // WhatsApp ping per mentioned person — fire-and-forget, never blocks the send.
  if (mentions.length > 0) {
    void sendDiaryMentionPings({
      admin, entryId, activity: entry.activity,
      senderId: profile.id, senderName: (profile.full_name ?? "").trim() || "Someone",
      body, mentionIds: mentions,
      allowSelf: profile.role === "developer", // dev may self-tag to test the WA ping
    }).catch(() => {});
  }

  revalidatePath("/diary");
  return { ok: true };
}

/** UNSEND — the author can delete their OWN message within 10 minutes of
 *  sending it (like WhatsApp's delete-for-everyone window). After that, no. */
export async function unsendDiaryRemarkAction(formData: FormData): Promise<ActionResult> {
  const { profile } = await requireAuth();
  const admin = createAdminSupabaseClient();
  const remarkId = txt(formData, "remark_id");
  if (!remarkId) return { ok: false, error: "Missing message." };

  const { data: rRow } = await admin
    .from("work_diary_remarks")
    .select("id, entry_id, author, kind, created_at")
    .eq("id", remarkId)
    .maybeSingle();
  const r = rRow as { id: string; entry_id: string; author: string; kind: string; created_at: string } | null;
  if (!r) return { ok: false, error: "Message not found." };
  if (r.kind !== "remark") return { ok: false, error: "System lines can't be unsent." };
  if (r.author !== profile.id) return { ok: false, error: "You can only unsend your own message." };
  const ageMs = Date.now() - new Date(r.created_at).getTime();
  if (ageMs > 10 * 60 * 1000) return { ok: false, error: "The 10-minute unsend window is over." };

  // Best-effort: remove the message's attachments from storage too.
  try {
    const { data: fs } = await admin.from("work_diary_files").select("path").eq("remark_id", remarkId);
    const paths = ((fs ?? []) as Array<{ path: string }>).map((f) => f.path);
    if (paths.length) await admin.storage.from(DIARY_BUCKET).remove(paths);
  } catch { /* orphaned storage objects are acceptable */ }

  const { error } = await admin.from("work_diary_remarks").delete().eq("id", remarkId).eq("author", profile.id);
  if (error) return { ok: false, error: error.message };

  void logAudit(profile.id, "diary_remark_unsent", "work_diary_entry", r.entry_id, {});
  revalidatePath("/diary");
  return { ok: true };
}

/** Close — CREATOR or owner/developer only (other includeds can only remark). */
export async function closeDiaryEntryAction(formData: FormData): Promise<ActionResult> {
  const { profile } = await requireAuth();
  const admin = createAdminSupabaseClient();
  const entryId = txt(formData, "entry_id");
  if (!entryId) return { ok: false, error: "Missing entry." };

  const { entry, manage } = await loadEntryFor(admin, entryId, profile.id, profile.role);
  if (!entry) return { ok: false, error: "Entry not found." };
  if (!manage) return { ok: false, error: MANAGE_DENIED };
  if (entry.closed_at) return { ok: false, error: "Already closed." };

  const { error } = await admin
    .from("work_diary_entries")
    .update({ closed_at: new Date().toISOString(), closed_by: profile.id })
    .eq("id", entryId);
  if (error) return { ok: false, error: error.message };
  // The optional closing remark rides on the system "closed" line — the Closed
  // tab card shows it big next to who closed it.
  await admin.from("work_diary_remarks").insert({ entry_id: entryId, author: profile.id, body: txt(formData, "body"), kind: "closed" });

  void logAudit(profile.id, "diary_entry_closed", "work_diary_entry", entryId, { activity: entry.activity });
  revalidatePath("/diary");
  revalidatePath("/", "layout");
  return { ok: true };
}

/** Reopen a closed entry — CREATOR or owner/developer only (same as close). */
export async function reopenDiaryEntryAction(formData: FormData): Promise<ActionResult> {
  const { profile } = await requireAuth();
  const admin = createAdminSupabaseClient();
  const entryId = txt(formData, "entry_id");
  if (!entryId) return { ok: false, error: "Missing entry." };

  const { entry, manage } = await loadEntryFor(admin, entryId, profile.id, profile.role);
  if (!entry) return { ok: false, error: "Entry not found." };
  if (!manage) return { ok: false, error: MANAGE_DENIED };
  if (!entry.closed_at) return { ok: false, error: "Entry is already open." };

  const { error } = await admin.from("work_diary_entries").update({ closed_at: null, closed_by: null }).eq("id", entryId);
  if (error) return { ok: false, error: error.message };
  await admin.from("work_diary_remarks").insert({ entry_id: entryId, author: profile.id, body: "", kind: "reopened" });

  void logAudit(profile.id, "diary_entry_reopened", "work_diary_entry", entryId, { activity: entry.activity });
  revalidatePath("/diary");
  revalidatePath("/", "layout");
  return { ok: true };
}

/** Mark / unmark an entry URGENT (mig 186) — CREATOR or owner/developer only.
 *  Urgent entries glow, sort on top, and light the topbar pill's moving border. */
export async function setDiaryUrgentAction(formData: FormData): Promise<ActionResult> {
  const { profile } = await requireAuth();
  const admin = createAdminSupabaseClient();
  const entryId = txt(formData, "entry_id");
  const urgent = txt(formData, "urgent") === "1";
  if (!entryId) return { ok: false, error: "Missing entry." };

  const { entry, manage } = await loadEntryFor(admin, entryId, profile.id, profile.role);
  if (!entry) return { ok: false, error: "Entry not found." };
  if (!manage) return { ok: false, error: MANAGE_DENIED };

  const { error } = await admin.from("work_diary_entries").update({ urgent } as never).eq("id", entryId);
  if (error) return { ok: false, error: "Run migration 186 to enable the urgent flag." };

  void logAudit(profile.id, urgent ? "diary_entry_urgent" : "diary_entry_unurgent", "work_diary_entry", entryId, { activity: entry.activity });
  revalidatePath("/diary");
  revalidatePath("/", "layout");
  return { ok: true };
}

/** Delete — ONLY the creator (or owner / developer). Cascades participants + remarks. */
export async function deleteDiaryEntryAction(formData: FormData): Promise<ActionResult> {
  const { profile } = await requireAuth();
  const admin = createAdminSupabaseClient();
  const entryId = txt(formData, "entry_id");
  if (!entryId) return { ok: false, error: "Missing entry." };

  const { entry } = await loadEntryFor(admin, entryId, profile.id, profile.role);
  if (!entry) return { ok: false, error: "Entry not found." };
  if (!(isBoss(profile.role) || entry.created_by === profile.id)) {
    return { ok: false, error: "Only the person who started this activity can delete it." };
  }

  void logAudit(profile.id, "diary_entry_deleted", "work_diary_entry", entryId, { activity: entry.activity });
  const { error } = await admin.from("work_diary_entries").delete().eq("id", entryId);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/diary");
  revalidatePath("/", "layout");
  return { ok: true };
}

/** Save a reusable member set (shared with everyone). */
export async function createDiaryGroupAction(formData: FormData): Promise<ActionResult> {
  const { profile } = await requireAuth();
  const admin = createAdminSupabaseClient();
  const name = txt(formData, "name");
  const members = [...new Set(ids(formData, "members"))];
  if (!name) return { ok: false, error: "Give the group a name." };
  if (members.length === 0) return { ok: false, error: "Pick at least one member." };

  const { data: g, error } = await admin.from("work_diary_groups").insert({ name, created_by: profile.id }).select("id").single();
  if (error || !g) return { ok: false, error: error?.message || "Failed to create the group." };
  await admin.from("work_diary_group_members").insert(members.map((pid) => ({ group_id: (g as { id: string }).id, profile_id: pid })));

  void logAudit(profile.id, "diary_group_created", "work_diary_group", (g as { id: string }).id, { name, members: members.length });
  revalidatePath("/diary");
  return { ok: true };
}

/** Delete a group — its creator (or owner / developer). Entries are untouched. */
export async function deleteDiaryGroupAction(formData: FormData): Promise<ActionResult> {
  const { profile } = await requireAuth();
  const admin = createAdminSupabaseClient();
  const groupId = txt(formData, "group_id");
  if (!groupId) return { ok: false, error: "Missing group." };

  const { data: g } = await admin.from("work_diary_groups").select("id, name, created_by").eq("id", groupId).maybeSingle();
  const grp = g as { id: string; name: string; created_by: string } | null;
  if (!grp) return { ok: false, error: "Group not found." };
  if (!(isBoss(profile.role) || grp.created_by === profile.id)) {
    return { ok: false, error: "Only the group's creator can delete it." };
  }

  void logAudit(profile.id, "diary_group_deleted", "work_diary_group", groupId, { name: grp.name });
  const { error } = await admin.from("work_diary_groups").delete().eq("id", groupId);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/diary");
  return { ok: true };
}
