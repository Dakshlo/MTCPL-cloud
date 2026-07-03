"use server";

/**
 * Work Diary server actions (mig 185) — the digital "kaam ka register".
 *
 * Rules (Daksh + Naresh, Jul 2026):
 *   • every logged-in user can create entries and remark on entries they're in;
 *   • CLOSE / REOPEN — anyone included (or the creator, or owner/developer);
 *   • DELETE — only the creator (or owner/developer), never other includeds;
 *   • groups are shared quick-pick member sets; delete = creator/owner/dev.
 *
 * All actions return { ok } instead of redirecting so the drawer / modal can
 * stay open and router.refresh() in place.
 */

import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";
import { revalidatePath } from "next/cache";

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

/** Load an entry + whether this profile may act on it (boss / creator / included). */
async function loadEntryFor(admin: Admin, entryId: string, profileId: string, role: string) {
  const { data: e } = await admin
    .from("work_diary_entries")
    .select("id, activity, created_by, closed_at")
    .eq("id", entryId)
    .maybeSingle();
  const entry = e as { id: string; activity: string; created_by: string; closed_at: string | null } | null;
  if (!entry) return { entry: null, allowed: false, participant: false };
  const { data: p } = await admin
    .from("work_diary_participants")
    .select("profile_id")
    .eq("entry_id", entryId)
    .eq("profile_id", profileId)
    .maybeSingle();
  const participant = !!p;
  const allowed = isBoss(role) || entry.created_by === profileId || participant;
  return { entry, allowed, participant };
}

/** New register entry — activity + due date + at least one included user. */
export async function createDiaryEntryAction(formData: FormData): Promise<ActionResult> {
  const { profile } = await requireAuth();
  const admin = createAdminSupabaseClient();

  const activity = txt(formData, "activity");
  const dueDate = txt(formData, "due_date");
  const people = [...new Set(ids(formData, "participants"))];
  if (!activity) return { ok: false, error: "Write the activity." };
  if (!dueDate) return { ok: false, error: "Pick a date to complete." };
  if (people.length === 0) return { ok: false, error: "Include at least one person." };

  const { data: row, error } = await admin
    .from("work_diary_entries")
    .insert({ activity, details: txt(formData, "details") || null, created_by: profile.id, due_date: dueDate })
    .select("id")
    .single();
  if (error || !row) return { ok: false, error: error?.message || "Failed to create the entry." };
  const entryId = (row as { id: string }).id;

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

/** Status remark on an entry — creator / included / owner / developer. */
export async function addDiaryRemarkAction(formData: FormData): Promise<ActionResult> {
  const { profile } = await requireAuth();
  const admin = createAdminSupabaseClient();
  const entryId = txt(formData, "entry_id");
  const body = txt(formData, "body");
  if (!entryId) return { ok: false, error: "Missing entry." };
  if (!body) return { ok: false, error: "Write a remark first." };

  const { entry, allowed } = await loadEntryFor(admin, entryId, profile.id, profile.role);
  if (!entry) return { ok: false, error: "Entry not found." };
  if (!allowed) return { ok: false, error: "You're not included in this entry." };

  const { error } = await admin.from("work_diary_remarks").insert({ entry_id: entryId, author: profile.id, body, kind: "remark" });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/diary");
  return { ok: true };
}

/** Close — anyone included (or creator / owner / developer). */
export async function closeDiaryEntryAction(formData: FormData): Promise<ActionResult> {
  const { profile } = await requireAuth();
  const admin = createAdminSupabaseClient();
  const entryId = txt(formData, "entry_id");
  if (!entryId) return { ok: false, error: "Missing entry." };

  const { entry, allowed } = await loadEntryFor(admin, entryId, profile.id, profile.role);
  if (!entry) return { ok: false, error: "Entry not found." };
  if (!allowed) return { ok: false, error: "You're not included in this entry." };
  if (entry.closed_at) return { ok: false, error: "Already closed." };

  const { error } = await admin
    .from("work_diary_entries")
    .update({ closed_at: new Date().toISOString(), closed_by: profile.id })
    .eq("id", entryId);
  if (error) return { ok: false, error: error.message };
  await admin.from("work_diary_remarks").insert({ entry_id: entryId, author: profile.id, body: "", kind: "closed" });

  void logAudit(profile.id, "diary_entry_closed", "work_diary_entry", entryId, { activity: entry.activity });
  revalidatePath("/diary");
  revalidatePath("/", "layout");
  return { ok: true };
}

/** Reopen a closed entry — same set of people as close. */
export async function reopenDiaryEntryAction(formData: FormData): Promise<ActionResult> {
  const { profile } = await requireAuth();
  const admin = createAdminSupabaseClient();
  const entryId = txt(formData, "entry_id");
  if (!entryId) return { ok: false, error: "Missing entry." };

  const { entry, allowed } = await loadEntryFor(admin, entryId, profile.id, profile.role);
  if (!entry) return { ok: false, error: "Entry not found." };
  if (!allowed) return { ok: false, error: "You're not included in this entry." };
  if (!entry.closed_at) return { ok: false, error: "Entry is already open." };

  const { error } = await admin.from("work_diary_entries").update({ closed_at: null, closed_by: null }).eq("id", entryId);
  if (error) return { ok: false, error: error.message };
  await admin.from("work_diary_remarks").insert({ entry_id: entryId, author: profile.id, body: "", kind: "reopened" });

  void logAudit(profile.id, "diary_entry_reopened", "work_diary_entry", entryId, { activity: entry.activity });
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
