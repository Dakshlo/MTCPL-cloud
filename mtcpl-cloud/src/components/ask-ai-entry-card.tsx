import Link from "next/link";

/**
 * Dashboard entry point for the Ask AI chatbot. Rendered on /dashboard for
 * owner + developer roles only (page handles the auth gate). Links through
 * to /ask-ai where the chat UI lives.
 */
export function AskAiEntryCard() {
  return (
    <Link
      href="/ask-ai"
      style={{
        // Daksh June 2026 — uniform card: kicker+title pinned top, CTA
        // pinned bottom-left via space-between, with a shared minHeight
        // so all four dashboard cards are exactly the same size whether
        // the title is one line or two.
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        gap: 12,
        height: "100%",
        minHeight: 150,
        textDecoration: "none",
        background: "linear-gradient(135deg, #2D2410 0%, #6b4f18 100%)",
        borderRadius: 12,
        padding: "22px 26px",
        boxShadow: "0 4px 16px rgba(45,36,16,0.15)",
        position: "relative",
        overflow: "hidden",
      }}
    >
      {/* Decorative sparkle accent */}
      <div
        aria-hidden
        style={{
          position: "absolute",
          top: -30,
          right: -30,
          width: 140,
          height: 140,
          borderRadius: "50%",
          background: "radial-gradient(circle, rgba(232,197,114,0.25) 0%, rgba(232,197,114,0) 70%)",
          pointerEvents: "none",
        }}
      />

      <div style={{ position: "relative", minWidth: 0 }}>
        <div style={{
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: "0.1em",
          textTransform: "uppercase",
          color: "#E8C572",
          marginBottom: 6,
        }}>
          ✨ New
        </div>
        <div style={{ fontSize: 22, fontWeight: 700, color: "#fff", letterSpacing: "-0.2px" }}>
          MTCPL-AI
        </div>
      </div>

      <div
        style={{
          position: "relative",
          alignSelf: "flex-start",
          padding: "10px 18px",
          background: "#E8C572",
          color: "#2D2410",
          borderRadius: 8,
          fontSize: 13,
          fontWeight: 700,
          letterSpacing: "0.02em",
          whiteSpace: "nowrap",
        }}
      >
        Open chat →
      </div>
    </Link>
  );
}
