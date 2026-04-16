import Link from "next/link";
import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { DateFilter } from "./date-filter";
import { PushPanel } from "./push-panel";
import { NowBand } from "./now-band";
import { PastBand } from "./past-band";
import { NextBand } from "./next-band";
import { getNowBandData } from "./actions";

type SearchParams = Promise<{ date?: string; pushed?: string }>;

// ── Helpers ──────────────────────────────────────────────────────

function cft(l: number, w: number, h: number) {
  return (Number(l) * Number(w) * Number(h)) / 1728;
}
function fc(n: number) { return n.toFixed(2); }
function fp(n: number) { return Math.round(n); }

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
    display: new Date(`${label}T12:00:00+05:30`).toLocaleDateString("en-IN", { day: "numeric", month: "short" }),
  };
}

function istWeekStart() {
  const ist = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
  const day = ist.getDay();
  ist.setDate(ist.getDate() - (day === 0 ? 6 : day - 1));
  const y = ist.getFullYear(), m = String(ist.getMonth() + 1).padStart(2, "0"), d = String(ist.getDate()).padStart(2, "0");
  return new Date(`${y}-${m}-${d}T00:00:00+05:30`).toISOString();
}

function istMonthStart() {
  const ist = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
  const y = ist.getFullYear(), m = String(ist.getMonth() + 1).padStart(2, "0");
  return new Date(`${y}-${m}-01T00:00:00+05:30`).toISOString();
}

function calcCutMetrics(blocks: Array<{ layout: unknown }>) {
  let pieces = 0, cftCut = 0, cftWasted = 0;
  for (const b of blocks) {
    const layout = b.layout as { placed?: Array<{ sw?: number; sh?: number; sd?: number }>; blk?: { l: number; w: number; h: number } } | null;
    const placed = layout?.placed ?? [];
    pieces += placed.length;
    let slabCft = 0;
    for (const s of placed) {
      if (s.sw && s.sh && s.sd) slabCft += cft(s.sw, s.sh, s.sd);
    }
    cftCut += slabCft;
    if (layout?.blk) cftWasted += Math.max(0, cft(layout.blk.l, layout.blk.w, layout.blk.h) - slabCft);
  }
  const eff = cftCut + cftWasted > 0 ? Math.round((cftCut / (cftCut + cftWasted)) * 100) : 0;
  return { count: blocks.length, pieces, cftCut, cftWasted, eff };
}

// ── Page ─────────────────────────────────────────────────────────

