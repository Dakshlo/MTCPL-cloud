"use client";

// ──────────────────────────────────────────────────────────────────
// Maintenance — machine registry UI (groups + photo cards).
// Create a GROUP (e.g. Cranes, CNCs) with a shared photo, then add
// machines into it. A machine can keep its own photo or share the
// group's. Cards show the photo, grouped group-wise.
// ──────────────────────────────────────────────────────────────────

import { useMemo, useState } from "react";
import Link from "next/link";
import { createMachineAction, updateMachineAction, createGroupAction, updateGroupAction, deleteGroupAction } from "./actions";

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
export type GroupOpt = { id: string; name: string };
export type Group = { id: string; name: string; imageUrl: string | null; machines: Machine[] };

const STATUS_META: Record<string, { label: string; bg: string; fg: string }> = {
  working: { label: "Working", bg: "rgba(22,163,74,0.15)", fg: "#15803d" },
  under_maintenance: { label: "Under maintenance", bg: "rgba(234,88,12,0.16)", fg: "#9a3412" },
  retired: { label: "Retired", bg: "rgba(148,163,184,0.2)", fg: "#475569" },
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
    <div style={{ width: "100%", height, borderRadius: rounded, background: "linear-gradient(135deg, rgba(63,143,134,0.12), rgba(63,143,134,0.04))", display: "flex", alignItems: "center", justifyContent: "center", fontSize: height > 80 ? 34 : 20, color: "rgba(63,143,134,0.55)" }}>🛠️</div>
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

// ── Group create / edit (+ delete) modal ────────────────────────────
export function GroupFormModal({
  mode, group, back, buttonLabel, buttonStyle,
}: {
  mode: "add" | "edit";
  group?: { id: string; name: string; imageUrl: string | null };
  back: string;
  buttonLabel: string;
  buttonStyle?: React.CSSProperties;
}) {
  const [open, setOpen] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} style={buttonStyle ?? btnGold}>{buttonLabel}</button>
      {open && (
        <ModalShell title={mode === "add" ? "📁 Create group" : "Edit group"} onClose={() => setOpen(false)}>
          <form action={mode === "add" ? createGroupAction : updateGroupAction} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {mode === "edit" && group && <input type="hidden" name="id" value={group.id} />}
            <input type="hidden" name="back" value={back} />
            <label><FieldLabel>Group name *</FieldLabel>
              <input name="name" required defaultValue={group?.name ?? ""} placeholder="e.g. Cranes, CNCs, Vehicles" style={inputStyle} />
            </label>
            <label><FieldLabel>{mode === "add" ? "Group photo (shared by all machines)" : "Replace group photo"}</FieldLabel>
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
  mode, machine, groups, defaultGroupId, back, buttonLabel, buttonStyle,
}: {
  mode: "add" | "edit";
  machine?: Machine;
  groups: GroupOpt[];
  defaultGroupId?: string | null;
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
          <form action={mode === "add" ? createMachineAction : updateMachineAction} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {mode === "edit" && machine && <input type="hidden" name="id" value={machine.id} />}
            <input type="hidden" name="back" value={back} />
            <label><FieldLabel>Machine name *</FieldLabel>
              <input name="name" required defaultValue={machine?.name ?? ""} placeholder="e.g. Gantry Crane #1" style={inputStyle} />
            </label>
            <label><FieldLabel>Group *</FieldLabel>
              <select name="group_id" required defaultValue={machine?.group_id ?? defaultGroupId ?? ""} style={inputStyle}>
                <option value="" disabled>— Select a group —</option>
                {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
              </select>
            </label>
            <label><FieldLabel>Machine photo (optional — leave blank to use the group photo)</FieldLabel>
              {mode === "edit" && machine?.imageUrl && <div style={{ marginBottom: 8 }}><PhotoBox url={machine.imageUrl} height={110} rounded="10px" /></div>}
              <input type="file" name="image" accept="image/*" style={{ fontSize: 13 }} />
            </label>
            <label><FieldLabel>Location</FieldLabel>
              <input name="location" defaultValue={machine?.location ?? ""} placeholder="Where it is" style={inputStyle} />
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
  return (
    <Link
      href={`/maintenance/${m.id}`}
      style={{
        textDecoration: "none", color: "inherit", border: "1px solid var(--border)", borderRadius: 14,
        background: "var(--surface)", overflow: "hidden", display: "flex", flexDirection: "column",
        boxShadow: "0 1px 3px rgba(0,0,0,0.05)", ...(m.status === "retired" ? { opacity: 0.6 } : {}),
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
      </div>
      <div style={{ padding: 12, display: "flex", flexDirection: "column", gap: 4 }}>
        <code style={{ fontFamily: "ui-monospace, monospace", fontWeight: 700, fontSize: 11.5, color: "var(--muted)" }}>{m.machine_code}</code>
        <div style={{ fontWeight: 700, fontSize: 15, lineHeight: 1.2 }}>{m.name}</div>
        {m.location && <div className="muted" style={{ fontSize: 11.5 }}>📍 {m.location}</div>}
      </div>
    </Link>
  );
}

// ── Registry ────────────────────────────────────────────────────────
export function MachinesGrid({ groups, ungrouped }: { groups: Group[]; ungrouped: Machine[] }) {
  const [search, setSearch] = useState("");
  const q = search.trim().toLowerCase();
  const allGroupOpts: GroupOpt[] = groups.map((g) => ({ id: g.id, name: g.name }));

  const matchM = (m: Machine) => !q || [m.machine_code, m.name, m.location].some((v) => (v ?? "").toLowerCase().includes(q));

  const shownGroups = useMemo(
    () => groups
      .map((g) => ({ ...g, machines: g.machines.filter(matchM) }))
      .filter((g) => !q || g.machines.length > 0 || g.name.toLowerCase().includes(q)),
    [groups, q],
  );
  const shownUngrouped = ungrouped.filter(matchM);
  const totalMachines = groups.reduce((n, g) => n + g.machines.length, 0) + ungrouped.length;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <GroupFormModal mode="add" back="/maintenance" buttonLabel="＋ Create group" />
        <Link href="/maintenance/tickets" style={{ ...btnGhost, textDecoration: "none", display: "inline-block" }}>🧾 Repair tickets</Link>
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search machines — code, name, location…" style={{ ...inputStyle, flex: "1 1 260px", width: "auto" }} />
      </div>

      {groups.length === 0 && ungrouped.length === 0 ? (
        <div className="banner">No groups yet. Tap <strong>＋ Create group</strong> (e.g. Cranes, CNCs), then add machines into it.</div>
      ) : (
        <p className="muted" style={{ fontSize: 13, margin: 0 }}>{groups.length} group(s) · {totalMachines} machine(s)</p>
      )}

      {shownGroups.map((g) => (
        <div key={g.id} style={{ border: "1px solid var(--border)", borderRadius: 16, background: "var(--surface)", overflow: "hidden" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, padding: 12, borderBottom: "1px solid var(--border)", background: "var(--surface-alt, rgba(0,0,0,0.02))" }}>
            <div style={{ width: 52, height: 52, flexShrink: 0 }}><PhotoBox url={g.imageUrl} height={52} rounded="10px" /></div>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontWeight: 800, fontSize: 16 }}>{g.name}</div>
              <div className="muted" style={{ fontSize: 12 }}>{g.machines.length} machine(s)</div>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <MachineFormModal mode="add" groups={allGroupOpts} defaultGroupId={g.id} back="/maintenance" buttonLabel="＋ Add machine" buttonStyle={{ ...btnGold, padding: "7px 12px" }} />
              <GroupFormModal mode="edit" group={{ id: g.id, name: g.name, imageUrl: g.imageUrl }} back="/maintenance" buttonLabel="Edit" buttonStyle={{ ...btnGhost, padding: "7px 12px" }} />
            </div>
          </div>
          <div style={{ padding: 12 }}>
            {g.machines.length === 0 ? (
              <div className="muted" style={{ fontSize: 13, padding: "8px 2px" }}>No machines in this group yet.</div>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 12 }}>
                {g.machines.map((m) => <MachineCard key={m.id} m={m} />)}
              </div>
            )}
          </div>
        </div>
      ))}

      {shownUngrouped.length > 0 && (
        <div style={{ border: "1px solid var(--border)", borderRadius: 16, background: "var(--surface)", overflow: "hidden" }}>
          <div style={{ padding: 12, borderBottom: "1px solid var(--border)", background: "var(--surface-alt, rgba(0,0,0,0.02))", fontWeight: 800, fontSize: 15 }}>
            Ungrouped <span className="muted" style={{ fontWeight: 600, fontSize: 12 }}>· {shownUngrouped.length}</span>
          </div>
          <div style={{ padding: 12, display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 12 }}>
            {shownUngrouped.map((m) => <MachineCard key={m.id} m={m} />)}
          </div>
        </div>
      )}
    </div>
  );
}
