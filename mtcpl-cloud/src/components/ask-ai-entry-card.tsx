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
        display: "block",
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

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, flexWrap: "wrap", position: "relative" }}>
        <div style={{ flex: "1 1 auto", minWidth: 0 }}>
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
          <div style={{ fontSize: 20, fontWeight: 700, color: "#fff", letterSpacing: "-0.2px", marginBottom: 4 }}>
            Ask AI
          </div>
          <div style={{ fontSize: 13, color: "rgba(255,255,255,0.7)", lineHeight: 1.5 }}>
            Ask anything about blocks, slabs, cutting, or planning — in English or Hindi.
            <span style={{ color: "rgba(255,255,255,0.45)" }}> &nbsp;e.g. &quot;How many blocks for Aasta Temple?&quot;</span>
          </div>
        </div>

        <div
          style={{
            flexShrink: 0,
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
      </div>
    </Link>
  );
}
