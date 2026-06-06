import Link from "next/link";

/**
 * Mig 060 — Dashboard entry tile for the Various Costing report.
 * Visually a sibling of AskAiEntryCard + BlockJourneyEntryCard so
 * the row of cards stays aligned.
 *
 * Links to /reports/various-costing which is the two-card landing
 * (CNC + Cutter). The page itself gates further per-card.
 */
export function VariousCostingEntryCard() {
  return (
    <Link
      href="/reports/various-costing"
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        textDecoration: "none",
        background: "linear-gradient(135deg, #0c4a6e 0%, #0ea5e9 100%)",
        borderRadius: 12,
        padding: "22px 26px",
        boxShadow: "0 4px 16px rgba(12,74,110,0.18)",
        position: "relative",
        overflow: "hidden",
      }}
    >
      {/* Decorative accent — same shape pattern as the AI card */}
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

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, flexWrap: "wrap", position: "relative" }}>
        <div style={{ flex: "1 1 auto", minWidth: 0 }}>
          <div style={{
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            color: "#bae6fd",
            marginBottom: 6,
          }}>
            📊 Reports
          </div>
          <div style={{ fontSize: 22, fontWeight: 700, color: "#fff", letterSpacing: "-0.2px" }}>
            Various Costing
          </div>
        </div>

        <div
          style={{
            flexShrink: 0,
            padding: "10px 18px",
            background: "#fff",
            color: "#0c4a6e",
            borderRadius: 8,
            fontSize: 13,
            fontWeight: 700,
            letterSpacing: "0.02em",
            whiteSpace: "nowrap",
          }}
        >
          Open →
        </div>
      </div>
    </Link>
  );
}
