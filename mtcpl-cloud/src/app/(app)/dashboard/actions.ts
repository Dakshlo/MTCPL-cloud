"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";

// ── Shared types for the NOW band (kept in sync with now-band.tsx) ──
export type NowOperator = {
  id: string;
  name: string;
  status: "cutting" | "idle" | "away";
  activity: string;
  todaySlabs: number;
  todayCft: number;
};

export type NowAlert = {
  kind: "rejection" | "deviation" | "overdue" | "lowstock";
  title: string;
  subtitle: string;
  timeAgo: string;
  href: string;
};

export type NowBandData = {
  todayCft: number;
  avgCft: number;
  pacePercent: number;
  operators: NowOperator[];
  alerts: NowAlert[];
  fetchedAt: string;
};

function cft(l: number, w: number, h: number) {
  return (Number(l) * Number(w) * Number(h)) / 1728;
}

function istToday(daysAgo = 0) {
  const ist = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
  ist.setDate(ist.getDate() - daysAgo);
  const y = ist.getFullYear();
  const m = String(ist.getMonth() + 1).padStart(2, "0");
  const d = String(ist.getDate()).padStart(2, "0");
  const label = `${y}-${m}-${d}`;
  return {
    start: new Date(`${label}T00:00:00+05:30`).toISOString(),
    end: new Date(`${label}T23:59:59.999+05:30`).toISOString(),
    label,
  };
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  return `${day}d ago`;
}

