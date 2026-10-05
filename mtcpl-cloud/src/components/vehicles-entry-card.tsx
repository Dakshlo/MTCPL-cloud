import Link from "next/link";

import { describeVehicleExpiry, loadVehicleExpirySummary } from "@/lib/vehicle-expiry";

/**
 * Dashboard entry tile for the Vehicles department (mig 204).
 * Owner/developer only — gated at the call site in dashboard/page.tsx.
 *
 * Same shape as DprEntryCard / CncLogbookEntryCard so the card row stays
 * aligned ("keep card as other same" — Daksh), with one addition: a status
 * chip and a line naming the single most urgent paper, so the owner sees
 * an expiry from the dashboard instead of having to open the department.
 *
 * The slate base never changes; only the chip carries the colour. A card
 * that turned red would stop reading as a sibling of the others.
 *
 * Server component — it reads six columns off a ~34-row table. On a
 * pre-mig-204 database the summary comes back unavailable and the card
 * renders nothing rather than claiming the fleet is clear.
 */
export async function VehiclesEntryCard() {
  const summary = await loadVehicleExpirySummary();
  if (!summary.available) return null;

  const { tone, chip, detail } = describeVehicleExpiry(summary);

  // Chip colours sit on the dark slate card, so these are the light ends
  // of each ramp — they carry the same meaning as the expiry dots on
  // /vehicles (red expired · amber within 30 days · green clear).
  const chipStyle = {
    bad: { bg: "rgba(248,113,113,0.18)", border: "rgba(248,113,113,0.45)", fg: "#fecaca" },
    warn: { bg: "rgba(251,191,36,0.18)", border: "rgba(251,191,36,0.45)", fg: "#fde68a" },
    good: { bg: "rgba(74,222,128,0.16)", border: "rgba(74,222,128,0.40)", fg: "#bbf7d0" },
    idle: { bg: "rgba(255,255,255,0.10)", border: "rgba(255,255,255,0.22)", fg: "#e2e8f0" },
  }[tone];

  return (
    <Link
      href="/vehicles"
      style={{
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        gap: 12,
        height: "100%",
        minHeight: 150,
        textDecoration: "none",
        background: "linear-gradient(135deg, #0f172a 0%, #475569 100%)",
        borderRadius: 12,
        padding: "22px 26px",
        boxShadow: "0 4px 16px rgba(15,23,42,0.22)",
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
            color: "#cbd5e1",
            marginBottom: 6,
          }}
        >
          🚚 Fleet papers
        </div>
        <div style={{ fontSize: 22, fontWeight: 700, color: "#fff", letterSpacing: "-0.2px" }}>
          Vehicles
        </div>

        <div
          style={{
            display: "inline-block",
            marginTop: 10,
            padding: "3px 10px",
            borderRadius: 999,
            background: chipStyle.bg,
            border: `1px solid ${chipStyle.border}`,
            color: chipStyle.fg,
            fontSize: 11.5,
            fontWeight: 800,
            letterSpacing: "0.01em",
            whiteSpace: "nowrap",
          }}
        >
          {chip}
        </div>

        {detail && (
          <div
            style={{
              marginTop: 7,
              fontSize: 12.5,
              lineHeight: 1.45,
              color: "rgba(255,255,255,0.80)",
              overflowWrap: "anywhere",
            }}
          >
            {detail}
          </div>
        )}
      </div>

      <div
        style={{
          position: "relative",
          alignSelf: "flex-start",
          padding: "10px 18px",
          background: "#fff",
          color: "#0f172a",
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
