// ──────────────────────────────────────────────────────────────────
// Dashboard v2 — "command center" redesign (Daksh, Aug 2026).
//
// DEVELOPER-ONLY PREVIEW: page.tsx renders this when profile.role ===
// "developer"; every other role keeps the v1 layout until Daksh
// approves, then the gate widens.
//
// THEMED (Daksh: "how light version will look") — the board follows the
// app's existing theme toggle ([data-theme="dark"] on <html>, sidebar
// "Dark mode"). Every colour flows through --dv2-* custom properties:
// the light skin matches the app's cream/white language, the dark skin
// is the original liquid-glass cockpit. The server can't know the
// client's theme, so ALL theming is CSS — no JS branches.
//
// IMPORTANT CSS constraint: PeekIframe's modal is position:fixed and
// NOT portaled, so no `transform` / `backdrop-filter` / `filter` on any
// ancestor of its triggers (containing-block bug). Hover is border+glow.
// ──────────────────────────────────────────────────────────────────

import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import { PeekIframe } from "@/components/peek-iframe";
import { EmailSnapshotCard } from "./email-snapshot-card";
import { RoyaltySecretDot } from "./royalty-secret-dot";
import { LiveClock } from "./live-clock";

type ScreenTimeRow = { name: string; minutes: number; isOnline: boolean };

// Theme-var aliases — every usage below resolves per-theme via the
// .dv2-root variable blocks in the <style> tag.
const INK = "var(--dv2-ink)";
const MUTED = "var(--dv2-muted)";
const FAINT = "var(--dv2-faint)";
const GOLD = "var(--dv2-gold)";
const CARD_BG = "var(--dv2-card-bg)";
const CARD_BORDER = "1px solid var(--dv2-card-border)";

/** Shared panel shell. */
function Panel({ children, pad = 18, style }: { children: ReactNode; pad?: number; style?: CSSProperties }) {
  return (
    <div
      className="dv2-panel"
      style={{ background: CARD_BG, border: CARD_BORDER, borderRadius: 4, padding: pad, ...style }}
    >
      {children}
    </div>
  );
}

/** Small uppercase section label with a gold tick. */
function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "2px 2px 0" }}>
      <span style={{ width: 16, height: 2.5, background: GOLD, borderRadius: 2, display: "inline-block" }} />
      <span style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: "0.16em", textTransform: "uppercase", color: FAINT }}>
        {children}
      </span>
    </div>
  );
}

/** One launch tile — ledger-entry style (Daksh: the icon-squircle +
 *  kicker-label card read as generic AI dashboard). Sharp corners, a
 *  mono index number, title, arrow. `accent`/`accentLight` = per-theme
 *  left-rule + arrow colours via the .dv2-acc rule. */
