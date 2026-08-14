import Link from "next/link";

/**
 * Dashboard entry tile for the Temple P&L (Daksh, Aug 2026).
 * DEVELOPER ONLY — gated at the call site in dashboard/page.tsx, and the
 * page itself re-checks. Visual sibling of DprEntryCard so the card row
 * stays aligned.
 */
export function TemplePnlEntryCard() {
  return (
    <Link
      href="/reports/temple-pnl"
      style={{
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        gap: 12,
        height: "100%",
        minHeight: 150,
        textDecoration: "none",
        background: "linear-gradient(135deg, #3b2f0b 0%, #b8860b 100%)",
        borderRadius: 12,
        padding: "22px 26px",
        boxShadow: "0 4px 16px rgba(59,47,11,0.22)",
        position: "relative",
        overflow: "hidden",
      }}
    >
      <div
        aria-hidden
        style={{
          position: "absolute",
          top: -30,
          right: -30,
          width: 140,
          height: 140,
          borderRadius: "50%",
          background: "radial-gradient(circle, rgba(255,255,255,0.18) 0%, rgba(255,255,255,0) 70%)",
          pointerEvents: "none",
        }}
      />
      <div style={{ position: "relative", minWidth: 0 }}>
        <div
          style={{
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            color: "#fde68a",
            marginBottom: 6,
          }}
        >
          📊 Profitability
        </div>
        <div style={{ fontSize: 22, fontWeight: 700, color: "#fff", letterSpacing: "-0.2px" }}>
          Temple P&amp;L
        </div>
      </div>

      <div
        style={{
          position: "relative",
          alignSelf: "flex-start",
          padding: "10px 18px",
          background: "#fff",
          color: "#78350f",
          borderRadius: 8,
          fontSize: 13,
          fontWeight: 700,
          letterSpacing: "0.02em",
          whiteSpace: "nowrap",
        }}
      >
        Open →
      </div>
    </Link>
  );
}
