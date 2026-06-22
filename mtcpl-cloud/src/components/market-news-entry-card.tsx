"use client";

import Link from "next/link";

/**
 * Dashboard entry card for the owner's market-news page (/market-news).
 * Owner + developer only (gated by the caller). Mirrors the Ask AI / TV Mode
 * cards' shape (kicker + title top, CTA bottom-left, equal min-height) with a
 * deep indigo gradient that matches the liquid-glass news page it opens.
 */
export function MarketNewsEntryCard() {
  return (
    <Link
      href="/market-news"
      style={{
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        gap: 12,
        height: "100%",
        minHeight: 150,
        textDecoration: "none",
        background: "linear-gradient(135deg, #0a0f24 0%, #1b1442 58%, #312e81 100%)",
        borderRadius: 12,
        padding: "22px 26px",
        boxShadow: "0 4px 16px rgba(20,16,48,0.25)",
        position: "relative",
        overflow: "hidden",
        transition: "transform 0.12s",
      }}
      onMouseEnter={(e) => (e.currentTarget.style.transform = "translateY(-1px)")}
      onMouseLeave={(e) => (e.currentTarget.style.transform = "translateY(0)")}
    >
      <div
        aria-hidden
        style={{
          position: "absolute",
          top: -30,
          right: -30,
          width: 150,
          height: 150,
          borderRadius: "50%",
          background: "radial-gradient(circle, rgba(129,140,248,0.35) 0%, rgba(129,140,248,0) 70%)",
          pointerEvents: "none",
        }}
      />
      <div style={{ position: "relative", minWidth: 0 }}>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "#c7d2fe", marginBottom: 6 }}>
          📰 Today&apos;s News
        </div>
        <div style={{ fontSize: 22, fontWeight: 700, color: "#fff", letterSpacing: "-0.2px" }}>
          Market brief &amp; chat
        </div>
        <div style={{ fontSize: 12.5, color: "rgba(255,255,255,0.6)", marginTop: 4 }}>
          Bull / bear read · top news · ask anything
        </div>
      </div>
      <div
        style={{
          position: "relative",
          alignSelf: "flex-start",
          fontSize: 12,
          padding: "8px 14px",
          background: "rgba(129,140,248,0.2)",
          border: "1px solid rgba(129,140,248,0.45)",
          borderRadius: 8,
          color: "#c7d2fe",
          fontWeight: 600,
          whiteSpace: "nowrap",
        }}
      >
        Open →
      </div>
    </Link>
  );
}