function TileBody({ index, icon, accent, accentLight, title, cta }: {
  index: string; icon: string; accent: string; accentLight: string; title: string; cta: string;
}) {
  return (
    <div
      className="dv2-tile"
      style={{
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        gap: 8,
        height: "100%",
        // Fill the grid cell — content-width tiles made uneven gaps (Daksh).
        width: "100%",
        flex: 1,
        minWidth: 0,
        minHeight: 84,
        background: CARD_BG,
        border: CARD_BORDER,
        borderLeft: `3px solid ${accentLight}`,
        borderRadius: 4,
        padding: "12px 14px",
        cursor: "pointer",
        position: "relative",
        overflow: "hidden",
        // Per-tile accent pair consumed by the themed CSS rules.
        ["--ta" as never]: accent,
        ["--tal" as never]: accentLight,
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
        <span style={{ fontFamily: "ui-monospace, monospace", fontSize: 10.5, fontWeight: 700, color: FAINT, letterSpacing: "0.08em" }}>
          {index}
        </span>
        <span className="dv2-acc" style={{ fontSize: 14, fontWeight: 800, lineHeight: 1 }}>{cta}</span>
      </div>
      <div style={{ minWidth: 0, fontSize: 15.5, fontWeight: 750, color: INK, letterSpacing: "-0.2px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        <span aria-hidden style={{ marginRight: 7 }}>{icon}</span>
        {title}
      </div>
    </div>
  );
}

/** Compact trigger row for the two embedded reports — same ledger style. */
function ReportRowBody({ icon, title, accent, accentLight }: { icon: string; title: string; accent: string; accentLight: string }) {
  return (
    <div
      className="dv2-tile"
      style={{
        display: "flex", alignItems: "center", gap: 10,
        background: CARD_BG, border: CARD_BORDER, borderLeft: `3px solid ${accentLight}`,
        borderRadius: 4, padding: "12px 14px", cursor: "pointer",
        ["--ta" as never]: accent,
        ["--tal" as never]: accentLight,
      }}
    >
      <div style={{ minWidth: 0, flex: 1, fontSize: 13.5, fontWeight: 750, color: INK }}>
        <span aria-hidden style={{ marginRight: 7 }}>{icon}</span>
        {title}
      </div>
      <span className="dv2-acc" style={{ fontSize: 13, fontWeight: 800 }}>→</span>
    </div>
  );
}

export function DashboardV2({
  greeting, name, dateDisplay, onlineNames, pushCount, screenTime, showMarketNews,
}: {
  greeting: string;
  name: string;
  dateDisplay: string;
  onlineNames: string[];
  pushCount: number;
  screenTime: ScreenTimeRow[];
  showMarketNews: boolean;
}) {
  const maxMin = screenTime[0]?.minutes ?? 1;

  return (
    <div
      className="dv2-root"
      style={{
        position: "relative",
        overflow: "hidden",
        borderRadius: 6,
        padding: "clamp(16px, 2.4vw, 30px)",
        background: "var(--dv2-root-bg)",
        border: "1px solid var(--dv2-root-border)",
        boxShadow: "var(--dv2-root-shadow)",
        marginBottom: 32,
      }}
    >
      {/* Theme system: light = the app's cream/white language (default);
          [data-theme="dark"] = the liquid-glass cockpit. Shell recolours
          (body/topbar) apply in DARK ONLY — the light board sits happily in
          the stock shell. These rules mount only while v2 is on screen.
          Hover = border+glow only (PeekIframe containing-block bug). */}
      <style>{`
        .dv2-root {
          --dv2-root-bg: var(--surface);
          --dv2-root-border: var(--border);
          --dv2-root-shadow: 0 4px 20px rgba(45,36,16,0.06);
          --dv2-ink: var(--text);
          --dv2-muted: var(--muted);
          --dv2-faint: var(--muted-light);
          --dv2-gold: var(--gold-dark);
          --dv2-badge-ink: #ffffff;
          --dv2-card-bg: var(--surface-alt, #FAF8F5);
          --dv2-card-border: var(--border);
          --dv2-track: var(--border);
          --dv2-push-bg: linear-gradient(135deg, rgba(180,140,40,0.10) 0%, rgba(180,140,40,0.03) 100%);
          --dv2-push-border: rgba(180,140,40,0.45);
          --dv2-divider: linear-gradient(90deg, rgba(180,140,40,0.55) 0%, rgba(45,36,16,0.10) 55%, transparent 100%);
        }
        [data-theme="dark"] .dv2-root {
          --dv2-root-bg: linear-gradient(160deg, #0b0e16 0%, #121726 55%, #191f31 100%);
          --dv2-root-border: rgba(255,255,255,0.08);
          --dv2-root-shadow: 0 18px 60px rgba(0,0,0,0.35);
          --dv2-ink: #eef1f7;
          --dv2-muted: rgba(255,255,255,0.55);
          --dv2-faint: rgba(255,255,255,0.38);
          --dv2-gold: #E8C572;
          --dv2-badge-ink: #0b0e16;
          --dv2-card-bg: rgba(255,255,255,0.055);
          --dv2-card-border: rgba(255,255,255,0.12);
          --dv2-track: rgba(255,255,255,0.10);
          --dv2-push-bg: linear-gradient(135deg, rgba(232,197,114,0.14) 0%, rgba(232,197,114,0.05) 100%);
          --dv2-push-border: rgba(232,197,114,0.35);
          --dv2-divider: linear-gradient(90deg, rgba(232,197,114,0.5) 0%, rgba(255,255,255,0.08) 55%, transparent 100%);
        }

        /* Per-tile accent: light uses the darker twin (--tal), dark the neon (--ta). */
        .dv2-root .dv2-acc { color: var(--tal); }
        [data-theme="dark"] .dv2-root .dv2-acc { color: var(--ta); }
        .dv2-root .dv2-blob { display: none; }
        [data-theme="dark"] .dv2-root .dv2-blob { display: block; }

        .dv2-tile { transition: border-color .16s ease, background .16s ease, box-shadow .16s ease; }
        .dv2-tile:hover { border-color: var(--gold-border, #d8c49a); background: var(--surface); box-shadow: 0 8px 24px rgba(45,36,16,0.10); }
        [data-theme="dark"] .dv2-tile:hover { border-color: rgba(255,255,255,.3); background: rgba(255,255,255,.09); box-shadow: 0 10px 34px rgba(0,0,0,.45); }

        .dv2-desk { display: grid; grid-template-columns: minmax(0, 1.65fr) minmax(300px, 1fr); gap: 14px; align-items: start; }
        @media (max-width: 1020px) { .dv2-desk { grid-template-columns: 1fr; } }
        /* 6 tiles: explicit 6/3/2/1 columns so a row is never left half-empty. */
        .dv2-launch { display: grid; grid-template-columns: 1fr; gap: 13px; align-items: stretch; }
        @media (min-width: 660px)  { .dv2-launch { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
        @media (min-width: 1040px) { .dv2-launch { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
        @media (min-width: 1620px) { .dv2-launch { grid-template-columns: repeat(6, minmax(0, 1fr)); } }

        /* ── shell: full width always; dark recolour only in dark theme ── */
        .page-content { max-width: none; padding: 12px 14px 22px; }
        [data-theme="dark"] body { background: #080b12; }
        [data-theme="dark"] .topbar { background: #0f1320; border-bottom: 1px solid rgba(255,255,255,0.08); }
        [data-theme="dark"] .topbar-label { color: rgba(255,255,255,0.42); }
        [data-theme="dark"] .topbar-name { color: #eef1f7; }
        [data-theme="dark"] .topbar .secondary-button { color: #eef1f7; border-color: rgba(255,255,255,0.22); }
        [data-theme="dark"] .topbar .secondary-button:hover { background: rgba(255,255,255,0.08); }
        [data-theme="dark"] .topbar .topbar-settings-btn {
          background: rgba(255,255,255,0.08);
          border-color: rgba(255,255,255,0.16);
          color: rgba(255,255,255,0.78);
        }
      `}</style>

      {/* Ambient glow blobs — dark skin only. */}
      <div className="dv2-blob" aria-hidden style={{ position: "absolute", top: -140, right: -100, width: 420, height: 420, borderRadius: "50%", background: "radial-gradient(circle, rgba(232,197,114,0.13) 0%, transparent 65%)", pointerEvents: "none" }} />
      <div className="dv2-blob" aria-hidden style={{ position: "absolute", bottom: -180, left: -140, width: 520, height: 520, borderRadius: "50%", background: "radial-gradient(circle, rgba(99,102,241,0.14) 0%, transparent 65%)", pointerEvents: "none" }} />
      <div className="dv2-blob" aria-hidden style={{ position: "absolute", top: "38%", left: "44%", width: 360, height: 360, borderRadius: "50%", background: "radial-gradient(circle, rgba(14,165,233,0.09) 0%, transparent 65%)", pointerEvents: "none" }} />

      <div style={{ position: "relative", display: "flex", flexDirection: "column", gap: 16 }}>

        {/* ── HERO ── */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 18, flexWrap: "wrap" }}>
          <div style={{ minWidth: 260 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
              <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.16em", textTransform: "uppercase", color: FAINT }}>
                {dateDisplay}
              </span>
              <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: "0.12em", color: "var(--dv2-badge-ink)", background: GOLD, borderRadius: 2, padding: "2.5px 7px", textTransform: "uppercase" }}>
                V2 preview
              </span>
            </div>
            <div style={{ fontSize: "clamp(26px, 3.2vw, 36px)", fontWeight: 800, color: INK, letterSpacing: "-0.8px", lineHeight: 1.08 }}>
              {greeting}, <span style={{ color: GOLD }}>{name}</span>
            </div>
            {/* Online users as pills. */}
            <div style={{ display: "flex", flexWrap: "wrap", gap: 7, marginTop: 14 }}>
              {onlineNames.length > 0 ? (
                onlineNames.map((n, i) => (
                  <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "rgba(34,197,94,0.10)", border: "1px solid rgba(34,197,94,0.35)", borderRadius: 999, padding: "4px 11px", fontSize: 11.5, fontWeight: 650, color: "#15803d" }}>
                    <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#22c55e", boxShadow: "0 0 0 3px rgba(34,197,94,0.22)", display: "inline-block" }} />
                    {n}
                  </span>
                ))
              ) : (
                <span style={{ fontSize: 11.5, color: FAINT }}>No other users online right now</span>
              )}
            </div>
          </div>
          <LiveClock />
        </div>

        <div style={{ height: 1, background: "var(--dv2-divider)" }} />

        {/* ── LAUNCH GRID ── */}
        <SectionLabel>Launch</SectionLabel>
        <div className="dv2-launch">
          <Link href="/ask-ai" style={{ textDecoration: "none", display: "flex" }}>
            <TileBody index="01" icon="✨" accent="#E8C572" accentLight="#a16207" title="MTCPL-AI" cta="→" />
          </Link>
          <PeekIframe
            url="/embed/block-journey"
            modalTitle="Block Journey — Real Efficiency"
            triggerContent={
              <TileBody index="02" icon="🧭" accent="#86AC5B" accentLight="#3f6212" title="Block Journey" cta="→" />
            }
          />
          <Link href="/reports/dpr" style={{ textDecoration: "none", display: "flex" }}>
            <TileBody index="03" icon="🏭" accent="#34d399" accentLight="#047857" title="Production DPR" cta="→" />
          </Link>
          {/* Aug 2026 — one "Various Costing" tile used to point at a
              landing page whose only content was these two choices.
              That page now redirects, so the reports are their own
              tiles and the extra hop is gone. */}
          <Link href="/reports/various-costing/cnc" style={{ textDecoration: "none", display: "flex" }}>
            <TileBody index="04" icon="🛠" accent="#7dd3fc" accentLight="#0369a1" title="CNC Costing" cta="→" />
          </Link>
          <Link href="/reports/various-costing/cutter" style={{ textDecoration: "none", display: "flex" }}>
            <TileBody index="05" icon="✂" accent="#7dd3fc" accentLight="#0369a1" title="Cutter Costing" cta="→" />
          </Link>
          <Link href="/carving/floor?mode=tv" target="_blank" rel="noreferrer" style={{ textDecoration: "none", display: "flex" }}>
            <TileBody index="06" icon="📺" accent="#f59e0b" accentLight="#b45309" title="Carving floor on the wall" cta="↗" />
          </Link>
          {showMarketNews && (
            <Link href="/market-news" style={{ textDecoration: "none", display: "flex" }}>
              <TileBody index="07" icon="📰" accent="#a5b4fc" accentLight="#4f46e5" title="Market brief & chat" cta="→" />
            </Link>
          )}
        </div>

        {/* ── DESK: email left · action rail right ── */}
        <SectionLabel>Today&apos;s desk</SectionLabel>
        <div className="dv2-desk">
          {/* Email snapshot themes itself off the app-wide vars (they flip
              with [data-theme]), so it matches both skins untouched. */}
          <div style={{ minWidth: 0 }}>
            <EmailSnapshotCard />
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <PeekIframe
              url="/embed/blocks/report"
              modalTitle="Block Report"
              triggerContent={<ReportRowBody icon="📊" title="Block Report" accent="#818cf8" accentLight="#4f46e5" />}
            />
            <PeekIframe
              url="/embed/slabs/ready"
              modalTitle="Ready Sizes Report"
              triggerContent={<ReportRowBody icon="📋" title="Ready Sizes Report" accent="#fbbf24" accentLight="#b45309" />}
            />

            {/* Urgent push — full page entry. */}
            <Link href="/dashboard/push-urgent" id="push" style={{ textDecoration: "none" }}>
              <div className="dv2-tile" style={{ background: "var(--dv2-push-bg)", border: "1px solid var(--dv2-push-border)", borderRadius: 4, padding: "13px 14px", cursor: "pointer" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 750, color: INK }}>🔔 Push urgent alert</div>
                  <span style={{ fontSize: 12, fontWeight: 800, color: "var(--dv2-badge-ink)", background: GOLD, borderRadius: 8, padding: "5px 12px", whiteSpace: "nowrap" }}>Open →</span>
                </div>
                <div style={{ fontSize: 11, color: MUTED, marginTop: 6 }}>
                  <b style={{ color: GOLD }}>{pushCount.toLocaleString("en-IN")}</b>{" "}open / planned slabs
                </div>
              </div>
            </Link>

            {/* Screen time leaderboard. */}
            {screenTime.length > 0 && (
              <Panel pad={15}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 11 }}>
                  <span style={{ fontSize: 12.5, fontWeight: 750, color: INK }}>🕐 Screen time today</span>
                  <Link href="/settings" style={{ fontSize: 10.5, color: GOLD, fontWeight: 700, textDecoration: "none" }}>Details →</Link>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {screenTime.slice(0, 6).map((row, i) => {
                    const hours = Math.floor(row.minutes / 60);
                    const mins = row.minutes % 60;
                    const label = hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
                    const barW = Math.max(8, Math.round((row.minutes / maxMin) * 100));
                    return (
                      <div key={i} style={{ display: "flex", alignItems: "center", gap: 9 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 86, flex: "0 0 86px" }}>
                          {row.isOnline && <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#22c55e", flexShrink: 0, boxShadow: "0 0 0 2px rgba(34,197,94,0.25)" }} />}
                          <span style={{ fontSize: 11.5, fontWeight: 650, color: INK, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{row.name}</span>
                        </div>
                        <div style={{ flex: 1, height: 5, background: "var(--dv2-track)", borderRadius: 3, overflow: "hidden" }}>
                          <div style={{ width: `${barW}%`, height: "100%", background: `linear-gradient(90deg, ${"var(--dv2-gold)"} 0%, #b98a3e 100%)`, borderRadius: 3 }} />
                        </div>
                        <span style={{ fontSize: 11.5, fontWeight: 750, color: INK, minWidth: 44, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{label}</span>
                      </div>
                    );
                  })}
                  {screenTime.length > 6 && (
                    <div style={{ fontSize: 10.5, color: FAINT, textAlign: "center", paddingTop: 2 }}>
                      +{screenTime.length - 6} more — <Link href="/settings" style={{ color: GOLD, textDecoration: "none" }}>view all</Link>
                    </div>
                  )}
                </div>
              </Panel>
            )}
          </div>
        </div>

        {/* Secret royalty entry — unchanged behaviour (hover + "aadesh"). */}
        <div style={{ marginTop: 10, display: "flex", justifyContent: "center" }}>
          <RoyaltySecretDot />
        </div>
      </div>
    </div>
  );
}
