// ──────────────────────────────────────────────────────────────────
// Dashboard v2 — "command center" redesign (Daksh, Aug 2026).
//
// DEVELOPER-ONLY PREVIEW for now: page.tsx renders this when
// profile.role === "developer" and the untouched v1 layout for every
// other role. Once Daksh approves, the gate widens to the applicable
// roles and v1 retires.
//
// Design: one dark liquid-glass cockpit (same family as the WhatsApp
// daily report + market-news page) instead of v1's stack of mixed
// light/dark cards. Same features, same links, same secrets — new
// skin + layout:
//   • Hero — date, greeting, live IST clock, online users as pills.
//   • Launch grid — the six destination tiles, one uniform glass
//     language with per-destination accent colours.
//   • Desk — email snapshot on the left; a right rail with the two
//     report peeks, the urgent-push entry and the screen-time board.
//   • RoyaltySecretDot stays at the bottom (hover + "aadesh").
//
// IMPORTANT CSS constraint: PeekIframe's modal is position:fixed and
// NOT portaled, so no `transform` / `backdrop-filter` / `filter` on
// any ancestor of its triggers (they'd become the containing block
// and pin the modal inside the tile — the known nested-modal bug).
// Hover feedback is border + glow only, app-wide here.
// ──────────────────────────────────────────────────────────────────

import Link from "next/link";
import type { ReactNode } from "react";
import { PeekIframe } from "@/components/peek-iframe";
import { EmailSnapshotCard } from "./email-snapshot-card";
import { RoyaltySecretDot } from "./royalty-secret-dot";
import { LiveClock } from "./live-clock";

type ScreenTimeRow = { name: string; minutes: number; isOnline: boolean };

const INK = "#eef1f7";
const MUTED = "rgba(255,255,255,0.55)";
const FAINT = "rgba(255,255,255,0.38)";
const GOLD = "#E8C572";
const GLASS_BG = "rgba(255,255,255,0.055)";
const GLASS_BORDER = "1px solid rgba(255,255,255,0.12)";

/** Shared glass-panel shell. */
function Panel({ children, pad = 18, style }: { children: ReactNode; pad?: number; style?: React.CSSProperties }) {
  return (
    <div
      className="dv2-panel"
      style={{
        background: GLASS_BG,
        border: GLASS_BORDER,
        borderRadius: 16,
        padding: pad,
        ...style,
      }}
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

/** One launch tile body — used inside a Link or a PeekIframe trigger.
 *  Daksh Aug 2026: no description line — the kicker + title already say what
 *  it is, and six paragraphs of explanation made the grid noisy. */
function TileBody({ icon, accent, kicker, title, cta }: {
  icon: string; accent: string; kicker: string; title: string; cta: string;
}) {
  return (
    <div
      className="dv2-tile"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 12,
        height: "100%",
        // Fill the grid cell. Without this the tile is only as wide as its
        // own text, so "Carving floor on the wall" made a fat card and
        // "MTCPL-AI" a thin one — the leftover space in each equal-width
        // column read as random gaps between the cards (Daksh).
        width: "100%",
        flex: 1,
        minWidth: 0,
        minHeight: 118,
        background: GLASS_BG,
        border: GLASS_BORDER,
        borderLeft: `3px solid ${accent}`,
        borderRadius: 16,
        padding: "16px 18px",
        cursor: "pointer",
        position: "relative",
        overflow: "hidden",
      }}
    >
      {/* soft accent glow in the corner */}
      <div aria-hidden style={{ position: "absolute", top: -46, right: -46, width: 130, height: 130, borderRadius: "50%", background: `radial-gradient(circle, ${accent}33 0%, transparent 70%)`, pointerEvents: "none" }} />
      <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
        <span style={{ width: 40, height: 40, borderRadius: 12, background: `${accent}22`, border: `1px solid ${accent}55`, display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 19, flexShrink: 0 }}>
          {icon}
        </span>
        <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.14em", textTransform: "uppercase", color: accent }}>
          {kicker}
        </span>
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 17.5, fontWeight: 750, color: INK, letterSpacing: "-0.2px" }}>{title}</div>
      </div>
      <div style={{ marginTop: "auto", fontSize: 12, fontWeight: 700, color: accent }}>{cta}</div>
    </div>
  );
}

