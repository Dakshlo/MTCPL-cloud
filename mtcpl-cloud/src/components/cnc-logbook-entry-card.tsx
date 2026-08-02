import Link from "next/link";

/**
 * Dashboard entry tile for the CNC Logbook (mig 215 carving routes).
 * Owner/developer only — gated at the call site in dashboard/page.tsx.
 * Visual sibling of DprEntryCard / VariousCostingEntryCard so the
 * dashboard card row stays aligned; blue to match the CNC route colour
 * used across the logbook.
 */
export function CncLogbookEntryCard() {
  return (
    <Link
      href="/carving/plan"
      style={{
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        gap: 12,
        height: "100%",
        minHeight: 150,
        textDecoration: "none",
        background: "linear-gradient(135deg, #172554 0%, #2563eb 100%)",
        borderRadius: 12,
        padding: "22px 26px",
        boxShadow: "0 4px 16px rgba(23,37,84,0.20)",
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
            color: "#bfdbfe",
            marginBottom: 6,
          }}
        >
          🗺️ Carving routes
        </div>
        <div style={{ fontSize: 22, fontWeight: 700, color: "#fff", letterSpacing: "-0.2px" }}>
          CNC Logbook
        </div>
      </div>

      <div
        style={{
          position: "relative",
          alignSelf: "flex-start",
          padding: "10px 18px",
          background: "#fff",
          color: "#1e3a8a",
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
