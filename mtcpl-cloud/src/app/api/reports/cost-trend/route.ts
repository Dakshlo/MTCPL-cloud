/**
 * GET /api/reports/cost-trend?plant=cnc|cutter&granularity=daily|weekly|monthly
 *
 * Cost-per-unit TREND series for the Various Costing pages (Daksh, Jul 2026).
 * Every point is computed by the SAME report engine as the page headline, so
 * the graph always matches the "COST PER UNIT" card:
 *
 *   • daily   — last 16 days; each point = the headline metric AS OF that day
 *               (window = 1st of that day's month → that day, i.e. the
 *               month-to-date elapsed-days calculation evaluated on each day;
 *               crossing into last month shows its running curve too).
 *   • weekly  — last 8 weeks; each point = that week's own cost (Mon–Sun
 *               window, current week clipped to today).
 *   • monthly — last 6 months; each point = that full month's cost (current
 *               month clamps to today inside the engine).
 *
 * CNC value = total cost ÷ (SFT + CFT) — the combined "/unit" headline.
 * Cutter value = cost per CFT. No output in a window → value: null (gap).
 *
 * Points are built with parallel engine calls (≤16) — heavier than a plain
 * query but guarantees the numbers can never drift from the page.
 */

import { NextResponse, type NextRequest } from "next/server";
import { requireAuth } from "@/lib/auth";
import { canViewCncCosts, canViewCutterCosts } from "@/lib/expenses-permissions";
import { buildCncVariousCostReport, type CncReportPeriod } from "@/lib/cnc-various-cost-report";
import { buildCutterCostReport, type CutterReportPeriod } from "@/lib/cutter-cost-report";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const IST_MS = 5.5 * 3600 * 1000;
const pad2 = (n: number) => String(n).padStart(2, "0");
const keyOf = (ms: number) => {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
};
const dayMs = 24 * 3600 * 1000;

type Win = { startDate: string; endDate: string; label: string; sub: string };

/** Point windows for a granularity, oldest → newest (IST calendar). */
function windows(granularity: "daily" | "weekly" | "monthly"): Win[] {
  const nowIst = new Date(Date.now() + IST_MS);
  const todayMs = Date.UTC(nowIst.getUTCFullYear(), nowIst.getUTCMonth(), nowIst.getUTCDate());
  const out: Win[] = [];

  if (granularity === "daily") {
    for (let i = 15; i >= 0; i--) {
      const ms = todayMs - i * dayMs;
      const d = new Date(ms);
      const start = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
      out.push({
        startDate: keyOf(start),
        endDate: keyOf(ms),
        label: `${d.getUTCDate()} ${MON[d.getUTCMonth()]}`,
        sub: `1–${d.getUTCDate()} ${MON[d.getUTCMonth()]} (month-to-date as of this day)`,
      });
    }
    return out;
  }

  if (granularity === "weekly") {
    const dow = new Date(todayMs).getUTCDay(); // 0 = Sun
    const monday = todayMs - ((dow + 6) % 7) * dayMs;
    for (let w = 7; w >= 0; w--) {
      const start = monday - w * 7 * dayMs;
      const end = Math.min(start + 6 * dayMs, todayMs);
      const s = new Date(start), e = new Date(end);
      const label =
        s.getUTCMonth() === e.getUTCMonth()
          ? `${s.getUTCDate()}–${e.getUTCDate()} ${MON[e.getUTCMonth()]}`
          : `${s.getUTCDate()} ${MON[s.getUTCMonth()]} – ${e.getUTCDate()} ${MON[e.getUTCMonth()]}`;
      out.push({ startDate: keyOf(start), endDate: keyOf(end), label, sub: "this week's own cost" });
    }
    return out;
  }

  // monthly — last 6 full months (current clamps to today inside the engine).
  for (let k = 5; k >= 0; k--) {
    const d = new Date(todayMs);
    const y = d.getUTCFullYear(), m = d.getUTCMonth() - k;
    const start = Date.UTC(y, m, 1);
    const end = Date.UTC(y, m + 1, 0);
    const sd = new Date(start);
    out.push({
      startDate: keyOf(start),
      endDate: keyOf(end),
      label: `${MON[sd.getUTCMonth()]} ${String(sd.getUTCFullYear()).slice(2)}`,
      sub: "full month",
    });
  }
  return out;
}

export type TrendPoint = {
  label: string;
  sub: string;
  startDate: string;
  endDate: string;
  /** Cost per unit (CNC: combined SFT+CFT, cutter: per CFT). null = no output. */
  value: number | null;
  cost: number;
  out: number;
  slabs: number;
  days: number;
};

export async function GET(req: NextRequest) {
  const { profile } = await requireAuth();
  const sp = req.nextUrl.searchParams;
  const plant = sp.get("plant") === "cutter" ? "cutter" : "cnc";
  const g = (["daily", "weekly", "monthly"].includes(sp.get("granularity") ?? "") ? sp.get("granularity") : "daily") as "daily" | "weekly" | "monthly";

  if (plant === "cnc" ? !canViewCncCosts(profile) : !canViewCutterCosts(profile)) {
    return NextResponse.json({ ok: false, error: "Not allowed." }, { status: 403 });
  }

  const wins = windows(g);
  try {
    const points: TrendPoint[] = await Promise.all(
      wins.map(async (w): Promise<TrendPoint> => {
        if (plant === "cnc") {
          const period: CncReportPeriod = { kind: g === "weekly" ? "weekly" : "monthly", startDate: w.startDate, endDate: w.endDate, label: w.label };
          const r = await buildCncVariousCostReport(period);
          const out = r.totalSft + r.totalCft;
          return { label: w.label, sub: w.sub, startDate: w.startDate, endDate: w.endDate, value: out > 0 ? r.totalCostForPeriod / out : null, cost: r.totalCostForPeriod, out, slabs: r.slabsCount, days: r.daysInWindow };
        }
        const period: CutterReportPeriod = { kind: g === "weekly" ? "weekly" : "monthly", startDate: w.startDate, endDate: w.endDate, label: w.label };
        const r = await buildCutterCostReport(period);
        const val = Number.isFinite(r.costPerCft) && r.totalCft > 0 ? r.costPerCft : null;
        // Cutter report has no daysInWindow — count the window's days (clamped
        // to today, mirroring the engine's own clamp).
        const todayK = keyOf(Date.UTC(new Date(Date.now() + IST_MS).getUTCFullYear(), new Date(Date.now() + IST_MS).getUTCMonth(), new Date(Date.now() + IST_MS).getUTCDate()));
        const endK = w.endDate > todayK && w.startDate <= todayK ? todayK : w.endDate;
        const days = Math.max(1, Math.round((Date.parse(`${endK}T00:00:00Z`) - Date.parse(`${w.startDate}T00:00:00Z`)) / dayMs) + 1);
        return { label: w.label, sub: w.sub, startDate: w.startDate, endDate: w.endDate, value: val, cost: r.totalCost, out: r.totalCft, slabs: r.slabsCount, days };
      }),
    );
    return NextResponse.json(
      { ok: true, plant, granularity: g, unit: plant === "cnc" ? "per unit (SFT+CFT)" : "per CFT", points },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
