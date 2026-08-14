/**
 * Classic ⁄ Cockpit dashboard toggle (Daksh, Aug 2026) — developer only;
 * page.tsx renders it solely for the developer role. Plain links into
 * /dashboard/switch-view, which sets the dash_view cookie and bounces
 * back, so the choice sticks across visits with zero client JS.
 */

const pill = (active: boolean): React.CSSProperties => ({
  fontSize: 11.5,
  fontWeight: 800,
  textDecoration: "none",
  padding: "6px 14px",
  borderRadius: 999,
  border: `1px solid ${active ? "var(--gold, #b8860b)" : "var(--border)"}`,
  background: active ? "rgba(180,140,60,0.14)" : "transparent",
  color: active ? "var(--text)" : "var(--muted)",
});

export function DashViewToggle({ current }: { current: "classic" | "cockpit" }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, justifyContent: "flex-end" }}>
      <span style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--muted)", marginRight: 2 }}>
        Dashboard
      </span>
      <a href="/dashboard/switch-view?to=classic" style={pill(current === "classic")}>Classic</a>
      <a href="/dashboard/switch-view?to=cockpit" style={pill(current === "cockpit")}>✨ Cockpit</a>
    </div>
  );
}
