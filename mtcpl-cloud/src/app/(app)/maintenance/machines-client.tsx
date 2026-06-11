"use client";

// ──────────────────────────────────────────────────────────────────
// Maintenance — machine registry UI (nested groups + photo cards).
// Create a primary GROUP (e.g. CNC) with a shared photo; optionally nest
// sub-groups under it (e.g. Mohit CNC). Add machines into any group. A
// machine keeps its own photo or shares the group's. Location is a
// creatable fixed list (Shade 1, Shade 2, …).
// ──────────────────────────────────────────────────────────────────

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createMachinesBulkAction, updateMachineAction, createGroupAction, updateGroupAction, deleteGroupAction } from "./actions";

export type Machine = {
  id: string;
  machine_code: string | null;
  name: string;
  status: string;
  location: string | null;
  notes: string | null;
  group_id: string | null;
  imageUrl: string | null;   // resolved: own photo, else the group's photo
  underMaintenanceSince: string | null; // ISO; set while status = under_maintenance
};
export type GroupOpt = { id: string; name: string };   // name may carry hierarchy ("CNC › Mohit CNC")
export type Group = {
  id: string; name: string; imageUrl: string | null; parent_id: string | null;
  machines: Machine[]; subgroups?: Group[];
};

const STATUS_META: Record<string, { label: string; bg: string; fg: string }> = {
  working: { label: "Working", bg: "rgba(22,163,74,0.15)", fg: "#15803d" },
  under_maintenance: { label: "Under maintenance", bg: "rgba(234,88,12,0.16)", fg: "#9a3412" },
  retired: { label: "Retired", bg: "rgba(148,163,184,0.2)", fg: "#475569" },
};

// Whole-card look by status — BOLD so the state is unmistakable even behind a
// machine photo: solid colour border + a solid status band across the card.
const STATUS_SOLID: Record<string, string> = {
  working: "#15803d", // green
  under_maintenance: "#ea580c", // orange
  retired: "#64748b", // slate
};
const STATUS_CARD: Record<string, { border: string; bg: string }> = {
  working: { border: "#16a34a", bg: "rgba(22,163,74,0.14)" },
  under_maintenance: { border: "#ea580c", bg: "rgba(234,88,12,0.20)" },
  retired: { border: "#94a3b8", bg: "rgba(148,163,184,0.18)" },
};

// "2d 5h" style elapsed-time formatter.
function fmtDur(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) ms = 0;
  const mins = Math.floor(ms / 60000);
  const d = Math.floor(mins / 1440);
  const h = Math.floor((mins % 1440) / 60);
  const m = mins % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

// Live "down for Xd Yh" timer. Seeded with the server's `now` so the first
// client render matches (no hydration flicker), then ticks every minute.
export function MaintTimer({ since, nowMs, style }: { since: string; nowMs: number; style?: React.CSSProperties }) {
  const [now, setNow] = useState(nowMs);
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(t);
  }, []);
  const started = new Date(since).getTime();
  return <span style={style}>⏱ {fmtDur(now - started)}</span>;
}

const inputStyle: React.CSSProperties = {
  width: "100%", boxSizing: "border-box", padding: "9px 12px", fontSize: 14,
  border: "1px solid var(--border)", borderRadius: 9, background: "var(--bg)", color: "var(--text)",
};
const btnGhost: React.CSSProperties = { padding: "9px 14px", fontSize: 13, fontWeight: 700, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 9, cursor: "pointer", color: "var(--text)" };
const btnGold: React.CSSProperties = { padding: "9px 16px", fontSize: 13, fontWeight: 800, color: "#fff", background: "var(--gold-dark, #a16207)", border: "none", borderRadius: 9, cursor: "pointer", whiteSpace: "nowrap" };

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <span style={{ fontSize: 11, fontWeight: 800, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.05em", display: "block", marginBottom: 5 }}>{children}</span>;
}

export function StatusChip({ status }: { status: string }) {
  const m = STATUS_META[status] ?? { label: status, bg: "rgba(0,0,0,0.06)", fg: "var(--muted)" };
  return <span style={{ fontSize: 10.5, fontWeight: 800, padding: "2px 9px", borderRadius: 999, background: m.bg, color: m.fg, textTransform: "uppercase", letterSpacing: "0.04em", whiteSpace: "nowrap" }}>{m.label}</span>;
}

function PhotoBox({ url, height, rounded }: { url: string | null; height: number; rounded: string }) {
  if (url) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={url} alt="" style={{ width: "100%", height, objectFit: "cover", borderRadius: rounded, display: "block", background: "var(--surface-alt, #eee)" }} />;
  }
  return (
    <div style={{ width: "100%", height, borderRadius: rounded, background: "linear-gradient(135deg, rgba(63,143,134,0.12), rgba(63,143,134,0.04))", display: "flex", alignItems: "center", justifyContent: "center", fontSize: height > 80 ? 34 : 18, color: "rgba(63,143,134,0.55)" }}>🛠️</div>
  );
}

