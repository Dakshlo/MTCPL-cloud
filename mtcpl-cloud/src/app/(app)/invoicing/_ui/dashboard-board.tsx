"use client";

/**
 * DashboardBoard (Daksh) — the Invoicing dashboard body. Shows EVERY challan
 * temple-wise (collapsible sections + cards, same look as the Challans page),
 * each tagged with its stage: a plain challan (open / under-review / rejected),
 * an Invoice (owner-approved), In bulk (parked), or Bulk invoice (on a bulk
 * invoice). Read-only overview — each card links to the relevant page. Includes
 * a search bar (temple / challan no. / slab code).
 */

import { useMemo, useState } from "react";
import Link from "next/link";

export type DashStatus = "open" | "pending_approval" | "rejected" | "invoiced" | "cancelled" | "in_bulk" | "bulk_invoiced";
export type DashCard = { id: string; code: string; date: string; status: DashStatus; href: string; search: string };
export type DashGroup = { temple: string; rows: DashCard[] };

const META: Record<DashStatus, { label: string; bg: string; fg: string; dot: string }> = {
  open: { label: "Open", bg: "#eef2ff", fg: "#4338ca", dot: "#6366f1" },
  pending_approval: { label: "Under review", bg: "#fef3c7", fg: "#92400e", dot: "#f59e0b" },
  rejected: { label: "Rejected", bg: "#fee2e2", fg: "#991b1b", dot: "#ef4444" },
  invoiced: { label: "Invoice", bg: "#d1fae5", fg: "#065f46", dot: "#10b981" },
  cancelled: { label: "Cancelled", bg: "#f1f5f9", fg: "#475569", dot: "#94a3b8" },
  in_bulk: { label: "In bulk", bg: "rgba(245,158,11,0.16)", fg: "#92400e", dot: "#f59e0b" },
  bulk_invoiced: { label: "Bulk invoice", bg: "#ede9fe", fg: "#5b21b6", dot: "#8b5cf6" },
};

function templeHue(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
  return h;
}

export function DashboardBoard({ groups, total }: { groups: DashGroup[]; total: number }) {
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [allExpanded, setAllExpanded] = useState(false);

  const q = query.trim().toLowerCase();
  const searchActive = q.length > 0;

  const filtered = useMemo(() => {
    const out: DashGroup[] = [];
    for (const g of groups) {
      const rows = searchActive ? g.rows.filter((r) => r.search.includes(q)) : g.rows;
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
        .dsh-card { transition: transform .12s ease, box-shadow .12s ease; }
        .dsh-card:hover { transform: translateY(-2px); box-shadow: 0 10px 24px rgba(15,23,42,0.12); }
        .dsh-temple { transition: background .12s ease; }
        .dsh-temple:hover { background: var(--bg); }
        @keyframes dshLift { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
      `}</style>

      {/* Search bar */}
      <div style={{ position: "relative", marginBottom: 14, maxWidth: 520 }}>
        <span style={{ position: "absolute", left: 13, top: "50%", transform: "translateY(-50%)", fontSize: 15, opacity: 0.55, pointerEvents: "none" }}>🔍</span>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search temple, challan no., or slab code…"
          style={{ width: "100%", padding: "11px 38px 11px 38px", borderRadius: 11, border: "1px solid var(--border)", background: "var(--surface, #fff)", color: "var(--text)", fontSize: 14 }}
        />
        {query && (
          <button type="button" onClick={() => setQuery("")} style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", border: "none", background: "transparent", color: "var(--muted)", cursor: "pointer", fontSize: 16, fontWeight: 700, lineHeight: 1, padding: 6 }}>✕</button>
        )}
      </div>

      {/* Count + expand/collapse all */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 10 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
          {searchActive ? <>Results <span style={{ color: "var(--text)" }}>· {shown}</span></> : <>All challans <span style={{ color: "var(--text)" }}>· {total}</span></>}
        </div>
        {!searchActive && filtered.length > 0 && (
          <button type="button" onClick={() => { setAllExpanded((v) => !v); setExpanded({}); }} style={{ fontSize: 12, fontWeight: 700, color: "var(--gold-dark)", background: "transparent", border: "none", cursor: "pointer" }}>
            {allExpanded ? "⊖ Collapse all" : "⊕ Expand all"}
          </button>
        )}
      </div>

      {filtered.length === 0 ? (
        <div style={{ background: "var(--surface)", border: "1px dashed var(--border)", borderRadius: 12, padding: "30px 22px", textAlign: "center", color: "var(--muted)" }}>
          {searchActive ? <>No challans match <strong>“{query}”</strong>.</> : <>No challans yet. <Link href="/invoicing/challans/new" style={{ color: "var(--gold-dark)", fontWeight: 700 }}>Create one</Link>.</>}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {filtered.map((g) => {
            const open = isExpanded(g.temple);
            const hue = templeHue(g.temple);
            return (
              <div key={g.temple} style={{ border: "1px solid var(--border)", borderRadius: 14, overflow: "hidden", background: "var(--surface, #fff)" }}>
                <button type="button" className="dsh-temple" onClick={() => toggle(g.temple)} style={{ width: "100%", display: "flex", alignItems: "center", gap: 11, padding: "12px 14px", border: "none", background: "var(--bg)", cursor: "pointer", textAlign: "left" }}>
                  <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 30, height: 30, borderRadius: 9, flexShrink: 0, fontSize: 13, fontWeight: 800, color: "#fff", background: `hsl(${hue} 55% 45%)` }}>
                    {g.temple.replace(/[^A-Za-z]/g, "").slice(0, 2).toUpperCase() || "🛕"}
                  </span>
                  <span style={{ fontWeight: 800, fontSize: 14, color: "var(--text)", flex: 1, minWidth: 0 }}>{g.temple}</span>
                  <span style={{ fontSize: 12, fontWeight: 700, color: "var(--muted)", background: "var(--surface, #fff)", border: "1px solid var(--border)", borderRadius: 999, padding: "2px 10px" }}>{g.rows.length}</span>
                  <span style={{ fontSize: 12, color: "var(--muted)", transform: open ? "rotate(180deg)" : "none", transition: "transform 0.15s" }}>▾</span>
                </button>
                {open && (
                  <div style={{ padding: 14, display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(248px, 1fr))", gap: 12 }}>
                    {g.rows.map((c) => {
                      const m = META[c.status];
                      return (
                        <Link key={c.id} href={c.href} className="dsh-card" style={{ border: "1px solid var(--border)", borderLeft: `4px solid ${m.dot}`, borderRadius: 12, background: "var(--surface, #fff)", padding: "12px 13px 13px", display: "flex", flexDirection: "column", gap: 8, textDecoration: "none", color: "var(--text)", animation: "dshLift 0.18s ease" }}>
                          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
                            <span style={{ fontFamily: "ui-monospace, monospace", fontWeight: 800, fontSize: 15, letterSpacing: "-0.01em" }}>{c.code}</span>
                            <span style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "3px 10px 3px 8px", borderRadius: 999, background: m.bg, color: m.fg, fontSize: 11, fontWeight: 700, whiteSpace: "nowrap" }}>
                              <span style={{ width: 6, height: 6, borderRadius: "50%", background: m.dot }} />
                              {m.label}
                            </span>
                          </div>
                          <div style={{ fontSize: 12, color: "var(--muted)", display: "inline-flex", alignItems: "center", gap: 5 }}>
                            <span style={{ opacity: 0.7 }}>📅</span>
                            {new Date(`${c.date}T00:00:00+05:30`).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric" })}
                          </div>
                        </Link>
                      );
                    })}
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
