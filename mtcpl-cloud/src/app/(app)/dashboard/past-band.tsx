import { Sparkline } from "./sparkline";
import { Donut } from "./donut";

type DailyPoint = { label: string; value: number };
type StoneSlice = { label: string; value: number; color: string };
type TopOperator = { name: string; slabs: number; cft: number; waste: number };

export function PastBand({
  sparkline,
  stoneMix,
  topOperators,
  deviationStats,
  wasteWeekPct,
  wasteTrend,
}: {
  sparkline: DailyPoint[];
  stoneMix: StoneSlice[];
  topOperators: TopOperator[];
  deviationStats: { totalApproved: number; deviations: number; rejections: number };
  wasteWeekPct: number;
  wasteTrend: DailyPoint[];
}) {
  const devPct = deviationStats.totalApproved > 0
    ? Math.round((deviationStats.deviations / deviationStats.totalApproved) * 100)
    : 0;

  const wasteColor = wasteWeekPct <= 10 ? "#16A34A" : wasteWeekPct <= 20 ? "#D97706" : "#DC2626";

  return (
    <section>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <span style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--gold-dark)" }} />
        <h2 style={{ margin: 0, fontSize: 14, fontWeight: 800, letterSpacing: "0.04em", color: "var(--text)", textTransform: "uppercase" }}>
          Past — Last 30 days
        </h2>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1.3fr 1fr", gap: 12, marginBottom: 12 }}>
        {/* Sparkline — daily production */}
        <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, padding: "16px 18px" }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 10 }}>
            Daily Production (CFT cut)
          </div>
          <Sparkline data={sparkline} height={64} color="var(--gold)" unit=" CFT" />
        </div>

        {/* Stone mix donut */}
        <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, padding: "16px 18px" }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 10 }}>
            Stone Mix
          </div>
          <Donut slices={stoneMix} size={100} thickness={16} />
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
        {/* Top Operators */}
        <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, padding: "14px 18px" }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 10 }}>
            Top Operators
          </div>
          {topOperators.length === 0 ? (
            <div style={{ fontSize: 11, color: "var(--muted-light)" }}>No cutting activity in 30 days</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
              {topOperators.slice(0, 3).map((op, i) => {
                const medals = ["🥇", "🥈", "🥉"];
                return (
                  <div key={op.name} style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 9px", background: "var(--surface-alt)", borderRadius: 6 }}>
                    <span style={{ fontSize: 14 }}>{medals[i]}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {op.name}
                      </div>
                      <div style={{ fontSize: 10, color: "var(--muted)" }}>
                        {op.slabs} slabs · {op.cft.toFixed(1)} CFT
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Deviation digest */}
        <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, padding: "14px 18px" }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 10 }}>
            Plan-vs-Reality
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
              <span style={{ fontSize: 11, color: "var(--muted)" }}>Plans approved</span>
              <span style={{ fontSize: 18, fontWeight: 800, color: "var(--text)", fontFamily: "ui-monospace, monospace" }}>{deviationStats.totalApproved}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
              <span style={{ fontSize: 11, color: "var(--muted)" }}>Deviations</span>
              <span style={{ fontSize: 14, fontWeight: 700, color: devPct > 20 ? "#DC2626" : devPct > 10 ? "#D97706" : "#16A34A", fontFamily: "ui-monospace, monospace" }}>
                {deviationStats.deviations} ({devPct}%)
              </span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
              <span style={{ fontSize: 11, color: "var(--muted)" }}>Rejections</span>
              <span style={{ fontSize: 14, fontWeight: 700, color: deviationStats.rejections > 0 ? "#DC2626" : "var(--text)", fontFamily: "ui-monospace, monospace" }}>
                {deviationStats.rejections}
              </span>
            </div>
            <div style={{ fontSize: 10, color: "var(--muted-light)", marginTop: 4, lineHeight: 1.4 }}>
              {devPct > 20
                ? "Operators often cut outside the plan — consider retraining or trusting the planner less."
                : devPct > 10
                ? "Occasional plan deviations — normal for brittle stones."
                : "Plans are being followed closely. Good."}
            </div>
          </div>
        </div>

        {/* Waste trend */}
        <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, padding: "14px 18px" }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 10 }}>
            Waste % Trend
          </div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 8 }}>
            <span style={{ fontSize: 28, fontWeight: 800, color: wasteColor, letterSpacing: "-0.5px", lineHeight: 1 }}>
              {wasteWeekPct}%
            </span>
            <span style={{ fontSize: 11, color: "var(--muted)" }}>this week</span>
          </div>
          <Sparkline data={wasteTrend} height={32} color={wasteColor} unit="%" />
          <div style={{ fontSize: 10, color: "var(--muted-light)", marginTop: 4 }}>
            {wasteWeekPct <= 10 ? "Excellent efficiency" : wasteWeekPct <= 20 ? "Acceptable waste" : "High waste — review packings"}
          </div>
        </div>
      </div>
    </section>
  );
}