function ModalShell({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 1100, background: "rgba(15,23,42,0.5)", backdropFilter: "blur(3px)", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "7vh 16px", overflowY: "auto" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: 460, background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 16, padding: 22, boxShadow: "0 24px 60px rgba(0,0,0,0.3)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <h2 style={{ margin: 0, fontSize: 18 }}>{title}</h2>
          <button type="button" onClick={onClose} style={{ background: "none", border: "none", fontSize: 24, lineHeight: 1, cursor: "pointer", color: "var(--muted)" }} aria-label="Close">×</button>
        </div>
        {children}
      </div>
    </div>
  );
}

// ── Group create / edit (+ nest under a parent, + delete) ───────────
export function GroupFormModal({
  mode, group, parentOptions, defaultParentId, back, buttonLabel, buttonStyle,
}: {
  mode: "add" | "edit";
  group?: { id: string; name: string; imageUrl: string | null; parent_id: string | null };
  parentOptions: GroupOpt[];
  defaultParentId?: string | null;
  back: string;
  buttonLabel: string;
  buttonStyle?: React.CSSProperties;
}) {
  const [open, setOpen] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  // A group can't be its own parent.
  const parents = parentOptions.filter((p) => !group || p.id !== group.id);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} style={buttonStyle ?? btnGold}>{buttonLabel}</button>
      {open && (
        <ModalShell title={mode === "add" ? "📁 Create group" : "Edit group"} onClose={() => setOpen(false)}>
          <form action={mode === "add" ? createGroupAction : updateGroupAction} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {mode === "edit" && group && <input type="hidden" name="id" value={group.id} />}
            <input type="hidden" name="back" value={back} />
            <label><FieldLabel>Group name *</FieldLabel>
              <input name="name" required defaultValue={group?.name ?? ""} placeholder="e.g. CNC, Cranes, Vehicles" style={inputStyle} />
            </label>
            <label><FieldLabel>Parent group (optional — leave as None for a primary group)</FieldLabel>
              <select name="parent_id" defaultValue={group?.parent_id ?? defaultParentId ?? ""} style={inputStyle}>
                <option value="">— None (primary group) —</option>
                {parents.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </label>
            <label><FieldLabel>{mode === "add" ? "Group photo (shared by its machines)" : "Replace group photo"}</FieldLabel>
              {mode === "edit" && group?.imageUrl && <div style={{ marginBottom: 8 }}><PhotoBox url={group.imageUrl} height={120} rounded="10px" /></div>}
              <input type="file" name="image" accept="image/*" style={{ fontSize: 13 }} />
            </label>
            {mode === "edit" && group?.imageUrl && (
              <label style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12.5, color: "var(--muted)", marginTop: -4 }}>
                <input type="checkbox" name="remove_image" value="yes" /> Remove current photo
              </label>
            )}
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 4 }}>
              <button type="button" onClick={() => setOpen(false)} style={btnGhost}>Cancel</button>
              <button type="submit" style={btnGold}>{mode === "add" ? "Create group" : "Save"}</button>
            </div>
          </form>
          {mode === "edit" && group && (
            <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px dashed var(--border)" }}>
              {!confirmDel ? (
                <button type="button" onClick={() => setConfirmDel(true)} style={{ fontSize: 12, fontWeight: 700, color: "#b91c1c", background: "none", border: "none", cursor: "pointer", padding: 0 }}>Delete this group</button>
              ) : (
                <form action={deleteGroupAction} style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <input type="hidden" name="id" value={group.id} /><input type="hidden" name="back" value={back} />
                  <span style={{ fontSize: 12.5, color: "var(--text)" }}>Delete group? Its machines become <strong>Ungrouped</strong>.</span>
                  <button type="submit" style={{ fontSize: 12, fontWeight: 700, color: "#fff", background: "#b91c1c", border: "none", borderRadius: 8, padding: "5px 11px", cursor: "pointer" }}>Delete</button>
                  <button type="button" onClick={() => setConfirmDel(false)} style={btnGhost}>No</button>
                </form>
              )}
            </div>
          )}
        </ModalShell>
      )}
    </>
  );
}

