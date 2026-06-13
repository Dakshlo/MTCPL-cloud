"use client";

import { useMemo, useState, useTransition, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import type { SiteSlab, SiteTruck, Yard } from "../../site-lib";
import { createSiteYardAction, unloadTruckAction, transferSlabYardAction } from "../../actions";

const peekOverlay: CSSProperties = {
  position: "fixed", inset: 0, zIndex: 1500, background: "rgba(15,12,6,0.6)",
  backdropFilter: "blur(3px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 14,
};
const peekPanel: CSSProperties = {
  width: "100%", maxWidth: 460, background: "var(--surface)", border: "1px solid var(--border)",
  borderRadius: 16, boxShadow: "0 24px 80px rgba(0,0,0,0.5)", display: "flex", flexDirection: "column", overflow: "hidden",
};

function matchSlab(s: SiteSlab, q: string): boolean {
  const query = q.trim().toLowerCase();
  if (!query) return true;
  const dim = `${s.l}x${s.w}x${s.t}`;
  const hay = `${s.id} ${s.label ?? ""} ${s.description ?? ""} ${s.stone ?? ""} ${s.yardName ?? ""} ${dim}`.toLowerCase();
  return query.split(/\s+/).every((tok) => hay.includes(tok.replace(/[×x*]/g, "x")));
}

// ── Yard picker — choose an existing yard or create a new one. ───────────
function YardPicker({
  temple, yards, title, subtitle, confirmLabel, onPick, onClose,
}: {
  temple: string;
  yards: Yard[];
  title: string;
  subtitle: string;
  confirmLabel: string;
  onPick: (yardId: string) => Promise<{ ok: boolean; error?: string }>;
  onClose: () => void;
}) {
  const router = useRouter();
  const [picked, setPicked] = useState<string>("");
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, startBusy] = useTransition();
  const [localYards, setLocalYards] = useState<Yard[]>(yards);

  function createYard() {
    const name = newName.trim();
    if (!name || busy) return;
    setErr(null);
    const fd = new FormData();
    fd.set("temple", temple);
    fd.set("name", name);
    startBusy(async () => {
      const res = await createSiteYardAction(fd);
      if (!res.ok) { setErr(res.error); return; }
      setLocalYards((prev) => [...prev, { id: res.id, name }].sort((a, b) => a.name.localeCompare(b.name)));
      setPicked(res.id);
      setNewName("");
      setCreating(false);
      router.refresh();
    });
  }

  function confirm() {
    if (!picked || busy) return;
    setErr(null);
    startBusy(async () => {
      const res = await onPick(picked);
      if (!res.ok) { setErr(res.error ?? "Failed."); return; }
      router.refresh();
      onClose();
    });
  }

  return (
    <div style={peekOverlay} onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div style={peekPanel} role="dialog" aria-modal="true" aria-label={title}>
        <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border)", display: "flex", gap: 12 }}>
          <div>
            <div style={{ fontSize: 17, fontWeight: 800 }}>{title}</div>
            <div className="muted" style={{ fontSize: 12.5, marginTop: 2 }}>{subtitle}</div>
          </div>
          <button type="button" onClick={onClose} disabled={busy} aria-label="Close" style={{ marginLeft: "auto", background: "none", border: "none", fontSize: 22, cursor: "pointer", color: "var(--muted)" }}>×</button>
        </div>

        <div style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ fontSize: 11, fontWeight: 800, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.06em" }}>📍 Pick a yard</div>
          {localYards.length === 0 ? (
            <div className="muted" style={{ fontSize: 13 }}>No yards yet — create one below.</div>
          ) : (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {localYards.map((y) => (
                <button
                  key={y.id}
                  type="button"
                  onClick={() => setPicked(y.id)}
                  style={{
                    fontSize: 13.5, fontWeight: 800, padding: "9px 15px", borderRadius: 999, cursor: "pointer",
                    border: `2px solid ${picked === y.id ? "var(--gold-dark)" : "var(--border)"}`,
                    background: picked === y.id ? "rgba(184,115,51,0.1)" : "var(--bg)", color: "var(--text)",
                  }}
                >
                  {picked === y.id ? "✓ " : "📍 "}{y.name}
                </button>
              ))}
            </div>
          )}

          {creating ? (
            <div style={{ display: "flex", gap: 8 }}>
              <input
                autoFocus
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") createYard(); }}
                placeholder="New yard name (e.g. Front gate, Yard B)"
                style={{ flex: 1, padding: "10px 12px", fontSize: 14, border: "1.5px solid var(--border)", borderRadius: 10, background: "var(--bg)", color: "var(--text)" }}
              />
              <button type="button" onClick={createYard} disabled={busy || !newName.trim()} className="primary-button" style={{ fontSize: 13 }}>
                {busy ? "…" : "Create"}
              </button>
            </div>
          ) : (
            <button type="button" onClick={() => setCreating(true)} style={{ alignSelf: "flex-start", fontSize: 13, fontWeight: 700, padding: "8px 14px", borderRadius: 10, border: "1.5px dashed var(--gold-dark)", background: "transparent", color: "var(--gold-dark)", cursor: "pointer" }}>
              ＋ Create new yard
            </button>
          )}

          {err && <div style={{ fontSize: 13, color: "#b91c1c", fontWeight: 700 }}>⚠ {err}</div>}

          <div style={{ display: "flex", gap: 8, marginTop: 2 }}>
            <button type="button" onClick={confirm} disabled={busy || !picked} className="primary-button" style={{ flex: 1, fontSize: 14, padding: "11px 12px", opacity: !picked ? 0.5 : 1 }}>
              {busy ? "Working…" : confirmLabel}
            </button>
            <button type="button" className="ghost-button" onClick={onClose} disabled={busy}>Cancel</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Stock slab card ──────────────────────────────────────────────────────
function StockCard({ s, onMove }: { s: SiteSlab; onMove: () => void }) {
  return (
    <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderLeft: "5px solid #0f766e", borderRadius: 12, padding: "10px 12px", display: "flex", flexDirection: "column", gap: 5 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
        <code style={{ fontFamily: "ui-monospace, monospace", fontWeight: 800, fontSize: 13 }}>{s.id}</code>
        {s.priority && <span title="Urgent">⚡</span>}
        <span style={{ marginLeft: "auto", fontSize: 10, fontWeight: 800, color: "#0f766e", background: "rgba(15,118,110,0.1)", borderRadius: 999, padding: "2px 9px" }}>📍 {s.yardName}</span>
      </div>
      {(s.label || s.description) && (
        <div style={{ fontSize: 12, lineHeight: 1.35 }}><strong>{s.label ?? ""}</strong>{s.description && <span className="muted">{s.label ? " · " : ""}{s.description}</span>}</div>
      )}
      <div style={{ fontFamily: "ui-monospace, monospace", fontSize: 11.5, color: "var(--text)" }}>
        {s.l}×{s.w}×{s.t} in · {s.cft.toFixed(2)} CFT
        {s.stone ? <span className="muted"> · {s.stone}</span> : null}
        {s.quality ? <span className="muted"> · {s.quality}</span> : null}
      </div>
      <button type="button" onClick={onMove} style={{ alignSelf: "flex-start", marginTop: 2, fontSize: 12, fontWeight: 700, padding: "6px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)", cursor: "pointer" }}>
        ↔ Move yard
      </button>
    </div>
  );
}

export function StockClient({
  temple, yards, toUnload, stock,
}: {
  temple: string;
  yards: Yard[];
  toUnload: SiteTruck[];
  stock: SiteSlab[];
}) {
  const [query, setQuery] = useState("");
  const [yardFilter, setYardFilter] = useState<string>(""); // "" = all
  const [unloadTruck, setUnloadTruck] = useState<SiteTruck | null>(null);
  const [moveSlab, setMoveSlab] = useState<SiteSlab | null>(null);

  const filtered = useMemo(
    () => stock.filter((s) => (!yardFilter || s.yardId === yardFilter) && matchSlab(s, query)),
    [stock, yardFilter, query],
  );

  // Group filtered stock by yard.
  const byYard = useMemo(() => {
    const map = new Map<string, { yardId: string | null; yardName: string; slabs: SiteSlab[] }>();
    for (const s of filtered) {
      const key = s.yardId ?? "—";
      if (!map.has(key)) map.set(key, { yardId: s.yardId, yardName: s.yardName ?? "—", slabs: [] });
      map.get(key)!.slabs.push(s);
    }
    return [...map.values()].sort((a, b) => a.yardName.localeCompare(b.yardName));
  }, [filtered]);

  const yardCount = (id: string) => stock.filter((s) => s.yardId === id).length;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* ── Trucks to unload ───────────────────────────────────────── */}
      {toUnload.length > 0 && (
        <div style={{ background: "rgba(180,83,9,0.05)", border: "1.5px solid rgba(180,83,9,0.35)", borderRadius: 14, padding: 14 }}>
          <div style={{ fontSize: 15, fontWeight: 800, color: "#92400e", marginBottom: 4 }}>
            🚚 {toUnload.length} truck{toUnload.length === 1 ? "" : "s"} to unload
          </div>
          <div className="muted" style={{ fontSize: 12.5, marginBottom: 10 }}>
            Delivered from Dispatch. Press <strong>Unload</strong> and choose a yard — sारी slab उस yard में चली जाएँगी।
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 10 }}>
            {toUnload.map((t) => (
              <div key={t.dispatchId} style={{ background: "var(--surface)", border: "1px solid rgba(180,83,9,0.3)", borderRadius: 12, padding: "12px 14px", display: "flex", flexDirection: "column", gap: 8 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <span style={{ fontFamily: "ui-monospace, monospace", fontWeight: 800, fontSize: 14.5 }}>🚛 {t.vehicleNo ?? "—"}</span>
                  {t.loadNumber != null && <span style={{ fontSize: 10.5, fontWeight: 800, color: "#92400e", background: "rgba(180,83,9,0.12)", borderRadius: 999, padding: "2px 8px" }}>Load {t.loadNumber}</span>}
                  <span className="muted" style={{ fontSize: 11.5 }}>{t.driverName ?? ""}</span>
                </div>
                <div style={{ fontSize: 12.5, fontWeight: 700 }}>{t.toUnload.length} slab{t.toUnload.length === 1 ? "" : "s"} to unload</div>
                <details>
                  <summary style={{ cursor: "pointer", fontSize: 11.5, color: "var(--muted)", userSelect: "none" }}>▸ show slabs</summary>
                  <div style={{ marginTop: 6, maxHeight: 150, overflowY: "auto", fontSize: 11.5, fontFamily: "ui-monospace, monospace", display: "flex", flexDirection: "column", gap: 2 }}>
                    {t.toUnload.map((s) => (
                      <div key={s.id} style={{ borderBottom: "1px dashed var(--border)", padding: "2px 0" }}>
                        <strong>{s.id}</strong>{s.label ? <span className="muted"> · {s.label}</span> : null} · {s.l}×{s.w}×{s.t}
                      </div>
                    ))}
                  </div>
                </details>
                <button
                  type="button"
                  onClick={() => setUnloadTruck(t)}
                  style={{ padding: "11px 12px", fontSize: 14, fontWeight: 800, color: "#fff", background: "#b45309", border: "none", borderRadius: 10, cursor: "pointer" }}
                >
                  📥 Unload into a yard
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Stock by yard ──────────────────────────────────────────── */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <div style={{ position: "relative", flex: "1 1 280px" }}>
          <span style={{ position: "absolute", left: 13, top: "50%", transform: "translateY(-50%)", fontSize: 14, opacity: 0.6 }}>🔍</span>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search stock — code / label / size / yard…"
            style={{ width: "100%", padding: "11px 14px 11px 38px", fontSize: 14, border: "1.5px solid var(--border)", borderRadius: 10, background: "var(--bg)", color: "var(--text)" }}
          />
        </div>
        <span className="muted" style={{ fontSize: 12.5, whiteSpace: "nowrap" }}>{filtered.length} of {stock.length} in stock</span>
      </div>

      {/* Yard filter chips */}
      {yards.length > 0 && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button type="button" onClick={() => setYardFilter("")} style={chip(yardFilter === "")}>All yards ({stock.length})</button>
          {yards.map((y) => (
            <button key={y.id} type="button" onClick={() => setYardFilter(y.id)} style={chip(yardFilter === y.id)}>
              📍 {y.name} ({yardCount(y.id)})
            </button>
          ))}
        </div>
      )}

      {filtered.length === 0 ? (
        <div className="muted" style={{ padding: "34px 16px", textAlign: "center", fontSize: 14, background: "var(--surface)", border: "1px dashed var(--border)", borderRadius: 12 }}>
          {stock.length === 0 ? "No stock yet — unload a delivered truck above to fill a yard." : `No stock matches “${query}”.`}
        </div>
      ) : (
        byYard.map((g) => (
          <div key={g.yardId ?? "—"} style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", background: "var(--bg)", borderBottom: "1px solid var(--border)" }}>
              <span style={{ fontSize: 15, fontWeight: 800 }}>📍 {g.yardName}</span>
              <span className="muted" style={{ fontSize: 12 }}>{g.slabs.length} slab{g.slabs.length === 1 ? "" : "s"}</span>
            </div>
            <div style={{ padding: "10px 12px", display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(230px, 1fr))", gap: 9 }}>
              {g.slabs.map((s) => <StockCard key={s.id} s={s} onMove={() => setMoveSlab(s)} />)}
            </div>
          </div>
        ))
      )}

      {/* Unload truck → yard */}
      {unloadTruck && (
        <YardPicker
          temple={temple}
          yards={yards}
          title={`📥 Unload ${unloadTruck.vehicleNo ?? "truck"}`}
          subtitle={`${unloadTruck.toUnload.length} slab(s) → choose a yard`}
          confirmLabel={`Unload ${unloadTruck.toUnload.length} slab${unloadTruck.toUnload.length === 1 ? "" : "s"} here`}
          onPick={async (yardId) => {
            const fd = new FormData();
            fd.set("dispatch_id", unloadTruck.dispatchId);
            fd.set("yard_id", yardId);
            const res = await unloadTruckAction(fd);
            return res.ok ? { ok: true } : { ok: false, error: res.error };
          }}
          onClose={() => setUnloadTruck(null)}
        />
      )}

      {/* Move slab → another yard */}
      {moveSlab && (
        <YardPicker
          temple={temple}
          yards={yards}
          title={`↔ Move ${moveSlab.id}`}
          subtitle={`Currently in ${moveSlab.yardName} — pick a new yard`}
          confirmLabel="Move slab here"
          onPick={async (yardId) => {
            const fd = new FormData();
            fd.set("slab_id", moveSlab.id);
            fd.set("yard_id", yardId);
            const res = await transferSlabYardAction(fd);
            return res.ok ? { ok: true } : { ok: false, error: res.error };
          }}
          onClose={() => setMoveSlab(null)}
        />
      )}
    </div>
  );
}

function chip(active: boolean): CSSProperties {
  return {
    fontSize: 12.5, fontWeight: 800, padding: "7px 13px", borderRadius: 999, cursor: "pointer",
    border: `1.5px solid ${active ? "var(--gold-dark)" : "var(--border)"}`,
    background: active ? "rgba(184,115,51,0.1)" : "var(--surface)", color: active ? "var(--gold-dark)" : "var(--text)",
  };
}
