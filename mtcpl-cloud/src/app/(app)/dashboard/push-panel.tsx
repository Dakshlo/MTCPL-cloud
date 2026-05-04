"use client";

import { useState, useMemo } from "react";
import { pushSlabAlertAction, clearSlabAlertAction } from "./actions";

type PushSlab = {
  id: string;
  label: string;
  temple: string;
  stone: string | null;
  status: string;
  priority: boolean;
  deadline: string | null;
  priority_note: string | null;
};

export function PushPanel({
  slabs,
  pushed,
  todayLabel,
  expandedByDefault = false,
}: {
  slabs: PushSlab[];
  pushed: boolean;
  todayLabel: string;
  /**
   * When true, skip the collapsed-3-rows view and render every
   * slab immediately. Used inside the dashboard's PeekSection
   * modal where the user has already explicitly opened the
   * panel — the extra "Show all N slabs" click is redundant
   * friction.
   */
  expandedByDefault?: boolean;
}) {
  const [q, setQ] = useState("");
  const [showAll, setShowAll] = useState(expandedByDefault);
  const COLLAPSED_COUNT = 3;

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return slabs;
    return slabs.filter(s =>
      s.id.toLowerCase().includes(term) ||
      s.temple.toLowerCase().includes(term) ||
      s.label.toLowerCase().includes(term) ||
      (s.stone ?? "").toLowerCase().includes(term)
    );
  }, [slabs, q]);

  // When searching, always show all matches. Otherwise collapse to COLLAPSED_COUNT.
  const isSearching = q.trim().length > 0;
  const visible = isSearching || showAll ? filtered : filtered.slice(0, COLLAPSED_COUNT);
  const hiddenCount = filtered.length - visible.length;

  return (
    <div style={{ background: "var(--surface)", border: "2px solid var(--gold-border)", borderRadius: 10, overflow: "hidden" }}>
      {/* Header */}
      <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border)", background: "var(--gold-subtle)", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 14, color: "var(--text)", display: "flex", alignItems: "center", gap: 8 }}>
            🔔 Push Urgent Alert to Workers
          </div>
          <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 3 }}>
            Mark a slab as urgent — workers will see a red highlight on their pages
          </div>
        </div>
        {pushed && (
          <span style={{ fontSize: 12, fontWeight: 600, color: "#16A34A", background: "rgba(22,163,74,0.1)", padding: "4px 12px", borderRadius: 20 }}>
            ✓ Alert pushed successfully
          </span>
        )}
      </div>

      {/* Live search */}
      <div style={{ padding: "10px 16px", borderBottom: "1px solid var(--border)", background: "var(--surface)" }}>
        <input
          type="search"
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder="Type to search by slab ID, temple, label or stone…"
          style={{
            width: "100%",
            fontSize: 12,
            padding: "7px 12px",
            border: "1px solid var(--border)",
            borderRadius: 6,
            background: "var(--bg)",
            color: "var(--text)",
            outline: "none",
            boxSizing: "border-box",
          }}
        />
        {q.trim() && (
          <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 5 }}>
            {filtered.length} of {slabs.length} slabs
          </div>
        )}
      </div>

      {/* Table */}
      {slabs.length === 0 ? (
        <div style={{ padding: 24, textAlign: "center", color: "var(--muted-light)", fontSize: 13 }}>
          No open or planned slabs to push alerts for
        </div>
      ) : filtered.length === 0 ? (
        <div style={{ padding: 24, textAlign: "center", color: "var(--muted-light)", fontSize: 13 }}>
          No slabs match &ldquo;{q.trim()}&rdquo;
        </div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 640 }}>
            <thead>
              <tr style={{ background: "var(--surface-alt)" }}>
                {["Slab ID", "Temple · Label", "Stone", "Status", "Deadline", "Note", "Action"].map(h => (
                  <th key={h} style={{ padding: "8px 14px", textAlign: "left", fontSize: 10, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.07em", whiteSpace: "nowrap" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visible.map(s => (
                <tr key={s.id} style={{ borderTop: "1px solid var(--border-light)", background: s.priority ? "rgba(220,38,38,0.04)" : "transparent" }}>
                  <td style={{ padding: "10px 14px", fontFamily: "ui-monospace, monospace", fontWeight: 700, fontSize: 12, whiteSpace: "nowrap" }}>
                    {s.priority && <span style={{ marginRight: 5 }}>⚡</span>}
                    {s.id}
                  </td>
                  <td style={{ padding: "10px 14px", fontSize: 12 }}>
                    <div style={{ fontWeight: 600 }}>{s.temple}</div>
                    <div style={{ color: "var(--muted)", fontSize: 11 }}>{s.label}</div>
                  </td>
                  <td style={{ padding: "10px 14px", fontSize: 12, color: "var(--muted)" }}>{s.stone ?? "—"}</td>
                  <td style={{ padding: "10px 14px" }}>
                    <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 10, background: s.status === "planned" ? "rgba(37,99,235,0.1)" : "rgba(217,119,6,0.1)", color: s.status === "planned" ? "#2563EB" : "#D97706", fontWeight: 600 }}>
                      {s.status}
                    </span>
                  </td>
                  <td style={{ padding: "10px 14px" }}>
                    {s.deadline
                      ? <span style={{ fontSize: 12, fontWeight: 600, color: "var(--gold-dark)" }}>{new Date(s.deadline).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}</span>
                      : <span style={{ fontSize: 11, color: "var(--muted-light)" }}>—</span>
                    }
                  </td>
                  <td style={{ padding: "10px 14px", fontSize: 11, color: "var(--muted)", maxWidth: 140 }}>
                    {s.priority_note ? <span style={{ fontStyle: "italic" }}>&ldquo;{s.priority_note}&rdquo;</span> : "—"}
                  </td>
                  <td style={{ padding: "10px 14px" }}>
                    {s.priority ? (
                      <form action={clearSlabAlertAction} style={{ display: "inline" }}>
                        <input type="hidden" name="id" value={s.id} />
                        <button type="submit" style={{ fontSize: 11, padding: "4px 10px", border: "1px solid var(--border)", borderRadius: 6, background: "var(--bg)", color: "var(--muted)", cursor: "pointer", whiteSpace: "nowrap" }}>
                          Clear alert
                        </button>
                      </form>
                    ) : (
                      <form action={pushSlabAlertAction} style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                        <input type="hidden" name="id" value={s.id} />
                        <select name="deadline_month" style={{ fontSize: 11, padding: "4px 6px", border: "1px solid var(--border)", borderRadius: 6, background: "var(--bg)", color: "var(--text)", width: 70 }}>
                          <option value="">Month</option>
                          {["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"].map((m, i) => (
                            <option key={m} value={String(i + 1).padStart(2,"0")}>{m}</option>
                          ))}
                        </select>
                        <select name="deadline_day" style={{ fontSize: 11, padding: "4px 6px", border: "1px solid var(--border)", borderRadius: 6, background: "var(--bg)", color: "var(--text)", width: 58 }}>
                          <option value="">Day</option>
                          {Array.from({ length: 31 }, (_, i) => i + 1).map(d => (
                            <option key={d} value={String(d).padStart(2,"0")}>{d}</option>
                          ))}
                        </select>
                        <input
                          type="text"
                          name="note"
                          placeholder="Remark (optional)"
                          maxLength={60}
                          style={{ fontSize: 11, padding: "4px 8px", border: "1px solid var(--border)", borderRadius: 6, background: "var(--bg)", color: "var(--text)", width: 130 }}
                        />
                        <button type="submit" style={{ fontSize: 11, padding: "4px 12px", border: "none", borderRadius: 6, background: "var(--gold)", color: "#fff", fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap" }}>
                          ⚡ Push
                        </button>
                      </form>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Show more / less toggle (only when not searching and there's something hidden) */}
          {!isSearching && filtered.length > COLLAPSED_COUNT && (
            <div style={{ padding: "10px 16px", borderTop: "1px solid var(--border-light)", background: "var(--surface-alt)", textAlign: "center" }}>
              <button
                type="button"
                onClick={() => setShowAll((v) => !v)}
                style={{
                  fontSize: 12,
                  fontWeight: 700,
                  padding: "6px 16px",
                  border: "1px solid var(--border)",
                  borderRadius: 20,
                  background: "var(--bg)",
                  color: "var(--gold-dark)",
                  cursor: "pointer",
                }}
              >
                {showAll
                  ? `▲ Show less`
                  : `▼ Show all ${filtered.length} slabs (${hiddenCount} more)`}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