/** Compact dark trigger row for the two embedded reports. */
function ReportRowBody({ icon, title, accent }: { icon: string; title: string; accent: string }) {
  return (
    <div
      className="dv2-tile"
      style={{
        display: "flex", alignItems: "center", gap: 12,
        background: GLASS_BG, border: GLASS_BORDER, borderLeft: `3px solid ${accent}`,
        borderRadius: 14, padding: "13px 15px", cursor: "pointer",
      }}
    >
      <span style={{ width: 36, height: 36, borderRadius: 10, background: `${accent}22`, border: `1px solid ${accent}55`, display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 16, flexShrink: 0 }}>
        {icon}
      </span>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 13.5, fontWeight: 750, color: INK }}>{title}</div>
      </div>
      <span style={{ fontSize: 13, fontWeight: 800, color: accent }}>→</span>
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
        borderRadius: 22,
        padding: "clamp(16px, 2.4vw, 30px)",
        background: "linear-gradient(160deg, #0b0e16 0%, #121726 55%, #191f31 100%)",
        border: "1px solid rgba(255,255,255,0.08)",
        boxShadow: "0 18px 60px rgba(0,0,0,0.35)",
        marginBottom: 32,
      }}
    >
      {/* Hover language is border+glow ONLY — see the containing-block note
          at the top of this file before adding transforms here.

          The shell rules below are GLOBAL on purpose: .page-content and
          .topbar belong to the (app) layout, and a dark dashboard framed by
          the cream shell looked like a window with white bezels (Daksh).
          Because this <style> lives inside the v2 tree it is mounted only
          while the v2 dashboard is on screen — navigating away unmounts it
          and the rest of the app stays light. */}
      <style>{`
        .dv2-tile { transition: border-color .16s ease, background .16s ease, box-shadow .16s ease; }
        .dv2-tile:hover { border-color: rgba(255,255,255,.3); background: rgba(255,255,255,.09); box-shadow: 0 10px 34px rgba(0,0,0,.45); }
        .dv2-desk { display: grid; grid-template-columns: minmax(0, 1.65fr) minmax(300px, 1fr); gap: 14px; align-items: start; }
        @media (max-width: 1020px) { .dv2-desk { grid-template-columns: 1fr; } }
        /* Explicit column counts instead of auto-fit: there are 6 tiles, and
           auto-fit happily produced a 5 + 1 orphan row. 6/3/2/1 all divide
           evenly, so every row is always full and the grid stays square. */
        .dv2-launch { display: grid; grid-template-columns: 1fr; gap: 13px; align-items: stretch; }
        @media (min-width: 660px)  { .dv2-launch { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
        @media (min-width: 1040px) { .dv2-launch { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
        @media (min-width: 1620px) { .dv2-launch { grid-template-columns: repeat(6, minmax(0, 1fr)); } }

        /* ── dark shell: no cream bezel around the dark panel ── */
        body { background: #080b12; }
        .page-content { max-width: none; padding: 12px 14px 22px; }
        .topbar { background: #0f1320; border-bottom: 1px solid rgba(255,255,255,0.08); }
        .topbar-label { color: rgba(255,255,255,0.42); }
        .topbar-name { color: #eef1f7; }
        /* Sign out is a transparent button with dark-brown text — invisible
           once the bar goes dark. Same for the ⟳ / ⚙ cream circles. */
        .topbar .secondary-button { color: #eef1f7; border-color: rgba(255,255,255,0.22); }
        .topbar .secondary-button:hover { background: rgba(255,255,255,0.08); }
        .topbar .topbar-settings-btn {
          background: rgba(255,255,255,0.08);
          border-color: rgba(255,255,255,0.16);
          color: rgba(255,255,255,0.78);
        }

        /* Email snapshot stays LIGHT on purpose (Daksh) — it reads as a sheet
           of paper on the dark desk, and it's the one panel you actually read
           word-by-word. No variable overrides here. */
      `}</style>

      {/* Ambient glow blobs behind everything. */}
      <div aria-hidden style={{ position: "absolute", top: -140, right: -100, width: 420, height: 420, borderRadius: "50%", background: "radial-gradient(circle, rgba(232,197,114,0.13) 0%, transparent 65%)", pointerEvents: "none" }} />
      <div aria-hidden style={{ position: "absolute", bottom: -180, left: -140, width: 520, height: 520, borderRadius: "50%", background: "radial-gradient(circle, rgba(99,102,241,0.14) 0%, transparent 65%)", pointerEvents: "none" }} />
      <div aria-hidden style={{ position: "absolute", top: "38%", left: "44%", width: 360, height: 360, borderRadius: "50%", background: "radial-gradient(circle, rgba(14,165,233,0.09) 0%, transparent 65%)", pointerEvents: "none" }} />

      <div style={{ position: "relative", display: "flex", flexDirection: "column", gap: 16 }}>

        {/* ── HERO ── */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 18, flexWrap: "wrap" }}>
          <div style={{ minWidth: 260 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
              <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.16em", textTransform: "uppercase", color: FAINT }}>
                {dateDisplay}
              </span>
              <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: "0.12em", color: "#0b0e16", background: GOLD, borderRadius: 5, padding: "2.5px 7px", textTransform: "uppercase" }}>
                V2 preview
              </span>
            </div>
            <div style={{ fontSize: "clamp(26px, 3.2vw, 36px)", fontWeight: 800, color: "#fff", letterSpacing: "-0.8px", lineHeight: 1.08 }}>
              {greeting},{" "}
              <span style={{ background: "linear-gradient(100deg, #E8C572 0%, #f6e3b4 55%, #E8C572 100%)", WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent" }}>
                {name}
              </span>
            </div>
            {/* Online users as pills. */}
            <div style={{ display: "flex", flexWrap: "wrap", gap: 7, marginTop: 14 }}>
              {onlineNames.length > 0 ? (
                onlineNames.map((n, i) => (
                  <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "rgba(34,197,94,0.1)", border: "1px solid rgba(34,197,94,0.3)", borderRadius: 999, padding: "4px 11px", fontSize: 11.5, fontWeight: 650, color: "#c9f2d9" }}>
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

        <div style={{ height: 1, background: "linear-gradient(90deg, rgba(232,197,114,0.5) 0%, rgba(255,255,255,0.08) 55%, transparent 100%)" }} />

        {/* ── LAUNCH GRID ── */}
        <SectionLabel>Launch</SectionLabel>
        <div className="dv2-launch">
          <Link href="/ask-ai" style={{ textDecoration: "none", display: "flex" }}>
            <TileBody icon="✨" accent="#E8C572" kicker="AI copilot" title="MTCPL-AI" cta="Open chat →" />
          </Link>
          <PeekIframe
            url="/embed/block-journey"
            modalTitle="Block Journey — Real Efficiency"
            triggerContent={
              <TileBody icon="🧭" accent="#86AC5B" kicker="Real efficiency" title="Block Journey" cta="Peek report →" />
            }
          />
          <Link href="/reports/dpr" style={{ textDecoration: "none", display: "flex" }}>
            <TileBody icon="🏭" accent="#34d399" kicker="Production" title="Production DPR" cta="Open →" />
          </Link>
          <Link href="/reports/various-costing" style={{ textDecoration: "none", display: "flex" }}>
            <TileBody icon="📊" accent="#7dd3fc" kicker="Reports" title="Various Costing" cta="Open →" />
          </Link>
          <Link href="/carving/floor?mode=tv" target="_blank" rel="noreferrer" style={{ textDecoration: "none", display: "flex" }}>
            <TileBody icon="📺" accent="#f59e0b" kicker="TV mode" title="Carving floor on the wall" cta="Open in new tab ↗" />
          </Link>
          {showMarketNews && (
            <Link href="/market-news" style={{ textDecoration: "none", display: "flex" }}>
              <TileBody icon="📰" accent="#a5b4fc" kicker="Today's news" title="Market brief & chat" cta="Open →" />
            </Link>
          )}
        </div>

        {/* ── DESK: email left · action rail right ── */}
        <SectionLabel>Today&apos;s desk</SectionLabel>
        <div className="dv2-desk">
          {/* Email snapshot keeps its own light panel — paper on the dark
              desk. Component is shared with v1 and stays untouched. */}
          <div style={{ minWidth: 0 }}>
            <EmailSnapshotCard />
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <PeekIframe
              url="/embed/blocks/report"
              modalTitle="Block Report"
              triggerContent={<ReportRowBody icon="📊" title="Block Report" accent="#818cf8" />}
            />
            <PeekIframe
              url="/embed/slabs/ready"
              modalTitle="Ready Sizes Report"
              triggerContent={<ReportRowBody icon="📋" title="Ready Sizes Report" accent="#fbbf24" />}
            />

            {/* Urgent push — full page entry. */}
            <Link href="/dashboard/push-urgent" id="push" style={{ textDecoration: "none" }}>
              <div className="dv2-tile" style={{ background: "linear-gradient(135deg, rgba(232,197,114,0.14) 0%, rgba(232,197,114,0.05) 100%)", border: "1px solid rgba(232,197,114,0.35)", borderRadius: 14, padding: "14px 15px", cursor: "pointer" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 750, color: INK }}>🔔 Push urgent alert</div>
                  <span style={{ fontSize: 12, fontWeight: 800, color: "#0b0e16", background: GOLD, borderRadius: 8, padding: "5px 12px", whiteSpace: "nowrap" }}>Open →</span>
                </div>
                {/* Only the live number survives — the how-it-works sentence
                    was noise on a page you open every day. */}
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
                        <div style={{ flex: 1, height: 5, background: "rgba(255,255,255,0.1)", borderRadius: 3, overflow: "hidden" }}>
                          <div style={{ width: `${barW}%`, height: "100%", background: `linear-gradient(90deg, ${GOLD} 0%, #b98a3e 100%)`, borderRadius: 3 }} />
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
