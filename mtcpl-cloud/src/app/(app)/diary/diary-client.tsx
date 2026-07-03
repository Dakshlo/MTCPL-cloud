"use client";

/**
 * Work Diary client (mig 185) — register table + entry drawer + new-entry modal.
 *
 *   • Tabs: My work (I'm included) · Assigned by me · All open (owner/dev) · Closed.
 *   • Row → drawer: details, included users, remarks thread (running status),
 *     add remark, ✓ Close (anyone included), ↩ Reopen, 🗑 Delete (creator/boss).
 *   • New entry: activity + details + due date + included users (or a saved
 *     group), optionally save the picked set as a new group.
 */

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  createDiaryEntryAction, addDiaryRemarkAction, closeDiaryEntryAction,
  reopenDiaryEntryAction, deleteDiaryEntryAction, deleteDiaryGroupAction,
} from "./actions";

export type DiaryPerson = { id: string; name: string; role: string };
export type DiaryGroup = { id: string; name: string; createdBy: string; members: string[] };
export type DiaryRemark = { id: string; authorId: string; author: string; body: string; kind: "remark" | "closed" | "reopened"; at: string };
export type DiaryEntry = {
  id: string;
  activity: string;
  details: string | null;
  createdBy: string;
  createdByName: string;
  dueDate: string;
  createdAt: string;
  closedAt: string | null;
  closedByName: string | null;
  participants: Array<{ id: string; name: string }>;
  remarks: DiaryRemark[];
};

