/**
 * Work Diary (mig 185) — the digital "kaam ka register" for ALL users.
 *
 * One entry = one register row: activity · from whom · who's included · date to
 * complete. Open entries stay pinned until someone included closes them; a
 * remarks thread carries the running status of multi-day work. Owner +
 * developer see every entry; everyone else only entries they created or are
 * included in. Reached from the topbar "Work Diary" pill (next to Tasks).
 */

import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { DiaryClient, type DiaryEntry, type DiaryPerson, type DiaryGroup } from "./diary-client";

export const dynamic = "force-dynamic";

type SearchParams = Promise<{ open?: string; new?: string }>;

const chunk = <T,>(arr: T[], n: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
};

export default async function WorkDiaryPage({ searchParams }: { searchParams: SearchParams }) {
  const { profile } = await requireAuth();
  const sp = await searchParams;
  const admin = createAdminSupabaseClient();
  const isBoss = profile.role === "owner" || profile.role === "developer";

  type EntryRow = {
    id: string; activity: string; details: string | null; created_by: string;
    due_date: string; closed_at: string | null; closed_by: string | null; created_at: string;
    /** mig 186 — absent on a pre-migration schema (select("*") keeps it best-effort). */
    urgent?: boolean | null;
  };
  const COLS = "*";

  // ── Visible entries. Best-effort: a pre-mig-185 deploy shows the banner.
  let needsMigration = false;
  const entryById = new Map<string, EntryRow>();
  if (isBoss) {
    const { data, error } = await admin.from("work_diary_entries").select(COLS).order("created_at", { ascending: false }).limit(1000);
    if (error) needsMigration = true;
    else for (const r of (data ?? []) as EntryRow[]) entryById.set(r.id, r);
  } else {
    const { data: mine, error } = await admin.from("work_diary_entries").select(COLS).eq("created_by", profile.id).order("created_at", { ascending: false }).limit(500);
    if (error) needsMigration = true;
    else {
      for (const r of (mine ?? []) as EntryRow[]) entryById.set(r.id, r);
      const { data: pRows } = await admin.from("work_diary_participants").select("entry_id").eq("profile_id", profile.id);
      const pIds = ((pRows ?? []) as Array<{ entry_id: string }>).map((r) => r.entry_id).filter((id) => !entryById.has(id));
      for (const part of chunk(pIds, 300)) {
        const { data } = await admin.from("work_diary_entries").select(COLS).in("id", part);
        for (const r of (data ?? []) as EntryRow[]) entryById.set(r.id, r);
      }
    }
  }
  const entryRows = [...entryById.values()];
  const entryIds = entryRows.map((e) => e.id);

  // ── Names — everyone (for From / Included / remark authors), active for picker.
  type ProfRow = { id: string; full_name: string | null; phone: string | null; role: string; is_active: boolean };
  const { data: profRows } = await admin.from("profiles").select("id, full_name, phone, role, is_active").order("full_name");
  const profs = (profRows ?? []) as ProfRow[];
  const nameOf = (id: string | null | undefined): string => {
    if (!id) return "—";
    const p = profs.find((x) => x.id === id);
    return p?.full_name || p?.phone || "—";
  };
  const people: DiaryPerson[] = profs.filter((p) => p.is_active).map((p) => ({ id: p.id, name: p.full_name || p.phone || "—", role: p.role }));

  // ── Participants + remarks for the visible entries.
  const partsByEntry = new Map<string, Array<{ id: string; name: string }>>();
  const remarksByEntry = new Map<string, DiaryEntry["remarks"]>();
  for (const part of chunk(entryIds, 300)) {
    const { data: ps } = await admin.from("work_diary_participants").select("entry_id, profile_id").in("entry_id", part);
    for (const r of (ps ?? []) as Array<{ entry_id: string; profile_id: string }>) {
      const a = partsByEntry.get(r.entry_id) ?? [];
      a.push({ id: r.profile_id, name: nameOf(r.profile_id) });
      partsByEntry.set(r.entry_id, a);
    }
    const { data: rs } = await admin.from("work_diary_remarks").select("id, entry_id, author, body, kind, created_at").in("entry_id", part).order("created_at", { ascending: true });
    for (const r of (rs ?? []) as Array<{ id: string; entry_id: string; author: string; body: string; kind: string; created_at: string }>) {
      const a = remarksByEntry.get(r.entry_id) ?? [];
      a.push({ id: r.id, authorId: r.author, author: nameOf(r.author), body: r.body, kind: (r.kind === "closed" || r.kind === "reopened" ? r.kind : "remark"), at: r.created_at });
      remarksByEntry.set(r.entry_id, a);
    }
  }

  // ── Attachments (mig 186) — entry-level (remark_id null) + per-remark. Best-
  // effort: pre-migration the table is absent and everything just has no files.
  const entryFiles = new Map<string, DiaryEntry["files"]>();
  const remarkFiles = new Map<string, DiaryEntry["files"]>();
  for (const part of chunk(entryIds, 300)) {
    const { data: fs, error } = await admin.from("work_diary_files").select("id, entry_id, remark_id, name, path, size").in("entry_id", part);
    if (error) break;
    for (const f of (fs ?? []) as Array<{ id: string; entry_id: string; remark_id: string | null; name: string; path: string; size: number | null }>) {
      const url = admin.storage.from("work-diary").getPublicUrl(f.path).data.publicUrl;
      const file = { id: f.id, name: f.name, url, size: f.size };
      if (f.remark_id) { const a = remarkFiles.get(f.remark_id) ?? []; a.push(file); remarkFiles.set(f.remark_id, a); }
      else { const a = entryFiles.get(f.entry_id) ?? []; a.push(file); entryFiles.set(f.entry_id, a); }
    }
  }

  const entries: DiaryEntry[] = entryRows.map((e) => ({
    id: e.id,
    activity: e.activity,
    details: e.details,
    createdBy: e.created_by,
    createdByName: nameOf(e.created_by),
    dueDate: e.due_date,
    createdAt: e.created_at,
    closedAt: e.closed_at,
    closedByName: e.closed_at ? nameOf(e.closed_by) : null,
    urgent: !!e.urgent,
    files: entryFiles.get(e.id) ?? [],
    participants: (partsByEntry.get(e.id) ?? []).sort((a, b) => a.name.localeCompare(b.name)),
    remarks: (remarksByEntry.get(e.id) ?? []).map((r) => ({ ...r, files: remarkFiles.get(r.id) ?? [] })),
  }));

  // ── Groups (shared quick-pick member sets).
  let groups: DiaryGroup[] = [];
  {
    const { data: gs, error } = await admin.from("work_diary_groups").select("id, name, created_by").order("name");
    if (!error) {
      const gRows = (gs ?? []) as Array<{ id: string; name: string; created_by: string }>;
      const membersByGroup = new Map<string, string[]>();
      for (const part of chunk(gRows.map((g) => g.id), 300)) {
        const { data: ms } = await admin.from("work_diary_group_members").select("group_id, profile_id").in("group_id", part);
        for (const m of (ms ?? []) as Array<{ group_id: string; profile_id: string }>) {
          const a = membersByGroup.get(m.group_id) ?? [];
          a.push(m.profile_id);
          membersByGroup.set(m.group_id, a);
        }
      }
      groups = gRows.map((g) => ({ id: g.id, name: g.name, createdBy: g.created_by, members: membersByGroup.get(g.id) ?? [] }));
    }
  }

  return (
    <section className="page-card">
      <div className="page-header">
        <h1>📒 Work Diary</h1>
        <p className="muted">The work register — an entry stays open until someone included closes it. Remarks carry the running status.</p>
      </div>

      {needsMigration ? (
        <div className="banner" style={{ marginTop: 14 }}>⚠ Run migration <strong>185_work_diary.sql</strong> on Supabase to enable the Work Diary.</div>
      ) : (
        <div style={{ marginTop: 14 }}>
          <DiaryClient
            me={{ id: profile.id, name: (profile.full_name ?? "").trim() || "me", isBoss }}
            entries={entries}
            people={people}
            groups={groups}
            initialOpenId={sp.open}
            initialNew={sp.new === "1"}
          />
        </div>
      )}
    </section>
  );
}
