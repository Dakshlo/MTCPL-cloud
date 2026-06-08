"use client";

// ──────────────────────────────────────────────────────────────────
// Maintenance — machine registry UI (grid + add/edit modal).
// ──────────────────────────────────────────────────────────────────

import { useMemo, useState } from "react";
import Link from "next/link";
import { createMachineAction, updateMachineAction } from "./actions";

export type Machine = {
  id: string;
  machine_code: string | null;
  name: string;
  category: string | null;
  section: string | null;
  status: string;
  location: string | null;
  notes: string | null;
  openTickets: number;
};

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

export function MachineFormModal({
  mode, machine, categories, sections, back, buttonLabel, buttonStyle,
}: {
  mode: "add" | "edit";
  machine?: Machine;
  categories: string[];
  sections: string[];
  back: string;
  buttonLabel: string;
  buttonStyle?: React.CSSProperties;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} style={buttonStyle ?? btnGold}>{buttonLabel}</button>
      {open && (
        <div onClick={() => setOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 1100, background: "rgba(15,23,42,0.5)", backdropFilter: "blur(3px)", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "7vh 16px", overflowY: "auto" }}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: 460, background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 16, padding: 22, boxShadow: "0 24px 60px rgba(0,0,0,0.3)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <h2 style={{ margin: 0, fontSize: 18 }}>{mode === "add" ? "🛠️ Add machine" : "Edit machine"}</h2>
              <button type="button" onClick={() => setOpen(false)} style={{ background: "none", border: "none", fontSize: 24, lineHeight: 1, cursor: "pointer", color: "var(--muted)" }} aria-label="Close">×</button>
            </div>
            <form action={mode === "add" ? createMachineAction : updateMachineAction} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {mode === "edit" && machine && <input type="hidden" name="id" value={machine.id} />}
              <input type="hidden" name="back" value={back} />
              <label><FieldLabel>Machine name *</FieldLabel>
                <input name="name" required defaultValue={machine?.name ?? ""} placeholder="e.g. Gantry Crane #1" style={inputStyle} />
              </label>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <label><FieldLabel>Type</FieldLabel>
                  <input name="category" list="machine-cats" defaultValue={machine?.category ?? ""} placeholder="Crane / CNC / Truck…" style={inputStyle} />
                  <datalist id="machine-cats">{categories.map((c) => <option key={c} value={c} />)}</datalist>
                </label>
                <label><FieldLabel>Section</FieldLabel>
                  <input name="section" list="machine-sections" defaultValue={machine?.section ?? ""} placeholder="Cutting / Logistics…" style={inputStyle} />
                  <datalist id="machine-sections">{sections.map((s) => <option key={s} value={s} />)}</datalist>
                </label>
              </div>
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
          </div>
        </div>
      )}
    </>
  );
}

export function MachinesGrid({ machines, categories, sections }: { machines: Machine[]; categories: string[]; sections: string[] }) {
  const [search, setSearch] = useState("");
  const q = search.trim().toLowerCase();
  const filtered = useMemo(() => {
    if (!q) return machines;
    return machines.filter((m) =>
      [m.machine_code, m.name, m.category, m.section, m.location].some((v) => (v ?? "").toLowerCase().includes(q)),
    );
  }, [machines, q]);

  // Group by section.
  const groups = useMemo(() => {
    const map = new Map<string, Machine[]>();
    for (const m of filtered) {
      const key = m.section || "Unassigned";
      const list = map.get(key) ?? [];
      list.push(m);
      map.set(key, list);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [filtered]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <MachineFormModal mode="add" categories={categories} sections={sections} back="/maintenance" buttonLabel="＋ Add machine" />
        <Link href="/maintenance/tickets" style={{ ...btnGhost, textDecoration: "none", display: "inline-block" }}>🧾 Repair tickets</Link>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search machines — code, name, type, section, location…"
          style={{ ...inputStyle, flex: "1 1 280px", width: "auto" }}
        />
      </div>

      <p className="muted" style={{ fontSize: 13, margin: 0 }}>
        <strong style={{ color: "var(--text)" }}>{filtered.length}</strong> of {machines.length} machines
      </p>

      {groups.length === 0 ? (
        <div className="banner">No machines yet. Tap <strong>＋ Add machine</strong> to start.</div>
      ) : (
        groups.map(([section, list]) => (
          <div key={section}>
            <div style={{ fontWeight: 700, fontSize: 14, color: "var(--text)", padding: "8px 0", borderBottom: "2px solid var(--border)", marginBottom: 12, display: "flex", justifyContent: "space-between" }}>
              <span>{section}</span>
              <span style={{ fontSize: 12, color: "var(--muted)", fontWeight: 600 }}>{list.length}</span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 12 }}>
              {list.map((m) => (
                <Link
                  key={m.id}
                  href={`/maintenance/${m.id}`}
                  style={{
                    textDecoration: "none", color: "inherit",
                    border: "1px solid var(--border)", borderRadius: 12, background: "var(--surface)",
                    padding: 14, display: "flex", flexDirection: "column", gap: 6,
                    boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
                    ...(m.status === "retired" ? { opacity: 0.6 } : {}),
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <code style={{ fontFamily: "ui-monospace, monospace", fontWeight: 700, fontSize: 12, color: "var(--muted)" }}>{m.machine_code}</code>
                    {m.openTickets > 0 && (
                      <span style={{ marginLeft: "auto", fontSize: 10.5, fontWeight: 800, color: "#9a3412", background: "rgba(234,88,12,0.14)", borderRadius: 999, padding: "2px 8px" }}>
                        {m.openTickets} open
                      </span>
                    )}
                  </div>
                  <div style={{ fontWeight: 700, fontSize: 15 }}>{m.name}</div>
                  {m.category && <div className="muted" style={{ fontSize: 12 }}>{m.category}</div>}
                  <div style={{ marginTop: 2 }}><StatusChip status={m.status} /></div>
                  {m.location && <div className="muted" style={{ fontSize: 11.5 }}>📍 {m.location}</div>}
                </Link>
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
