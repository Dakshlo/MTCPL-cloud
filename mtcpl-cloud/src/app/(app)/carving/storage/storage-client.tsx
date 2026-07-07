"use client";

// Main Storage client (Daksh June 2026 — unified carving + dispatch storage).
// Park-all cards (one per kind) + a searchable, collapsible per-temple list of
// parked slabs with multi-select / per-temple / per-slab bring-back.
// Bring-back is now TWO-ENDED (Daksh Jul 2026): a destination chooser lets you
// return each slab to EITHER list — Carving Unassigned (→ cut_done) or Make
// Dispatch (→ completed) — not just its own kind. Default keeps each slab in
// its own list. bringBackStorageSlabsAction flips status + un-parks in one go.

import { useMemo, useState, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { parkAllUnassignedAction, bringBackStorageSlabsAction } from "../actions";
import { parkAllReadyDispatchAction } from "../../dispatch/actions";

export type ParkedSlab = {
  id: string; label: string; temple: string; stone: string | null;
  l: number; w: number; t: number; parkedAt: string | null;
  /** carving = parked cut-done (→ Carving); dispatch = parked ready (→ Make Dispatch). */
  kind: "carving" | "dispatch";
};

const calcCft = (l: number, w: number, t: number) => (l * w * t) / 1728;

export function StorageClient({
  parked,
  unassignedCount,
  readyCount,
  canCarving,
  canDispatch,
}: {
  parked: ParkedSlab[];
  unassignedCount: number;
  readyCount: number;
  canCarving: boolean;
  canDispatch: boolean;
}) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [confirmPark, setConfirmPark] = useState<null | "carving" | "dispatch">(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  // Where "Bring back" sends slabs: "same" = each to its own list (default);
  // "carving"/"dispatch" force ALL brought-back slabs into that one list.
  const [dest, setDest] = useState<"same" | "carving" | "dispatch">("same");

  // id → kind, so bring-back can route each slab to the right action.
  const kindById = useMemo(() => {
    const m = new Map<string, ParkedSlab["kind"]>();
    for (const s of parked) m.set(s.id, s.kind);
    return m;
  }, [parked]);

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

  // Collapsible temple groups — default collapsed; a live search auto-expands.
  const [open, setOpen] = useState<Set<string>>(new Set());
  function toggleOpen(temple: string) {
    setOpen((prev) => { const n = new Set(prev); n.has(temple) ? n.delete(temple) : n.add(temple); return n; });
  }

  function toggle(id: string) {
    const k = kindById.get(id);
    if (k && !canBringBack(k)) return; // not returnable to the chosen destination
    setSelected((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }
  function toggleTemple(slabs: ParkedSlab[]) {
    const allOn = slabs.every((s) => selected.has(s.id));
    setSelected((prev) => { const n = new Set(prev); for (const s of slabs) allOn ? n.delete(s.id) : n.add(s.id); return n; });
  }

  async function parkAll(kind: "carving" | "dispatch") {
    if (busy) return;
    setBusy(true); setErr(null); setMsg(null);
    try {
      const res = kind === "carving" ? await parkAllUnassignedAction() : await parkAllReadyDispatchAction();
      if (!res.ok) setErr(res.error);
      else {
        const where = kind === "carving" ? "Carving Unassigned is now 0." : "Make Dispatch is now clear.";
        setMsg(`Moved ${res.count} slab${res.count === 1 ? "" : "s"} to storage. ${where}`);
        router.refresh();
      }
    } catch { setErr("Failed — check your connection."); }
    finally { setBusy(false); setConfirmPark(null); }
  }

  // Which kind the current viewer may return in "same" mode: CUT-DONE (carving)
  // needs canCarving, READY (dispatch) needs canDispatch.
  function canManageKind(kind: ParkedSlab["kind"]) {
    return kind === "carving" ? canCarving : canDispatch;
  }
  // Destination-aware gate driving row controls + the filter inside bringBack:
  //  • "carving"  → any slab, needs carving rights   • "dispatch" → any slab, needs dispatch rights
  //  • "same"     → the slab's own kind's permission.
  function canBringBack(kind: ParkedSlab["kind"]) {
    if (dest === "carving") return canCarving;
    if (dest === "dispatch") return canDispatch;
    return canManageKind(kind);
  }

  const destLabel = dest === "carving" ? "Carving Unassigned" : dest === "dispatch" ? "Make Dispatch" : "their own lists";

  async function bringBack(ids: string[]) {
    if (busy || ids.length === 0) return;
    // Resolve each id to a concrete destination list + only keep ids this viewer
    // may actually send there. "same" routes by kind; a forced dest sends all.
    let batches: Array<{ to: "carving" | "dispatch"; ids: string[] }>;
    if (dest === "same") {
      const carv = ids.filter((id) => kindById.get(id) === "carving" && canCarving);
      const disp = ids.filter((id) => kindById.get(id) === "dispatch" && canDispatch);
      batches = [{ to: "carving" as const, ids: carv }, { to: "dispatch" as const, ids: disp }].filter((b) => b.ids.length);
    } else {
      const ok = dest === "carving" ? canCarving : canDispatch;
      batches = ok ? [{ to: dest, ids }] : [];
    }
    const attempt = batches.reduce((a, b) => a + b.ids.length, 0);
    const skipped = ids.length - attempt;
    if (attempt === 0) { setErr("You don't have permission to send these slabs there."); return; }
    const confirmMsg = `Bring ${attempt} slab${attempt === 1 ? "" : "s"} back to ${destLabel}?`;
    if (!window.confirm(confirmMsg)) return;
    setBusy(true); setErr(null); setMsg(null);
    try {
      // Independent, non-transactional per-destination calls — handle partials.
      const results = await Promise.all(batches.map((b) => bringBackStorageSlabsAction(b.ids, b.to)));
      const okCount = results.reduce((a, r) => a + (r.ok ? r.count : 0), 0);
      const failed = results.find((r) => !r.ok) as { ok: false; error: string } | undefined;
      // Clear only the ids whose call succeeded; keep failed ones selected for a retry.
      setSelected((prev) => {
        const n = new Set(prev);
        batches.forEach((b, i) => { if (results[i].ok) for (const id of b.ids) n.delete(id); });
        return n;
      });
      if (okCount > 0) setMsg(`Brought ${okCount} slab${okCount === 1 ? "" : "s"} back to ${destLabel}.`);
      if (failed) setErr(failed.error);
      else if (skipped > 0) setErr(`${skipped} slab${skipped === 1 ? "" : "s"} skipped — no permission for that list.`);
      router.refresh();
    } catch { setErr("Failed — check your connection."); }
    finally { setBusy(false); }
  }

  const btn = (bg: string): CSSProperties => ({ padding: "9px 16px", fontSize: 13.5, fontWeight: 800, color: "#fff", background: bg, border: "none", borderRadius: 9, cursor: busy ? "wait" : "pointer", opacity: busy ? 0.7 : 1, whiteSpace: "nowrap" });

  // One "move all → storage" card per kind the user can manage.
  function ParkAllCard({ kind, count, listLabel }: { kind: "carving" | "dispatch"; count: number; listLabel: string }) {
    return (
      <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: "14px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 800 }}>{listLabel}: <span style={{ color: count > 0 ? "#b45309" : "#15803d" }}>{count}</span></div>
          <div className="muted" style={{ fontSize: 12.5, marginTop: 2 }}>Move the whole {kind === "carving" ? "backlog" : "ready list"} into storage in one click, then bring back only the few you need.</div>
        </div>
        {confirmPark === kind ? (
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontSize: 12.5, fontWeight: 700 }}>Move all {count}?</span>
            <button type="button" disabled={busy} onClick={() => parkAll(kind)} style={btn("#b45309")}>{busy ? "Moving…" : "Yes, move all"}</button>
            <button type="button" disabled={busy} onClick={() => setConfirmPark(null)} className="ghost-button">Cancel</button>
          </div>
        ) : (
          <button type="button" disabled={busy || count === 0} onClick={() => setConfirmPark(kind)} style={{ ...btn("#b45309"), opacity: count === 0 ? 0.5 : 1, cursor: count === 0 ? "not-allowed" : "pointer" }}>
            🗄 Move all {count} {kind === "carving" ? "unassigned" : "ready"} → storage
          </button>
        )}
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {/* Park-all cards — one per kind the user is allowed to manage. */}
      {canCarving && <ParkAllCard kind="carving" count={unassignedCount} listLabel="Carving Unassigned" />}
      {canDispatch && <ParkAllCard kind="dispatch" count={readyCount} listLabel="In Make Dispatch" />}

      {msg && <div style={{ fontSize: 13, fontWeight: 700, color: "#15803d", background: "rgba(22,163,74,0.08)", border: "1px solid rgba(22,163,74,0.3)", borderRadius: 10, padding: "9px 13px" }}>✓ {msg}</div>}
      {err && <div style={{ fontSize: 13, fontWeight: 700, color: "#991b1b" }}>⚠ {err}</div>}

      {/* Bring-back destination chooser (two-ended storage). */}
      {parked.length > 0 && (
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, padding: "8px 12px" }}>
          <span style={{ fontSize: 12.5, fontWeight: 800 }}>↩ Bring back to:</span>
          <div style={{ display: "inline-flex", border: "1px solid var(--border)", borderRadius: 9, overflow: "hidden" }}>
            {([
              { key: "same", label: "🏠 Its own list", on: true },
              { key: "carving", label: "🪚 Carving", on: canCarving },
              { key: "dispatch", label: "🚚 Dispatch", on: canDispatch },
            ] as const).map((opt) => (
              <button
                key={opt.key}
                type="button"
                disabled={!opt.on}
                onClick={() => { setDest(opt.key); setSelected(new Set()); }}
                title={opt.on ? undefined : "You don't manage that list"}
                style={{ padding: "6px 13px", fontSize: 12.5, fontWeight: 700, border: "none", borderLeft: opt.key !== "same" ? "1px solid var(--border)" : "none", cursor: opt.on ? "pointer" : "not-allowed", background: dest === opt.key ? "var(--gold-dark)" : "transparent", color: dest === opt.key ? "#fff" : opt.on ? "var(--text)" : "var(--muted)", opacity: opt.on ? 1 : 0.5 }}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <span style={{ fontSize: 11.5, color: "var(--muted)" }}>
            {dest === "same"
              ? "Cut-done → Carving Unassigned · Ready → Make Dispatch (each to where it came from)."
              : dest === "carving"
                ? "Every slab you bring back becomes cut-done in Carving Unassigned — ready to assign."
                : "Every slab you bring back becomes ready in Make Dispatch."}
          </span>
        </div>
      )}

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
        <div className="banner">Storage is empty. Use the “Move all → storage” cards above, or send selected slabs from the carving / dispatch pickers.</div>
      ) : filtered.length === 0 ? (
        <div className="muted" style={{ fontSize: 13 }}>No parked slabs match “{q}”.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {groups.map(([temple, slabs]) => {
            // Only slabs this viewer can return to the CHOSEN destination take
            // part in select-all / bring-all.
            const manageable = slabs.filter((s) => canBringBack(s.kind));
            const allOn = manageable.length > 0 && manageable.every((s) => selected.has(s.id));
            const expanded = q.trim() !== "" || open.has(temple);
            return (
              <div key={temple} style={{ border: "1px solid var(--border)", borderRadius: 12, background: "var(--surface)", overflow: "hidden" }}>
                <div style={{ padding: "10px 14px", borderBottom: expanded ? "1px solid var(--border)" : "none", display: "flex", alignItems: "center", gap: 10, background: "var(--surface-alt, rgba(0,0,0,0.02))" }}>
                  <input type="checkbox" checked={allOn} disabled={manageable.length === 0} onChange={() => toggleTemple(manageable)} onClick={(e) => e.stopPropagation()} style={{ width: 16, height: 16, cursor: manageable.length === 0 ? "not-allowed" : "pointer", opacity: manageable.length === 0 ? 0.4 : 1, flexShrink: 0 }} title="Select all in this temple" />
                  <button type="button" onClick={() => toggleOpen(temple)} style={{ display: "flex", alignItems: "center", gap: 8, background: "none", border: "none", cursor: "pointer", flex: 1, textAlign: "left", color: "var(--text)", fontWeight: 800, fontSize: 14, minWidth: 0 }}>
                    <span style={{ color: "var(--muted)", fontSize: 12, width: 12 }}>{expanded ? "▾" : "▸"}</span>
                    🏛 <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{temple}</span>
                    <span className="muted" style={{ fontWeight: 600, fontSize: 12 }}>· {slabs.length}</span>
                  </button>
                  {manageable.length > 0 && (
                    <button type="button" disabled={busy} onClick={() => bringBack(manageable.map((s) => s.id))} style={{ fontSize: 11.5, fontWeight: 700, color: "#15803d", background: "none", border: "1px solid rgba(22,163,74,0.4)", borderRadius: 6, padding: "3px 9px", cursor: "pointer", whiteSpace: "nowrap", flexShrink: 0 }}>↩ Bring all back</button>
                  )}
                </div>
                {expanded && (
                <div style={{ padding: 12, display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))", gap: 8 }}>
                  {slabs.map((s) => {
                    const on = selected.has(s.id);
                    // Read-only when this slab can't go to the chosen destination.
                    const canMng = canBringBack(s.kind);
                    return (
                      <div key={s.id} onClick={canMng ? () => toggle(s.id) : undefined} style={{ border: `1.5px solid ${on ? "var(--gold-dark)" : "var(--border)"}`, background: on ? "rgba(184,115,51,0.06)" : "var(--bg)", borderRadius: 10, padding: "8px 10px", cursor: canMng ? "pointer" : "default", opacity: canMng ? 1 : 0.6, display: "flex", flexDirection: "column", gap: 3 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          {canMng ? (
                            <input type="checkbox" checked={on} onChange={() => toggle(s.id)} onClick={(e) => e.stopPropagation()} style={{ width: 15, height: 15, cursor: "pointer" }} />
                          ) : (
                            <span title={`Only ${s.kind === "carving" ? "carving" : "dispatch"} roles can return these`} style={{ fontSize: 12, flexShrink: 0 }}>🔒</span>
                          )}
                          <code style={{ fontFamily: "ui-monospace, monospace", fontWeight: 800, fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.id}</code>
                          {/* Kind tag — the slab's current home (where it was parked from). */}
                          <span title={s.kind === "carving" ? "Cut-done slab — parked from Carving" : "Ready slab — parked from Make Dispatch"} style={{ marginLeft: "auto", flexShrink: 0, fontSize: 8.5, fontWeight: 800, letterSpacing: "0.03em", color: "#fff", background: s.kind === "carving" ? "#7c3aed" : "#2563eb", borderRadius: 4, padding: "1px 5px" }}>
                            {s.kind === "carving" ? "CUT-DONE" : "READY"}
                          </span>
                        </div>
                        <div style={{ fontSize: 11.5, color: "var(--muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.label || "—"}</div>
                        <div style={{ fontFamily: "ui-monospace, monospace", fontSize: 11, color: "var(--text)" }}>{s.l}&quot;×{s.w}&quot;×{s.t}&quot; · {calcCft(s.l, s.w, s.t).toFixed(2)} CFT</div>
                        {canMng && (
                          <button type="button" disabled={busy} onClick={(e) => { e.stopPropagation(); bringBack([s.id]); }} style={{ alignSelf: "flex-start", fontSize: 11, fontWeight: 700, color: "#15803d", background: "none", border: "1px solid rgba(22,163,74,0.4)", borderRadius: 6, padding: "2px 8px", cursor: "pointer" }}>↩ Bring back</button>
                        )}
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
