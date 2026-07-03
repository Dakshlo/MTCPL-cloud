"use client";

/**
 * BulkBoard (Daksh, Jul 2026 — tabs removed). Transport is now filled on the
 * full-page "Prepare work order challan" step BEFORE a challan lands here, so
 * everything in the bulk pool is already a FINAL work order challan. One flat,
 * temple-grouped list (search + collapsible sections). Each card: 🖨 Download
 * challan + Send back. A legacy challan that predates the prepare flow (no
 * transport yet) shows a "Finish setup" link back to the prepare page.
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { BulkSendBack } from "./bulk-send-back";

export type BulkCard = {
  id: string; code: string; date: string; sourceDispatchId: string | null; search: string;
  ready: boolean;
  transport: { company: string; phone: string; lr: string; vehicle: string; driver: string; driverPhone: string };
};
export type BulkGroup = { temple: string; rows: BulkCard[] };

function templeHue(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
  return h;
}

export function BulkBoard({ groups }: { groups: BulkGroup[] }) {
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [allExpanded, setAllExpanded] = useState(false);

  const q = query.trim().toLowerCase();
  const searchActive = q.length > 0;

  const total = useMemo(() => groups.reduce((n, g) => n + g.rows.length, 0), [groups]);

  const filtered = useMemo(() => {
    const out: BulkGroup[] = [];
    for (const g of groups) {
      const rows = g.rows.filter((r) => !searchActive || r.search.includes(q));
      if (rows.length) out.push({ temple: g.temple, rows });
    }
    return out;
  }, [groups, q, searchActive]);
  const shown = filtered.reduce((n, g) => n + g.rows.length, 0);

  const isExpanded = (t: string) => searchActive || (expanded[t] ?? allExpanded);
  const toggle = (t: string) => setExpanded((p) => ({ ...p, [t]: !(p[t] ?? allExpanded) }));

  return (
    <>
      <style>{`
        .blk-card { transition: transform .12s ease, box-shadow .12s ease; }
        .blk-card:hover { transform: translateY(-2px); box-shadow: 0 10px 24px rgba(15,23,42,0.12); }
        .blk-temple { transition: background .12s ease; }
        .blk-temple:hover { background: var(--bg); }
        @keyframes blkLift { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
      `}</style>

      {/* Search bar */}
      <div style={{ position: "relative", marginBottom: 14, maxWidth: 520 }}>
        <span style={{ position: "absolute", left: 13, top: "50%", transform: "translateY(-50%)", fontSize: 15, opacity: 0.55, pointerEvents: "none" }}>🔍</span>
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search temple, challan no., or slab code…" style={{ width: "100%", padding: "11px 38px 11px 38px", borderRadius: 11, border: "1px solid var(--border)", background: "var(--surface, #fff)", color: "var(--text)", fontSize: 14 }} />
        {query && <button type="button" onClick={() => setQuery("")} style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", border: "none", background: "transparent", color: "var(--muted)", cursor: "pointer", fontSize: 16, fontWeight: 700, lineHeight: 1, padding: 6 }}>✕</button>}
      </div>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 10 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
          {searchActive ? <>Results <span style={{ color: "var(--text)" }}>· {shown}</span></> : <>Work order challans <span style={{ color: "var(--text)" }}>· {total}</span></>}
        </div>
        {!searchActive && filtered.length > 0 && (
          <button type="button" onClick={() => { setAllExpanded((v) => !v); setExpanded({}); }} style={{ fontSize: 12, fontWeight: 700, color: "var(--gold-dark)", background: "transparent", border: "none", cursor: "pointer" }}>
            {allExpanded ? "⊖ Collapse all" : "⊕ Expand all"}
          </button>
        )}
      </div>

      {filtered.length === 0 ? (
        <div style={{ background: "var(--surface)", border: "1px dashed var(--border)", borderRadius: 12, padding: "30px 22px", textAlign: "center", color: "var(--muted)" }}>
          {searchActive ? <>No challans match <strong>“{query}”</strong>.</>
            : <>No work order challans yet. Drag a challan onto <strong>Bulk</strong> from the <Link href="/invoicing/challans" style={{ color: "var(--gold-dark)", fontWeight: 700 }}>Challans</Link> page.</>}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {filtered.map((g) => {
            const open = isExpanded(g.temple);
            const hue = templeHue(g.temple);
            return (
              <div key={g.temple} style={{ border: "1px solid var(--border)", borderRadius: 14, overflow: "hidden", background: "var(--surface, #fff)" }}>
                <button type="button" className="blk-temple" onClick={() => toggle(g.temple)} style={{ width: "100%", display: "flex", alignItems: "center", gap: 11, padding: "12px 14px", border: "none", background: "var(--bg)", cursor: "pointer", textAlign: "left" }}>
                  <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 30, height: 30, borderRadius: 9, flexShrink: 0, fontSize: 13, fontWeight: 800, color: "#fff", background: `hsl(${hue} 55% 45%)` }}>
                    {g.temple.replace(/[^A-Za-z]/g, "").slice(0, 2).toUpperCase() || "🛕"}
                  </span>
                  <span style={{ fontWeight: 800, fontSize: 14, color: "var(--text)", flex: 1, minWidth: 0 }}>{g.temple}</span>
                  <span style={{ fontSize: 12, fontWeight: 700, color: "var(--muted)", background: "var(--surface, #fff)", border: "1px solid var(--border)", borderRadius: 999, padding: "2px 10px" }}>{g.rows.length}</span>
                  <span style={{ fontSize: 12, color: "var(--muted)", transform: open ? "rotate(180deg)" : "none", transition: "transform 0.15s" }}>▾</span>
                </button>
                {open && (
                  <div style={{ padding: 14, display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(262px, 1fr))", gap: 12 }}>
                    {g.rows.map((c) => (
                      <div key={c.id} className="blk-card" style={{ border: "1px solid var(--border)", borderLeft: `4px solid ${c.ready ? "#15803d" : "#f59e0b"}`, borderRadius: 12, background: "var(--surface, #fff)", padding: "12px 13px 13px", display: "flex", flexDirection: "column", gap: 9, animation: "blkLift 0.18s ease" }}>
                        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
                          <Link href={`/invoicing/challans/${c.id}`} style={{ fontFamily: "ui-monospace, monospace", fontWeight: 800, fontSize: 15, color: "var(--text)", textDecoration: "none", letterSpacing: "-0.01em" }}>{c.code}</Link>
                          {c.ready
                            ? <span style={{ fontSize: 10.5, fontWeight: 800, color: "#15803d", background: "rgba(22,101,52,0.12)", borderRadius: 999, padding: "3px 9px", whiteSpace: "nowrap" }}>✅ Ready</span>
                            : <span style={{ fontSize: 10.5, fontWeight: 800, color: "#92400e", background: "rgba(245,158,11,0.16)", borderRadius: 999, padding: "3px 9px", whiteSpace: "nowrap" }}>⚙ Setup</span>}
                        </div>
                        <div style={{ fontSize: 12, color: "var(--muted)", display: "inline-flex", alignItems: "center", gap: 5 }}>
                          <span style={{ opacity: 0.7 }}>📅</span>
                          {new Date(`${c.date}T00:00:00+05:30`).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric" })}
                        </div>
                        {c.ready && (c.transport.company || c.transport.lr) && (
                          <div style={{ fontSize: 11, color: "var(--muted)" }}>🚚 {[c.transport.company, c.transport.lr ? `LR ${c.transport.lr}` : ""].filter(Boolean).join(" · ")}</div>
                        )}
                        <div style={{ marginTop: "auto", paddingTop: 4, display: "flex", gap: 7, flexWrap: "wrap" }}>
                          {c.ready ? (
                            c.sourceDispatchId && <Link href={`/dispatch/${c.sourceDispatchId}/print`} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12, fontWeight: 700, padding: "8px 12px", border: "1px solid var(--gold-dark)", borderRadius: 8, background: "var(--gold)", color: "#fff", textDecoration: "none" }}>🖨 Download challan</Link>
                          ) : (
                            <Link href={`/invoicing/bulk/prepare/${c.id}`} style={{ fontSize: 12, fontWeight: 800, padding: "8px 12px", border: "none", borderRadius: 8, background: "#0f172a", color: "#fff", textDecoration: "none" }}>⚙ Finish setup</Link>
                          )}
                          <BulkSendBack id={c.id} code={c.code} />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
