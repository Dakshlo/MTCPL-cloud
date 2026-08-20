/**
 * Tender / Price Breakdown (Daksh, Aug 2026) — its own page.
 *
 * It started as a tab on the Temple P&L report, but it is a workspace, not a
 * report: it wants the whole window and it is reached from the dashboard, so
 * it lives here and the P&L page went back to being just the P&L.
 *
 * The P&L report is still built server-side — but only for the rate card that
 * seeds "New from rate card" and the real cutting pace behind the timeline.
 *
 * Developer + owner. (The Temple P&L it draws its rate card from stays
 * developer-only — that one's allocation model is still a judgement call.)
 */

import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { buildTemplePnl, pnlPeriodFromSearch } from "@/lib/temple-pnl";
import { TenderClient } from "../temple-pnl/tender-client";
import { TENDER_KEY, canUseTender, type TenderAnalysis } from "../temple-pnl/tender-model";

export const dynamic = "force-dynamic";

const INK = "#0b1220";
const MUTED = "#8892a4";
const LINE = "#e6eaf0";

/** The window's REAL cutting pace: CFT cut ÷ elapsed days (window end clamped
 *  to today, matching how the cost engines clip in-progress periods). */
function dataPaceCftPerDay(startDate: string, endDate: string, producedCft: number): number | null {
  const todayIst = new Date(Date.now() + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const end = endDate < todayIst ? endDate : todayIst;
  const days = Math.max(1, Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`)) / 86400000) + 1);
  if (!Number.isFinite(producedCft) || producedCft <= 0) return null;
  return producedCft / days;
}

export default async function TenderPage({ searchParams }: { searchParams: Promise<{ p?: string }> }) {
  const { profile } = await requireAuth();
  if (!canUseTender(profile.role)) redirect("/dashboard");

  const sp = await searchParams;
  const period = pnlPeriodFromSearch(sp.p);
  const report = await buildTemplePnl(period);

  const admin = createAdminSupabaseClient();
  const { data } = await admin.from("app_settings").select("value").eq("key", TENDER_KEY).maybeSingle();
  const v = data?.value as { analyses?: TenderAnalysis[] } | null;
  const sheets = Array.isArray(v?.analyses) ? v.analyses : [];

  return (
    <div style={{ width: "100%", padding: "14px 16px 60px", background: "#f6f8fb", minHeight: "100vh" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
        <Link
          href="/dashboard"
          style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: 12.5, fontWeight: 700, color: INK, textDecoration: "none", padding: "8px 14px", borderRadius: 999, border: `1px solid ${LINE}`, background: "#fff", boxShadow: "0 1px 2px rgba(11,18,32,0.05)" }}
        >
          ← Dashboard
        </Link>
        <h1 style={{ margin: 0, fontSize: 21, letterSpacing: "-0.025em", color: INK, fontWeight: 800 }}>Tender / Price Breakdown</h1>
        {/* The chip said DEV ONLY until the owner was let in — it would now be
            a lie on his own screen. */}
        <span style={{ marginLeft: "auto", fontSize: 9.5, fontWeight: 800, letterSpacing: "0.09em", color: MUTED, border: `1px solid ${LINE}`, background: "#fff", borderRadius: 999, padding: "4px 10px" }}>
          OWNER · DEV
        </span>
      </div>

      <TenderClient
        initial={sheets}
        defaultWide
        seed={{
          stone: report.rateCard.stonePerCft,
          cutting: report.rateCard.cuttingPerCft,
          carving: report.rateCard.carvingPerCft,
          label: report.period.label,
          pace: dataPaceCftPerDay(report.period.startDate, report.period.endDate, report.rateCard.producedCft),
        }}
      />
    </div>
  );
}
