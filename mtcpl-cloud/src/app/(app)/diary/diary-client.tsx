"use client";

/**
 * Work Diary client v2 (mig 185 + 186) — register table + entry drawer + modal.
 *
 *   • OPTIMISTIC — every action (remark / close / reopen / urgent / people /
 *     delete) updates the screen instantly, then syncs with the server.
 *   • URGENT — 🔥 entries glow and sort on top; toggled at creation or later.
 *   • ATTACHMENTS — any file on the entry or on a remark; the browser uploads
 *     straight to storage via signed URLs (no size limit).
 *   • CLOSED tab — card grid with the closer's name BIG + their closing remark.
 *   • Personal entries — "me" is pre-included, so an entry can be just your own.
 */

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FinanceLoadingOverlay } from "@/components/finance-loading-overlay";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";
import {
  createDiaryEntryAction, addDiaryRemarkAction, closeDiaryEntryAction,
  reopenDiaryEntryAction, deleteDiaryEntryAction, deleteDiaryGroupAction,
  updateDiaryParticipantsAction, setDiaryUrgentAction, prepareDiaryUploadsAction,
} from "./actions";

export type DiaryPerson = { id: string; name: string; role: string };
export type DiaryGroup = { id: string; name: string; createdBy: string; members: string[] };
export type DiaryFile = { id: string; name: string; url: string; size: number | null };
export type DiaryRemark = { id: string; authorId: string; author: string; body: string; kind: "remark" | "closed" | "reopened"; at: string; files?: DiaryFile[] };
export type DiaryEntry = {
  id: string;
  activity: string;
  details: string | null;
  createdBy: string;
  createdByName: string;
  dueDate: string | null;
  createdAt: string;
  closedAt: string | null;
  closedByName: string | null;
  urgent: boolean;
  files: DiaryFile[];
  participants: Array<{ id: string; name: string }>;
  remarks: DiaryRemark[];
};

const todayIST = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
const fmtDate = (d: string | null) => (d ? new Date(`${d.slice(0, 10)}T00:00:00+05:30`).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short" }) : "—");
const fmtStamp = (iso: string) => new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
// Just the day (IST) for the register's "Created" column — matches the Due format.
const fmtDay = (iso: string) => (iso ? new Date(iso).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short" }) : "—");
const fmtSize = (n: number | null) => (n == null ? "" : n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : n > 1024 ? `${Math.round(n / 1024)} KB` : `${n} B`);
const hueOf = (s: string) => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360; return h; };

type Tab = "mine" | "assigned" | "all" | "closed";
type ServerAction = (fd: FormData) => Promise<{ ok: true } | { ok: false; error: string }>;
type FileMeta = { name: string; path: string; mime: string | null; size: number | null };

/** Browser → storage direct upload via signed URLs (no server size limit). */
async function uploadDiaryFiles(files: File[]): Promise<{ ok: true; metas: FileMeta[] } | { ok: false; error: string }> {
  if (files.length === 0) return { ok: true, metas: [] };
  const fd = new FormData();
  fd.set("names", JSON.stringify(files.map((f) => ({ name: f.name }))));
  const prep = await prepareDiaryUploadsAction(fd);
  if (!prep.ok) return prep;
  const sb = createBrowserSupabaseClient();
  const metas: FileMeta[] = [];
  for (let i = 0; i < files.length; i++) {
    const u = prep.uploads[i];
    const { error } = await sb.storage.from("work-diary").uploadToSignedUrl(u.path, u.token, files[i]);
    if (error) return { ok: false, error: `Upload failed for ${files[i].name}: ${error.message}` };
    metas.push({ name: files[i].name, path: u.path, mime: files[i].type || null, size: files[i].size });
  }
  return { ok: true, metas };
}

/* Shared bits */
const GLOW_CSS = `
@keyframes wdUrgentRow { 0%,100% { box-shadow: inset 3px 0 0 #dc2626, 0 0 0 0 rgba(220,38,38,0); } 50% { box-shadow: inset 3px 0 0 #f59e0b, 0 0 14px 1px rgba(220,38,38,0.28); } }
.wd-urgent-row { animation: wdUrgentRow 1.6s ease-in-out infinite; background: rgba(220,38,38,0.05); }
@keyframes wdPop { from { opacity: 0; transform: translateY(5px); } to { opacity: 1; transform: none; } }
.wd-pop { animation: wdPop .16s ease; }
`;

function FileChip({ f, muted }: { f: DiaryFile; muted?: boolean }) {
  const inner = (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11, fontWeight: 700, color: muted ? "var(--muted)" : "#1d4ed8", background: muted ? "var(--bg)" : "rgba(37,99,235,0.08)", border: `1px solid ${muted ? "var(--border)" : "rgba(37,99,235,0.25)"}`, borderRadius: 999, padding: "3px 10px", maxWidth: 220 }}>
      📎 <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.name}</span>
      {f.size != null && <span style={{ opacity: 0.65, fontSize: 10 }}>{fmtSize(f.size)}</span>}
    </span>
  );
  if (!f.url || f.url === "#") return inner;
  return <a href={f.url} target="_blank" rel="noopener noreferrer" style={{ textDecoration: "none" }}>{inner}</a>;
}

function Avatars({ people, max = 4 }: { people: Array<{ id: string; name: string }>; max?: number }) {
  const shown = people.slice(0, max);
  return (
    <span style={{ display: "inline-flex", alignItems: "center" }}>
      {shown.map((p, i) => (
        <span key={p.id} title={p.name} style={{ width: 24, height: 24, borderRadius: "50%", background: `hsl(${hueOf(p.name)} 48% 42%)`, color: "#fff", fontSize: 10, fontWeight: 800, display: "inline-flex", alignItems: "center", justifyContent: "center", border: "2px solid var(--surface, #fff)", marginLeft: i === 0 ? 0 : -7 }}>
          {p.name.replace(/[^A-Za-zऀ-ॿ]/g, "").slice(0, 2).toUpperCase() || "👤"}
        </span>
      ))}
      {people.length > max && <span style={{ marginLeft: 5, fontSize: 10.5, fontWeight: 800, color: "var(--muted)" }}>+{people.length - max}</span>}
    </span>
  );
}

