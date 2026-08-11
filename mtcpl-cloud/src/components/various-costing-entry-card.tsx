import Link from "next/link";

/**
 * Mig 060 — Dashboard entry tile for the Various Costing reports.
 * Visually a sibling of AskAiEntryCard + BlockJourneyEntryCard so
 * the row of cards stays aligned.
 *
 * Aug 2026 (Daksh): "that page just increases resistance so remove it
 * — instead when you press Various Costing it will give directly 2
 * options on the dashboard." The card used to be one big <Link> to
 * /reports/various-costing, a landing page whose ONLY job was to show
 * these same two choices. That's one click and one page load to learn
 * nothing, so the two reports are now reachable straight from here.
 *
 * The card itself is no longer a link — a card-wide <Link> can't
 * contain two more links (invalid HTML, and the outer one swallows the
 * clicks). The two buttons are the only hit targets.
 *
 * `canCnc` / `canCutter` hide a button the user can't open. Both
 * destination pages still enforce their own gate (canViewCncCosts /
 * canViewCutterCosts), so this is only about not offering a dead
 * button — never the security boundary.
 */
export function VariousCostingEntryCard({
  canCnc = true,
  canCutter = true,
}: {
  canCnc?: boolean;
  canCutter?: boolean;
}) {
  return (
    <div
      style={{
        // Uniform dashboard card — see ask-ai-entry-card for the shape.
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        gap: 12,
        height: "100%",
        minHeight: 150,
        background: "linear-gradient(135deg, #0c4a6e 0%, #0ea5e9 100%)",
        borderRadius: 12,
        padding: "22px 26px",
        boxShadow: "0 4px 16px rgba(12,74,110,0.18)",
        position: "relative",
        overflow: "hidden",
      }}
    >
      <VcCardStyles />

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

      <div style={{ position: "relative", minWidth: 0 }}>
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

      {/* The two reports, straight from the dashboard. */}
      <div
        style={{
          position: "relative",
          display: "flex",
          flexWrap: "wrap",
          gap: 8,
        }}
      >
        {canCnc && (
          <Link href="/reports/various-costing/cnc" className="vce-btn">
            <span aria-hidden>🛠</span> CNC
          </Link>
        )}
        {canCutter && (
          <Link href="/reports/various-costing/cutter" className="vce-btn">
            <span aria-hidden>✂</span> Cutter
          </Link>
        )}
      </div>
    </div>
  );
}

/** Hover/press states need real CSS — this is a server component, so
 *  there are no inline mouse handlers to lean on. */
function VcCardStyles() {
  return (
    <style>{`
      .vce-btn {
        display: inline-flex;
        align-items: center;
        gap: 7px;
        padding: 10px 18px;
        background: #fff;
        color: #0c4a6e;
        border-radius: 8px;
        font-size: 13px;
        font-weight: 700;
        letter-spacing: 0.02em;
        white-space: nowrap;
        text-decoration: none;
        box-shadow: 0 1px 3px rgba(12,74,110,0.22);
        transition: transform .12s cubic-bezier(.22,1,.36,1), box-shadow .12s ease;
      }
      .vce-btn:hover {
        transform: translateY(-1px);
        box-shadow: 0 5px 14px rgba(3,26,45,0.32);
      }
      .vce-btn:active { transform: translateY(0); }
      .vce-btn:focus-visible {
        outline: 2px solid #fff;
        outline-offset: 2px;
      }
    `}</style>
  );
}
