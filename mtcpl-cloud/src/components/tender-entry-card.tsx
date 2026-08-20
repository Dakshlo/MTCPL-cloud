import Link from "next/link";

/**
 * Dashboard entry tile for the Tender / Price Breakdown workspace
 * (Daksh, Aug 2026). Developer + owner — gated at the call site in
 * dashboard/page.tsx via canUseTender, and the page itself re-checks.
 * Visual sibling of TemplePnlEntryCard so the card row stays aligned.
 *
 * Carries a softly blinking NEW flag: the tool has just been opened up to the
 * owner, and a card that has never been there before deserves to be noticed
 * once. Drop the badge when it stops being new.
 */
export function TenderEntryCard() {
  return (
    <Link
      href="/reports/tender"
      style={{
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        gap: 12,
        height: "100%",
        minHeight: 150,
        textDecoration: "none",
        background: "linear-gradient(135deg, #17173a 0%, #4f46e5 100%)",
        borderRadius: 12,
        padding: "22px 26px",
        boxShadow: "0 4px 16px rgba(23,23,58,0.24)",
        position: "relative",
        overflow: "hidden",
      }}
    >
      {/* NEW flag — a slow opacity pulse, not a hard blink; it should catch
          the eye on the second pass, not fight the page. */}
      <style>{`
        @keyframes mtcplTenderNew { 0%, 100% { opacity: 1 } 50% { opacity: 0.35 } }
        @media (prefers-reduced-motion: reduce) { .mtcpl-tender-new { animation: none !important } }
      `}</style>
      <span
        className="mtcpl-tender-new"
        style={{
          position: "absolute",
          top: 14,
          right: 14,
          zIndex: 2,
          display: "inline-flex",
          alignItems: "center",
          gap: 5,
          padding: "3px 9px",
          borderRadius: 999,
          background: "#fbbf24",
          color: "#3b2f0b",
          fontSize: 10,
          fontWeight: 800,
          letterSpacing: "0.1em",
          boxShadow: "0 2px 8px rgba(251,191,36,0.45)",
          animation: "mtcplTenderNew 1.6s ease-in-out infinite",
        }}
      >
        <span style={{ width: 5, height: 5, borderRadius: "50%", background: "#3b2f0b" }} />
        NEW
      </span>
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
            color: "#c7d2fe",
            marginBottom: 6,
          }}
        >
          🧮 Estimating
        </div>
        <div style={{ fontSize: 22, fontWeight: 700, color: "#fff", letterSpacing: "-0.2px" }}>
          Tender / Price Breakdown
        </div>
      </div>

      <div
        style={{
          position: "relative",
          alignSelf: "flex-start",
          padding: "10px 18px",
          background: "#fff",
          color: "#312e81",
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