export function DiaryClient({ me, entries: serverEntries, people, groups, initialOpenId, initialNew }: {
  me: { id: string; name: string; isBoss: boolean };
  entries: DiaryEntry[];
  people: DiaryPerson[];
  groups: DiaryGroup[];
  initialOpenId?: string;
  initialNew?: boolean;
}) {
  const router = useRouter();
  // OPTIMISTIC store — mutations patch this instantly; server refreshes re-sync it.
  const [entries, setEntries] = useState<DiaryEntry[]>(serverEntries);
  useEffect(() => setEntries(serverEntries), [serverEntries]);
  const patch = (id: string, fn: (e: DiaryEntry) => DiaryEntry) => setEntries((p) => p.map((e) => (e.id === id ? fn(e) : e)));
  const drop = (id: string) => setEntries((p) => p.filter((e) => e.id !== id));

  const [tab, setTab] = useState<Tab>("mine");
  const [openId, setOpenId] = useState<string | null>(initialOpenId ?? null);
  const [showNew, setShowNew] = useState(!!initialNew);
  const today = todayIST();

  // Date info only applies when a due date is set (it's optional now, Daksh).
  const isOverdue = (e: DiaryEntry) => !e.closedAt && !!e.dueDate && e.dueDate < today;
  const isDueToday = (e: DiaryEntry) => !e.closedAt && !!e.dueDate && e.dueDate === today;
  const amIn = (e: DiaryEntry) => e.participants.some((p) => p.id === me.id);

  // Urgent first, then dated entries (earliest due first) before undated ones.
  const dueRank = (e: DiaryEntry) => e.dueDate || "9999-99-99";
  const openSort = (a: DiaryEntry, b: DiaryEntry) =>
    (b.urgent ? 1 : 0) - (a.urgent ? 1 : 0) || (dueRank(a) < dueRank(b) ? -1 : dueRank(a) > dueRank(b) ? 1 : a.createdAt.localeCompare(b.createdAt));
  const lists: Record<Tab, DiaryEntry[]> = useMemo(() => ({
    mine: entries.filter((e) => !e.closedAt && amIn(e)).sort(openSort),
    assigned: entries.filter((e) => !e.closedAt && e.createdBy === me.id).sort(openSort),
    all: entries.filter((e) => !e.closedAt).sort(openSort),
    closed: entries.filter((e) => !!e.closedAt).sort((a, b) => (b.closedAt ?? "").localeCompare(a.closedAt ?? "")),
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [entries, me.id, today]);

  const myOpen = lists.mine.length + lists.assigned.filter((e) => !amIn(e)).length;
  const scope = me.isBoss ? lists.all : [...new Map([...lists.mine, ...lists.assigned].map((e) => [e.id, e])).values()];
  const urgentCount = scope.filter((e) => e.urgent).length;
  const overdueCount = scope.filter((e) => isOverdue(e)).length;

  const tabs: Array<{ key: Tab; label: string; count: number }> = [
    { key: "mine", label: "📋 My work", count: lists.mine.length },
    { key: "assigned", label: "📤 Assigned by me", count: lists.assigned.length },
    ...(me.isBoss ? [{ key: "all" as Tab, label: "👁 All open", count: lists.all.length }] : []),
    { key: "closed", label: "✅ Closed", count: lists.closed.length },
  ];
  const rows = lists[tab];
  const open = openId ? entries.find((e) => e.id === openId) ?? null : null;

  const th: React.CSSProperties = { padding: "9px 12px", fontSize: 10.5, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--muted)", textAlign: "left", borderBottom: "2px solid var(--border)", whiteSpace: "nowrap", background: "var(--bg)" };
  const td: React.CSSProperties = { padding: "11px 12px", fontSize: 13, borderBottom: "1px solid var(--border)", verticalAlign: "middle" };

  function StatusChip({ e }: { e: DiaryEntry }) {
    const [bg, fg, label] = e.closedAt
      ? ["rgba(22,101,52,0.12)", "#15803d", "✓ Done"]
      : e.urgent ? ["rgba(220,38,38,0.14)", "#b91c1c", "🔥 Urgent"]
      : isOverdue(e) ? ["rgba(220,38,38,0.12)", "#b91c1c", "Overdue"]
      : isDueToday(e) ? ["rgba(217,119,6,0.14)", "#b45309", "Due today"]
      : ["rgba(37,99,235,0.10)", "#1d4ed8", "Open"];
    return <span style={{ fontSize: 10.5, fontWeight: 800, color: fg, background: bg, borderRadius: 999, padding: "3px 10px", whiteSpace: "nowrap" }}>{label}</span>;
  }

  return (
    <div>
      <style>{GLOW_CSS}</style>

      {/* Stats strip */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 14 }}>
        {[
          { icon: "🗂", label: "My open work", value: myOpen, fg: "#1d4ed8", bg: "rgba(37,99,235,0.08)" },
          { icon: "🔥", label: "Urgent", value: urgentCount, fg: "#b91c1c", bg: "rgba(220,38,38,0.08)" },
          { icon: "⏰", label: "Overdue", value: overdueCount, fg: "#b45309", bg: "rgba(217,119,6,0.10)" },
          { icon: "✅", label: "Closed", value: lists.closed.length, fg: "#15803d", bg: "rgba(22,101,52,0.08)" },
        ].map((s) => (
          <div key={s.label} style={{ flex: "1 1 150px", display: "flex", alignItems: "center", gap: 10, border: "1px solid var(--border)", borderRadius: 12, padding: "10px 14px", background: "var(--surface)" }}>
            <span style={{ width: 34, height: 34, borderRadius: 9, display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 16, background: s.bg }}>{s.icon}</span>
            <span>
              <span style={{ display: "block", fontSize: 19, fontWeight: 800, fontFamily: "ui-monospace, monospace", color: s.fg, lineHeight: 1.1 }}>{s.value}</span>
              <span style={{ display: "block", fontSize: 10.5, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.04em" }}>{s.label}</span>
            </span>
          </div>
        ))}
      </div>

      {/* Tabs + new entry */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 14 }}>
        <div style={{ display: "inline-flex", gap: 4, padding: 4, borderRadius: 12, background: "var(--bg)", border: "1px solid var(--border)" }}>
          {tabs.map((t) => (
            <button key={t.key} type="button" onClick={() => setTab(t.key)} style={{ fontSize: 12.5, fontWeight: 800, padding: "8px 14px", borderRadius: 9, cursor: "pointer", border: "none", background: tab === t.key ? "var(--gold)" : "transparent", color: tab === t.key ? "#fff" : "var(--muted)" }}>
              {t.label} <span style={{ opacity: 0.75 }}>· {t.count}</span>
            </button>
          ))}
        </div>
        <button type="button" onClick={() => setShowNew(true)} style={{ marginLeft: "auto", fontSize: 13.5, fontWeight: 800, padding: "11px 20px", borderRadius: 11, border: "none", color: "#fff", background: "var(--gold-dark)", cursor: "pointer", boxShadow: "0 3px 10px rgba(180,83,9,0.25)" }}>＋ New entry</button>
      </div>

      {rows.length === 0 ? (
        <div style={{ background: "var(--surface)", border: "1px dashed var(--border)", borderRadius: 12, padding: "34px 22px", textAlign: "center", color: "var(--muted)" }}>
          {tab === "closed" ? "Nothing closed yet." : "No open entries here. ＋ New entry to write one in the register."}
        </div>
      ) : tab === "closed" ? (
        /* CLOSED — card grid: BIG who-closed + their closing remark. */
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(290px, 1fr))", gap: 12 }}>
          {rows.map((e) => {
            const closing = [...e.remarks].reverse().find((r) => r.kind === "closed");
            const note = (closing?.body ?? "").trim();
            return (
              <div key={e.id} className="wd-pop" onClick={() => setOpenId(e.id)} style={{ border: "1px solid var(--border)", borderTop: "4px solid #16a34a", borderRadius: 13, background: "var(--surface)", padding: "13px 15px", cursor: "pointer", display: "flex", flexDirection: "column", gap: 8 }}>
                <div style={{ fontSize: 12.5, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.01em", color: "var(--muted)" }}>{e.activity}</div>
                <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                  <span style={{ fontSize: 22 }}>✅</span>
                  <span>
                    <span style={{ display: "block", fontSize: 17, fontWeight: 900, color: "#15803d", lineHeight: 1.15 }}>{e.closedByName ?? "—"}</span>
                    <span style={{ display: "block", fontSize: 10.5, fontWeight: 700, color: "var(--muted)" }}>closed this · {e.closedAt ? fmtStamp(e.closedAt) : ""}</span>
                  </span>
                </div>
                <div style={{ fontSize: 12.5, fontStyle: note ? "normal" : "italic", color: note ? "var(--text)" : "var(--muted)", background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 9, padding: "7px 10px" }}>
                  {note ? <>&ldquo;{note}&rdquo;</> : "No closing remark."}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11, color: "var(--muted)" }}>
                  ✍️ {e.createdByName} <span style={{ marginLeft: "auto" }}><Avatars people={e.participants} /></span>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        /* OPEN tabs — register table (urgent rows glow + sit on top). */
        <div style={{ border: "1px solid var(--border)", borderRadius: 13, overflow: "hidden", background: "var(--surface)", boxShadow: "0 1px 4px rgba(15,23,42,0.05)" }}>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 880 }}>
              <thead>
                <tr>
                  <th style={{ ...th, width: 34 }}>#</th>
                  <th style={th}>Activity</th>
                  <th style={th}>From</th>
                  <th style={th}>Included</th>
                  <th style={th}>Created</th>
                  <th style={th}>Due</th>
                  <th style={th}>Status</th>
                  <th style={th}>Last remark</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((e, i) => {
                  const lastRemark = [...e.remarks].reverse().find((r) => r.kind === "remark");
                  return (
                    <tr key={e.id} className={e.urgent ? "wd-urgent-row" : undefined} onClick={() => setOpenId(e.id)} style={{ cursor: "pointer", background: e.urgent ? undefined : isOverdue(e) ? "rgba(220,38,38,0.045)" : undefined }}>
                      <td style={{ ...td, color: "var(--muted)", fontFamily: "ui-monospace, monospace" }}>{i + 1}</td>
                      <td style={{ ...td, minWidth: 230 }}>
                        <span style={{ fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.01em" }}>{e.urgent ? "🔥 " : ""}{e.activity}</span>
                        {e.files.length > 0 && <span style={{ marginLeft: 6, fontSize: 11, color: "var(--muted)" }}>📎{e.files.length}</span>}
                        {e.details && <div style={{ fontSize: 11.5, fontWeight: 500, color: "var(--muted)", marginTop: 2, maxWidth: 380, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.details}</div>}
                      </td>
                      <td style={{ ...td, whiteSpace: "nowrap", fontWeight: 600 }}>{e.createdByName}</td>
                      <td style={td}><Avatars people={e.participants} /></td>
                      <td style={{ ...td, whiteSpace: "nowrap", color: "var(--muted)" }} title={`Added ${fmtStamp(e.createdAt)}`}>{fmtDay(e.createdAt)}</td>
                      <td style={{ ...td, whiteSpace: "nowrap", fontWeight: e.dueDate ? 700 : 500, color: isOverdue(e) ? "#b91c1c" : e.dueDate ? "var(--text)" : "var(--muted)" }}>{e.dueDate ? fmtDate(e.dueDate) : "— no date"}</td>
                      <td style={td}><StatusChip e={e} /></td>
                      <td style={{ ...td, maxWidth: 260 }}>
                        {lastRemark
                          ? <span style={{ fontSize: 12.5 }}>&ldquo;{lastRemark.body.length > 64 ? `${lastRemark.body.slice(0, 64)}…` : lastRemark.body}&rdquo; <span style={{ color: "var(--muted)", fontSize: 11.5 }}>— {lastRemark.author}</span></span>
                          : <span style={{ color: "var(--muted)" }}>—</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {open && (
        <EntryDrawer
          key={open.id}
          e={open}
          me={me}
          people={people}
          onClose={() => setOpenId(null)}
          refresh={() => router.refresh()}
          patch={patch}
          drop={drop}
        />
      )}
      {showNew && <NewEntryModal me={me} people={people} groups={groups} onClose={() => setShowNew(false)} refresh={() => router.refresh()} />}
    </div>
  );
}

type Busy = null | "remark" | "close" | "reopen" | "delete" | "people" | "urgent";

/* ── Entry drawer — optimistic remarks / urgent / people / close / delete ── */
function EntryDrawer({ e, me, people, onClose, refresh, patch, drop }: {
  e: DiaryEntry; me: { id: string; name: string; isBoss: boolean }; people: DiaryPerson[];
  onClose: () => void; refresh: () => void;
  patch: (id: string, fn: (e: DiaryEntry) => DiaryEntry) => void;
  drop: (id: string) => void;
}) {
  const [, startT] = useTransition();
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);
  const [remark, setRemark] = useState("");
  const [remarkFiles, setRemarkFiles] = useState<File[]>([]);
  const [confirm, setConfirm] = useState<null | "close" | "delete">(null);
  const [closeNote, setCloseNote] = useState("");
  const [editPeople, setEditPeople] = useState(false);
  const [sel, setSel] = useState<Set<string>>(() => new Set(e.participants.map((p) => p.id)));
  const [query, setQuery] = useState("");
  const fileInput = useRef<HTMLInputElement | null>(null);
  const threadRef = useRef<HTMLDivElement | null>(null);

  // Only the CREATOR (or owner/dev) may manage the entry: close / reopen /
  // urgent toggle / edit included people / delete. Everyone included can REMARK.
  const canManage = me.isBoss || e.createdBy === me.id;
  const canRemark = canManage || e.participants.some((p) => p.id === me.id);
  const pending = busy !== null;

  useEffect(() => { threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight }); }, [e.remarks.length]);

  /** Optimistic runner: apply the local patch INSTANTLY, then fire the action;
   *  on failure show the error + resync from the server. */
  function run(kind: Busy, action: ServerAction, extra: Record<string, string>, optimistic: () => void, after?: () => void) {
    const fd = new FormData();
    fd.set("entry_id", e.id);
    for (const [k, v] of Object.entries(extra)) fd.set(k, v);
    optimistic();
    setBusy(kind);
    startT(async () => {
      setError(null);
      const r = await action(fd);
      if (!r.ok) { setError(r.error); setBusy(null); refresh(); return; }
      after?.();
      refresh();
      setBusy(null);
    });
  }

  const now = () => new Date().toISOString();
  const tmpId = () => `tmp-${Math.random().toString(36).slice(2)}`;

  function sendRemark() {
    const body = remark.trim();
    const files = [...remarkFiles];
    if (!body && files.length === 0) return;
    setBusy("remark");
    startT(async () => {
      setError(null);
      // 1) upload straight to storage (may take a moment for big files)…
      const up = await uploadDiaryFiles(files);
      if (!up.ok) { setError(up.error); setBusy(null); return; }
      // 2) …then optimistic bubble + record on the server.
      patch(e.id, (x) => ({ ...x, remarks: [...x.remarks, { id: tmpId(), authorId: me.id, author: me.name, body, kind: "remark", at: now(), files: files.map((f) => ({ id: tmpId(), name: f.name, url: "#", size: f.size })) }] }));
      setRemark(""); setRemarkFiles([]);
      const fd = new FormData();
      fd.set("entry_id", e.id);
      fd.set("body", body);
      fd.set("files", JSON.stringify(up.metas));
      const r = await addDiaryRemarkAction(fd);
      if (!r.ok) { setError(r.error); refresh(); setBusy(null); return; }
      refresh();
      setBusy(null);
    });
  }

  const btn: React.CSSProperties = { fontSize: 12.5, fontWeight: 800, padding: "9px 15px", borderRadius: 9, cursor: "pointer", border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)" };
  const warn: React.CSSProperties = { fontSize: 12, fontWeight: 700 };

  return (
    <div onMouseDown={() => { if (!pending) onClose(); }} style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(15,23,42,0.45)", display: "flex", justifyContent: "flex-end" }}>
      <div onMouseDown={(ev) => ev.stopPropagation()} style={{ width: "min(560px, 100%)", height: "100%", background: "var(--surface, #fff)", boxShadow: "-18px 0 50px rgba(0,0,0,0.25)", display: "flex", flexDirection: "column", position: "relative" }}>
        <FinanceLoadingOverlay show={busy === "delete"} label="Deleting…" />

        {/* Header */}
        <div style={{ padding: "16px 18px 12px", borderBottom: "1px solid var(--border)", background: e.urgent ? "rgba(220,38,38,0.04)" : undefined }}>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 17, fontWeight: 900, lineHeight: 1.3, textTransform: "uppercase" }}>{e.urgent ? "🔥 " : ""}{e.activity}</div>
              {e.details && <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 4, whiteSpace: "pre-wrap" }}>{e.details}</div>}
            </div>
            <button type="button" onClick={onClose} style={{ border: "none", background: "transparent", fontSize: 20, cursor: "pointer", color: "var(--muted)", lineHeight: 1 }}>✕</button>
          </div>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 10, fontSize: 11.5, color: "var(--muted)", alignItems: "center" }}>
            <span>✍️ From <strong style={{ color: "var(--text)" }}>{e.createdByName}</strong></span>
            {e.dueDate && (() => { const overdue = !e.closedAt && e.dueDate < todayIST(); return <span style={{ color: overdue ? "#b91c1c" : undefined }}>📅 Due <strong style={{ color: overdue ? "#b91c1c" : "var(--text)" }}>{fmtDate(e.dueDate)}</strong></span>; })()}
            <span>🕑 Started {fmtStamp(e.createdAt)}</span>
            {canManage && !e.closedAt && (
              <button
                type="button"
                disabled={pending}
                onClick={() => run("urgent", setDiaryUrgentAction, { urgent: e.urgent ? "0" : "1" }, () => patch(e.id, (x) => ({ ...x, urgent: !x.urgent })))}
                style={{ marginLeft: "auto", fontSize: 11, fontWeight: 800, padding: "5px 12px", borderRadius: 999, cursor: "pointer", border: `1.5px solid ${e.urgent ? "#dc2626" : "var(--border)"}`, background: e.urgent ? "rgba(220,38,38,0.1)" : "var(--bg)", color: e.urgent ? "#b91c1c" : "var(--muted)" }}
              >
                {e.urgent ? "🔥 Urgent — tap to remove" : "🔥 Mark urgent"}
              </button>
            )}
          </div>

          {/* Included + manage */}
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8, alignItems: "center" }}>
            {e.participants.map((p) => (
              <span key={p.id} style={{ fontSize: 11, fontWeight: 700, color: "var(--text)", background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 999, padding: "3px 10px" }}>👤 {p.name}</span>
            ))}
            {canManage && (
              <button type="button" onClick={() => { setSel(new Set(e.participants.map((x) => x.id))); setEditPeople((v) => !v); }} style={{ fontSize: 11, fontWeight: 800, color: "var(--gold-dark)", background: "transparent", border: "none", cursor: "pointer", padding: "3px 4px" }}>
                {editPeople ? "Cancel" : "✎ Manage people"}
              </button>
            )}
          </div>
          {editPeople && (
            <div style={{ marginTop: 8, border: "1px solid var(--border)", borderRadius: 10, padding: 10, background: "var(--bg)" }}>
              <input value={query} onChange={(ev) => setQuery(ev.target.value)} placeholder="Search a name…" autoComplete="off" style={{ width: "100%", padding: "8px 10px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)", fontSize: 12.5, marginBottom: 8 }} />
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 5, maxHeight: 180, overflowY: "auto" }}>
                {people.filter((p) => !query.trim() || p.name.toLowerCase().includes(query.trim().toLowerCase())).map((p) => {
                  const on = sel.has(p.id);
                  return (
                    <label key={p.id} style={{ display: "flex", alignItems: "center", gap: 7, padding: "6px 8px", borderRadius: 8, cursor: "pointer", border: `1.5px solid ${on ? "var(--gold-dark)" : "var(--border)"}`, background: on ? "rgba(180,83,9,0.07)" : "var(--surface)" }}>
                      <input type="checkbox" checked={on} onChange={() => setSel((prev) => { const n = new Set(prev); if (n.has(p.id)) n.delete(p.id); else n.add(p.id); return n; })} />
                      <span style={{ fontSize: 12, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}{p.id === me.id ? " (me)" : ""}</span>
                    </label>
                  );
                })}
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 10, alignItems: "center" }}>
                <span style={{ fontSize: 11.5, color: "var(--muted)", marginRight: "auto" }}>{sel.size} included</span>
                <button
                  type="button"
                  disabled={pending || sel.size === 0}
                  onClick={() => run("people", updateDiaryParticipantsAction, { participants: JSON.stringify([...sel]) },
                    () => patch(e.id, (x) => ({ ...x, participants: [...sel].map((id) => ({ id, name: people.find((p) => p.id === id)?.name ?? "—" })).sort((a, b) => a.name.localeCompare(b.name)) })),
                    () => setEditPeople(false))}
                  style={{ ...btn, background: sel.size ? "#0f172a" : "var(--border)", color: "#fff", border: "none" }}
                >
                  {busy === "people" ? "Saving…" : "Save people"}
                </button>
              </div>
            </div>
          )}

          {/* Entry attachments */}
          {e.files.length > 0 && (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
              {e.files.map((f) => <FileChip key={f.id} f={f} />)}
            </div>
          )}

          {e.closedAt && (
            <div style={{ marginTop: 10, fontSize: 12, fontWeight: 700, color: "#15803d", background: "rgba(22,101,52,0.08)", border: "1px solid rgba(22,101,52,0.3)", borderRadius: 8, padding: "7px 11px" }}>
              ✅ Closed by {e.closedByName} · {fmtStamp(e.closedAt)}
            </div>
          )}
        </div>

        {/* Remarks thread */}
        <div ref={threadRef} style={{ flex: 1, overflowY: "auto", padding: "14px 18px", display: "flex", flexDirection: "column", gap: 10 }}>
          {e.remarks.length === 0 && <div style={{ color: "var(--muted)", fontSize: 12.5, textAlign: "center", padding: "18px 0" }}>No remarks yet — write the current status below.</div>}
          {e.remarks.map((r) =>
            r.kind === "remark" ? (
              <div key={r.id} className="wd-pop" style={{ alignSelf: r.authorId === me.id ? "flex-end" : "flex-start", maxWidth: "88%", background: r.authorId === me.id ? "rgba(201,161,74,0.13)" : "var(--bg)", border: "1px solid var(--border)", borderRadius: 11, padding: "8px 12px" }}>
                <div style={{ fontSize: 11, fontWeight: 800, color: "var(--gold-dark)" }}>{r.author}</div>
                {r.body && <div style={{ fontSize: 13, whiteSpace: "pre-wrap" }}>{r.body}</div>}
                {(r.files ?? []).length > 0 && (
                  <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginTop: 5 }}>
                    {(r.files ?? []).map((f) => <FileChip key={f.id} f={f} />)}
                  </div>
                )}
                <div style={{ fontSize: 10, color: "var(--muted)", marginTop: 3, textAlign: "right" }}>{fmtStamp(r.at)}</div>
              </div>
            ) : (
              <div key={r.id} style={{ alignSelf: "center", textAlign: "center", fontSize: 11, fontWeight: 700, color: "var(--muted)" }}>
                {r.kind === "closed" ? "✅" : "↩"} {r.author} {r.kind === "closed" ? "closed this" : "reopened this"} · {fmtStamp(r.at)}
                {r.kind === "closed" && r.body && <div style={{ fontSize: 12, fontWeight: 700, color: "#15803d", marginTop: 2 }}>&ldquo;{r.body}&rdquo;</div>}
              </div>
            ),
          )}
        </div>

        {/* Composer + actions */}
        <div style={{ borderTop: "1px solid var(--border)", padding: "12px 18px 16px", display: "flex", flexDirection: "column", gap: 10 }}>
          {error && <div style={{ fontSize: 12.5, fontWeight: 700, color: "#b91c1c" }}>⚠ {error}</div>}
          {canRemark ? (
            <>
              {remarkFiles.length > 0 && (
                <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                  {remarkFiles.map((f, i) => (
                    <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11, fontWeight: 700, background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 999, padding: "3px 10px" }}>
                      📎 {f.name} <span style={{ color: "var(--muted)", fontSize: 10 }}>{fmtSize(f.size)}</span>
                      <button type="button" onClick={() => setRemarkFiles((p) => p.filter((_, j) => j !== i))} style={{ border: "none", background: "transparent", color: "#b91c1c", fontWeight: 800, cursor: "pointer", padding: 0 }}>✕</button>
                    </span>
                  ))}
                </div>
              )}
              <div style={{ display: "flex", gap: 8 }}>
                <input ref={fileInput} type="file" multiple style={{ display: "none" }} onChange={(ev) => { const fs = [...(ev.target.files ?? [])]; if (fs.length) setRemarkFiles((p) => [...p, ...fs]); ev.target.value = ""; }} />
                <button type="button" disabled={pending} title="Attach files" onClick={() => fileInput.current?.click()} style={{ ...btn, alignSelf: "flex-end", padding: "9px 12px" }}>📎</button>
                <textarea
                  value={remark}
                  onChange={(ev) => setRemark(ev.target.value)}
                  rows={2}
                  placeholder="Current status / remark…"
                  style={{ flex: 1, resize: "none", fontSize: 13, padding: "9px 11px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)", fontFamily: "inherit" }}
                />
                <button type="button" disabled={pending || (!remark.trim() && remarkFiles.length === 0)} onClick={sendRemark} style={{ ...btn, alignSelf: "flex-end", minWidth: 86, background: "#0f172a", color: "#fff", border: "none", opacity: pending || (!remark.trim() && remarkFiles.length === 0) ? 0.6 : 1 }}>
                  {busy === "remark" ? (remarkFiles.length ? "Uploading…" : "Sending…") : "Send"}
                </button>
              </div>

              {/* Reopen / Close / Delete — CREATOR or owner/dev only. Other
                  included users can remark above, but can't manage the entry. */}
              {canManage && (
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                {e.closedAt && !confirm && (
                  <button type="button" disabled={pending} onClick={() => run("reopen", reopenDiaryEntryAction, {},
                    () => patch(e.id, (x) => ({ ...x, closedAt: null, closedByName: null, remarks: [...x.remarks, { id: tmpId(), authorId: me.id, author: me.name, body: "", kind: "reopened", at: now() }] })))} style={btn}>
                    {busy === "reopen" ? "Reopening…" : "↩ Reopen"}
                  </button>
                )}
                <span style={{ marginLeft: "auto", display: "inline-flex", gap: 8, flexWrap: "wrap", alignItems: "center", justifyContent: "flex-end" }}>
                  {confirm === "close" ? (
                    <span style={{ display: "flex", flexDirection: "column", gap: 7, alignItems: "flex-end" }}>
                      <input value={closeNote} onChange={(ev) => setCloseNote(ev.target.value)} placeholder="Closing remark (optional) — what was done?" autoComplete="off" style={{ width: 300, maxWidth: "72vw", padding: "8px 10px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)", fontSize: 12.5 }} />
                      <span style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
                        <span style={{ ...warn, color: "#15803d" }}>Close this — work done?</span>
                        <button type="button" disabled={pending} onClick={() => run("close", closeDiaryEntryAction, { body: closeNote.trim() },
                          () => patch(e.id, (x) => ({ ...x, closedAt: now(), closedByName: me.name, urgent: false, remarks: [...x.remarks, { id: tmpId(), authorId: me.id, author: me.name, body: closeNote.trim(), kind: "closed", at: now() }] })),
                          () => setConfirm(null))} style={{ ...btn, background: "#16a34a", color: "#fff", border: "none" }}>
                          {busy === "close" ? "Closing…" : "Yes, close"}
                        </button>
                        <button type="button" disabled={pending} onClick={() => setConfirm(null)} style={btn}>No</button>
                      </span>
                    </span>
                  ) : confirm === "delete" ? (
                    <>
                      <span style={{ ...warn, color: "#b91c1c" }}>Delete this entry + its remarks?</span>
                      <button type="button" disabled={pending} onClick={() => run("delete", deleteDiaryEntryAction, {}, () => { drop(e.id); }, onClose)} style={{ ...btn, background: "#b91c1c", color: "#fff", border: "none" }}>Yes, delete</button>
                      <button type="button" disabled={pending} onClick={() => setConfirm(null)} style={btn}>No</button>
                    </>
                  ) : (
                    <>
                      {!e.closedAt && <button type="button" disabled={pending} onClick={() => setConfirm("close")} style={{ ...btn, background: "#16a34a", color: "#fff", border: "none" }}>✅ Close — work done</button>}
                      <button type="button" disabled={pending} onClick={() => setConfirm("delete")} style={{ ...btn, color: "#b91c1c" }}>🗑 Delete</button>
                    </>
                  )}
                </span>
              </div>
              )}
              {!canManage && !e.closedAt && (
                <div style={{ fontSize: 11.5, color: "var(--muted)" }}>Only {e.createdByName} (who started this) or the owner can mark urgent, edit included people, or close it.</div>
              )}
            </>
          ) : (
            <div style={{ fontSize: 12, color: "var(--muted)" }}>You&apos;re viewing this entry — you&apos;re not included, so you can&apos;t remark.</div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── New entry modal — wide, all users visible, CAPS activity, urgent, files ── */
function NewEntryModal({ me, people, groups, onClose, refresh }: {
  me: { id: string; name: string; isBoss: boolean }; people: DiaryPerson[]; groups: DiaryGroup[]; onClose: () => void; refresh: () => void;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [activity, setActivity] = useState("");
  const [details, setDetails] = useState("");
  const [due, setDue] = useState(""); // optional — blank = no deadline
  const [urgent, setUrgent] = useState(false);
  // "Me" is pre-included — leave it as just yourself for a PERSONAL entry.
  const [selected, setSelected] = useState<Set<string>>(() => new Set([me.id]));
  const [saveGroup, setSaveGroup] = useState("");
  const [query, setQuery] = useState("");
  const [confirmGroup, setConfirmGroup] = useState<string | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const fileInput = useRef<HTMLInputElement | null>(null);

  const toggle = (id: string) => setSelected((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const matches = people.filter((p) => !query.trim() || p.name.toLowerCase().includes(query.trim().toLowerCase()));
  const canCreate = activity.trim().length > 0 && selected.size > 0;

  function create() {
    start(async () => {
      setError(null);
      const up = await uploadDiaryFiles(files);
      if (!up.ok) { setError(up.error); return; }
      const fd = new FormData();
      fd.set("activity", activity.trim().toUpperCase());
      fd.set("details", details);
      fd.set("due_date", due);
      fd.set("urgent", urgent ? "1" : "0");
      fd.set("participants", JSON.stringify([...selected]));
      fd.set("files", JSON.stringify(up.metas));
      if (saveGroup.trim()) fd.set("save_group_name", saveGroup.trim());
      const r = await createDiaryEntryAction(fd);
      if (!r.ok) { setError(r.error); return; }
      refresh();
      onClose();
    });
  }
  function doRemoveGroup(g: DiaryGroup) {
    const fd = new FormData();
    fd.set("group_id", g.id);
    start(async () => { const r = await deleteDiaryGroupAction(fd); if (!r.ok) setError(r.error); else { setConfirmGroup(null); refresh(); } });
  }

  const fld: React.CSSProperties = { width: "100%", padding: "10px 12px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)", fontSize: 13.5 };
  const lbl: React.CSSProperties = { fontSize: 11.5, fontWeight: 800, color: "var(--muted)", display: "block", marginBottom: 5, textTransform: "uppercase", letterSpacing: "0.04em" };

  return (
    <div onMouseDown={() => { if (!pending) onClose(); }} style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(15,23,42,0.5)", display: "grid", placeItems: "center", padding: 16, overflowY: "auto" }}>
      <div onMouseDown={(ev) => ev.stopPropagation()} style={{ width: "min(1020px, 100%)", background: "var(--surface, #fff)", borderRadius: 18, padding: "22px 26px", boxShadow: "0 30px 70px rgba(0,0,0,0.35)", maxHeight: "94vh", overflowY: "auto", position: "relative" }}>
        <FinanceLoadingOverlay show={pending} label={files.length ? "Uploading files & writing in the register…" : "Writing in the register…"} />
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
          <span style={{ fontSize: 22 }}>📒</span>
          <span style={{ fontSize: 18, fontWeight: 900 }}>New register entry</span>
          <button
            type="button"
            onClick={() => setUrgent((v) => !v)}
            style={{ marginLeft: "auto", fontSize: 12, fontWeight: 800, padding: "7px 15px", borderRadius: 999, cursor: "pointer", border: `1.5px solid ${urgent ? "#dc2626" : "var(--border)"}`, background: urgent ? "rgba(220,38,38,0.1)" : "var(--bg)", color: urgent ? "#b91c1c" : "var(--muted)" }}
          >
            {urgent ? "🔥 URGENT — on top, glowing" : "🔥 Mark urgent"}
          </button>
        </div>

        {/* Activity — register style: CAPITALS, bold. */}
        <label style={{ display: "block", marginBottom: 12 }}>
          <span style={lbl}>Activity *</span>
          <input
            value={activity}
            onChange={(ev) => setActivity(ev.target.value)}
            placeholder="WHAT WORK HAS TO BE DONE?"
            autoComplete="off"
            style={{ ...fld, fontSize: 16.5, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.02em", padding: "12px 14px" }}
          />
        </label>

        <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginBottom: 12 }}>
          <label style={{ display: "block", flex: "1 1 380px" }}>
            <span style={lbl}>Details (optional)</span>
            <textarea value={details} onChange={(ev) => setDetails(ev.target.value)} rows={2} style={{ ...fld, resize: "vertical", fontFamily: "inherit" }} />
          </label>
          <label style={{ display: "block", flex: "0 0 200px" }}>
            <span style={lbl}>Date to complete (optional)</span>
            <input type="date" value={due} onChange={(ev) => setDue(ev.target.value)} style={fld} />
            {due && <button type="button" onClick={() => setDue("")} style={{ marginTop: 4, fontSize: 10.5, fontWeight: 700, color: "var(--muted)", background: "transparent", border: "none", cursor: "pointer", padding: 0 }}>✕ Clear date</button>}
          </label>
          <div style={{ flex: "0 0 220px" }}>
            <span style={lbl}>Attachments</span>
            <input ref={fileInput} type="file" multiple style={{ display: "none" }} onChange={(ev) => { const fs = [...(ev.target.files ?? [])]; if (fs.length) setFiles((p) => [...p, ...fs]); ev.target.value = ""; }} />
            <button type="button" onClick={() => fileInput.current?.click()} style={{ ...fld, cursor: "pointer", textAlign: "left", color: "var(--muted)", fontWeight: 700 }}>📎 Attach files…</button>
          </div>
        </div>
        {files.length > 0 && (
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
            {files.map((f, i) => (
              <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11.5, fontWeight: 700, background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 999, padding: "4px 11px" }}>
                📎 {f.name} <span style={{ color: "var(--muted)", fontSize: 10 }}>{fmtSize(f.size)}</span>
                <button type="button" onClick={() => setFiles((p) => p.filter((_, j) => j !== i))} style={{ border: "none", background: "transparent", color: "#b91c1c", fontWeight: 800, cursor: "pointer", padding: 0 }}>✕</button>
              </span>
            ))}
          </div>
        )}

        {groups.length > 0 && (
          <div style={{ marginBottom: 10 }}>
            <span style={lbl}>Quick pick — groups</span>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {groups.map((g) => (
                <span key={g.id} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 700, border: "1.5px solid var(--gold-dark)", color: "var(--gold-dark)", background: "rgba(180,83,9,0.06)", borderRadius: 999, padding: "5px 11px" }}>
                  {confirmGroup === g.id ? (
                    <>
                      <span>Delete &ldquo;{g.name}&rdquo;?</span>
                      <button type="button" disabled={pending} onClick={() => doRemoveGroup(g)} style={{ border: "none", background: "transparent", color: "#b91c1c", cursor: "pointer", fontWeight: 800, padding: 0 }}>✓</button>
                      <button type="button" disabled={pending} onClick={() => setConfirmGroup(null)} style={{ border: "none", background: "transparent", color: "var(--muted)", cursor: "pointer", fontWeight: 800, padding: 0 }}>✕</button>
                    </>
                  ) : (
                    <>
                      <button type="button" onClick={() => setSelected(new Set([me.id, ...g.members]))} style={{ border: "none", background: "transparent", color: "inherit", fontWeight: 800, cursor: "pointer", padding: 0 }}>👥 {g.name}</button>
                      {(me.isBoss || g.createdBy === me.id) && (
                        <button type="button" onClick={() => setConfirmGroup(g.id)} title="Delete group" style={{ border: "none", background: "transparent", color: "#b91c1c", cursor: "pointer", fontWeight: 800, padding: 0 }}>✕</button>
                      )}
                    </>
                  )}
                </span>
              ))}
            </div>
          </div>
        )}

        <div style={{ marginBottom: 12 }}>
          <span style={lbl}>
            Included users * <span style={{ fontWeight: 600, textTransform: "none" }}>· {selected.size} selected — only you = your personal entry</span>
          </span>
          {people.length > 24 && <input value={query} onChange={(ev) => setQuery(ev.target.value)} placeholder="Search a name…" autoComplete="off" style={{ ...fld, marginBottom: 8 }} />}
          {/* Every user visible in ONE view — no scrolling (Daksh). */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(172px, 1fr))", gap: 7, border: "1px solid var(--border)", borderRadius: 12, padding: 10, background: "var(--bg)" }}>
            {matches.map((p) => {
              const on = selected.has(p.id);
              return (
                <label key={p.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", borderRadius: 9, cursor: "pointer", border: `1.5px solid ${on ? "var(--gold-dark)" : "var(--border)"}`, background: on ? "rgba(180,83,9,0.08)" : "var(--surface)" }}>
                  <input type="checkbox" checked={on} onChange={() => toggle(p.id)} />
                  <span style={{ minWidth: 0 }}>
                    <span style={{ display: "block", fontSize: 12.5, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}{p.id === me.id ? " (me)" : ""}</span>
                    <span style={{ display: "block", fontSize: 10, color: "var(--muted)" }}>{p.role.replace(/_/g, " ")}</span>
                  </span>
                </label>
              );
            })}
            {matches.length === 0 && <div style={{ gridColumn: "1 / -1", textAlign: "center", color: "var(--muted)", fontSize: 12, padding: "10px 0" }}>No user matches.</div>}
          </div>
        </div>

        <div style={{ display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
          <label style={{ display: "block", flex: "0 1 320px" }}>
            <span style={lbl}>Save this set as a group (optional)</span>
            <input value={saveGroup} onChange={(ev) => setSaveGroup(ev.target.value)} placeholder="e.g. Dispatch team" autoComplete="off" style={fld} />
          </label>
          <span style={{ marginLeft: "auto", display: "inline-flex", gap: 10 }}>
            <button type="button" disabled={pending} onClick={onClose} style={{ fontSize: 13, fontWeight: 700, padding: "11px 18px", borderRadius: 11, border: "1.5px solid var(--border)", background: "var(--bg)", color: "var(--text)", cursor: "pointer" }}>Cancel</button>
            <button type="button" disabled={pending || !canCreate} onClick={create} style={{ fontSize: 13.5, fontWeight: 800, padding: "11px 24px", borderRadius: 11, border: "none", color: "#fff", background: canCreate ? "#0f172a" : "var(--border)", cursor: canCreate ? "pointer" : "default" }}>
              {pending ? "Saving…" : "📒 Write in register"}
            </button>
          </span>
        </div>
        {error && <div style={{ fontSize: 12.5, fontWeight: 700, color: "#b91c1c", marginTop: 10 }}>⚠ {error}</div>}
      </div>
    </div>
  );
}
