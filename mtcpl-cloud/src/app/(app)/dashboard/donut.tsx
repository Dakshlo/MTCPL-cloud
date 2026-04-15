/**
 * Inline SVG donut chart — pure, dependency-free.
 */
type Slice = { label: string; value: number; color: string };

export function Donut({
  slices,
  size = 120,
  thickness = 18,
  centerLabel,
  centerValue,
}: {
  slices: Slice[];
  size?: number;
  thickness?: number;
  centerLabel?: string;
  centerValue?: string;
}) {
  const total = slices.reduce((sum, s) => sum + s.value, 0);
  const radius = size / 2 - thickness / 2;
  const circumference = 2 * Math.PI * radius;
  const center = size / 2;

  if (total === 0) {
    return (
      <div style={{ width: size, height: size, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, color: "var(--muted-light)" }}>
        No data
      </div>
    );
  }

  let offset = 0;

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
      <svg width={size} height={size} style={{ flexShrink: 0 }}>
        <circle cx={center} cy={center} r={radius} fill="none" stroke="var(--border)" strokeWidth={thickness} />
        {slices.map((s, i) => {
          const pct = s.value / total;
          const dash = pct * circumference;
          const gap = circumference - dash;
          const rotation = (offset / circumference) * 360 - 90;
          offset += dash;
          return (
            <circle
              key={i}
              cx={center}
              cy={center}
              r={radius}
              fill="none"
              stroke={s.color}
              strokeWidth={thickness}
              strokeDasharray={`${dash} ${gap}`}
              strokeDashoffset={0}
              transform={`rotate(${rotation} ${center} ${center})`}
              style={{ transition: "stroke-dasharray 0.3s" }}
            >
              <title>
                {s.label}: {s.value.toFixed(1)} ({Math.round(pct * 100)}%)
              </title>
            </circle>
          );
        })}
        {(centerValue || centerLabel) && (
          <g>
            {centerValue && (
              <text x={center} y={center - 2} textAnchor="middle" fontSize={16} fontWeight={800} fill="var(--text)">
                {centerValue}
              </text>
            )}
            {centerLabel && (
              <text x={center} y={center + 12} textAnchor="middle" fontSize={9} fill="var(--muted)">
                {centerLabel}
              </text>
            )}
          </g>
        )}
      </svg>
      <div style={{ display: "flex", flexDirection: "column", gap: 5, fontSize: 11 }}>
        {slices.map((s) => (
          <div key={s.label} style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 9, height: 9, borderRadius: 2, background: s.color, flexShrink: 0 }} />
            <span style={{ color: "var(--text)", fontWeight: 600 }}>{s.label}</span>
            <span style={{ color: "var(--muted)" }}>
              {s.value.toFixed(1)} · {Math.round((s.value / total) * 100)}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