export async function getNowBandData(): Promise<NowBandData> {
  await requireAuth(["owner", "developer"]);
  const admin = createAdminSupabaseClient();

  const today = istToday(0);
  const thirtyAgo = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
  const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();

  const [
    { data: todayDone },
    { data: last30Done },
    { data: onlineUsers },
    { data: liveBlocks },
    { data: auditEvents },
    { data: overdueSlabs },
    { data: availableBlocks },
    { data: consumedLast30 },
  ] = await Promise.all([
    admin.from("cut_session_blocks").select("layout, updated_at, updated_by").eq("status", "done").gte("updated_at", today.start).lte("updated_at", today.end),
    admin.from("cut_session_blocks").select("layout, updated_at").eq("status", "done").gte("updated_at", thirtyAgo),
    admin.from("profiles").select("id, full_name, last_seen_at").gte("last_seen_at", fiveMinAgo),
    admin.from("cut_session_blocks").select("id, block_id, updated_at, updated_by").eq("status", "cutting"),
    admin.from("audit_logs").select("id, action, entity_id, details, created_at").in("action", ["block_rejected", "cutting_done_with_deviation"]).order("created_at", { ascending: false }).limit(8),
    admin.from("slab_requirements").select("id, label, temple, deadline").eq("priority", true).in("status", ["open", "planned"]).not("deadline", "is", null).lte("deadline", new Date(Date.now() + 2 * 24 * 3600 * 1000).toISOString()),
    admin.from("blocks").select("stone, length_ft, width_ft, height_ft").eq("status", "available"),
    admin.from("cut_session_blocks").select("layout").eq("status", "done").gte("updated_at", thirtyAgo),
  ]);

  // ── Today's CFT + 30-day average ──
  let todayCft = 0;
  for (const b of todayDone ?? []) {
    const layout = b.layout as { placed?: Array<{ sw?: number; sh?: number; sd?: number }> } | null;
    for (const s of layout?.placed ?? []) {
      if (s.sw && s.sh && s.sd) todayCft += cft(s.sw, s.sh, s.sd);
    }
  }

  const dailyCftBuckets = new Map<string, number>();
  for (const b of last30Done ?? []) {
    const day = new Date(b.updated_at).toISOString().slice(0, 10);
    const layout = b.layout as { placed?: Array<{ sw?: number; sh?: number; sd?: number }> } | null;
    let total = 0;
    for (const s of layout?.placed ?? []) {
      if (s.sw && s.sh && s.sd) total += cft(s.sw, s.sh, s.sd);
    }
    dailyCftBuckets.set(day, (dailyCftBuckets.get(day) ?? 0) + total);
  }
  const distinctDays = dailyCftBuckets.size;
  const avgCft = distinctDays > 0 ? [...dailyCftBuckets.values()].reduce((a, v) => a + v, 0) / distinctDays : 0;
  const pacePercent = avgCft > 0 ? Math.round((todayCft / avgCft) * 100) : 0;

  // ── Operator strip ──
  const liveByUser = new Map<string, { blockId: string; since: string }>();
  for (const lb of liveBlocks ?? []) {
    if (lb.updated_by) liveByUser.set(lb.updated_by, { blockId: lb.block_id, since: lb.updated_at });
  }
  const todayStatsByUser = new Map<string, { slabs: number; cftv: number; lastAt: string | null }>();
  for (const b of todayDone ?? []) {
    const uid = b.updated_by;
    if (!uid) continue;
    const layout = b.layout as { placed?: Array<{ sw?: number; sh?: number; sd?: number }> } | null;
    let count = 0;
    let cftv = 0;
    for (const s of layout?.placed ?? []) {
      if (s.sw && s.sh && s.sd) {
        count++;
        cftv += cft(s.sw, s.sh, s.sd);
      }
    }
    const prev = todayStatsByUser.get(uid) ?? { slabs: 0, cftv: 0, lastAt: null };
    prev.slabs += count;
    prev.cftv += cftv;
    if (!prev.lastAt || b.updated_at > prev.lastAt) prev.lastAt = b.updated_at;
    todayStatsByUser.set(uid, prev);
  }

  const operators: NowOperator[] = (onlineUsers ?? [])
    .map((u) => {
      const live = liveByUser.get(u.id);
      const stats = todayStatsByUser.get(u.id) ?? { slabs: 0, cftv: 0, lastAt: null };
      let status: NowOperator["status"] = "away";
      let activity = "Online";
      if (live) {
        status = "cutting";
        activity = `Cutting ${live.blockId}`;
      } else if (stats.lastAt && stats.lastAt > thirtyMinAgo) {
        status = "idle";
        activity = `Last cut ${timeAgo(stats.lastAt)}`;
      } else {
        status = "away";
        activity = stats.lastAt ? `Last cut ${timeAgo(stats.lastAt)}` : "Idle";
      }
      return {
        id: u.id,
        name: u.full_name || "—",
        status,
        activity,
        todaySlabs: stats.slabs,
        todayCft: Math.round(stats.cftv * 10) / 10,
      };
    })
    .sort((a, b) => {
      const rank = { cutting: 0, idle: 1, away: 2 };
      return rank[a.status] - rank[b.status];
    });

  // ── Alerts feed ──
  const alerts: NowAlert[] = [];
  for (const ev of auditEvents ?? []) {
    const details = (ev.details ?? {}) as Record<string, unknown>;
    if (ev.action === "block_rejected") {
      alerts.push({
        kind: "rejection",
        title: `Block ${details.block_id ?? ev.entity_id} rejected`,
        subtitle: `${Array.isArray(details.slabs_released) ? details.slabs_released.length : 0} slabs released back to open`,
        timeAgo: timeAgo(ev.created_at),
        href: `/cutting/${ev.entity_id}`,
      });
    } else if (ev.action === "cutting_done_with_deviation") {
      const extras = Array.isArray(details.extra_slabs) ? (details.extra_slabs as unknown[]).length : 0;
      alerts.push({
        kind: "deviation",
        title: `Plan deviation on block ${details.block_id ?? ev.entity_id}`,
        subtitle: `${extras} unplanned slab${extras !== 1 ? "s" : ""} cut from this block`,
        timeAgo: timeAgo(ev.created_at),
        href: `/cutting/${ev.entity_id}`,
      });
    }
  }
  for (const s of overdueSlabs ?? []) {
    const days = s.deadline ? Math.ceil((new Date(s.deadline).getTime() - Date.now()) / 86400000) : null;
    alerts.push({
      kind: "overdue",
      title: `${s.id} · ${s.temple}`,
      subtitle: days !== null && days <= 0 ? "Overdue priority slab" : `Priority due in ${days}d`,
      timeAgo: "now",
      href: "/slabs",
    });
  }

  // Low stock: per stone, if available CFT < 3 days of consumption
  const availByStone = new Map<string, number>();
  for (const b of availableBlocks ?? []) {
    const stone = b.stone ?? "Unknown";
    availByStone.set(stone, (availByStone.get(stone) ?? 0) + cft(b.length_ft, b.width_ft, b.height_ft));
  }
  const consumedByStone = new Map<string, number>();
  for (const b of consumedLast30 ?? []) {
    const layout = b.layout as { blk?: { stone?: string }; placed?: Array<{ sw?: number; sh?: number; sd?: number }> } | null;
    const stone = layout?.blk?.stone ?? "Unknown";
    let totalCft = 0;
    for (const s of layout?.placed ?? []) {
      if (s.sw && s.sh && s.sd) totalCft += cft(s.sw, s.sh, s.sd);
    }
    consumedByStone.set(stone, (consumedByStone.get(stone) ?? 0) + totalCft);
  }
  for (const [stone, avail] of availByStone) {
    const consumed30 = consumedByStone.get(stone) ?? 0;
    const perDay = consumed30 / 30;
    if (perDay > 0.1) {
      const daysLeft = avail / perDay;
      if (daysLeft < 3) {
        alerts.unshift({
          kind: "lowstock",
          title: `${stone} runway critical`,
          subtitle: `Only ~${daysLeft.toFixed(1)} days of stock left at current pace`,
          timeAgo: "",
          href: "/blocks",
        });
      }
    }
  }

  return {
    todayCft: Math.round(todayCft * 10) / 10,
    avgCft: Math.round(avgCft * 10) / 10,
    pacePercent,
    operators,
    alerts: alerts.slice(0, 8),
    fetchedAt: new Date().toISOString(),
  };
}

