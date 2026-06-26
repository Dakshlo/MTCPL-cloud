import Link from "next/link";

/**
 * Dashboard entry tile for the Production DPR (Daily Production Report).
 * Owner/developer only — gated at the call site in dashboard/page.tsx.
 * Visual sibling of VariousCostingEntryCard / AskAiEntryCard so the
 * dashboard card row stays aligned.
 */
export function DprEntryCard() {
  return (
    <Link
      href="/reports/dpr"
      style={{
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        gap: 12,
        height: "100%",
        minHeight: 150,
        textDecoration: "none",
        background: "linear-gradient(135deg, #064e3b 0%, #10b981 100%)",
        borderRadius: 12,
        padding: "22px 26px",
        boxShadow: "0 4px 16px rgba(6,78,59,0.20)",
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
            color: "#a7f3d0",
            marginBottom: 6,
          }}
        >
          🏭 Production
        </div>
        <div style={{ fontSize: 22, fontWeight: 700, color: "#fff", letterSpacing: "-0.2px" }}>
          DPR
        </div>
        <div style={{ fontSize: 12.5, color: "#d1fae5", marginTop: 4, lineHeight: 1.4 }}>
          Day · week · month — every stage by code, with CFT.
        </div>
      </div>

      <div
        style={{
          position: "relative",
          alignSelf: "flex-start",
          padding: "10px 18px",
          background: "#fff",
          color: "#065f46",
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
