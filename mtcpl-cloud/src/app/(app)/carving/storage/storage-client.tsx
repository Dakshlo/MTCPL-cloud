"use client";

// Mig 125 — Temporary Storage client. Park-all-unassigned (one-click clear)
// + a searchable list of parked slabs grouped by temple, with multi-select
// "bring back" and per-slab bring-back.

import { useMemo, useState, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { parkAllUnassignedAction, unparkSlabsAction } from "../actions";

export type ParkedSlab = {
  id: string; label: string; temple: string; stone: string | null;
  l: number; w: number; t: number; parkedAt: string | null;
};

const calcCft = (l: number, w: number, t: number) => (l * w * t) / 1728;

export function StorageClient({ parked, unassignedCount }: { parked: ParkedSlab[]; unassignedCount: number }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [confirmPark, setConfirmPark] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const n = q.trim().toLowerCase();
    if (!n) return parked;
    // Dimension-friendly needle: 64x61x19 / 64 61 19 / 64"×61" all match.
    const nd = n.replace(/×/g, "x").replace(/["\s]/g, "");
    return parked.filter((s) => {
      if ([s.id, s.label, s.temple, s.stone].some((v) => (v ?? "").toLowerCase().includes(n))) return true;
      const dims = `${s.l}x${s.w}x${s.t}`;
      const cft = calcCft(s.l, s.w, s.t).toFixed(2);
      return !!nd && (dims.includes(nd) || cft.includes(nd));
    });
  }, [q, parked]);

  // Group filtered slabs by temple.
  const groups = useMemo(() => {
    const m = new Map<string, ParkedSlab[]>();
    for (const s of filtered) { const arr = m.get(s.temple) ?? []; arr.push(s); m.set(s.temple, arr); }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [filtered]);

  // Collapsible temple groups (match the Unassigned UI) — default collapsed so
  // a 1800-slab storage isn't one giant wall; a live search auto-expands.
  const [open, setOpen] = useState<Set<string>>(new Set());
  function toggleOpen(temple: string) {
    setOpen((prev) => { const n = new Set(prev); n.has(temple) ? n.delete(temple) : n.add(temple); return n; });
  }

  function toggle(id: string) {
    setSelected((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }
  function toggleTemple(slabs: ParkedSlab[]) {
    const allOn = slabs.every((s) => selected.has(s.id));
    setSelected((prev) => { const n = new Set(prev); for (const s of slabs) allOn ? n.delete(s.id) : n.add(s.id); return n; });
  }

  async function parkAll() {
    if (busy) return;
    setBusy(true); setErr(null); setMsg(null);
    try {
      const res = await parkAllUnassignedAction();
      if (!res.ok) setErr(res.error);
      else { setMsg(`Moved ${res.count} slab${res.count === 1 ? "" : "s"} to storage. Unassigned is now 0.`); router.refresh(); }
    } catch { setErr("Failed — check your connection."); }
    finally { setBusy(false); setConfirmPark(false); }
  }

  async function bringBack(ids: string[]) {
    if (busy || ids.length === 0) return;
    const confirmMsg = ids.length === 1
      ? `Bring slab ${ids[0]} back to Carving Unassigned?`
      : `Bring ${ids.length} selected slabs back to Carving Unassigned?`;
    if (!window.confirm(confirmMsg)) return;
    setBusy(true); setErr(null); setMsg(null);
    try {
      const res = await unparkSlabsAction(ids);
      if (!res.ok) setErr(res.error);
      else { setMsg(`Brought ${res.count} slab${res.count === 1 ? "" : "s"} back to Unassigned.`); setSelected(new Set()); router.refresh(); }
    } catch { setErr("Failed — check your connection."); }
    finally { setBusy(false); }
  }

  const btn = (bg: string): CSSProperties => ({ padding: "9px 16px", fontSize: 13.5, fontWeight: 800, color: "#fff", background: bg, border: "none", borderRadius: 9, cursor: busy ? "wait" : "pointer", opacity: busy ? 0.7 : 1, whiteSpace: "nowrap" });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {/* Park-all card */}
      <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: "14px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 800 }}>Carving Unassigned: <span style={{ color: unassignedCount > 0 ? "#b45309" : "#15803d" }}>{unassignedCount}</span></div>
          <div className="muted" style={{ fontSize: 12.5, marginTop: 2 }}>Move the whole backlog into storage in one click, then bring back only the few you need.</div>
        </div>
        {confirmPark ? (
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontSize: 12.5, fontWeight: 700 }}>Move all {unassignedCount}?</span>
            <button type="button" disabled={busy} onClick={parkAll} style={btn("#b45309")}>{busy ? "Moving…" : "Yes, move all"}</button>
            <button type="button" disabled={busy} onClick={() => setConfirmPark(false)} className="ghost-button">Cancel</button>
          </div>
        ) : (
          <button type="button" disabled={busy || unassignedCount === 0} onClick={() => setConfirmPark(true)} style={{ ...btn("#b45309"), opacity: unassignedCount === 0 ? 0.5 : 1, cursor: unassignedCount === 0 ? "not-allowed" : "pointer" }}>
            🗄 Move all {unassignedCount} unassigned → storage
          </button>
        )}
      </div>

      {msg && <div style={{ fontSize: 13, fontWeight: 700, color: "#15803d", background: "rgba(22,163,74,0.08)", border: "1px solid rgba(22,163,74,0.3)", borderRadius: 10, padding: "9px 13px" }}>✓ {msg}</div>}
      {err && <div style={{ fontSize: 13, fontWeight: 700, color: "#991b1b" }}>⚠ {err}</div>}

      {/* Search + bring-back-selected */}
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search parked slabs — code, label, temple, stone, size (e.g. 64x61x19)…" style={{ flex: "1 1 280px", padding: "9px 12px", fontSize: 13.5, border: "1px solid var(--border)", borderRadius: 9, background: "var(--bg)", color: "var(--text)" }} />
        <span className="muted" style={{ fontSize: 12.5 }}>{parked.length} in storage · {filtered.length} shown</span>
        {groups.length > 1 && (
          <>
            <button type="button" onClick={() => setOpen(new Set(groups.map(([t]) => t)))} className="ghost-button" style={{ fontSize: 12 }}>⊞ Expand all</button>
            <button type="button" onClick={() => setOpen(new Set())} className="ghost-button" style={{ fontSize: 12 }}>⊟ Collapse all</button>
          </>
        )}
        {selected.size > 0 && (
          <button type="button" disabled={busy} onClick={() => bringBack([...selected])} style={btn("#15803d")}>↩ Bring back {selected.size} selected</button>
        )}
      </div>

      {parked.length === 0 ? (
        <div className="banner">Storage is empty. Use “Move all unassigned → storage” above to park the backlog.</div>
      ) : filtered.length === 0 ? (
        <div className="muted" style={{ fontSize: 13 }}>No parked slabs match “{q}”.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {groups.map(([temple, slabs]) => {
            const allOn = slabs.every((s) => selected.has(s.id));
            const expanded = q.trim() !== "" || open.has(temple);
            return (
              <div key={temple} style={{ border: "1px solid var(--border)", borderRadius: 12, background: "var(--surface)", overflow: "hidden" }}>
                <div style={{ padding: "10px 14px", borderBottom: expanded ? "1px solid var(--border)" : "none", display: "flex", alignItems: "center", gap: 10, background: "var(--surface-alt, rgba(0,0,0,0.02))" }}>
                  <input type="checkbox" checked={allOn} onChange={() => toggleTemple(slabs)} onClick={(e) => e.stopPropagation()} style={{ width: 16, height: 16, cursor: "pointer", flexShrink: 0 }} title="Select all in this temple" />
                  <button type="button" onClick={() => toggleOpen(temple)} style={{ display: "flex", alignItems: "center", gap: 8, background: "none", border: "none", cursor: "pointer", flex: 1, textAlign: "left", color: "var(--text)", fontWeight: 800, fontSize: 14, minWidth: 0 }}>
                    <span style={{ color: "var(--muted)", fontSize: 12, width: 12 }}>{expanded ? "▾" : "▸"}</span>
                    🏛 <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{temple}</span>
                    <span className="muted" style={{ fontWeight: 600, fontSize: 12 }}>· {slabs.length}</span>
                  </button>
                  <button type="button" disabled={busy} onClick={() => bringBack(slabs.map((s) => s.id))} style={{ fontSize: 11.5, fontWeight: 700, color: "#15803d", background: "none", border: "1px solid rgba(22,163,74,0.4)", borderRadius: 6, padding: "3px 9px", cursor: "pointer", whiteSpace: "nowrap", flexShrink: 0 }}>↩ Bring all back</button>
                </div>
                {expanded && (
                <div style={{ padding: 12, display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))", gap: 8 }}>
                  {slabs.map((s) => {
                    const on = selected.has(s.id);
                    return (
                      <div key={s.id} onClick={() => toggle(s.id)} style={{ border: `1.5px solid ${on ? "var(--gold-dark)" : "var(--border)"}`, background: on ? "rgba(184,115,51,0.06)" : "var(--bg)", borderRadius: 10, padding: "8px 10px", cursor: "pointer", display: "flex", flexDirection: "column", gap: 3 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <input type="checkbox" checked={on} onChange={() => toggle(s.id)} onClick={(e) => e.stopPropagation()} style={{ width: 15, height: 15, cursor: "pointer" }} />
                          <code style={{ fontFamily: "ui-monospace, monospace", fontWeight: 800, fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.id}</code>
                        </div>
                        <div style={{ fontSize: 11.5, color: "var(--muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.label || "—"}</div>
                        <div style={{ fontFamily: "ui-monospace, monospace", fontSize: 11, color: "var(--text)" }}>{s.l}&quot;×{s.w}&quot;×{s.t}&quot; · {calcCft(s.l, s.w, s.t).toFixed(2)} CFT</div>
                        <button type="button" disabled={busy} onClick={(e) => { e.stopPropagation(); bringBack([s.id]); }} style={{ alignSelf: "flex-start", fontSize: 11, fontWeight: 700, color: "#15803d", background: "none", border: "1px solid rgba(22,163,74,0.4)", borderRadius: 6, padding: "2px 8px", cursor: "pointer" }}>↩ Bring back</button>
                      </div>
                    );
                  })}
                </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
