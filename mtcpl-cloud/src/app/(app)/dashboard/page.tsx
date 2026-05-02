import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAuth, getDefaultRouteForRole } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { canTransferPlannedSlabs } from "@/lib/cutting-permissions";
import { PushPanel } from "./push-panel";
import { AskAiEntryCard } from "@/components/ask-ai-entry-card";
import { BlockJourneyEntryCard } from "@/components/block-journey-entry-card";
import { PeekSection } from "@/components/peek-section";

type SearchParams = Promise<{ pushed?: string }>;

/**
 * IST midnight today / start / end — used to scope Screen Time pings + the
 * "today.label" string passed to <PushPanel />.
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

export default async function DashboardPage({ searchParams }: { searchParams: SearchParams }) {
  // Permissive auth + explicit guard. We need to allow Rajesh
  // (whose stored role is team_head, not owner) onto the dashboard
  // so he can see his stripped Block-Journey-only variant.
  // canTransferPlannedSlabs catches him by name.
  const { profile } = await requireAuth();
  const params = await searchParams;
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
    const dateDisplay = istObj.toLocaleDateString("en-IN", {
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
  const pushed = params.pushed === "1";
  const onlineList = onlineUsers ?? [];

  const istObj = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
  const hr = istObj.getHours();
  const greeting = hr < 12 ? "Good morning" : hr < 17 ? "Good afternoon" : "Good evening";
  const ownerName = profile.full_name || "there";
  const dateDisplay = istObj.toLocaleDateString("en-IN", {
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

      {/* ── ASK AI ENTRY ── */}
      {/* Two "insight" entry cards side by side on wide screens; stack
          on narrow screens thanks to flexWrap. */}
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <div style={{ flex: "1 1 320px", minWidth: 0 }}>
          <AskAiEntryCard />
        </div>
        <div style={{ flex: "1 1 320px", minWidth: 0 }}>
          <BlockJourneyEntryCard />
        </div>
      </div>

      {/* ── REPORT BUTTONS ── */}
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <Link
          href="/blocks/report"
          style={{
            flex: "1 1 220px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "14px 20px",
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: 10,
            textDecoration: "none",
            gap: 12,
          }}
        >
          <div>
            <div style={{ fontWeight: 700, fontSize: 13, color: "var(--text)" }}>📊 Block Report</div>
            <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>
              All blocks — filter by stone, yard, vendor · Export to Excel
            </div>
          </div>
          <span style={{ fontSize: 12, color: "var(--gold-dark)", fontWeight: 600, flexShrink: 0 }}>Open →</span>
        </Link>

        <Link
          href="/slabs/ready"
          style={{
            flex: "1 1 220px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "14px 20px",
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: 10,
            textDecoration: "none",
            gap: 12,
          }}
        >
          <div>
            <div style={{ fontWeight: 700, fontSize: 13, color: "var(--text)" }}>📋 Ready Sizes Report</div>
            <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>
              Cut-done sizes — filter by temple, stone, grade · Export to Excel
            </div>
          </div>
          <span style={{ fontSize: 12, color: "var(--gold-dark)", fontWeight: 600, flexShrink: 0 }}>Open →</span>
        </Link>
      </div>

      {/* ── PUSH ALERT PANEL ──
          Wrapped in PeekSection so the dashboard isn't dominated by
          the full-table view. Click the card → centred modal opens
          with the same panel + search + Push controls inside. The
          "id=push" anchor stays on the wrapper so any deep link
          (?#push) still scrolls to the right spot. */}
      <div id="push">
        <PeekSection
          icon="🔔"
          title="Push Urgent Alert to Workers"
          count={pushList.length}
          subtitle="Mark a slab as urgent — workers see a red highlight on their pages."
          modalMaxWidth={1100}
        >
          <PushPanel slabs={pushList} pushed={pushed} todayLabel={today.label} />
        </PeekSection>
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

    </div>
  );
}