// ── Machine create / edit modal ─────────────────────────────────────
export function MachineFormModal({
  mode, machine, groups, defaultGroupId, locations, back, buttonLabel, buttonStyle,
}: {
  mode: "add" | "edit";
  machine?: Machine;
  groups: GroupOpt[];
  defaultGroupId?: string | null;
  locations: string[];
  back: string;
  buttonLabel: string;
  buttonStyle?: React.CSSProperties;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} style={buttonStyle ?? btnGold}>{buttonLabel}</button>
      {open && (
        <ModalShell title={mode === "add" ? "🛠️ Add machine" : "Edit machine"} onClose={() => setOpen(false)}>
          <form action={mode === "add" ? createMachinesBulkAction : updateMachineAction} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {mode === "edit" && machine && <input type="hidden" name="id" value={machine.id} />}
            <input type="hidden" name="back" value={back} />
            {mode === "add" ? (
              <label><FieldLabel>Machine names * — one per line (add several at once)</FieldLabel>
                <textarea name="names" required rows={5} placeholder={"One machine per line, e.g.\nMohit CNC 1\nMohit CNC 2\nMohit CNC 3"} style={{ ...inputStyle, resize: "vertical", fontFamily: "inherit", lineHeight: 1.6 }} />
              </label>
            ) : (
              <label><FieldLabel>Machine name *</FieldLabel>
                <input name="name" required defaultValue={machine?.name ?? ""} placeholder="e.g. Gantry Crane #1" style={inputStyle} />
              </label>
            )}
            <label><FieldLabel>Group *</FieldLabel>
              <select name="group_id" required defaultValue={machine?.group_id ?? defaultGroupId ?? ""} style={inputStyle}>
                <option value="" disabled>— Select a group —</option>
                {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
              </select>
            </label>
            <label><FieldLabel>{mode === "add" ? "Photo (optional — applied to all; blank = group photo)" : "Machine photo (optional — leave blank to use the group photo)"}</FieldLabel>
              {mode === "edit" && machine?.imageUrl && <div style={{ marginBottom: 8 }}><PhotoBox url={machine.imageUrl} height={110} rounded="10px" /></div>}
              <input type="file" name="image" accept="image/*" style={{ fontSize: 13 }} />
            </label>
            {mode === "edit" && machine?.imageUrl && (
              <label style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12.5, color: "var(--muted)", marginTop: -4 }}>
                <input type="checkbox" name="remove_image" value="yes" /> Remove this machine&apos;s photo (use group photo)
              </label>
            )}
            <label><FieldLabel>{mode === "add" ? "Location (applied to all)" : "Location"}</FieldLabel>
              <input name="location" list="machine-locs" defaultValue={machine?.location ?? ""} placeholder="e.g. Shade 1 (pick or type a new one)" style={inputStyle} />
              <datalist id="machine-locs">{locations.map((l) => <option key={l} value={l} />)}</datalist>
            </label>
            <label><FieldLabel>Notes</FieldLabel>
              <textarea name="notes" rows={2} defaultValue={machine?.notes ?? ""} placeholder="Any notes" style={{ ...inputStyle, resize: "vertical", fontFamily: "inherit" }} />
            </label>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 4 }}>
              <button type="button" onClick={() => setOpen(false)} style={btnGhost}>Cancel</button>
              <button type="submit" style={btnGold}>{mode === "add" ? "Add machine" : "Save changes"}</button>
            </div>
          </form>
        </ModalShell>
      )}
    </>
  );
}

