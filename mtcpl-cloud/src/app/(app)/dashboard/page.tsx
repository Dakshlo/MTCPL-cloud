import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAuth, getDefaultRouteForRole } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { canTransferPlannedSlabs } from "@/lib/cutting-permissions";
import { AskAiEntryCard } from "@/components/ask-ai-entry-card";
import { BlockJourneyEntryCard } from "@/components/block-journey-entry-card";
import { TvModeEntryCard } from "@/components/tv-mode-entry-card";
import { EmailSnapshotCard } from "./email-snapshot-card";
import { MarketNewsEntryCard } from "@/components/market-news-entry-card";
import { VariousCostingEntryCard } from "@/components/various-costing-entry-card";
import { PeekIframe } from "@/components/peek-iframe";

/**
 * IST midnight today / start / end — used to scope Screen Time pings.
 */
function istToday(daysAgo = 0) {
  const ist = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
  ist.setDate(ist.getDate() - daysAgo);
  const y = ist.getFullYear();
  const m = String(ist.getMonth() + 1).padStart(2, "0");
  const d = String(ist.getDate()).padStart(2, "0");
  const label = `${y}-${m}-${d}`;
  return {
    start: new Date(`${label}T00:00:00+05:30`).toISOString(),
    end:   new Date(`${label}T23:59:59.999+05:30`).toISOString(),
    label,
  };
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
    const istObj = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
    const hr = istObj.getHours();
    const greeting = hr < 12 ? "Good morning" : hr < 17 ? "Good afternoon" : "Good evening";
    const dateDisplay = istObj.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata",
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    });
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 20, paddingBottom: 32 }}>
        {/* Lightweight greeting header — same visual style as the main
            dashboard but with no online-users panel. */}
        <div style={{
          background: "linear-gradient(135deg, #2D2410 0%, #4a3a1f 100%)",
          borderRadius: 12,
          padding: "20px 24px",
          boxShadow: "0 4px 16px rgba(45,36,16,0.18)",
        }}>
          <div style={{ fontSize: 11, color: "rgba(255,255,255,0.45)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 4 }}>
            {dateDisplay}
          </div>
          <div style={{ fontSize: 22, fontWeight: 700, color: "#fff", letterSpacing: "-0.3px" }}>
            {greeting}, <span style={{ color: "#E8C572" }}>{profile.full_name || "there"}</span>
          </div>
          <div style={{ fontSize: 12, color: "rgba(255,255,255,0.5)", marginTop: 4 }}>
            Open Block Journey to track inventory throughput.
          </div>
        </div>

        {/* The single card Rajesh wants. Full-width on this dashboard. */}
        <BlockJourneyEntryCard />
      </div>
    );
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

  const istObj = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
  const hr = istObj.getHours();
  const greeting = hr < 12 ? "Good morning" : hr < 17 ? "Good afternoon" : "Good evening";
  const ownerName = profile.full_name || "there";
  const dateDisplay = istObj.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata",
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  // Priority count is passed to PushPanel via `pushableSlabs` so PushPanel
  // can show its own urgent-list state. We just need the raw query on the page
  // (no derived value needed here).
  void prioritySlabs;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20, paddingBottom: 32 }}>

      {/* ── GREETING HEADER ── */}
      <div style={{
        background: "linear-gradient(135deg, #2D2410 0%, #4a3a1f 100%)",
        borderRadius: 12,
        padding: "20px 24px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        flexWrap: "wrap",
        gap: 12,
        boxShadow: "0 4px 16px rgba(45,36,16,0.18)",
      }}>
        <div>
          <div style={{ fontSize: 11, color: "rgba(255,255,255,0.45)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 4 }}>
            {dateDisplay}
          </div>
          <div style={{ fontSize: 22, fontWeight: 700, color: "#fff", letterSpacing: "-0.3px" }}>
            {greeting}, <span style={{ color: "#E8C572" }}>{ownerName}</span>
          </div>
          <div style={{ fontSize: 12, color: "rgba(255,255,255,0.5)", marginTop: 4 }}>
            Here&apos;s your operations overview
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          {onlineList.length > 0 ? (
            <div style={{ display: "flex", alignItems: "center", gap: 8, background: "rgba(255,255,255,0.07)", borderRadius: 20, padding: "6px 12px" }}>
              <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#22c55e", boxShadow: "0 0 0 2px rgba(34,197,94,0.3)", display: "inline-block", flexShrink: 0 }} />
              <span style={{ fontSize: 12, color: "rgba(255,255,255,0.75)", fontWeight: 500 }}>
                {onlineList.map((u) => u.full_name || "—").join(", ")} online
              </span>
            </div>
          ) : (
            <div style={{ fontSize: 12, color: "rgba(255,255,255,0.35)" }}>No other users online</div>
          )}
        </div>
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
        <VariousCostingEntryCard />
        <TvModeEntryCard />
        {/* Owner-only market-news brief + chat (liquid-glass page). */}
        {(profile.role === "owner" || profile.role === "developer") && <MarketNewsEntryCard />}
      </div>

      {/* ── EMAIL SNAPSHOT (June 2026) — owner/dev only. AI-picked
          important emails from the owner's Gmail, summarized. The
          mailbox link is read-only (IMAP, no SMTP in the codebase). */}
      {(profile.role === "owner" || profile.role === "developer") && (
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
        <div style={{ flex: "1 1 220px", display: "flex" }}>
          <PeekIframe
            url="/embed/blocks/report"
            triggerIcon="📊"
            triggerLabel="Block Report"
            modalTitle="Block Report"
            triggerStyle={{
              flex: 1,
              padding: "18px 22px 18px 26px",
              background:
                "linear-gradient(135deg, #ffffff 0%, #eef4ff 100%)",
              border: "1px solid #c7d2fe",
              borderLeft: "4px solid #4f46e5",
              borderRadius: 12,
              boxShadow:
                "0 1px 2px rgba(15,23,42,0.04), 0 4px 12px rgba(15,23,42,0.06)",
            }}
          />
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

      {/* Daksh May 2026 — discreet entry to cross-vendor royalty
          summary. Owner / developer only; passphrase-gated on the
          destination page. Shrunk to a single tiny dot per dad's
          ask — he knows where it lives and doesn't want a button
          taking up real estate. */}
      {(profile.role === "owner" || profile.role === "developer") && (
        <div
          style={{
            marginTop: 24,
            display: "flex",
            justifyContent: "center",
          }}
        >
          <Link
            href="/accounts/royalty-summary"
            title="Cross-vendor royalty summary (passphrase required)"
            aria-label="Royalty Summary"
            style={{
              display: "inline-block",
              width: 10,
              height: 10,
              borderRadius: "50%",
              background: "#d97706",
              boxShadow: "0 0 0 3px rgba(217,119,6,0.15)",
              opacity: 0.55,
            }}
          />
        </div>
      )}

    </div>
  );
}
