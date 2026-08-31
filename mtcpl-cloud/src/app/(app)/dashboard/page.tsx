import Link from "next/link";
import { istDateLabel, istDayRange, istHour } from "@/lib/ist";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { requireAuth, getDefaultRouteForRole } from "@/lib/auth";
import { CockpitDashboard } from "./cockpit";
import { DashViewToggle } from "./view-toggle";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { canTransferPlannedSlabs } from "@/lib/cutting-permissions";
import { AskAiEntryCard } from "@/components/ask-ai-entry-card";
import { BlockJourneyEntryCard } from "@/components/block-journey-entry-card";
import { TvModeEntryCard } from "@/components/tv-mode-entry-card";
import { EmailSnapshotCard } from "./email-snapshot-card";
import { RoyaltySecretDot } from "./royalty-secret-dot";
import { MarketNewsEntryCard } from "@/components/market-news-entry-card";
import { canSeeMarketNews } from "@/lib/market-news-access";
import { VariousCostingEntryCard } from "@/components/various-costing-entry-card";
import { TemplePnlEntryCard } from "@/components/temple-pnl-entry-card";
import { TimeCheckCard } from "./time-check-card";
import { TenderEntryCard } from "@/components/tender-entry-card";
import { canUseTender } from "@/app/(app)/reports/temple-pnl/tender-model";
import {
  canViewVariousCosting,
  canViewCncCosts,
  canViewCutterCosts,
} from "@/lib/expenses-permissions";
import { DprEntryCard } from "@/components/dpr-entry-card";
import { CncLogbookEntryCard } from "@/components/cnc-logbook-entry-card";
import { PeekIframe } from "@/components/peek-iframe";

/**
 * IST midnight today / start / end — used to scope Screen Time pings.
 * Delegates to lib/ist so the timezone maths lives in one place; the
 * old inline version read the right day on a UTC server and the wrong
 * one on an IST laptop.
 */
function istToday(daysAgo = 0) {
  return istDayRange(daysAgo);
}

/** "PARESH KUMAR" → "PK" — for the hero's online-user avatars. */
function initialsOf(name: string | null): string {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return parts.slice(0, 2).map((w) => w[0]!.toUpperCase()).join("");
}

