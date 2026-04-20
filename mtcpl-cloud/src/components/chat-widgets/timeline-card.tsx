/**
 * Vertical timeline widget for "journey" / "history" answers.
 *
 * Marker shape:
 *   [[TIMELINE:{
 *     "title": "MT-B-001 journey",
 *     "subtitle": "PinkStone · Yard 2 · Consumed",    (optional)
 *     "items": [
 *       {
 *         "icon": "📦",
 *         "at": "2026-03-15T09:30:00Z",              (ISO or anything Date parses)
 *         "title": "Added to inventory",
 *         "by": "Paresh Kumar",                       (optional)
 *         "details": "200×76×56 in · 92.5 CFT"        (optional)
 *       },
 *       ...
 *     ]
 *   }]]
 *
 * Each item is a row with a dot on the left (showing the icon) connected
 * by a faint gold rail, and the text on the right. Works for block
 * journeys today; any timeline-shaped answer (dispatch, carving, etc.)
 * can reuse it.
 */

export type TimelineItem = {
  icon?: string;
  at?: string;
  title: string;
  by?: string;
  details?: string;
};

export type TimelineCardProps = {
  title?: string;
  subtitle?: string;
  items: TimelineItem[];
};

const ACCENT = "#E8C572";
const ACCENT_SOFT = "rgba(232,197,114,0.15)";
const RAIL = "rgba(232,197,114,0.25)";

function fmtDate(raw?: string): string {
  if (!raw) return "";
  const d = new Date(raw);
  if (!isFinite(d.getTime())) return raw;
  const date = d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
  const time = d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true });
  return `${date} · ${time}`;
}

export function TimelineCard({ title, subtitle, items }: TimelineCardProps) {
  if (!items || items.length === 0) return null;

  return (
    <div
      style={{
        margin: "10px 0",
        padding: "14px 16px",
        background: "rgba(255,255,255,0.03)",
        border: "1px solid rgba(255,255,255,0.08)",
        borderRadius: 12,
      }}
    >
      {(title || subtitle) && (
        <div style={{ marginBottom: 14, paddingBottom: 10, borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
          {title && <div style={{ fontSize: 14, fontWeight: 700, color: ACCENT }}>{title}</div>}
          {subtitle && <div style={{ fontSize: 12, color: "rgba(255,255,255,0.65)", marginTop: 2 }}>{subtitle}</div>}
        </div>
      )}

      <div style={{ position: "relative", paddingLeft: 30 }}>
        {/* Vertical rail */}
        <div
          style={{
            position: "absolute",
            left: 13,
            top: 6,
            bottom: 6,
            width: 2,
            background: RAIL,
            borderRadius: 1,
          }}
        />

        {items.map((item, idx) => (
          <div
            key={idx}
            style={{
              position: "relative",
              paddingBottom: idx === items.length - 1 ? 0 : 14,
              minHeight: 32,
            }}
          >
            {/* Dot */}
            <div
              style={{
                position: "absolute",
                left: -30,
                top: 0,
                width: 28,
                height: 28,
                borderRadius: "50%",
                background: ACCENT_SOFT,
                border: `1.5px solid ${ACCENT}`,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 14,
                color: ACCENT,
              }}
            >
              {item.icon || "•"}
            </div>

            {/* Content */}
            {item.at && (
              <div style={{ fontSize: 11, color: "rgba(255,255,255,0.55)", fontFamily: "ui-monospace, monospace", marginBottom: 2 }}>
                {fmtDate(item.at)}
              </div>
            )}
            <div style={{ fontSize: 14, fontWeight: 600, color: "#fff", lineHeight: 1.35 }}>
              {item.title}
            </div>
            {item.by && (
              <div style={{ fontSize: 12, color: "rgba(255,255,255,0.7)", marginTop: 2 }}>
                by <strong style={{ color: ACCENT }}>{item.by}</strong>
              </div>
            )}
            {item.details && (
              <div
                style={{
                  fontSize: 12,
                  color: "rgba(255,255,255,0.6)",
                  marginTop: 3,
                  lineHeight: 1.5,
                }}
              >
                {item.details}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
