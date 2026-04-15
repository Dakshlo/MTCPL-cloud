import Link from "next/link";

type StoneRunway = {
  stone: string;
  availableCft: number;
  burnPerDay: number;
  daysLeft: number;
};

type PriorityDeadline = {
  id: string;
  temple: string;
  label: string;
  deadline: string | null;
  daysLeft: number | null;
};

export function NextBand({
  runways,
  backlogCount,
  backlogDays,
  priorityDeadlines,
}: {
  runways: StoneRunway[];
  backlogCount: number;
  backlogDays: number | null;
  priorityDeadlines: PriorityDeadline[];
}) {
  return (
    <section>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#2563EB" }} />
        <h2 style={{ margin: 0, fontSize: 14, fontWeight: 800, letterSpacing: "0.04em", color: "var(--text)", textTransform: "uppercase" }}>
          Next — What's coming
        </h2>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1.3fr 1fr 1fr", gap: 12 }}>
        {/* Inventory runway per stone */}
        <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, padding: "14px 18px" }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 10 }}>
            Inventory Runway
          </div>
          {runways.length === 0 ? (
            <div style={{ fontSize: 11, color: "var(--muted-light)" }}>No stock data available</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
              {runways.map((r) => {
                const capped = Math.min(r.daysLeft, 30);
                const pct = (capped / 30) * 100;
                const color = r.daysLeft >= 14 ? "#16A34A" : r.daysLeft >= 7 ? "#D97706" : "#DC2626";
                const label = r.burnPerDay < 0.1
                  ? "No recent consumption"
                  : r.daysLeft >= 30
                  ? `${r.daysLeft.toFixed(0)}+ days`
                  : `${r.daysLeft.toFixed(1)} days left`;
                return (
                  <Link
                    key={r.stone}
                    href="/blocks"
                    style={{ textDecoration: "none", display: "flex", flexDirection: "column", gap: 4, padding: "8px 10px", background: "var(--surface-alt)", borderRadius: 6 }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span style={{ fontSize: 12, fontWeight: 700, color: "var(--text)" }}>{r.stone}</span>
                      <span style={{ fontSize: 11, fontWeight: 700, color }}>{label}</span>
                    </div>
                    <div style={{ height: 5, background: "var(--border)", borderRadius: 3, overflow: "hidden" }}>
                      <div style={{
                        width: `${Math.max(2, pct)}%`,
                        height: "100%",
                        background: color,
                        borderRadius: 3,
                        transition: "width 0.4s ease",
                      }} />
                    </div>
                    <div style={{ fontSize: 10, color: "var(--muted-light)" }}>
                      {r.availableCft.toFixed(1)} CFT available · {r.burnPerDay.toFixed(1)} CFT/day avg
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </div>

        {/* Planned backlog forecast */}
        <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, padding: "14px 18px", display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
            Planned Backlog
          </div>
          <div>
            <div style={{ fontSize: 36, fontWeight: 800, color: "var(--text)", letterSpacing: "-1px", lineHeight: 1 }}>
              {backlogCount}
            </div>
            <div style={{ fontSize: 11, color: "var(--muted)" }}>slabs planned</div>
          </div>
          <div style={{ marginTop: 4, padding: "8px 10px", background: "rgba(37,99,235,0.06)", border: "1px solid rgba(37,99,235,0.15)", borderRadius: 6 }}>
            <div style={{ fontSize: 10, color: "var(--muted)", fontWeight: 600 }}>At current pace</div>
            <div style={{ fontSize: 16, fontWeight: 800, color: "#2563EB", marginTop: 2 }}>
              {backlogDays !== null ? `~${backlogDays.toFixed(1)} days` : "—"}
            </div>
            <div style={{ fontSize: 10, color: "var(--muted-light)", marginTop: 2 }}>
              to clear the queue
            </div>
          </div>
        </div>

        {/* Upcoming priority deadlines */}
        <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, padding: "14px 18px" }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 10 }}>
            Priority Deadlines
          </div>
          {priorityDeadlines.length === 0 ? (
            <div style={{ fontSize: 11, color: "var(--muted-light)" }}>No upcoming priority deadlines</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {priorityDeadlines.slice(0, 5).map((p) => {
                const overdue = p.daysLeft !== null && p.daysLeft <= 0;
                const urgent = p.daysLeft !== null && p.daysLeft > 0 && p.daysLeft <= 3;
                const color = overdue ? "#DC2626" : urgent ? "#D97706" : "var(--text)";
                const bg = overdue ? "rgba(220,38,38,0.06)" : urgent ? "rgba(217,119,6,0.05)" : "var(--surface-alt)";
                const border = overdue ? "rgba(220,38,38,0.2)" : urgent ? "rgba(217,119,6,0.15)" : "var(--border-light)";
                const statusLabel = p.daysLeft === null
                  ? "—"
                  : p.daysLeft <= 0
                  ? "Overdue"
                  : p.daysLeft === 1
                  ? "Tomorrow"
                  : `${p.daysLeft}d`;
                return (
                  <div key={p.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6, padding: "7px 9px", background: bg, border: `1px solid ${border}`, borderRadius: 6 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontFamily: "ui-monospace, monospace", fontSize: 11, fontWeight: 700, color: "var(--text)" }}>
                        {p.id}
                      </div>
                      <div style={{ fontSize: 10, color: "var(--muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {p.temple}
                      </div>
                    </div>
                    <span style={{ fontSize: 10, fontWeight: 800, color, fontFamily: "ui-monospace, monospace", flexShrink: 0 }}>
                      {statusLabel}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
