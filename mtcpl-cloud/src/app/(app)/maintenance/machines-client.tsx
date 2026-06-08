"use client";

// ──────────────────────────────────────────────────────────────────
// Maintenance — machine registry UI (nested groups + photo cards).
// Create a primary GROUP (e.g. CNC) with a shared photo; optionally nest
// sub-groups under it (e.g. Mohit CNC). Add machines into any group. A
// machine keeps its own photo or shares the group's. Location is a
// creatable fixed list (Shade 1, Shade 2, …).
// ──────────────────────────────────────────────────────────────────

import { useMemo, useState } from "react";
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
  openTickets: number;
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

// Whole-card tint by status so the state reads at a glance, not just the chip.
const STATUS_CARD: Record<string, { border: string; bg: string }> = {
  working: { border: "rgba(22,163,74,0.55)", bg: "rgba(22,163,74,0.07)" },
  under_maintenance: { border: "rgba(234,88,12,0.6)", bg: "rgba(234,88,12,0.10)" },
  retired: { border: "rgba(148,163,184,0.6)", bg: "rgba(148,163,184,0.14)" },
};

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
function MachineCard({ m }: { m: Machine }) {
  const sc = STATUS_CARD[m.status] ?? STATUS_CARD.working;
  return (
    <Link
      href={`/maintenance/${m.id}`}
      style={{
        textDecoration: "none", color: "inherit", border: `2px solid ${sc.border}`, borderRadius: 14,
        background: sc.bg, overflow: "hidden", display: "flex", flexDirection: "column",
        boxShadow: "0 1px 3px rgba(0,0,0,0.05)", ...(m.status === "retired" ? { opacity: 0.7 } : {}),
      }}
    >
      <div style={{ position: "relative" }}>
        <PhotoBox url={m.imageUrl} height={140} rounded="0" />
        <div style={{ position: "absolute", top: 8, right: 8 }}><StatusChip status={m.status} /></div>
        {m.openTickets > 0 && (
          <div style={{ position: "absolute", top: 8, left: 8, fontSize: 10.5, fontWeight: 800, color: "#fff", background: "rgba(234,88,12,0.92)", borderRadius: 999, padding: "2px 9px" }}>
            {m.openTickets} open
          </div>
        )}
        {/* bottom status ribbon so the colour is unmistakable on the whole card */}
        <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 4, background: sc.border }} />
      </div>
      <div style={{ padding: 12, display: "flex", flexDirection: "column", gap: 4 }}>
        <code style={{ fontFamily: "ui-monospace, monospace", fontWeight: 700, fontSize: 11.5, color: "var(--muted)" }}>{m.machine_code}</code>
        <div style={{ fontWeight: 700, fontSize: 15, lineHeight: 1.2 }}>{m.name}</div>
        {m.location && <div className="muted" style={{ fontSize: 11.5 }}>📍 {m.location}</div>}
      </div>
    </Link>
  );
}

function MachineGrid({ machines }: { machines: Machine[] }) {
  if (machines.length === 0) return <div className="muted" style={{ fontSize: 13, padding: "6px 2px" }}>No machines here yet.</div>;
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 12 }}>
      {machines.map((m) => <MachineCard key={m.id} m={m} />)}
    </div>
  );
}