// ── Machine card ────────────────────────────────────────────────────
function MachineCard({ m, nowMs }: { m: Machine; nowMs: number }) {
  const sc = STATUS_CARD[m.status] ?? STATUS_CARD.working;
  const solid = STATUS_SOLID[m.status] ?? STATUS_SOLID.working;
  const meta = STATUS_META[m.status] ?? STATUS_META.working;
  return (
    <Link
      href={`/maintenance/${m.id}`}
      style={{
        textDecoration: "none", color: "inherit", border: `3px solid ${sc.border}`, borderRadius: 14,
        background: sc.bg, overflow: "hidden", display: "flex", flexDirection: "column",
        boxShadow: "0 1px 3px rgba(0,0,0,0.05)", ...(m.status === "retired" ? { opacity: 0.72 } : {}),
      }}
    >
      {/* Smaller photo so the colour-coding, not the picture, dominates. */}
      <PhotoBox url={m.imageUrl} height={96} rounded="0" />

      {/* Solid status band — unmistakable colour + live "down for…" timer. */}
      <div style={{ background: solid, color: "#fff", padding: "5px 10px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <span style={{ fontSize: 11, fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.05em" }}>{meta.label}</span>
        {m.status === "under_maintenance" && m.underMaintenanceSince && (
          <MaintTimer since={m.underMaintenanceSince} nowMs={nowMs} style={{ fontSize: 11, fontWeight: 800 }} />
        )}
      </div>

      <div style={{ padding: "10px 12px", display: "flex", flexDirection: "column", gap: 3 }}>
        <code style={{ fontFamily: "ui-monospace, monospace", fontWeight: 700, fontSize: 11, color: "var(--muted)" }}>{m.machine_code}</code>
        <div style={{ fontWeight: 800, fontSize: 15, lineHeight: 1.2 }}>{m.name}</div>
        {m.location && <div className="muted" style={{ fontSize: 11.5 }}>📍 {m.location}</div>}
      </div>
    </Link>
  );
}

function MachineGrid({ machines, nowMs }: { machines: Machine[]; nowMs: number }) {
  if (machines.length === 0) return <div className="muted" style={{ fontSize: 13, padding: "6px 2px" }}>No machines here.</div>;
  // Natural-sort by name so CNC-1, CNC-2 … CNC-10 line up in sequence
  // (not CNC-1, CNC-10, CNC-2 or whatever created-order produced).
  const ordered = [...machines].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }));
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 12 }}>
      {ordered.map((m) => <MachineCard key={m.id} m={m} nowMs={nowMs} />)}
    </div>
  );
}

// ── Top status filter chip (count + click-to-filter) ───────────────
function FilterChip({
  label, count, active, onClick, tint,
}: {
  label: string; count: number; active: boolean; onClick: () => void;
  tint: { border: string; bg: string; fg: string };
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: "flex", alignItems: "center", gap: 9, padding: "9px 15px", borderRadius: 12, cursor: "pointer",
        border: `2px solid ${active ? tint.border : "var(--border)"}`,
        background: active ? tint.bg : "var(--surface)",
      }}
    >
      <span style={{ fontSize: 13, fontWeight: 800, color: active ? tint.fg : "var(--text)" }}>{label}</span>
      <span style={{ fontSize: 13, fontWeight: 900, color: tint.fg, background: active ? "rgba(255,255,255,0.65)" : tint.bg, borderRadius: 999, padding: "1px 9px", minWidth: 22, textAlign: "center" }}>{count}</span>
    </button>
  );
}

