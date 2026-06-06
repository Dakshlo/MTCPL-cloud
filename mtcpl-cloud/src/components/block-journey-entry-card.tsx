"use client";

import { PeekIframe } from "./peek-iframe";

/**
 * Dashboard entry point for the Block Journey (real efficiency) report.
 * Owner + developer + the trusted named users only — parent page
 * handles the auth gate.
 *
 * Now opens as a center-peek iframe (over /embed/block-journey)
 * instead of navigating away — operators can dip in and out of the
 * report without losing their place on the dashboard. The "↗ Full
 * page" link in the modal header still routes to /block-journey if
 * someone wants the standalone surface.
 *
 * Visually a sibling of AskAiEntryCard (same gradient + layout) so the
 * two "insight" surfaces read as a pair.
 */
export function BlockJourneyEntryCard() {
  return (
    <PeekIframe
      url="/embed/block-journey"
      modalTitle="Block Journey — Real Efficiency"
      modalSubtitle="Track every Fresh block end-to-end — true slab yield across the full cutting lineage."
      triggerContent={
        <div
          style={{
            // Stretch to grid cell height (mig 044 follow-on / Daksh
            // OCD fix) — all four dashboard cards equal-height.
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            gap: 12,
            height: "100%",
            minHeight: 150,
            cursor: "pointer",
            textDecoration: "none",
            background: "linear-gradient(135deg, #1A2414 0%, #3d5a28 100%)",
            borderRadius: 12,
            padding: "22px 26px",
            boxShadow: "0 4px 16px rgba(26,36,20,0.15)",
            position: "relative",
            overflow: "hidden",
          }}
        >
          {/* Decorative accent */}
          <div
            aria-hidden
            style={{
              position: "absolute",
              top: -30,
              right: -30,
              width: 140,
              height: 140,
              borderRadius: "50%",
              background: "radial-gradient(circle, rgba(134,172,91,0.25) 0%, rgba(134,172,91,0) 70%)",
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
                color: "#86AC5B",
                marginBottom: 6,
              }}
            >
              📈 Real efficiency
            </div>
            <div
              style={{
                fontSize: 22,
                fontWeight: 700,
                color: "#fff",
                letterSpacing: "-0.2px",
              }}
            >
              Block Journey
            </div>
          </div>

          <div
            style={{
              position: "relative",
              alignSelf: "flex-start",
              padding: "10px 18px",
              background: "#86AC5B",
              color: "#1A2414",
              borderRadius: 8,
              fontSize: 13,
              fontWeight: 700,
              letterSpacing: "0.02em",
              whiteSpace: "nowrap",
            }}
          >
            Open report →
          </div>
        </div>
      }
    />
  );
}
