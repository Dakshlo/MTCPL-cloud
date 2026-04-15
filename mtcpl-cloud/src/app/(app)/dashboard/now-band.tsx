"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { getNowBandData, type NowBandData } from "./actions";

export function NowBand({ initial }: { initial: NowBandData }) {
  const [data, setData] = useState<NowBandData>(initial);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        setRefreshing(true);
        const next = await getNowBandData();
        setData(next);
      } catch {
        // silent fail — next tick will retry
      } finally {
        setRefreshing(false);
      }
    }, 45000);
    return () => clearInterval(interval);
  }, []);

  const pace = data.pacePercent;
  const paceColor = pace >= 80 ? "#16A34A" : pace >= 60 ? "#D97706" : "#DC2626";
  const paceBg = pace >= 80 ? "rgba(22,163,74,0.08)" : pace >= 60 ? "rgba(217,119,6,0.08)" : "rgba(220,38,38,0.08)";

  return (
    <section>
      {/* Band header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#16A34A", boxShadow: "0 0 0 3px rgba(22,163,74,0.15)" }} />
          <h2 style={{ margin: 0, fontSize: 14, fontWeight: 800, letterSpacing: "0.04em", color: "var(--text)", textTransform: "uppercase" }}>
            Now
          </h2>
          <span className="muted" style={{ fontSize: 11 }}>
            auto-refreshing every 45s{refreshing ? " · updating…" : ""}
          </span>
        </div>
        <span className="muted" style={{ fontSize: 11, fontFamily: "ui-monospace, monospace" }}>
          last update {new Date(data.fetchedAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}
        </span>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, alignItems: "stretch" }}>
        {/* Pacing meter */}
        <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, padding: "16px 18px", display: "flex", flexDirection: "column", gap: 12 }}>
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
              Today's Pacing
            </div>
            <div style={{ marginTop: 6, display: "flex", alignItems: "baseline", gap: 8 }}>
              <span style={{ fontSize: 30, fontWeight: 800, color: "var(--text)", letterSpacing: "-0.5px", lineHeight: 1 }}>
                {data.todayCft.toFixed(1)}
              </span>
              <span style={{ fontSize: 12, color: "var(--muted)", fontWeight: 600 }}>CFT cut today</span>
            </div>
            <div style={{ fontSize: 11, color: "var(--muted-light)", marginTop: 2 }}>
              30-day average: {data.avgCft.toFixed(1)} CFT/day
            </div>
          </div>

          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 5 }}>
              <span style={{ fontSize: 10, color: "var(--muted)", fontWeight: 600 }}>Pace vs avg</span>
              <span style={{ fontSize: 13, fontWeight: 800, color: paceColor }}>{pace}%</span>
            </div>
            <div style={{ height: 8, background: paceBg, borderRadius: 4, overflow: "hidden" }}>
              <div style={{
                width: `${Math.min(100, Math.max(0, pace))}%`,
                height: "100%",
                background: paceColor,
                borderRadius: 4,
                transition: "width 0.6s ease",
              }} />
            </div>
            <div style={{ fontSize: 10, color: "var(--muted-light)", marginTop: 4 }}>
              {pace >= 100 ? "Ahead of average 🚀" : pace >= 80 ? "On track for the day" : pace >= 60 ? "Slightly behind" : pace > 0 ? "Behind — push harder" : "No cuts yet today"}
            </div>
          </div>
        </div>

        {/* Operator strip */}
        <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, padding: "14px 18px", display: "flex", flexDirection: "column", gap: 10 }}>
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
              Operators Online
            </div>
            <div style={{ fontSize: 11, color: "var(--muted-light)", marginTop: 2 }}>
              {data.operators.length === 0 ? "No one online right now" : `${data.operators.length} user${data.operators.length > 1 ? "s" : ""} active`}
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 7, maxHeight: 180, overflowY: "auto" }}>
            {data.operators.length === 0 ? (
              <div style={{ textAlign: "center", padding: "12px 0", color: "var(--muted-light)", fontSize: 11 }}>
                Quiet — no users in the last 5 min
              </div>
            ) : (
              data.operators.map((op) => {
                const dot = op.status === "cutting" ? "#16A34A" : op.status === "idle" ? "#D97706" : "#9CA3AF";
                const bg = op.status === "cutting" ? "rgba(22,163,74,0.07)" : op.status === "idle" ? "rgba(217,119,6,0.05)" : "var(--surface-alt)";
                const initial = op.name.charAt(0).toUpperCase() || "?";
                return (
                  <div key={op.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 10px", background: bg, borderRadius: 7 }}>
                    <div style={{ width: 26, height: 26, borderRadius: "50%", background: "var(--gold-dark)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 12, flexShrink: 0 }}>
                      {initial}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                        <span style={{ width: 6, height: 6, borderRadius: "50%", background: dot, flexShrink: 0 }} />
                        <span style={{ fontSize: 12, fontWeight: 700, color: "var(--text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                          {op.name}
                        </span>
                      </div>
                      <div style={{ fontSize: 10, color: "var(--muted)", marginTop: 1 }}>{op.activity}</div>
                    </div>
                    {op.todaySlabs > 0 && (
                      <div style={{ fontSize: 10, fontFamily: "ui-monospace, monospace", color: "var(--muted)", textAlign: "right", flexShrink: 0 }}>
                        <div style={{ fontWeight: 700, color: "var(--text)" }}>{op.todaySlabs}</div>
                        <div>{op.todayCft.toFixed(1)} CFT</div>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Alerts feed */}
        <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, padding: "14px 18px", display: "flex", flexDirection: "column", gap: 10 }}>
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
              Open Alerts
            </div>
            <div style={{ fontSize: 11, color: "var(--muted-light)", marginTop: 2 }}>
              {data.alerts.length === 0 ? "All clear — no issues flagged" : `${data.alerts.length} need${data.alerts.length === 1 ? "s" : ""} your attention`}
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 200, overflowY: "auto" }}>
            {data.alerts.length === 0 ? (
              <div style={{ textAlign: "center", padding: "16px 0", color: "var(--muted-light)", fontSize: 11 }}>
                🎉 No rejections, deviations, or low-stock warnings
              </div>
            ) : (
              data.alerts.map((a, i) => {
                const icon =
                  a.kind === "rejection" ? "🚫"
                  : a.kind === "deviation" ? "↔️"
                  : a.kind === "overdue" ? "⏰"
                  : a.kind === "carving_review" ? "🎨"
                  : "📉";
                const border =
                  a.kind === "rejection" || a.kind === "lowstock" ? "rgba(220,38,38,0.2)"
                  : a.kind === "carving_review" ? "rgba(124,58,237,0.2)"
                  : "rgba(217,119,6,0.2)";
                const bg =
                  a.kind === "rejection" || a.kind === "lowstock" ? "rgba(220,38,38,0.04)"
                  : a.kind === "carving_review" ? "rgba(124,58,237,0.04)"
                  : "rgba(217,119,6,0.04)";
                return (
                  <Link key={i} href={a.href} style={{ textDecoration: "none", display: "flex", gap: 8, padding: "7px 10px", background: bg, border: `1px solid ${border}`, borderRadius: 6 }}>
                    <span style={{ fontSize: 14, flexShrink: 0 }}>{icon}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {a.title}
                      </div>
                      <div style={{ fontSize: 10, color: "var(--muted)", marginTop: 1 }}>
                        {a.subtitle}{a.timeAgo ? ` · ${a.timeAgo}` : ""}
                      </div>
                    </div>
                  </Link>
                );
              })
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