const todayIST = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
const fmtDate = (d: string) => (d ? new Date(`${d.slice(0, 10)}T00:00:00+05:30`).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short" }) : "—");
const fmtStamp = (iso: string) => new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

type Tab = "mine" | "assigned" | "all" | "closed";

export function DiaryClient({ me, entries, people, groups, initialOpenId, initialNew }: {
  me: { id: string; name: string; isBoss: boolean };
  entries: DiaryEntry[];
  people: DiaryPerson[];
  groups: DiaryGroup[];
  initialOpenId?: string;
  initialNew?: boolean;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("mine");
  const [openId, setOpenId] = useState<string | null>(initialOpenId ?? null);
  const [showNew, setShowNew] = useState(!!initialNew);
  const today = todayIST();

  const isOverdue = (e: DiaryEntry) => !e.closedAt && e.dueDate < today;
  const isDueToday = (e: DiaryEntry) => !e.closedAt && e.dueDate === today;
  const amIn = (e: DiaryEntry) => e.participants.some((p) => p.id === me.id);

  // Open entries: overdue first, then by nearest due date. Closed: newest first.
  const openSort = (a: DiaryEntry, b: DiaryEntry) => (a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : a.createdAt.localeCompare(b.createdAt));
  const lists: Record<Tab, DiaryEntry[]> = useMemo(() => ({
    mine: entries.filter((e) => !e.closedAt && amIn(e)).sort(openSort),
    assigned: entries.filter((e) => !e.closedAt && e.createdBy === me.id).sort(openSort),
    all: entries.filter((e) => !e.closedAt).sort(openSort),
    closed: entries.filter((e) => !!e.closedAt).sort((a, b) => (b.closedAt ?? "").localeCompare(a.closedAt ?? "")),
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [entries, me.id]);

  const tabs: Array<{ key: Tab; label: string; count: number }> = [
    { key: "mine", label: "📋 My work", count: lists.mine.length },
    { key: "assigned", label: "📤 Assigned by me", count: lists.assigned.length },
    ...(me.isBoss ? [{ key: "all" as Tab, label: "👁 All open", count: lists.all.length }] : []),
    { key: "closed", label: "✅ Closed", count: lists.closed.length },
  ];

  const rows = lists[tab];
  const open = openId ? entries.find((e) => e.id === openId) ?? null : null;

  const th: React.CSSProperties = { padding: "8px 10px", fontSize: 10.5, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--muted)", textAlign: "left", borderBottom: "2px solid var(--border)", whiteSpace: "nowrap", background: "var(--bg)" };
  const td: React.CSSProperties = { padding: "9px 10px", fontSize: 13, borderBottom: "1px solid var(--border)", verticalAlign: "top" };

  function StatusChip({ e }: { e: DiaryEntry }) {
    const [bg, fg, label] = e.closedAt
      ? ["rgba(22,101,52,0.12)", "#15803d", "Done"]
      : isOverdue(e) ? ["rgba(220,38,38,0.12)", "#b91c1c", "Overdue"]
      : isDueToday(e) ? ["rgba(217,119,6,0.14)", "#b45309", "Due today"]
      : ["rgba(37,99,235,0.10)", "#1d4ed8", "Open"];
    return <span style={{ fontSize: 10.5, fontWeight: 800, color: fg, background: bg, borderRadius: 999, padding: "3px 10px", whiteSpace: "nowrap" }}>{label}</span>;
  }

  return (
    <div>
      {/* Tabs + new entry */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 14 }}>
        <div style={{ display: "inline-flex", gap: 4, padding: 4, borderRadius: 12, background: "var(--bg)", border: "1px solid var(--border)" }}>
          {tabs.map((t) => (
            <button key={t.key} type="button" onClick={() => setTab(t.key)} style={{ fontSize: 12.5, fontWeight: 800, padding: "8px 14px", borderRadius: 9, cursor: "pointer", border: "none", background: tab === t.key ? "var(--gold)" : "transparent", color: tab === t.key ? "#fff" : "var(--muted)" }}>
              {t.label} <span style={{ opacity: 0.75 }}>· {t.count}</span>
            </button>
          ))}
        </div>
        <button type="button" onClick={() => setShowNew(true)} style={{ marginLeft: "auto", fontSize: 13.5, fontWeight: 800, padding: "10px 18px", borderRadius: 10, border: "none", color: "#fff", background: "var(--gold-dark)", cursor: "pointer" }}>＋ New entry</button>
      </div>

      {/* Register table */}
      {rows.length === 0 ? (
        <div style={{ background: "var(--surface)", border: "1px dashed var(--border)", borderRadius: 12, padding: "30px 22px", textAlign: "center", color: "var(--muted)" }}>
          {tab === "closed" ? "Nothing closed yet." : "No open entries here. ＋ New entry to write one in the register."}
        </div>
      ) : (
        <div style={{ border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden", background: "var(--surface)" }}>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 860 }}>
              <thead>
                <tr>
                  <th style={{ ...th, width: 34 }}>#</th>
                  <th style={th}>Activity</th>
                  <th style={th}>From</th>
                  <th style={th}>Included</th>
                  <th style={th}>Due</th>
                  <th style={th}>Status</th>
                  <th style={th}>Last remark</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((e, i) => {
                  const lastRemark = [...e.remarks].reverse().find((r) => r.kind === "remark");
                  return (
                    <tr key={e.id} onClick={() => setOpenId(e.id)} style={{ cursor: "pointer", background: isOverdue(e) ? "rgba(220,38,38,0.045)" : undefined }}>
                      <td style={{ ...td, color: "var(--muted)", fontFamily: "ui-monospace, monospace" }}>{i + 1}</td>
                      <td style={{ ...td, fontWeight: 700, minWidth: 220 }}>
                        {e.activity}
                        {e.details && <div style={{ fontSize: 11.5, fontWeight: 500, color: "var(--muted)", marginTop: 2, maxWidth: 380, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.details}</div>}
                      </td>
                      <td style={{ ...td, whiteSpace: "nowrap" }}>{e.createdByName}</td>
                      <td style={{ ...td, maxWidth: 220 }}>{e.participants.map((p) => p.name).join(", ") || "—"}</td>
                      <td style={{ ...td, whiteSpace: "nowrap", fontWeight: 700, color: isOverdue(e) ? "#b91c1c" : "var(--text)" }}>{fmtDate(e.dueDate)}</td>
                      <td style={td}><StatusChip e={e} /></td>
                      <td style={{ ...td, maxWidth: 260 }}>
                        {e.closedAt
                          ? <span style={{ color: "var(--muted)", fontSize: 12 }}>Closed by {e.closedByName} · {fmtStamp(e.closedAt)}</span>
                          : lastRemark
                          ? <span style={{ fontSize: 12.5 }}>&ldquo;{lastRemark.body.length > 70 ? `${lastRemark.body.slice(0, 70)}…` : lastRemark.body}&rdquo; <span style={{ color: "var(--muted)", fontSize: 11.5 }}>— {lastRemark.author}</span></span>
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

      {open && <EntryDrawer key={open.id} e={open} me={me} onClose={() => setOpenId(null)} refresh={() => router.refresh()} />}
      {showNew && <NewEntryModal me={me} people={people} groups={groups} onClose={() => setShowNew(false)} refresh={() => router.refresh()} />}
    </div>
  );
}

/* ── Entry drawer — remarks thread + close / reopen / delete ── */
function EntryDrawer({ e, me, onClose, refresh }: {
  e: DiaryEntry; me: { id: string; isBoss: boolean }; onClose: () => void; refresh: () => void;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [remark, setRemark] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const canDelete = me.isBoss || e.createdBy === me.id;
  const canAct = me.isBoss || e.createdBy === me.id || e.participants.some((p) => p.id === me.id);

  function run(action: (fd: FormData) => Promise<{ ok: true } | { ok: false; error: string }>, extra?: Record<string, string>, after?: () => void) {
    const fd = new FormData();
    fd.set("entry_id", e.id);
    for (const [k, v] of Object.entries(extra ?? {})) fd.set(k, v);
    start(async () => {
      setError(null);
      const r = await action(fd);
      if (!r.ok) { setError(r.error); return; }
      after?.();
      refresh();
    });
  }

  const btn: React.CSSProperties = { fontSize: 12.5, fontWeight: 800, padding: "9px 15px", borderRadius: 9, cursor: "pointer", border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)" };

  return (
    <div onMouseDown={() => { if (!pending) onClose(); }} style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(15,23,42,0.45)", display: "flex", justifyContent: "flex-end" }}>
      <div onMouseDown={(ev) => ev.stopPropagation()} style={{ width: "min(520px, 100%)", height: "100%", background: "var(--surface, #fff)", boxShadow: "-18px 0 50px rgba(0,0,0,0.25)", display: "flex", flexDirection: "column" }}>
        {/* Header */}
        <div style={{ padding: "16px 18px 12px", borderBottom: "1px solid var(--border)" }}>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 16.5, fontWeight: 800, lineHeight: 1.3 }}>{e.activity}</div>
              {e.details && <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 4, whiteSpace: "pre-wrap" }}>{e.details}</div>}
            </div>
            <button type="button" onClick={onClose} style={{ border: "none", background: "transparent", fontSize: 20, cursor: "pointer", color: "var(--muted)", lineHeight: 1 }}>✕</button>
          </div>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 10, fontSize: 11.5, color: "var(--muted)" }}>
            <span>✍️ From <strong style={{ color: "var(--text)" }}>{e.createdByName}</strong></span>
            <span>📅 Due <strong style={{ color: "var(--text)" }}>{fmtDate(e.dueDate)}</strong></span>
            <span>🕑 Started {fmtStamp(e.createdAt)}</span>
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
            {e.participants.map((p) => (
              <span key={p.id} style={{ fontSize: 11, fontWeight: 700, color: "var(--text)", background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 999, padding: "3px 10px" }}>👤 {p.name}</span>
            ))}
          </div>
          {e.closedAt && (
            <div style={{ marginTop: 10, fontSize: 12, fontWeight: 700, color: "#15803d", background: "rgba(22,101,52,0.08)", border: "1px solid rgba(22,101,52,0.3)", borderRadius: 8, padding: "7px 11px" }}>
              ✅ Closed by {e.closedByName} · {fmtStamp(e.closedAt)}
            </div>
          )}
        </div>

        {/* Remarks thread */}
        <div style={{ flex: 1, overflowY: "auto", padding: "14px 18px", display: "flex", flexDirection: "column", gap: 10 }}>
          {e.remarks.length === 0 && <div style={{ color: "var(--muted)", fontSize: 12.5, textAlign: "center", padding: "18px 0" }}>No remarks yet — write the current status below.</div>}
          {e.remarks.map((r) =>
            r.kind === "remark" ? (
              <div key={r.id} style={{ alignSelf: r.authorId === me.id ? "flex-end" : "flex-start", maxWidth: "88%", background: r.authorId === me.id ? "rgba(201,161,74,0.13)" : "var(--bg)", border: "1px solid var(--border)", borderRadius: 11, padding: "8px 12px" }}>
                <div style={{ fontSize: 11, fontWeight: 800, color: "var(--gold-dark)" }}>{r.author}</div>
                <div style={{ fontSize: 13, whiteSpace: "pre-wrap" }}>{r.body}</div>
                <div style={{ fontSize: 10, color: "var(--muted)", marginTop: 3, textAlign: "right" }}>{fmtStamp(r.at)}</div>
              </div>
            ) : (
              <div key={r.id} style={{ alignSelf: "center", fontSize: 11, fontWeight: 700, color: "var(--muted)" }}>
                {r.kind === "closed" ? "✅" : "↩"} {r.author} {r.kind === "closed" ? "closed this" : "reopened this"} · {fmtStamp(r.at)}
              </div>
            ),
          )}
        </div>

        {/* Composer + actions */}
        <div style={{ borderTop: "1px solid var(--border)", padding: "12px 18px 16px", display: "flex", flexDirection: "column", gap: 10 }}>
          {error && <div style={{ fontSize: 12.5, fontWeight: 700, color: "#b91c1c" }}>⚠ {error}</div>}
          {canAct ? (
            <>
              <div style={{ display: "flex", gap: 8 }}>
                <textarea
                  value={remark}
                  onChange={(ev) => setRemark(ev.target.value)}
                  rows={2}
                  placeholder="Current status / remark…"
                  style={{ flex: 1, resize: "none", fontSize: 13, padding: "9px 11px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)", fontFamily: "inherit" }}
                />
                <button type="button" disabled={pending || !remark.trim()} onClick={() => run(addDiaryRemarkAction, { body: remark }, () => setRemark(""))} style={{ ...btn, alignSelf: "flex-end", background: "#0f172a", color: "#fff", border: "none", opacity: pending || !remark.trim() ? 0.6 : 1 }}>
                  Send
                </button>
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {!e.closedAt
                  ? <button type="button" disabled={pending} onClick={() => run(closeDiaryEntryAction)} style={{ ...btn, background: "#16a34a", color: "#fff", border: "none" }}>✅ Close — work done</button>
                  : <button type="button" disabled={pending} onClick={() => run(reopenDiaryEntryAction)} style={btn}>↩ Reopen</button>}
                {canDelete && !confirmDelete && (
                  <button type="button" disabled={pending} onClick={() => setConfirmDelete(true)} style={{ ...btn, color: "#b91c1c", marginLeft: "auto" }}>🗑 Delete</button>
                )}
                {canDelete && confirmDelete && (
                  <span style={{ marginLeft: "auto", display: "inline-flex", gap: 6, alignItems: "center" }}>
                    <span style={{ fontSize: 11.5, fontWeight: 700, color: "#b91c1c" }}>Delete this entry + its remarks?</span>
                    <button type="button" disabled={pending} onClick={() => run(deleteDiaryEntryAction, {}, onClose)} style={{ ...btn, background: "#b91c1c", color: "#fff", border: "none" }}>Yes, delete</button>
                    <button type="button" disabled={pending} onClick={() => setConfirmDelete(false)} style={btn}>No</button>
                  </span>
                )}
              </div>
            </>
          ) : (
            <div style={{ fontSize: 12, color: "var(--muted)" }}>You&apos;re viewing this entry — only included users can remark or close.</div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── New entry modal — activity + due + included users (or a saved group) ── */
function NewEntryModal({ me, people, groups, onClose, refresh }: {
  me: { id: string; isBoss: boolean }; people: DiaryPerson[]; groups: DiaryGroup[]; onClose: () => void; refresh: () => void;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [activity, setActivity] = useState("");
  const [details, setDetails] = useState("");
  const [due, setDue] = useState(todayIST());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [saveGroup, setSaveGroup] = useState("");
  const [query, setQuery] = useState("");

  const toggle = (id: string) => setSelected((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const matches = people.filter((p) => !query.trim() || p.name.toLowerCase().includes(query.trim().toLowerCase()));
  const canCreate = activity.trim().length > 0 && due && selected.size > 0;

  function create() {
    const fd = new FormData();
    fd.set("activity", activity);
    fd.set("details", details);
    fd.set("due_date", due);
    fd.set("participants", JSON.stringify([...selected]));
    if (saveGroup.trim()) fd.set("save_group_name", saveGroup.trim());
    start(async () => {
      setError(null);
      const r = await createDiaryEntryAction(fd);
      if (!r.ok) { setError(r.error); return; }
      refresh();
      onClose();
    });
  }
  function removeGroup(g: DiaryGroup) {
    if (!window.confirm(`Delete the group "${g.name}"? (Entries are not touched.)`)) return;
    const fd = new FormData();
    fd.set("group_id", g.id);
    start(async () => { const r = await deleteDiaryGroupAction(fd); if (!r.ok) setError(r.error); else refresh(); });
  }

  const fld: React.CSSProperties = { width: "100%", padding: "9px 11px", borderRadius: 9, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)", fontSize: 13.5 };
  const lbl: React.CSSProperties = { fontSize: 11.5, fontWeight: 700, color: "var(--muted)", display: "block", marginBottom: 4 };

  return (
    <div onMouseDown={() => { if (!pending) onClose(); }} style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(15,23,42,0.45)", display: "grid", placeItems: "center", padding: 18, overflowY: "auto" }}>
      <div onMouseDown={(ev) => ev.stopPropagation()} style={{ width: "min(640px, 100%)", background: "var(--surface, #fff)", borderRadius: 16, padding: "20px 22px", boxShadow: "0 24px 60px rgba(0,0,0,0.3)", maxHeight: "92vh", overflowY: "auto" }}>
        <div style={{ fontSize: 17, fontWeight: 800, marginBottom: 14 }}>📒 New register entry</div>

        <label style={{ display: "block", marginBottom: 12 }}>
          <span style={lbl}>Activity *</span>
          <input value={activity} onChange={(ev) => setActivity(ev.target.value)} placeholder="What work has to be done?" autoComplete="off" style={fld} />
        </label>
        <label style={{ display: "block", marginBottom: 12 }}>
          <span style={lbl}>Details (optional)</span>
          <textarea value={details} onChange={(ev) => setDetails(ev.target.value)} rows={2} style={{ ...fld, resize: "vertical", fontFamily: "inherit" }} />
        </label>
        <label style={{ display: "block", marginBottom: 14, maxWidth: 200 }}>
          <span style={lbl}>Date to complete *</span>
          <input type="date" value={due} onChange={(ev) => setDue(ev.target.value)} style={fld} />
        </label>

        {groups.length > 0 && (
          <div style={{ marginBottom: 10 }}>
            <span style={lbl}>Quick pick — groups</span>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {groups.map((g) => (
                <span key={g.id} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 700, border: "1.5px solid var(--gold-dark)", color: "var(--gold-dark)", background: "rgba(180,83,9,0.06)", borderRadius: 999, padding: "5px 11px" }}>
                  <button type="button" onClick={() => setSelected(new Set(g.members))} style={{ border: "none", background: "transparent", color: "inherit", fontWeight: 800, cursor: "pointer", padding: 0 }}>👥 {g.name}</button>
                  {(me.isBoss || g.createdBy === me.id) && (
                    <button type="button" onClick={() => removeGroup(g)} title="Delete group" style={{ border: "none", background: "transparent", color: "#b91c1c", cursor: "pointer", fontWeight: 800, padding: 0 }}>✕</button>
                  )}
                </span>
              ))}
            </div>
          </div>
        )}

        <div style={{ marginBottom: 12 }}>
          <span style={lbl}>Included users * <span style={{ fontWeight: 600 }}>· {selected.size} selected</span></span>
          <input value={query} onChange={(ev) => setQuery(ev.target.value)} placeholder="Search a name…" autoComplete="off" style={{ ...fld, marginBottom: 8 }} />
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 6, maxHeight: 220, overflowY: "auto", border: "1px solid var(--border)", borderRadius: 10, padding: 8, background: "var(--bg)" }}>
            {matches.map((p) => {
              const on = selected.has(p.id);
              return (
                <label key={p.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 9px", borderRadius: 8, cursor: "pointer", border: `1.5px solid ${on ? "var(--gold-dark)" : "var(--border)"}`, background: on ? "rgba(180,83,9,0.07)" : "var(--surface)" }}>
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

        <label style={{ display: "block", marginBottom: 14, maxWidth: 320 }}>
          <span style={lbl}>Save this set as a group (optional)</span>
          <input value={saveGroup} onChange={(ev) => setSaveGroup(ev.target.value)} placeholder="e.g. Dispatch team" autoComplete="off" style={fld} />
        </label>

        {error && <div style={{ fontSize: 12.5, fontWeight: 700, color: "#b91c1c", marginBottom: 10 }}>⚠ {error}</div>}
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button type="button" disabled={pending} onClick={onClose} style={{ fontSize: 13, fontWeight: 700, padding: "10px 16px", borderRadius: 10, border: "1.5px solid var(--border)", background: "var(--bg)", color: "var(--text)", cursor: "pointer" }}>Cancel</button>
          <button type="button" disabled={pending || !canCreate} onClick={create} style={{ fontSize: 13.5, fontWeight: 800, padding: "10px 20px", borderRadius: 10, border: "none", color: "#fff", background: canCreate ? "#0f172a" : "var(--border)", cursor: canCreate ? "pointer" : "default" }}>
            {pending ? "Saving…" : "📒 Write in register"}
          </button>
        </div>
      </div>
    </div>
  );
}