export default async function DashboardPage({ searchParams }: { searchParams: SearchParams }) {
  const { profile } = await requireAuth(["owner", "developer"]);
  const params = await searchParams;
  const admin = createAdminSupabaseClient();

  const today     = istToday(0);
  const yesterday = istToday(1);
  const nowISO    = new Date().toISOString();
  const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();

  const selectedDate  = params.date ?? today.label;
  const selStart = new Date(`${selectedDate}T00:00:00+05:30`).toISOString();
  const selEnd   = new Date(`${selectedDate}T23:59:59.999+05:30`).toISOString();
  const isToday = selectedDate === today.label;
  const isYest  = selectedDate === yesterday.label;

  const [
    { data: allBlocks },
    { data: allSlabs },
    { data: prioritySlabs },
    { data: liveBlocks },
    { data: todayDone },
    { data: yesterdayDone },
    { data: weekDone },
    { data: monthDone },
    { data: selDateSlabs },
    { data: onlineUsers },
  ] = await Promise.all([
    admin.from("blocks").select("status, yard, length_ft, width_ft, height_ft"),
    admin.from("slab_requirements").select("status, length_ft, width_ft, thickness_ft, priority, created_at, updated_at"),
    admin.from("slab_requirements").select("id, label, temple, deadline, priority_note").eq("priority", true).in("status", ["open", "planned"]),
    admin.from("cut_session_blocks").select("id, block_id, layout, cut_sessions(session_code)").eq("status", "cutting"),
    admin.from("cut_session_blocks").select("id, layout").eq("status", "done").gte("updated_at", today.start).lte("updated_at", today.end),
    admin.from("cut_session_blocks").select("id, layout").eq("status", "done").gte("updated_at", yesterday.start).lte("updated_at", yesterday.end),
    admin.from("cut_session_blocks").select("id, layout").eq("status", "done").gte("updated_at", istWeekStart()).lte("updated_at", nowISO),
    admin.from("cut_session_blocks").select("id, layout").eq("status", "done").gte("updated_at", istMonthStart()).lte("updated_at", nowISO),
    admin.from("slab_requirements").select("length_ft, width_ft, thickness_ft").in("status", ["cut_done", "completed"]).gte("updated_at", selStart).lte("updated_at", selEnd),
    admin.from("profiles").select("id, full_name, role").gte("last_seen_at", fiveMinAgo),
  ]);

  // Extra query for push panel — all open/planned slabs (no limit, search done server-side)
  const pushQuery = admin
    .from("slab_requirements")
    .select("id, label, temple, stone, status, priority, deadline, priority_note")
    .in("status", ["open", "planned"])
    .order("priority", { ascending: false })
    .order("created_at", { ascending: true });

  const { data: pushableSlabs } = await pushQuery.limit(1000);

  // ── Dashboard 2.0 bands ──
  const thirtyAgoIso = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
  const sevenAgoIso = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
  const twentyeightAgoIso = new Date(Date.now() - 28 * 24 * 3600 * 1000).toISOString();

  const [
    nowBandInitial,
    { data: last30CutBlocks },
    { data: last30AuditDone },
    { data: last30AuditRejected },
    { data: last7CutBlocks },
    { data: plannedSlabCount },
    { data: availableBlocksAll },
    { data: priorityDeadlineSlabs },
  ] = await Promise.all([
    getNowBandData(),
    admin.from("cut_session_blocks").select("layout, updated_at, updated_by").eq("status", "done").gte("updated_at", thirtyAgoIso),
    admin.from("audit_logs").select("user_id, action").in("action", ["cutting_done", "cutting_done_with_deviation"]).gte("created_at", thirtyAgoIso),
    admin.from("audit_logs").select("id, action").eq("action", "block_rejected").gte("created_at", thirtyAgoIso),
    admin.from("cut_session_blocks").select("layout").eq("status", "done").gte("updated_at", sevenAgoIso),
    admin.from("slab_requirements").select("id", { count: "exact", head: true }).eq("status", "planned"),
    admin.from("blocks").select("stone, length_ft, width_ft, height_ft").eq("status", "available"),
    admin.from("slab_requirements").select("id, label, temple, deadline").eq("priority", true).in("status", ["open", "planned"]).not("deadline", "is", null).order("deadline", { ascending: true }).limit(10),
  ]);

  // ── PAST band: Sparkline (30 days of daily CFT) ──
  const dailyCft = new Map<string, number>();
  const dailyBlockVol = new Map<string, number>(); // for waste calc
  const dailyUsefulVol = new Map<string, number>();
  const stoneCft = new Map<string, number>();
  for (const b of last30CutBlocks ?? []) {
    const day = new Date(b.updated_at).toISOString().slice(0, 10);
    const layout = b.layout as { blk?: { stone?: string; l?: number; w?: number; h?: number }; placed?: Array<{ sw?: number; sh?: number; sd?: number }> } | null;
    let slabCft = 0;
    for (const s of layout?.placed ?? []) {
      if (s.sw && s.sh && s.sd) slabCft += cft(s.sw, s.sh, s.sd);
    }
    dailyCft.set(day, (dailyCft.get(day) ?? 0) + slabCft);
    dailyUsefulVol.set(day, (dailyUsefulVol.get(day) ?? 0) + slabCft);
    if (layout?.blk) {
      const bv = cft(layout.blk.l ?? 0, layout.blk.w ?? 0, layout.blk.h ?? 0);
      dailyBlockVol.set(day, (dailyBlockVol.get(day) ?? 0) + bv);
    }
    const stone = layout?.blk?.stone ?? "Unknown";
    stoneCft.set(stone, (stoneCft.get(stone) ?? 0) + slabCft);
  }

  // Build sparkline: 30 days worth (oldest → newest)
  const sparklinePoints: Array<{ label: string; value: number }> = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date(Date.now() - i * 24 * 3600 * 1000);
    const iso = d.toISOString().slice(0, 10);
    const label = d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
    sparklinePoints.push({ label, value: Number((dailyCft.get(iso) ?? 0).toFixed(1)) });
  }

  // Stone mix donut slices
  const stoneColors: Record<string, string> = {
    PinkStone: "#C87A60",
    WhiteStone: "#B8B6AC",
    Jaisalmer: "#E8C572",
    Unknown: "#9CA3AF",
  };
  const paletteFallback = ["#D4A94A", "#C87A60", "#2563EB", "#16A34A", "#DC2626", "#D97706"];
  const stoneMixSlices = [...stoneCft.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([label, value], i) => ({
      label,
      value: Number(value.toFixed(1)),
      color: stoneColors[label] ?? paletteFallback[i % paletteFallback.length],
    }));

  // Top operators (by slab count from last 30d done blocks)
  const opStats = new Map<string, { slabs: number; cftv: number }>();
  for (const b of last30CutBlocks ?? []) {
    const uid = b.updated_by;
    if (!uid) continue;
    const layout = b.layout as { placed?: Array<{ sw?: number; sh?: number; sd?: number }> } | null;
    const placed = layout?.placed ?? [];
    let cftv = 0;
    for (const s of placed) {
      if (s.sw && s.sh && s.sd) cftv += cft(s.sw, s.sh, s.sd);
    }
    const prev = opStats.get(uid) ?? { slabs: 0, cftv: 0 };
    prev.slabs += placed.length;
    prev.cftv += cftv;
    opStats.set(uid, prev);
  }
  const opIds = [...opStats.keys()];
  const { data: opProfiles } = opIds.length > 0
    ? await admin.from("profiles").select("id, full_name").in("id", opIds)
    : { data: [] };
  const nameById = new Map<string, string>();
  for (const p of opProfiles ?? []) nameById.set(p.id, p.full_name || "—");
  const topOperators = [...opStats.entries()]
    .map(([uid, s]) => ({
      name: nameById.get(uid) ?? "Unknown",
      slabs: s.slabs,
      cft: Number(s.cftv.toFixed(1)),
      waste: 0,
    }))
    .sort((a, b) => b.slabs - a.slabs);

  // Deviation stats
  const totalApproved = (last30AuditDone ?? []).length;
  const deviations = (last30AuditDone ?? []).filter((a) => a.action === "cutting_done_with_deviation").length;
  const rejections = (last30AuditRejected ?? []).length;

  // Waste % this week + 7-day sparkline
  let wasteSlabCft = 0;
  let wasteBlockCft = 0;
  for (const b of last7CutBlocks ?? []) {
    const layout = b.layout as { blk?: { l?: number; w?: number; h?: number }; placed?: Array<{ sw?: number; sh?: number; sd?: number }> } | null;
    for (const s of layout?.placed ?? []) {
      if (s.sw && s.sh && s.sd) wasteSlabCft += cft(s.sw, s.sh, s.sd);
    }
    if (layout?.blk) wasteBlockCft += cft(layout.blk.l ?? 0, layout.blk.w ?? 0, layout.blk.h ?? 0);
  }
  const wasteWeekPct = wasteBlockCft > 0 ? Math.round(((wasteBlockCft - wasteSlabCft) / wasteBlockCft) * 100) : 0;

  // Build 4-week waste trend (by week, last 28 days)
  const weekBuckets = new Map<number, { useful: number; total: number }>();
  for (const b of last30CutBlocks ?? []) {
    if (b.updated_at < twentyeightAgoIso) continue;
    const weekIdx = Math.floor((Date.now() - new Date(b.updated_at).getTime()) / (7 * 24 * 3600 * 1000));
    if (weekIdx < 0 || weekIdx >= 4) continue;
    const layout = b.layout as { blk?: { l?: number; w?: number; h?: number }; placed?: Array<{ sw?: number; sh?: number; sd?: number }> } | null;
    let useful = 0;
    let total = 0;
    for (const s of layout?.placed ?? []) {
      if (s.sw && s.sh && s.sd) useful += cft(s.sw, s.sh, s.sd);
    }
    if (layout?.blk) total = cft(layout.blk.l ?? 0, layout.blk.w ?? 0, layout.blk.h ?? 0);
    const prev = weekBuckets.get(weekIdx) ?? { useful: 0, total: 0 };
    prev.useful += useful;
    prev.total += total;
    weekBuckets.set(weekIdx, prev);
  }
  const wasteTrend = [3, 2, 1, 0].map((i) => {
    const w = weekBuckets.get(i);
    const pct = w && w.total > 0 ? Math.round(((w.total - w.useful) / w.total) * 100) : 0;
    return { label: i === 0 ? "This wk" : `${i}wk ago`, value: pct };
  });

  // ── NEXT band: Runway per stone ──
  const availCftByStone = new Map<string, number>();
  for (const b of availableBlocksAll ?? []) {
    const stone = b.stone ?? "Unknown";
    availCftByStone.set(stone, (availCftByStone.get(stone) ?? 0) + cft(b.length_ft, b.width_ft, b.height_ft));
  }
  const burnByStone = new Map<string, number>();
  for (const [stone, c] of stoneCft) {
    burnByStone.set(stone, c / 30); // CFT/day over last 30 days
  }
  const runways = [...availCftByStone.entries()]
    .map(([stone, availableCft]) => {
      const burnPerDay = burnByStone.get(stone) ?? 0;
      const daysLeft = burnPerDay > 0.1 ? availableCft / burnPerDay : 999;
      return {
        stone,
        availableCft: Number(availableCft.toFixed(1)),
        burnPerDay: Number(burnPerDay.toFixed(2)),
        daysLeft,
      };
    })
    .sort((a, b) => a.daysLeft - b.daysLeft);

  // Planned backlog forecast
  const backlogCount = (plannedSlabCount as unknown as { count: number } | null)?.count ?? 0;
  let slabsLast7 = 0;
  for (const b of last7CutBlocks ?? []) {
    const layout = b.layout as { placed?: unknown[] } | null;
    slabsLast7 += (layout?.placed ?? []).length;
  }
  const slabsPerDay7 = slabsLast7 / 7;
  const backlogDays = slabsPerDay7 > 0.1 ? backlogCount / slabsPerDay7 : null;

  // Priority deadlines
  const priorityDeadlines = (priorityDeadlineSlabs ?? []).slice(0, 5).map((p) => ({
    id: p.id,
    temple: p.temple,
    label: p.label,
    deadline: p.deadline,
    daysLeft: p.deadline ? Math.ceil((new Date(p.deadline).getTime() - Date.now()) / 86400000) : null,
  }));

  // ── Block stats ──
  const bs: Record<string, { count: number; cft: number }> = {
    available: { count: 0, cft: 0 }, reserved: { count: 0, cft: 0 },
    consumed:  { count: 0, cft: 0 }, discarded: { count: 0, cft: 0 },
  };
  // Yard breakdown for available blocks
  const yardMap: Record<number, { count: number; cft: number }> = {};
  for (const b of allBlocks ?? []) {
    if (bs[b.status]) { bs[b.status].count++; bs[b.status].cft += cft(b.length_ft, b.width_ft, b.height_ft); }
    if (b.status === "available") {
      const y = Number(b.yard);
      if (!yardMap[y]) yardMap[y] = { count: 0, cft: 0 };
      yardMap[y].count++;
      yardMap[y].cft += cft(b.length_ft, b.width_ft, b.height_ft);
    }
  }
  const yardEntries = Object.entries(yardMap).sort((a, b) => Number(a[0]) - Number(b[0]));
  const totalBlocks = Object.values(bs).reduce((a, v) => a + v.count, 0);
  const totalBlockCft = Object.values(bs).reduce((a, v) => a + v.cft, 0);

  // ── Slab stats ──
  const ss: Record<string, { count: number; cft: number }> = {
    open: { count: 0, cft: 0 }, planned: { count: 0, cft: 0 }, cutting: { count: 0, cft: 0 },
    cut_done: { count: 0, cft: 0 }, completed: { count: 0, cft: 0 }, rejected: { count: 0, cft: 0 },
  };
  for (const s of allSlabs ?? []) {
    if (ss[s.status]) { ss[s.status].count++; ss[s.status].cft += cft(s.length_ft, s.width_ft, s.thickness_ft); }
  }
  const totalSlabs = Object.values(ss).reduce((a, v) => a + v.count, 0);

  // ── Selected-date slab output ──
  let selCount = 0, selCft = 0;
  for (const s of selDateSlabs ?? []) { selCount++; selCft += cft(s.length_ft, s.width_ft, s.thickness_ft); }

  // ── Cutting metrics ──
  const cm = {
    today:     calcCutMetrics(todayDone ?? []),
    yesterday: calcCutMetrics(yesterdayDone ?? []),
    week:      calcCutMetrics(weekDone ?? []),
    month:     calcCutMetrics(monthDone ?? []),
  };

  // ── Misc ──
  const liveList    = (liveBlocks ?? []) as unknown as Array<{ id: string; block_id: string; layout: unknown; cut_sessions: { session_code: string } | null }>;
  const priorityList = (prioritySlabs ?? []) as Array<{ id: string; label: string; temple: string; deadline: string | null; priority_note: string | null }>;
  const pushList = (pushableSlabs ?? []) as Array<{ id: string; label: string; temple: string; stone: string | null; status: string; priority: boolean; deadline: string | null; priority_note: string | null }>;
  const pushed = params.pushed === "1";
  const onlineList  = onlineUsers ?? [];

  const istObj = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
  const hr = istObj.getHours();
  const greeting = hr < 12 ? "Good morning" : hr < 17 ? "Good afternoon" : "Good evening";
  const ownerName = profile.full_name || "there";
  const dateDisplay = istObj.toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric" });

  const selDisplay = isToday ? "Today" : isYest ? "Yesterday"
    : new Date(`${selectedDate}T12:00:00+05:30`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

  // Efficiency for month
  const monthEff = cm.month.eff;

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
                {onlineList.map(u => u.full_name || "—").join(", ")} online
              </span>
            </div>
          ) : (
            <div style={{ fontSize: 12, color: "rgba(255,255,255,0.35)" }}>No other users online</div>
          )}
        </div>
      </div>

      {/* ── PAST BAND (last 30 days) ── */}
      <PastBand
        sparkline={sparklinePoints}
        stoneMix={stoneMixSlices}
        topOperators={topOperators}
        deviationStats={{ totalApproved, deviations, rejections }}
        wasteWeekPct={wasteWeekPct}
        wasteTrend={wasteTrend}
      />

      {/* ── NEXT BAND (forecast) ── */}
      <NextBand
        runways={runways}
        backlogCount={backlogCount}
        backlogDays={backlogDays}
        priorityDeadlines={priorityDeadlines}
      />

      {/* ── TOP KPI ROW ── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12 }}>
        {[
          { label: "Fresh Blocks", value: bs.available.count, sub: `${fc(bs.available.cft)} CFT available`, color: "#16A34A", icon: "🧱" },
          { label: "Slabs Pending", value: ss.open.count + ss.planned.count, sub: `${fc(ss.open.cft + ss.planned.cft)} CFT in queue`, color: "#D97706", icon: "📋" },
          { label: "Live Cutting", value: liveList.length, sub: liveList.length > 0 ? "In progress now" : "No active cuts", color: liveList.length > 0 ? "#DC2626" : "#7A6A52", icon: "✂" },
          { label: "Cut Today", value: cm.today.pieces, sub: `${fc(cm.today.cftCut)} CFT processed`, color: "#2563EB", icon: "📦" },
          { label: "⚡ Priority", value: priorityList.length, sub: "Urgent slabs", color: priorityList.length > 0 ? "#D97706" : "#7A6A52", icon: "" },
        ].map(k => (
          <div key={k.label} style={{
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: 10,
            padding: "16px 18px",
            position: "relative",
            overflow: "hidden",
          }}>
            <div style={{ position: "absolute", top: 0, left: 0, width: 3, height: "100%", background: k.color, borderRadius: "10px 0 0 10px" }} />
            <div style={{ fontSize: 11, color: "var(--muted)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 6 }}>
              {k.icon} {k.label}
            </div>
            <div style={{ fontSize: 32, fontWeight: 800, color: "var(--text)", lineHeight: 1, letterSpacing: "-1px", marginBottom: 4 }}>
              {k.value}
            </div>
            <div style={{ fontSize: 11, color: "var(--muted-light)" }}>{k.sub}</div>
          </div>
        ))}
      </div>

      {/* ── MAIN CONTENT GRID ── */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 320px", gap: 16, alignItems: "start" }}>

        {/* LEFT: SLAB PRODUCTION */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

          {/* Slab Status Breakdown */}
          <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden" }}>
            <div style={{ padding: "14px 20px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 13, color: "var(--text)" }}>Slab Requirements</div>
                <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 1 }}>
                  {totalSlabs} total requirements · {fc(Object.values(ss).reduce((a, v) => a + v.cft, 0))} CFT
                </div>
              </div>
              <Link href="/slabs" style={{ fontSize: 11, color: "var(--gold-dark)", fontWeight: 600, textDecoration: "none" }}>
                View all →
              </Link>
            </div>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: "var(--surface-alt)" }}>
                  {["Status", "Pieces", "CFT", "% of total"].map(h => (
                    <th key={h} style={{ padding: "8px 20px", textAlign: h === "Status" ? "left" : "right", fontSize: 10, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.07em" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[
                  { key: "open",      label: "Open / Pending",  color: "#D97706" },
                  { key: "planned",   label: "Planned",         color: "#2563EB" },
                  { key: "cutting",   label: "In Cutting",      color: "#DC2626" },
                  { key: "cut_done",  label: "Cut Done",        color: "#16A34A" },
                  { key: "completed", label: "Completed",       color: "#16A34A" },
                ].map(row => {
                  const stat = ss[row.key];
                  const pct = totalSlabs > 0 ? ((stat.count / totalSlabs) * 100).toFixed(0) : "0";
                  return (
                    <tr key={row.key} style={{ borderTop: "1px solid var(--border-light)" }}>
                      <td style={{ padding: "10px 20px" }}>
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
                          <span style={{ width: 8, height: 8, borderRadius: 2, background: row.color, flexShrink: 0 }} />
                          <span style={{ fontSize: 13, fontWeight: 500, color: "var(--text)" }}>{row.label}</span>
                        </span>
                      </td>
                      <td style={{ padding: "10px 20px", textAlign: "right", fontFamily: "ui-monospace, monospace", fontSize: 13, fontWeight: 600, color: stat.count > 0 ? "var(--text)" : "var(--muted-light)" }}>
                        {stat.count}
                      </td>
                      <td style={{ padding: "10px 20px", textAlign: "right", fontFamily: "ui-monospace, monospace", fontSize: 13, color: "var(--muted)" }}>
                        {fc(stat.cft)}
                      </td>
                      <td style={{ padding: "10px 20px", textAlign: "right" }}>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 8 }}>
                          <div style={{ width: 60, height: 5, background: "var(--border)", borderRadius: 3, overflow: "hidden" }}>
                            <div style={{ width: `${pct}%`, height: "100%", background: row.color, borderRadius: 3 }} />
                          </div>
                          <span style={{ fontSize: 11, color: "var(--muted)", width: 28, textAlign: "right" }}>{pct}%</span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Daily Production Filter */}
          <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden" }}>
            <div style={{ padding: "14px 20px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
              <div style={{ fontWeight: 700, fontSize: 13 }}>Slab Output — {selDisplay}</div>
              <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                <a href="/dashboard" style={{ fontSize: 12, padding: "4px 12px", borderRadius: 20, background: isToday ? "var(--gold)" : "var(--surface-alt)", color: isToday ? "#fff" : "var(--muted)", fontWeight: isToday ? 700 : 400, textDecoration: "none", border: `1px solid ${isToday ? "var(--gold)" : "var(--border)"}` }}>Today</a>
                <a href={`/dashboard?date=${yesterday.label}`} style={{ fontSize: 12, padding: "4px 12px", borderRadius: 20, background: isYest ? "var(--gold)" : "var(--surface-alt)", color: isYest ? "#fff" : "var(--muted)", fontWeight: isYest ? 700 : 400, textDecoration: "none", border: `1px solid ${isYest ? "var(--gold)" : "var(--border)"}` }}>Yesterday</a>
                <DateFilter value={selectedDate} />
              </div>
            </div>
            <div style={{ padding: 20 }}>
              {selCount === 0 ? (
                <div style={{ textAlign: "center", padding: "24px 0", color: "var(--muted-light)", fontSize: 13 }}>
                  No slabs completed on {selDisplay}
                </div>
              ) : (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                  <div style={{ background: "var(--success-bg)", borderRadius: 8, padding: "16px 20px", border: "1px solid rgba(22,163,74,0.15)" }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: "#16A34A", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>Slabs Completed</div>
                    <div style={{ fontSize: 36, fontWeight: 800, color: "#16A34A", letterSpacing: "-1px", lineHeight: 1 }}>{selCount}</div>
                    <div style={{ fontSize: 12, color: "#16A34A", opacity: 0.7, marginTop: 4 }}>pieces</div>
                  </div>
                  <div style={{ background: "var(--info-bg)", borderRadius: 8, padding: "16px 20px", border: "1px solid rgba(37,99,235,0.15)" }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: "#2563EB", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>CFT Delivered</div>
                    <div style={{ fontSize: 36, fontWeight: 800, color: "#2563EB", letterSpacing: "-1px", lineHeight: 1 }}>{fc(selCft)}</div>
                    <div style={{ fontSize: 12, color: "#2563EB", opacity: 0.7, marginTop: 4 }}>cubic feet</div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* RIGHT: LIVE + PRIORITY */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

          {/* Live Cutting */}
          <div style={{ background: "var(--surface)", border: `1px solid ${liveList.length > 0 ? "rgba(220,38,38,0.2)" : "var(--border)"}`, borderRadius: 10, overflow: "hidden" }}>
            <div style={{ padding: "14px 18px", borderBottom: `1px solid ${liveList.length > 0 ? "rgba(220,38,38,0.15)" : "var(--border)"}`, background: liveList.length > 0 ? "rgba(220,38,38,0.04)" : "transparent", display: "flex", alignItems: "center", gap: 8 }}>
              {liveList.length > 0 && <span className="live-dot" />}
              <span style={{ fontWeight: 700, fontSize: 13, color: liveList.length > 0 ? "#DC2626" : "var(--text)" }}>
                {liveList.length > 0 ? "Live Cutting Now" : "No Active Cuts"}
              </span>
            </div>
            <div style={{ padding: "12px 18px", display: "flex", flexDirection: "column", gap: 10 }}>
              {liveList.length === 0 ? (
                <div style={{ textAlign: "center", padding: "16px 0", color: "var(--muted-light)", fontSize: 12 }}>All quiet — no blocks being cut</div>
              ) : (
                liveList.map(b => {
                  const sess = b.cut_sessions as { session_code: string } | null;
                  const placed = ((b.layout as { placed?: unknown[] } | null)?.placed ?? []).length;
                  return (
                    <Link key={b.id} href={`/cutting/${b.id}`} style={{ textDecoration: "none", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 12px", background: "rgba(220,38,38,0.05)", border: "1px solid rgba(220,38,38,0.12)", borderRadius: 8, gap: 8 }}>
                      <div>
                        <div style={{ fontFamily: "ui-monospace, monospace", fontWeight: 700, fontSize: 13, color: "var(--text)" }}>{b.block_id}</div>
                        <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>{sess?.session_code} · {placed} slabs</div>
                      </div>
                      <span style={{ fontSize: 11, color: "#DC2626", fontWeight: 600 }}>View →</span>
                    </Link>
                  );
                })
              )}
            </div>
          </div>

          {/* Priority Slabs */}
          <div style={{ background: "var(--surface)", border: `1px solid ${priorityList.length > 0 ? "rgba(217,119,6,0.25)" : "var(--border)"}`, borderRadius: 10, overflow: "hidden" }}>
            <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ fontWeight: 700, fontSize: 13 }}>⚡ Priority Slabs</span>
              <Link href="/slabs" style={{ fontSize: 11, color: "var(--gold-dark)", fontWeight: 600, textDecoration: "none" }}>All slabs →</Link>
            </div>
            <div style={{ padding: "12px 18px", display: "flex", flexDirection: "column", gap: 8 }}>
              {priorityList.length === 0 ? (
                <div style={{ textAlign: "center", padding: "16px 0", color: "var(--muted-light)", fontSize: 12 }}>No urgent slabs pushed right now</div>
              ) : (
                priorityList.slice(0, 6).map(s => {
                  const dl = s.deadline ? new Date(s.deadline) : null;
                  const daysLeft = dl ? Math.ceil((dl.getTime() - Date.now()) / 86400000) : null;
                  const urgent = daysLeft !== null && daysLeft <= 1;
                  return (
                    <div key={s.id} style={{ padding: "9px 11px", background: urgent ? "rgba(220,38,38,0.06)" : "rgba(217,119,6,0.05)", border: `1px solid ${urgent ? "rgba(220,38,38,0.2)" : "rgba(217,119,6,0.15)"}`, borderRadius: 7 }}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <span style={{ fontSize: 12 }}>{urgent ? "🔴" : "⚡"}</span>
                          <span style={{ fontFamily: "ui-monospace, monospace", fontSize: 12, fontWeight: 700, color: "var(--text)" }}>{s.id}</span>
                        </div>
                        {daysLeft !== null && (
                          <span style={{ fontSize: 10, fontWeight: 700, color: urgent ? "#DC2626" : "#D97706", background: urgent ? "rgba(220,38,38,0.1)" : "rgba(217,119,6,0.1)", padding: "2px 6px", borderRadius: 10 }}>
                            {daysLeft <= 0 ? "Overdue" : daysLeft === 1 ? "Due tomorrow" : `${daysLeft}d left`}
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 3 }}>{s.temple} · {s.label}</div>
                      {s.priority_note && <div style={{ fontSize: 11, color: "var(--gold-dark)", marginTop: 3, fontStyle: "italic" }}>"{s.priority_note}"</div>}
                    </div>
                  );
                })
              )}
              {priorityList.length > 6 && (
                <div style={{ textAlign: "center", fontSize: 11, color: "var(--muted)", paddingTop: 4 }}>+{priorityList.length - 6} more urgent slabs</div>
              )}
            </div>
          </div>

          {/* Block Snapshot */}
          <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden" }}>
            <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ fontWeight: 700, fontSize: 13 }}>Block Inventory</span>
              <Link href="/blocks" style={{ fontSize: 11, color: "var(--gold-dark)", fontWeight: 600, textDecoration: "none" }}>Manage →</Link>
            </div>
            <div style={{ padding: "16px 18px", display: "flex", flexDirection: "column", gap: 12 }}>
              {/* Fresh vs In Use */}
              {[
                { key: "available", label: "Fresh Stock", color: "#16A34A", bg: "rgba(22,163,74,0.07)" },
                { key: "reserved",  label: "In Use",      color: "#2563EB", bg: "rgba(37,99,235,0.07)" },
              ].map(item => (
                <div key={item.key} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 12px", background: item.bg, borderRadius: 8 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ width: 9, height: 9, borderRadius: 2, background: item.color, flexShrink: 0 }} />
                    <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>{item.label}</span>
                  </div>
                  <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
                    <span style={{ fontSize: 18, fontWeight: 800, fontFamily: "ui-monospace, monospace", color: item.color }}>{bs[item.key].count}</span>
                    <span style={{ fontSize: 11, color: "var(--muted-light)", minWidth: 65, textAlign: "right" }}>{fc(bs[item.key].cft)} CFT</span>
                  </div>
                </div>
              ))}

              {/* Yard breakdown */}
              {yardEntries.length > 0 && (
                <div style={{ marginTop: 2 }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 8 }}>
                    Fresh stock by yard
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {yardEntries.map(([yard, stat]) => {
                      const maxCft = Math.max(...yardEntries.map(([, s]) => s.cft), 1);
                      return (
                        <div key={yard} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <span style={{ fontSize: 11, color: "var(--muted)", width: 44, flexShrink: 0 }}>Yard {yard}</span>
                          <div style={{ flex: 1, height: 6, background: "var(--border)", borderRadius: 3, overflow: "hidden" }}>
                            <div style={{ width: `${(stat.cft / maxCft) * 100}%`, height: "100%", background: "var(--gold)", borderRadius: 3 }} />
                          </div>
                          <span style={{ fontSize: 11, fontWeight: 600, color: "var(--text)", width: 24, textAlign: "right" }}>{stat.count}</span>
                          <span style={{ fontSize: 10, color: "var(--muted-light)", width: 60, textAlign: "right" }}>{fc(stat.cft)} CFT</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── CUTTING PERFORMANCE ── */}
      <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden" }}>
        <div style={{ padding: "14px 20px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 13 }}>Cutting Performance</div>
            <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 1 }}>
              This month: <strong style={{ color: "var(--text)" }}>{monthEff}% efficiency</strong> · {fc(cm.month.cftWasted)} CFT wasted
            </div>
          </div>
          <Link href="/cutting" style={{ fontSize: 11, color: "var(--gold-dark)", fontWeight: 600, textDecoration: "none" }}>Cutting page →</Link>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 0 }}>
          {[
            { label: "Today",          data: cm.today,     accent: "#DC2626", bg: "rgba(220,38,38,0.04)" },
            { label: "Yesterday",      data: cm.yesterday, accent: "#D97706", bg: "rgba(217,119,6,0.04)" },
            { label: "This Week",      data: cm.week,      accent: "#2563EB", bg: "rgba(37,99,235,0.04)" },
            { label: "This Month",     data: cm.month,     accent: "#16A34A", bg: "rgba(22,163,74,0.04)" },
          ].map((col, i) => (
            <div key={col.label} style={{ padding: "20px 22px", borderRight: i < 3 ? "1px solid var(--border-light)" : "none", background: col.bg }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: col.accent, textTransform: "uppercase", letterSpacing: "0.09em", marginBottom: 14 }}>
                {col.label}
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <div>
                  <div style={{ fontSize: 28, fontWeight: 800, color: "var(--text)", lineHeight: 1, letterSpacing: "-0.5px" }}>{col.data.count}</div>
                  <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>blocks cut</div>
                </div>
                <div style={{ height: 1, background: "var(--border-light)" }} />
                <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ fontSize: 11, color: "var(--muted)" }}>Pieces</span>
                    <span style={{ fontSize: 12, fontWeight: 700, fontFamily: "ui-monospace, monospace", color: "var(--text)" }}>{col.data.pieces}</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ fontSize: 11, color: "var(--muted)" }}>CFT cut</span>
                    <span style={{ fontSize: 12, fontWeight: 700, fontFamily: "ui-monospace, monospace", color: col.accent }}>{fc(col.data.cftCut)}</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ fontSize: 11, color: "var(--muted)" }}>CFT waste</span>
                    <span style={{ fontSize: 12, fontFamily: "ui-monospace, monospace", color: "var(--muted-light)" }}>{fc(col.data.cftWasted)}</span>
                  </div>
                  {col.data.count > 0 && (
                    <div style={{ marginTop: 4 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                        <span style={{ fontSize: 10, color: "var(--muted)" }}>Efficiency</span>
                        <span style={{ fontSize: 10, fontWeight: 700, color: col.data.eff >= 80 ? "#16A34A" : col.data.eff >= 60 ? "#D97706" : "#DC2626" }}>{col.data.eff}%</span>
                      </div>
                      <div style={{ height: 4, borderRadius: 2, background: "var(--border)", overflow: "hidden" }}>
                        <div style={{ width: `${col.data.eff}%`, height: "100%", background: col.data.eff >= 80 ? "#16A34A" : col.data.eff >= 60 ? "#D97706" : "#DC2626", borderRadius: 2 }} />
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── QUICK REPORTS ── */}
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
            transition: "border-color 0.15s",
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
            transition: "border-color 0.15s",
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

      {/* ── PUSH ALERT PANEL ── */}
      <div id="push">
        <PushPanel slabs={pushList} pushed={pushed} todayLabel={today.label} />
      </div>

      {/* ── NOW BAND (open alerts — very bottom, auto-refresh 45s) ── */}
      <NowBand initial={nowBandInitial} />

    </div>
  );
}
