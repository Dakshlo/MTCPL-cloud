type Event = {
  id: string;
  event_type: string;
  message: string | null;
  created_at: string;
  user_name?: string | null;
};

const EVENT_META: Record<string, { icon: string; color: string; label: string }> = {
  assigned: { icon: "📋", color: "#2563EB", label: "Assigned" },
  reassigned: { icon: "↪", color: "#2563EB", label: "Reassigned" },
  started: { icon: "▶", color: "#16A34A", label: "Started" },
  phase_update: { icon: "⚙", color: "#D97706", label: "Progress update" },
  photo_added: { icon: "📷", color: "#7c3aed", label: "Photo added" },
  completed: { icon: "✅", color: "#16A34A", label: "Marked complete" },
  approved: { icon: "✔", color: "#16A34A", label: "Approved" },
  rejected: { icon: "🚫", color: "#DC2626", label: "Rejected" },
  dispatched: { icon: "🚚", color: "#2563EB", label: "Dispatched" },
  cancelled: { icon: "✕", color: "#6B7280", label: "Cancelled" },
};

function fmt(iso: string) {
  return new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function EventTimeline({ events }: { events: Event[] }) {
  if (events.length === 0) {
    return (
      <div style={{ fontSize: 12, color: "var(--muted-light)", padding: 16, textAlign: "center" }}>
        No events yet.
      </div>
    );
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {events.map((e) => {
        const meta = EVENT_META[e.event_type] ?? { icon: "·", color: "var(--muted)", label: e.event_type };
        return (
          <div key={e.id} style={{ display: "flex", gap: 10 }}>
            <div style={{
              width: 28, height: 28, borderRadius: "50%",
              background: `${meta.color}22`, color: meta.color,
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 13, flexShrink: 0,
            }}>
              {meta.icon}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: meta.color }}>{meta.label}</span>
                {e.user_name && (
                  <span style={{ fontSize: 11, color: "var(--muted)" }}>by {e.user_name}</span>
                )}
                <span style={{ fontSize: 10, color: "var(--muted-light)", fontFamily: "ui-monospace, monospace" }}>
                  {fmt(e.created_at)}
                </span>
              </div>
              {e.message && (
                <div style={{ fontSize: 12, color: "var(--text)", marginTop: 2, wordBreak: "break-word" }}>
                  {e.event_type === "photo_added" && /^https?:\/\//.test(e.message) ? (
                    <a href={e.message} target="_blank" rel="noreferrer" style={{ color: "#7c3aed", textDecoration: "underline" }}>
                      {e.message}
                    </a>
                  ) : e.message}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