// ── Registry ────────────────────────────────────────────────────────
export function MachinesGrid({
  tree, ungrouped, groupOpts, topGroupOpts, locations,
}: {
  tree: Group[]; ungrouped: Machine[]; groupOpts: GroupOpt[]; topGroupOpts: GroupOpt[]; locations: string[];
}) {
  const [search, setSearch] = useState("");
  const q = search.trim().toLowerCase();
  const matchM = (m: Machine) => [m.machine_code, m.name, m.location].some((v) => (v ?? "").toLowerCase().includes(q));
  const fM = (list: Machine[]) => (q ? list.filter(matchM) : list);

  // Collapsible top-level groups. While searching, everything is forced open.
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const toggle = (id: string) => setCollapsed((c) => ({ ...c, [id]: !c[id] }));
  const allCollapsed = tree.length > 0 && tree.every((g) => collapsed[g.id]);
  const collapseAll = () => { const next: Record<string, boolean> = {}; for (const g of tree) next[g.id] = true; setCollapsed(next); };
  const expandAll = () => setCollapsed({});

  const totalMachines = useMemo(() => {
    let n = ungrouped.length;
    for (const g of tree) { n += g.machines.length; for (const s of g.subgroups ?? []) n += s.machines.length; }
    return n;
  }, [tree, ungrouped]);

  // When searching, hide groups/subgroups with no matches.
  const visibleTree = q
    ? tree
        .map((g) => ({
          ...g,
          machines: fM(g.machines),
          subgroups: (g.subgroups ?? []).map((s) => ({ ...s, machines: fM(s.machines) })).filter((s) => s.machines.length > 0),
        }))
        .filter((g) => g.machines.length > 0 || (g.subgroups ?? []).length > 0)
    : tree;
  const visibleUngrouped = fM(ungrouped);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <GroupFormModal mode="add" parentOptions={topGroupOpts} back="/maintenance" buttonLabel="＋ Create group" />
        <Link href="/maintenance/tickets" style={{ ...btnGhost, textDecoration: "none", display: "inline-block" }}>🧾 Repair tickets</Link>
        {tree.length > 0 && (
          <button type="button" onClick={allCollapsed ? expandAll : collapseAll} style={btnGhost}>
            {allCollapsed ? "Expand all" : "Collapse all"}
          </button>
        )}
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search machines — code, name, location…" style={{ ...inputStyle, flex: "1 1 260px", width: "auto" }} />
      </div>

      {tree.length === 0 && ungrouped.length === 0 ? (
        <div className="banner">No groups yet. Tap <strong>＋ Create group</strong> (e.g. CNC, Cranes), then add machines into it. You can also nest a sub-group (e.g. CNC → Mohit CNC).</div>
      ) : (
        <p className="muted" style={{ fontSize: 13, margin: 0 }}>{tree.length} group(s) · {totalMachines} machine(s)</p>
      )}

      {visibleTree.map((g) => {
        const isCollapsed = q ? false : !!collapsed[g.id];
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
                <div className="muted" style={{ fontSize: 12 }}>{g.machines.length} machine(s){(g.subgroups?.length ?? 0) > 0 ? ` · ${g.subgroups!.length} sub-group(s)` : ""}</div>
              </div>
            </button>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <MachineFormModal mode="add" groups={groupOpts} defaultGroupId={g.id} locations={locations} back="/maintenance" buttonLabel="＋ Machine" buttonStyle={{ ...btnGold, padding: "7px 12px" }} />
              <GroupFormModal mode="add" parentOptions={topGroupOpts} defaultParentId={g.id} back="/maintenance" buttonLabel="＋ Sub-group" buttonStyle={{ ...btnGhost, padding: "7px 12px" }} />
              <GroupFormModal mode="edit" group={{ id: g.id, name: g.name, imageUrl: g.imageUrl, parent_id: g.parent_id }} parentOptions={topGroupOpts} back="/maintenance" buttonLabel="Edit" buttonStyle={{ ...btnGhost, padding: "7px 12px" }} />
            </div>
          </div>

          {!isCollapsed && (
          <div style={{ padding: 12, display: "flex", flexDirection: "column", gap: 14 }}>
            {/* direct machines */}
            {(g.machines.length > 0 || !q) && <MachineGrid machines={g.machines} />}

            {/* sub-groups */}
            {(g.subgroups ?? []).map((s) => (
              <div key={s.id} style={{ border: "1px dashed var(--border)", borderRadius: 12, padding: 12, background: "var(--bg)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                  <div style={{ width: 36, height: 36, flexShrink: 0 }}><PhotoBox url={s.imageUrl} height={36} rounded="8px" /></div>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontWeight: 700, fontSize: 14 }}>↳ {s.name}</div>
                    <div className="muted" style={{ fontSize: 11.5 }}>{s.machines.length} machine(s)</div>
                  </div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    <MachineFormModal mode="add" groups={groupOpts} defaultGroupId={s.id} locations={locations} back="/maintenance" buttonLabel="＋ Machine" buttonStyle={{ ...btnGold, padding: "6px 11px", fontSize: 12 }} />
                    <GroupFormModal mode="edit" group={{ id: s.id, name: s.name, imageUrl: s.imageUrl, parent_id: s.parent_id }} parentOptions={topGroupOpts} back="/maintenance" buttonLabel="Edit" buttonStyle={{ ...btnGhost, padding: "6px 11px", fontSize: 12 }} />
                  </div>
                </div>
                <MachineGrid machines={s.machines} />
              </div>
            ))}
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
          <div style={{ padding: 12 }}><MachineGrid machines={visibleUngrouped} /></div>
        </div>
      )}
    </div>
  );
}