export async function pushSlabAlertAction(formData: FormData) {
  await requireAuth(["owner", "developer"]);
  const admin = createAdminSupabaseClient();

  const id             = formData.get("id") as string;
  const deadlineMonth  = formData.get("deadline_month") as string | null;
  const deadlineDay    = formData.get("deadline_day") as string | null;
  const note           = (formData.get("note") as string | null)?.trim() || null;

  // Construct date from month+day using current year (or next year if date already passed)
  let deadline: string | null = null;
  if (deadlineMonth && deadlineDay) {
    const now = new Date();
    const year = now.getFullYear();
    const candidate = `${year}-${deadlineMonth}-${deadlineDay}`;
    // If the date has already passed this year, use next year
    deadline = new Date(candidate) < now ? `${year + 1}-${deadlineMonth}-${deadlineDay}` : candidate;
  }

  if (!id) redirect("/dashboard?toast=Missing+slab+ID");

  const { error } = await admin
    .from("slab_requirements")
    .update({
      priority: true,
      ...(deadline ? { deadline } : {}),
      ...(note     ? { priority_note: note } : {}),
    })
    .eq("id", id);

  if (error) redirect(`/dashboard?toast=${encodeURIComponent(error.message)}`);

  revalidatePath("/dashboard");
  revalidatePath("/slabs");
  revalidatePath("/cutting");
  redirect("/dashboard?pushed=1");
}

export async function clearSlabAlertAction(formData: FormData) {
  await requireAuth(["owner", "developer"]);
  const admin = createAdminSupabaseClient();

  const id = formData.get("id") as string;
  if (!id) return;

  await admin
    .from("slab_requirements")
    .update({ priority: false, deadline: null, priority_note: null })
    .eq("id", id);

  revalidatePath("/dashboard");
  revalidatePath("/slabs");
  revalidatePath("/cutting");
}
