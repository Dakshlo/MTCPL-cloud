import Link from "next/link";

/**
 * Dashboard entry tile for the server-time check (Daksh, Aug 2026):
 * "put that in a card like MTCPL AI."
 *
 * The check first shipped as a full-width panel at the top of the
 * dashboard, which put a diagnostic tool ahead of the day's work every
 * single morning. It is something to open when a date looks wrong, not
 * something to read daily — so it becomes a tile like the others and
 * the detail lives on its own page.
 *
 * DEVELOPER ONLY — gated at the call site in dashboard/page.tsx, and
 * both the page and the API route re-check the role.
 */
export function TimeCheckEntryCard() {
  return (
    <Link
      href="/time-check"
      style={{
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        gap: 12,
        height: "100%",
        minHeight: 150,
        textDecoration: "none",
        background: "linear-gradient(135deg, #0f2027 0%, #2c5364 100%)",
        borderRadius: 12,
        padding: "22px 26px",
        boxShadow: "0 4px 16px rgba(15,32,39,0.22)",
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
            color: "#a5f3fc",
            marginBottom: 6,
          }}
        >
          🕐 Developer
        </div>
        <div style={{ fontSize: 22, fontWeight: 700, color: "#fff", letterSpacing: "-0.2px" }}>
          Server time check
        </div>
        <div style={{ fontSize: 12.5, color: "rgba(255,255,255,0.72)", marginTop: 4 }}>
          Server clock vs yours, and the dates the app derives from it
        </div>
      </div>

      <div
        style={{
          position: "relative",
          alignSelf: "flex-start",
          padding: "10px 18px",
          background: "#fff",
          color: "#0f2027",
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