// ── Registry ────────────────────────────────────────────────────────
export function MachinesGrid({
  tree, ungrouped, groupOpts, topGroupOpts, locations, nowMs, canManage,
}: {
  tree: Group[]; ungrouped: Machine[]; groupOpts: GroupOpt[]; topGroupOpts: GroupOpt[]; locations: string[]; nowMs: number;
  // Only owner/developer can manage the registry (create/edit groups &
  // machines). View-only roles (e.g. manager) get the board + the ability
  // to mark a machine Under-maintenance from its page, nothing else.
  canManage: boolean;
}) {
  const [search, setSearch] = useState("");
  // Management buttons live behind this toggle, and the toggle itself only
  // shows for canManage roles — so view-only roles see a clean board.
  const [editMode, setEditMode] = useState(false);
  const manage = canManage && editMode;
  const [statusFilter, setStatusFilter] = useState<"all" | "working" | "under_maintenance" | "retired">("all");
  const q = search.trim().toLowerCase();
  const matchSearch = (m: Machine) => !q || [m.machine_code, m.name, m.location].some((v) => (v ?? "").toLowerCase().includes(q));
  const matchStatus = (m: Machine) => statusFilter === "all" || m.status === statusFilter;
  // A filter is "active" (and hides empty groups) when searching OR a status
  // chip other than All is selected.
  const active = q.length > 0 || statusFilter !== "all";
  const fM = (list: Machine[]) => list.filter((m) => matchStatus(m) && matchSearch(m));

  // Counts across every machine (groups + sub-groups + ungrouped) for the
  // top filter chips.
  const counts = useMemo(() => {
    const c = { all: 0, working: 0, under_maintenance: 0, retired: 0 };
    const tally = (list: Machine[]) => {
      for (const m of list) {
        c.all += 1;
        if (m.status === "working") c.working += 1;
        else if (m.status === "under_maintenance") c.under_maintenance += 1;
        else if (m.status === "retired") c.retired += 1;
      }
    };
    tally(ungrouped);
    for (const g of tree) { tally(g.machines); for (const s of g.subgroups ?? []) tally(s.machines); }
    return c;
  }, [tree, ungrouped]);

  // Collapsible groups. Default = everything collapsed for a quick
  // overview; click a header (or Expand all) to open. Searching forces open.
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {};
    for (const g of tree) { init[g.id] = true; for (const s of g.subgroups ?? []) init[s.id] = true; }
    return init;
  });
  const toggle = (id: string) => setCollapsed((c) => ({ ...c, [id]: !c[id] }));
  const allCollapsed = tree.length > 0 && tree.every((g) => collapsed[g.id]);
  const collapseAll = () => { const next: Record<string, boolean> = {}; for (const g of tree) { next[g.id] = true; for (const s of g.subgroups ?? []) next[s.id] = true; } setCollapsed(next); };
  const expandAll = () => setCollapsed({});

  const totalMachines = useMemo(() => {
    let n = ungrouped.length;
    for (const g of tree) { n += g.machines.length; for (const s of g.subgroups ?? []) n += s.machines.length; }
    return n;
  }, [tree, ungrouped]);

  // When a search or status filter is active, hide groups/sub-groups that
  // have no matching machines.
  const visibleTree = active
    ? tree
        .map((g) => ({
          ...g,
          machines: fM(g.machines),
          subgroups: (g.subgroups ?? []).map((s) => ({ ...s, machines: fM(s.machines) })).filter((s) => s.machines.length > 0),
        }))
        .filter((g) => g.machines.length > 0 || (g.subgroups ?? []).length > 0)
    : tree;
  const visibleUngrouped = active ? fM(ungrouped) : ungrouped;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      {/* Status filter chips — counts at a glance; click to filter. */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <FilterChip label="All" count={counts.all} active={statusFilter === "all"} onClick={() => setStatusFilter("all")}
          tint={{ border: "var(--border)", bg: "var(--surface)", fg: "var(--text)" }} />
        <FilterChip label="Working" count={counts.working} active={statusFilter === "working"} onClick={() => setStatusFilter("working")}
          tint={{ border: STATUS_SOLID.working, bg: "rgba(22,163,74,0.12)", fg: STATUS_SOLID.working }} />
        <FilterChip label="Under maintenance" count={counts.under_maintenance} active={statusFilter === "under_maintenance"} onClick={() => setStatusFilter("under_maintenance")}
          tint={{ border: STATUS_SOLID.under_maintenance, bg: "rgba(234,88,12,0.14)", fg: "#9a3412" }} />
        {counts.retired > 0 && (
          <FilterChip label="Retired" count={counts.retired} active={statusFilter === "retired"} onClick={() => setStatusFilter("retired")}
            tint={{ border: STATUS_SOLID.retired, bg: "rgba(148,163,184,0.16)", fg: "#475569" }} />
        )}
      </div>

      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        {/* Edit-machines toggle — owner/developer only. Reveals all the
            add / edit / delete controls. View-only roles never see it. */}
        {canManage && (
          <button
            type="button"
            onClick={() => setEditMode((e) => !e)}
            style={editMode ? { ...btnGold, background: "var(--gold-dark, #a16207)" } : btnGhost}
          >
            {editMode ? "✓ Done editing" : "✎ Edit machines"}
          </button>
        )}
        {manage && (
          <GroupFormModal mode="add" parentOptions={topGroupOpts} back="/maintenance" buttonLabel="＋ Create group" />
        )}
        {tree.length > 0 && (
          <button type="button" onClick={allCollapsed ? expandAll : collapseAll} style={btnGhost}>
            {allCollapsed ? "Expand all" : "Collapse all"}
          </button>
        )}
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search machines — code, name, location…" style={{ ...inputStyle, flex: "1 1 260px", width: "auto" }} />
      </div>

      {manage && (
        <div style={{ fontSize: 12.5, fontWeight: 600, color: "#9a3412", background: "rgba(234,88,12,0.10)", border: "1px solid rgba(234,88,12,0.25)", borderRadius: 9, padding: "8px 12px" }}>
          ✎ Editing mode — add or change groups & machines. Tap <strong>✓ Done editing</strong> when finished.
        </div>
      )}

      {tree.length === 0 && ungrouped.length === 0 ? (
        canManage ? (
          <div className="banner">No groups yet. Tap <strong>✎ Edit machines</strong> → <strong>＋ Create group</strong> (e.g. CNC, Cranes), then add machines into it. You can also nest a sub-group (e.g. CNC → Mohit CNC).</div>
        ) : (
          <div className="banner">No machines have been set up yet.</div>
        )
      ) : (
        <p className="muted" style={{ fontSize: 13, margin: 0 }}>{tree.length} group(s) · {totalMachines} machine(s)</p>
      )}

      {visibleTree.map((g) => {
        const isCollapsed = active ? false : !!collapsed[g.id];
        return (
        <div key={g.id} style={{ border: "1px solid var(--border)", borderRadius: 16, background: "var(--surface)", overflow: "hidden" }}>
          {/* Top group header — click the left part to collapse / expand */}
          <div style={{ display: "flex", alignItems: "center", gap: 12, padding: 12, borderBottom: isCollapsed ? "none" : "1px solid var(--border)", background: "var(--surface-alt, rgba(0,0,0,0.02))" }}>
            <button type="button" onClick={() => toggle(g.id)} aria-expanded={!isCollapsed}
              style={{ display: "flex", alignItems: "center", gap: 12, flex: 1, minWidth: 0, background: "none", border: "none", padding: 0, cursor: "pointer", textAlign: "left" }}>
              <span style={{ fontSize: 12, color: "var(--muted)", width: 14, flexShrink: 0 }}>{isCollapsed ? "▶" : "▼"}</span>
              <div style={{ width: 52, height: 52, flexShrink: 0 }}><PhotoBox url={g.imageUrl} height={52} rounded="10px" /></div>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontWeight: 800, fontSize: 16, color: "var(--text)" }}>{g.name}</div>
                <div className="muted" style={{ fontSize: 12 }}>
                  {g.machines.length + (g.subgroups ?? []).reduce((n, s) => n + s.machines.length, 0)} machine(s)
                  {(g.subgroups?.length ?? 0) > 0 ? ` · ${g.subgroups!.length} sub-group(s)` : ""}
                </div>
              </div>
            </button>
            {manage && (
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <MachineFormModal mode="add" groups={groupOpts} defaultGroupId={g.id} locations={locations} back="/maintenance" buttonLabel="＋ Machine" buttonStyle={{ ...btnGold, padding: "7px 12px" }} />
                <GroupFormModal mode="add" parentOptions={topGroupOpts} defaultParentId={g.id} back="/maintenance" buttonLabel="＋ Sub-group" buttonStyle={{ ...btnGhost, padding: "7px 12px" }} />
                <GroupFormModal mode="edit" group={{ id: g.id, name: g.name, imageUrl: g.imageUrl, parent_id: g.parent_id }} parentOptions={topGroupOpts} back="/maintenance" buttonLabel="Edit" buttonStyle={{ ...btnGhost, padding: "7px 12px" }} />
              </div>
            )}
          </div>

          {!isCollapsed && (
          <div style={{ padding: 12, display: "flex", flexDirection: "column", gap: 14 }}>
            {/* direct machines */}
            {(g.machines.length > 0 || !active) && <MachineGrid machines={g.machines} nowMs={nowMs} />}

            {/* sub-groups */}
            {(g.subgroups ?? []).map((s) => {
              const subCollapsed = active ? false : !!collapsed[s.id];
              return (
              <div key={s.id} style={{ border: "1px dashed var(--border)", borderRadius: 12, padding: 12, background: "var(--bg)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: subCollapsed ? 0 : 10 }}>
                  <button type="button" onClick={() => toggle(s.id)} aria-expanded={!subCollapsed}
                    style={{ display: "flex", alignItems: "center", gap: 10, flex: 1, minWidth: 0, background: "none", border: "none", padding: 0, cursor: "pointer", textAlign: "left" }}>
                    <span style={{ fontSize: 11, color: "var(--muted)", width: 12, flexShrink: 0 }}>{subCollapsed ? "▶" : "▼"}</span>
                    <div style={{ width: 36, height: 36, flexShrink: 0 }}><PhotoBox url={s.imageUrl} height={36} rounded="8px" /></div>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontWeight: 700, fontSize: 14, color: "var(--text)" }}>↳ {s.name}</div>
                      <div className="muted" style={{ fontSize: 11.5 }}>{s.machines.length} machine(s)</div>
                    </div>
                  </button>
                  {manage && (
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      <MachineFormModal mode="add" groups={groupOpts} defaultGroupId={s.id} locations={locations} back="/maintenance" buttonLabel="＋ Machine" buttonStyle={{ ...btnGold, padding: "6px 11px", fontSize: 12 }} />
                      <GroupFormModal mode="edit" group={{ id: s.id, name: s.name, imageUrl: s.imageUrl, parent_id: s.parent_id }} parentOptions={topGroupOpts} back="/maintenance" buttonLabel="Edit" buttonStyle={{ ...btnGhost, padding: "6px 11px", fontSize: 12 }} />
                    </div>
                  )}
                </div>
                {!subCollapsed && <MachineGrid machines={s.machines} nowMs={nowMs} />}
              </div>
              );
            })}
          </div>
          )}
        </div>
        );
      })}

      {visibleUngrouped.length > 0 && (
        <div style={{ border: "1px solid var(--border)", borderRadius: 16, background: "var(--surface)", overflow: "hidden" }}>
          <div style={{ padding: 12, borderBottom: "1px solid var(--border)", background: "var(--surface-alt, rgba(0,0,0,0.02))", fontWeight: 800, fontSize: 15 }}>
            Ungrouped <span className="muted" style={{ fontWeight: 600, fontSize: 12 }}>· {visibleUngrouped.length}</span>
          </div>
          <div style={{ padding: 12 }}><MachineGrid machines={visibleUngrouped} nowMs={nowMs} /></div>
        </div>
      )}
    </div>
  );
}
