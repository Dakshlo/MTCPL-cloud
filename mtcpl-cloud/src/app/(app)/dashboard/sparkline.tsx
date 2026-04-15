/**
 * Inline SVG sparkline — pure, dependency-free.
 * Renders a series of bars with optional hover tooltips.
 */
type Point = { label: string; value: number };

export function Sparkline({
  data,
  height = 56,
  color = "#D4A94A",
  unit = "",
}: {
  data: Point[];
  height?: number;
  color?: string;
  unit?: string;
}) {
  if (data.length === 0) {
    return (
      <div style={{ height, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, color: "var(--muted-light)" }}>
        No data yet
      </div>
    );
  }

  const max = Math.max(...data.map((d) => d.value), 0.0001);
  const barWidth = 100 / data.length;
  const gap = Math.min(barWidth * 0.15, 1.5);
  const bw = barWidth - gap;

  return (
    <div style={{ position: "relative" }}>
      <svg viewBox={`0 0 100 100`} preserveAspectRatio="none" style={{ width: "100%", height, display: "block" }}>
        {data.map((d, i) => {
          const h = max > 0 ? (d.value / max) * 92 : 0; // 92 so top number has room
          const x = i * barWidth + gap / 2;
          const y = 100 - h;
          const isZero = d.value === 0;
          return (
            <g key={i}>
              <rect
                x={x}
                y={y}
                width={bw}
                height={isZero ? 1 : Math.max(h, 1.2)}
                fill={isZero ? "var(--border)" : color}
                rx={0.5}
              >
                <title>
                  {d.label}: {d.value.toFixed(1)}{unit}
                </title>
              </rect>
            </g>
          );
        })}
      </svg>
      <div style={{ fontSize: 9, color: "var(--muted-light)", marginTop: 2, display: "flex", justifyContent: "space-between" }}>
        <span>{data[0]?.label}</span>
        <span style={{ fontWeight: 600 }}>max {max.toFixed(1)}{unit}</span>
        <span>{data[data.length - 1]?.label}</span>
      </div>
    </div>
  );
}
