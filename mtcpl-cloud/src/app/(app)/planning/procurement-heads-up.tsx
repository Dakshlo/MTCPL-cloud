type Alert = {
  stone: string;
  p90: number;
  longestAvailable: number;
  sampleCount: number;
};

export function ProcurementHeadsUp({ alerts }: { alerts: Alert[] }) {
  if (alerts.length === 0) return null;

  return (
    <div
      style={{
        margin: "0 0 16px",
        padding: "12px 16px",
        background: "#eff6ff",
        border: "1px solid #60a5fa",
        borderRadius: 8,
      }}
    >
      <p style={{ margin: 0, fontWeight: 700, fontSize: 13, color: "#1e3a8a" }}>
        📊 Procurement heads-up
      </p>
      <ul style={{ margin: "6px 0 0 18px", padding: 0, fontSize: 12, color: "#1e3a8a" }}>
        {alerts.map((a) => (
          <li key={a.stone} style={{ marginBottom: 4, lineHeight: 1.5 }}>
            <strong>{a.stone}</strong> — recent 90th-percentile slab was <strong>{a.p90}&Prime;</strong>,
            but your longest available block is only <strong>{a.longestAvailable}&Prime;</strong>.
            Consider procuring longer blocks before the next beam-size requirement arrives.
            <span className="muted" style={{ marginLeft: 6, fontSize: 11 }}>
              ({a.sampleCount} slabs in last 6 months)
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