export default async function DashboardPage() {
  // Permissive auth + explicit guard. We need to allow Rajesh
  // (whose stored role is team_head, not owner) onto the dashboard
  // so he can see his stripped Block-Journey-only variant.
  // canTransferPlannedSlabs catches him by name.
  const { profile } = await requireAuth();
  const isDashboardAllowed =
    profile.role === "owner" ||
    profile.role === "developer" ||
    canTransferPlannedSlabs(profile);
  if (!isDashboardAllowed) {
    redirect(getDefaultRouteForRole(profile.role));
  }

  // ── Per-owner stripped dashboards ────────────────────────────────
  // Rajesh has asked for a dashboard that shows ONLY the Block Journey
  // entry card — nothing else. He uses Block Journey as his primary
  // entry point and finds the rest of the dashboard noisy. Detect him
  // by name (substring, case-insensitive — same pattern as
  // canTransferPlannedSlabs in cutting-permissions.ts).
  //
  // Early-return here BEFORE any of the heavy data queries so this
  // login path stays fast and zero-cost.
  const fullName = (profile.full_name ?? "").toUpperCase();
  if (fullName.includes("RAJESH")) {
    // Same double-offset fix as the main hero below.
    const hr = istHour();
    const greeting = hr < 12 ? "Good morning" : hr < 17 ? "Good afternoon" : "Good evening";
    const dateDisplay = istDateLabel();
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 20, paddingBottom: 32 }}>
        {/* Lightweight greeting header — same .dash-hero chrome as the
            main dashboard, just without the online-users panel. */}
        <div className="dash-hero">
          <div className="dash-hero-left">
            <div className="dash-hero-tile" aria-hidden>
              {hr < 12 ? "🌅" : hr < 17 ? "☀️" : "🌙"}
            </div>
            <div style={{ minWidth: 0 }}>
              <div className="dash-hero-date">{dateDisplay}</div>
              <div className="dash-hero-title">
                {greeting}, <span className="dash-hero-name">{profile.full_name || "there"}</span>
              </div>
              <div className="dash-hero-sub">Open Block Journey to track inventory throughput.</div>
            </div>
          </div>
        </div>

        {/* The single card Rajesh wants. Full-width on this dashboard. */}
        <BlockJourneyEntryCard />
      </div>
    );
  }

  // ── Cockpit toggle (Daksh, Aug 2026) — developer only. The classic
  // dashboard below stays untouched and remains the default; the
  // dash_view cookie (set by /dashboard/switch-view) flips this ONE
  // login to the new cockpit view. Early-return so the classic page's
  // heavy queries never run when the cockpit is showing.
  if (profile.role === "developer") {
    const view = (await cookies()).get("dash_view")?.value;
    if (view === "cockpit") return <CockpitDashboard profile={profile} />;
  }

  const admin = createAdminSupabaseClient();

  const today = istToday(0);
  const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();

  // Paginated fetch for the urgent-alert push panel — Supabase's
  // PostgREST caps single .select() calls at 1000 rows. Once total
  // open+planned slabs cross that threshold (currently 1500+), the
  // panel silently truncates and shows "Show all 1000 slabs (997 more)"
  // even when the real total is way higher. Loop in 1000-row pages
  // via .range() to grab everything.
  type PushableSlabRow = {
    id: string;
    label: string | null;
    temple: string;
    stone: string | null;
    status: string;
    priority: boolean | null;
    deadline: string | null;
    priority_note: string | null;
  };
  async function fetchAllPushableSlabs(): Promise<PushableSlabRow[]> {
    const PAGE = 1000;
    const out: PushableSlabRow[] = [];
    for (let offset = 0; offset < 50000; offset += PAGE) {
      const { data, error } = await admin
        .from("slab_requirements")
        .select("id, label, temple, stone, status, priority, deadline, priority_note")
        .in("status", ["open", "planned"])
        .order("priority", { ascending: false })
        .order("created_at", { ascending: true })
        .range(offset, offset + PAGE - 1);
      if (error) throw new Error(error.message);
      if (!data || data.length === 0) break;
      out.push(...(data as PushableSlabRow[]));
      if (data.length < PAGE) break;
    }
    return out;
  }

  const [
    { data: prioritySlabs },
    pushableSlabs,
    { data: onlineUsers },
  ] = await Promise.all([
    admin
      .from("slab_requirements")
      .select("id, label, temple, deadline, priority_note")
      .eq("priority", true)
      .in("status", ["open", "planned"]),
    fetchAllPushableSlabs(),
    admin
      .from("profiles")
      .select("id, full_name, role")
      .gte("last_seen_at", fiveMinAgo),
  ]);

  // ── Screen time today (heartbeat pings) ──────────────────────────
  const hbRes = await admin
    .from("heartbeat_log")
    .select("user_id, created_at")
    .gte("created_at", today.start)
    .lte("created_at", today.end);
  const heartbeatPings = hbRes.error ? [] : (hbRes.data ?? []);

  const screenTimeMap = new Map<string, number>();
  const screenTimeLastSeen = new Map<string, string>();
  for (const p of heartbeatPings) {
    screenTimeMap.set(p.user_id, (screenTimeMap.get(p.user_id) ?? 0) + 1);
    const prev = screenTimeLastSeen.get(p.user_id) ?? "";
    if (p.created_at > prev) screenTimeLastSeen.set(p.user_id, p.created_at);
  }

  let screenTimeRows: Array<{ name: string; minutes: number; isOnline: boolean }> = [];
  if (screenTimeMap.size > 0) {
    const stUids = [...screenTimeMap.keys()];
    const { data: stProfiles } = await admin
      .from("profiles")
      .select("id, full_name, phone")
      .in("id", stUids);
    const stNameMap = new Map<string, string>();
    for (const p of stProfiles ?? []) stNameMap.set(p.id, p.full_name || p.phone || "Unknown");

    screenTimeRows = stUids
      .map((uid) => {
        const pings = screenTimeMap.get(uid) ?? 0;
        const last = screenTimeLastSeen.get(uid) ?? "";
        const isOnline = last ? Date.now() - new Date(last).getTime() < 5 * 60 * 1000 : false;
        return { name: stNameMap.get(uid) ?? "Unknown", minutes: pings * 2, isOnline };
      })
      .sort((a, b) => b.minutes - a.minutes);
  }

  // ── Derived display values ────────────────────────────────────────
  // pushableSlabs is now non-null (paginated fetcher returns []) so no
  // ?? needed. Coerce nullable label/priority to non-null shapes the
  // PushPanel expects.
  const pushList = pushableSlabs.map((s) => ({
    id: s.id,
    label: s.label ?? "",
    temple: s.temple,
    stone: s.stone,
    status: s.status,
    priority: s.priority ?? false,
    deadline: s.deadline,
    priority_note: s.priority_note,
  }));
  const onlineList = onlineUsers ?? [];

  // Aug 2026 — this read the IST wall clock into a string, parsed it
  // back as server-local time, then formatted it into IST again. The
  // +5:30 landed twice, so after 18:30 IST production showed tomorrow
  // ("Friday, 28 August" at 23:14 on Thursday the 27th). Format the
  // instant directly instead.
  const hr = istHour();
  const greeting = hr < 12 ? "Good morning" : hr < 17 ? "Good afternoon" : "Good evening";
  const ownerName = profile.full_name || "there";
  const dateDisplay = istDateLabel();

  // Priority count is passed to PushPanel via `pushableSlabs` so PushPanel
  // can show its own urgent-list state. We just need the raw query on the page
  // (no derived value needed here).
  void prioritySlabs;

  const isOwnerOrDev = profile.role === "owner" || profile.role === "developer";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20, paddingBottom: 32 }}>

      {/* Dev-only switch to the new Cockpit view — everyone else never
          sees this and the classic dashboard stays exactly as-is. */}
      {profile.role === "developer" && <DashViewToggle current="classic" />}

      {/* Server-vs-browser clock, developer only. Sits at the top so a
          wrong date is the first thing seen, not something to go
          hunting for. */}
      {profile.role === "developer" && <TimeCheckCard />}

      {/* ── GREETING HEADER ── styled by .dash-hero (globals.css):
          same card, richer finish — layered gold glows, hairline ring,
          gradient name, time-of-day tile, and online users as
          initial-avatars + names instead of one long comma pill. */}
      <div className="dash-hero">
        <div className="dash-hero-left">
          <div className="dash-hero-tile" aria-hidden>
            {hr < 12 ? "🌅" : hr < 17 ? "☀️" : "🌙"}
          </div>
          <div style={{ minWidth: 0 }}>
            <div className="dash-hero-date">{dateDisplay}</div>
            <div className="dash-hero-title">
              {greeting}, <span className="dash-hero-name">{ownerName}</span>
            </div>
            <div className="dash-hero-sub">Here&apos;s your operations overview</div>
          </div>
        </div>
        {onlineList.length > 0 ? (
          <div
            className="dash-online"
            // Full list on hover, since the visible line clamps at two rows.
            title={onlineList.map((u) => u.full_name || "—").join(", ")}
          >
            <div className="dash-avatars">
              {onlineList.slice(0, 5).map((u) => (
                <span key={u.id} className="dash-avatar">{initialsOf(u.full_name)}</span>
              ))}
              {onlineList.length > 5 && (
                <span className="dash-avatar dash-avatar-more">+{onlineList.length - 5}</span>
              )}
            </div>
            <div className="dash-online-meta">
              <div className="dash-online-label">
                <span className="dash-online-dot" /> Online now · {onlineList.length}
              </div>
              <div className="dash-online-names">
                {onlineList.map((u) => u.full_name || "—").join(", ")}
              </div>
            </div>
          </div>
        ) : (
          <div className="dash-online-empty">No other users online</div>
        )}
      </div>

      {/* ── ASK AI / BLOCK JOURNEY / TV MODE ENTRIES ──
          ID Lookup moved to the topbar (TopbarIdLookup) so anyone
          on the workshop floor can pull up a slab/block status from
          any page, not just the dashboard. Three cards remain;
          grid still auto-fits and equalises heights. */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
          gap: 12,
          alignItems: "stretch",
        }}
      >
        <AskAiEntryCard />
        <BlockJourneyEntryCard />
        {/* Production DPR + CNC Logbook — owner/developer only. */}
        {isOwnerOrDev && <DprEntryCard />}
        {isOwnerOrDev && <CncLogbookEntryCard />}
        {/* Two reports, straight off the card — the old
            /reports/various-costing landing in between did nothing but
            show these same two choices. Its per-report gate moves here
            so we don't render a button that only leads to a redirect;
            both report pages still enforce their own. */}
        {canViewVariousCosting(profile) && (
          <VariousCostingEntryCard
            canCnc={canViewCncCosts(profile)}
            canCutter={canViewCutterCosts(profile)}
          />
        )}
        <TvModeEntryCard />
        {/* Owner-only market-news brief + chat (liquid-glass page). */}
        {canSeeMarketNews(profile) && <MarketNewsEntryCard />}
        {/* Temple P&L — developer only while the cost-allocation model is
            still being agreed (the page re-checks the role). */}
        {profile.role === "developer" && <TemplePnlEntryCard />}
        {canUseTender(profile.role) && <TenderEntryCard />}
      </div>

      {/* ── EMAIL SNAPSHOT (June 2026) — owner/dev only. AI-picked
          important emails from the owner's Gmail, summarized. The
          mailbox link is read-only (IMAP, no SMTP in the codebase). */}
      {isOwnerOrDev && (
        <EmailSnapshotCard />
      )}

      {/* Today's News moved to its own liquid-glass page (/market-news),
          reached from the owner-only MarketNewsEntryCard above. */}
      {/* Daily WhatsApp work-report controls live in Settings → "Daily
          WhatsApp report" (recipients, preview, send test). */}

      {/* ── REPORT BUTTONS ──
          Both reports open as center-peek iframe modals over /embed
          routes so the dashboard never goes through a full nav.
          Mig follow-on (Daksh, May 2026): the two cards used to be
          plain white tiles next to four saturated gradient hero
          cards above — felt under-styled. Pumped up the look with
          a tinted gradient + a thick coloured left border + a
          soft shadow so they read like first-class entries while
          keeping the same shape (icon · title · subtitle · Open). */}
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        {/* Block Report opens as a real full page now (Daksh, Aug 2026), not
            the cramped centre-peek iframe — the report grew a stock-snapshot
            header and a wide table that needed the room. ?from=dashboard tells
            its Back button to return here. */}
        <div style={{ flex: "1 1 220px", display: "flex" }}>
          <Link
            href="/blocks/report?from=dashboard"
            style={{
              flex: 1,
              textDecoration: "none",
              color: "inherit",
              display: "flex",
              alignItems: "center",
              padding: "18px 22px 18px 26px",
              background: "linear-gradient(135deg, #ffffff 0%, #eef4ff 100%)",
              border: "1px solid #c7d2fe",
              borderLeft: "4px solid #4f46e5",
              borderRadius: 12,
              boxShadow: "0 1px 2px rgba(15,23,42,0.04), 0 4px 12px rgba(15,23,42,0.06)",
              fontWeight: 600,
            }}
          >
            <span style={{ marginRight: 6 }}>📊</span>
            Block Report
          </Link>
        </div>

        <div style={{ flex: "1 1 220px", display: "flex" }}>
          <PeekIframe
            url="/embed/slabs/ready"
            triggerIcon="📋"
            triggerLabel="Ready Sizes Report"
            modalTitle="Ready Sizes Report"
            triggerStyle={{
              flex: 1,
              padding: "18px 22px 18px 26px",
              background:
                "linear-gradient(135deg, #ffffff 0%, #fff7ec 100%)",
              border: "1px solid #fde7c1",
              borderLeft: "4px solid #d97706",
              borderRadius: 12,
              boxShadow:
                "0 1px 2px rgba(15,23,42,0.04), 0 4px 12px rgba(15,23,42,0.06)",
            }}
          />
        </div>
      </div>

      {/* ── PUSH ALERT PANEL ──
          Moved to its own full page (/dashboard/push-urgent). The old
          centred modal rendered every open/planned slab at once and was
          slow to open; the page also flags slabs already in an outsource
          work order so the owner can spot what's still free to assign. */}
      <div id="push">
        <Link
          href="/dashboard/push-urgent"
          style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", background: "var(--surface)", border: "2px solid var(--gold-border)", borderRadius: 10, padding: "16px 20px", textDecoration: "none", color: "inherit" }}
        >
          <div>
            <div style={{ fontWeight: 700, fontSize: 14, color: "var(--text)" }}>🔔 Push Urgent Alert to Workers</div>
            <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 3 }}>
              {pushList.length} open / planned slabs · mark urgent + see which are already in a work order →
            </div>
          </div>
          <span style={{ fontSize: 13, fontWeight: 700, color: "#fff", background: "var(--gold)", borderRadius: 8, padding: "8px 16px", whiteSpace: "nowrap" }}>Open page →</span>
        </Link>
      </div>

      {/* ── SCREEN TIME TODAY ── */}
      {screenTimeRows.length > 0 && (
        <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden" }}>
          <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={{ fontWeight: 700, fontSize: 13 }}>🕐 Screen Time Today</span>
            <Link href="/settings" style={{ fontSize: 11, color: "var(--gold-dark)", fontWeight: 600, textDecoration: "none" }}>Details →</Link>
          </div>
          <div style={{ padding: "12px 18px", display: "flex", flexDirection: "column", gap: 8 }}>
            {screenTimeRows.slice(0, 6).map((row, i) => {
              const hours = Math.floor(row.minutes / 60);
              const mins = row.minutes % 60;
              const label = hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
              const maxMin = screenTimeRows[0]?.minutes ?? 1;
              const barW = Math.max(8, Math.round((row.minutes / maxMin) * 100));
              return (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 90, flex: "0 0 90px" }}>
                    {row.isOnline && (
                      <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#22c55e", flexShrink: 0, boxShadow: "0 0 0 2px rgba(34,197,94,0.25)" }} />
                    )}
                    <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{row.name}</span>
                  </div>
                  <div style={{ flex: 1, height: 5, background: "var(--border)", borderRadius: 3, overflow: "hidden" }}>
                    <div style={{ width: `${barW}%`, height: "100%", background: "var(--gold)", borderRadius: 3 }} />
                  </div>
                  <span style={{ fontSize: 12, fontWeight: 700, color: "var(--text)", minWidth: 44, textAlign: "right" }}>{label}</span>
                </div>
              );
            })}
            {screenTimeRows.length > 6 && (
              <div style={{ fontSize: 11, color: "var(--muted)", textAlign: "center", paddingTop: 2 }}>
                +{screenTimeRows.length - 6} more — <Link href="/settings" style={{ color: "var(--gold-dark)", textDecoration: "none" }}>view all</Link>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Daksh May 2026 → Jul 2026 — discreet entry to the cross-vendor
          royalty summary. No longer a link: it's a secret gesture (hover the
          dot + type "aadesh", or long-press on a tablet), which navigates to
          the passphrase-gated summary page. Owner / developer only. See
          royalty-secret-dot.tsx. */}
      {isOwnerOrDev && (
        <div
          style={{
            marginTop: 24,
            display: "flex",
            justifyContent: "center",
          }}
        >
          <RoyaltySecretDot />
        </div>
      )}

    </div>
  );
}
