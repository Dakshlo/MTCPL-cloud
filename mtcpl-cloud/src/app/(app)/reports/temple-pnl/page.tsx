/**
 * Temple P&L (Daksh, Aug 2026) — revenue, allocated cost and margin per
 * temple, the first place the money-out and money-in sides of the business
 * meet.
 *
 * DEVELOPER ONLY. The allocation model is a judgement call (see the header
 * of lib/temple-pnl.ts) and the figures are easy to misread as audited
 * numbers, so this stays with Daksh until the model is agreed. Widening it
 * later is a one-line change to the gate below.
 *
 * Shell restyled to the Finance Analysis language (Daksh) — full-width,
 * pinned light surface, white pill chips with an indigo active ring.
 */

import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { buildTemplePnl, pnlPeriodFromSearch, PNL_PRESETS } from "@/lib/temple-pnl";
import { PnlClient } from "./pnl-client";
import { TenderClient } from "./tender-client";
import { TENDER_KEY, type TenderAnalysis } from "./tender-model";

export const dynamic = "force-dynamic";

const INK = "#0b1220";
const MUTED = "#8892a4";
const LINE = "#e6eaf0";
const INDIGO = "#4f46e5";

/** The window's REAL cutting pace: CFT cut ÷ elapsed days (window end
 *  clamped to today, matching how the cost engines clip in-progress
 *  periods). Feeds the tender sheet's data-driven timeline. */
function dataPaceCftPerDay(startDate: string, endDate: string, producedCft: number): number | null {
  const todayIst = new Date(Date.now() + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const end = endDate < todayIst ? endDate : todayIst;
  const days = Math.max(1, Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`)) / 86400000) + 1);
  if (!Number.isFinite(producedCft) || producedCft <= 0) return null;
  return producedCft / days;
}

const tabPill = (active: boolean): React.CSSProperties => ({
  fontSize: 12.5,
  fontWeight: 800,
  textDecoration: "none",
  padding: "7px 15px",
  borderRadius: 999,
  color: active ? "#fff" : MUTED,
  background: active ? INDIGO : "transparent",
});

export default async function TemplePnlPage({
  searchParams,
}: {
  searchParams: Promise<{ p?: string; tab?: string }>;
}) {
  const { profile } = await requireAuth();
  if (profile.role !== "developer") redirect("/dashboard");

  const sp = await searchParams;
  const period = pnlPeriodFromSearch(sp.p);
  const tab = sp.tab === "tender" ? "tender" : "pnl";
  // The report powers the P&L view AND seeds the tender sheet's
  // "from rate card" template, so it's built for both tabs.
  const report = await buildTemplePnl(period);

  // Saved tender sheets (app_settings jsonb — no migration).
  let tenderSheets: TenderAnalysis[] = [];
  if (tab === "tender") {
    const admin = createAdminSupabaseClient();
    const { data } = await admin.from("app_settings").select("value").eq("key", TENDER_KEY).maybeSingle();
    const v = data?.value as { analyses?: TenderAnalysis[] } | null;
    if (v && Array.isArray(v.analyses)) tenderSheets = v.analyses;
  }

  return (
    // The tender workspace is a worksheet — it wants every pixel, so its tab
    // runs on tighter side padding than the P&L report (Daksh).
    <div style={{ width: "100%", padding: tab === "tender" ? "14px 16px 60px" : "16px 26px 60px", background: "#f6f8fb", minHeight: "100vh" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 13, flexWrap: "wrap", marginBottom: 6 }}>
        <Link
          href="/dashboard"
          style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: 12.5, fontWeight: 700, color: INK, textDecoration: "none", padding: "8px 14px", borderRadius: 999, border: `1px solid ${LINE}`, background: "#fff", boxShadow: "0 1px 2px rgba(11,18,32,0.05)" }}
        >
          ← Dashboard
        </Link>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
          <h1 style={{ margin: 0, fontSize: 22, letterSpacing: "-0.025em", color: INK, fontWeight: 800 }}>Temple P&amp;L</h1>
          <span style={{ fontSize: 12, color: MUTED }}>
            {report.period.label} · revenue actual, cost allocated
          </span>
        </div>
        <span style={{ marginLeft: "auto", fontSize: 9.5, fontWeight: 800, letterSpacing: "0.09em", color: MUTED, border: `1px solid ${LINE}`, background: "#fff", borderRadius: 999, padding: "4px 10px" }}>
          DEV ONLY
        </span>
      </div>

      {/* View tabs + (P&L only) period presets. */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", margin: "14px 0 18px" }}>
        <div style={{ display: "flex", gap: 4, background: "#fff", border: `1px solid ${LINE}`, borderRadius: 999, padding: 4, boxShadow: "0 1px 2px rgba(11,18,32,0.05)" }}>
          <Link href={`/reports/temple-pnl?p=${report.period.key}`} style={tabPill(tab === "pnl")}>📊 Temple P&amp;L</Link>
          <Link href={`/reports/temple-pnl?p=${report.period.key}&tab=tender`} style={tabPill(tab === "tender")}>🧮 Tender / Price Breakdown</Link>
        </div>
        {tab === "pnl" ? (
          PNL_PRESETS.map((p) => {
            const active = p.key === report.period.key;
            return (
              <Link
                key={p.key}
                href={`/reports/temple-pnl?p=${p.key}`}
                style={{
                  fontSize: 12.5,
                  fontWeight: 700,
                  textDecoration: "none",
                  padding: "8px 16px",
                  borderRadius: 999,
                  border: `1px solid ${active ? INDIGO : LINE}`,
                  background: "#fff",
                  color: active ? INDIGO : MUTED,
                  boxShadow: active ? `inset 0 0 0 1px ${INDIGO}, 0 1px 3px rgba(79,70,229,0.15)` : "0 1px 2px rgba(11,18,32,0.04)",
                }}
              >
                {p.label}
              </Link>
            );
          })
        ) : (
          <span style={{ fontSize: 11.5, color: MUTED }}>
            sheets autosave · &quot;from rate card&quot; seeds {report.period.label} rates · 🖨 prints the letterhead quotation · 📌 save a version to compare a re-price
          </span>
        )}
      </div>

      {tab === "pnl" ? (
        <PnlClient report={report} />
      ) : (
        <TenderClient
          initial={tenderSheets}
          seed={{
            stone: report.rateCard.stonePerCft,
            cutting: report.rateCard.cuttingPerCft,
            carving: report.rateCard.carvingPerCft,
            label: report.period.label,
            pace: dataPaceCftPerDay(report.period.startDate, report.period.endDate, report.rateCard.producedCft),
          }}
        />
      )}
    </div>
  );
}
