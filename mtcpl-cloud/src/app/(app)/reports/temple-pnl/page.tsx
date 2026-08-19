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
import { buildTemplePnl, pnlPeriodFromSearch, PNL_PRESETS } from "@/lib/temple-pnl";
import { PnlClient } from "./pnl-client";

export const dynamic = "force-dynamic";

const INK = "#0b1220";
const MUTED = "#8892a4";
const LINE = "#e6eaf0";
const INDIGO = "#4f46e5";

export default async function TemplePnlPage({
  searchParams,
}: {
  searchParams: Promise<{ p?: string }>;
}) {
  const { profile } = await requireAuth();
  if (profile.role !== "developer") redirect("/dashboard");

  const sp = await searchParams;
  const report = await buildTemplePnl(pnlPeriodFromSearch(sp.p));

  return (
    <div style={{ width: "100%", padding: "16px 26px 60px", background: "#f6f8fb", minHeight: "100vh" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 13, flexWrap: "wrap", marginBottom: 6 }}>
        <Link
          href="/dashboard"
          style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: 12.5, fontWeight: 700, color: INK, textDecoration: "none", padding: "8px 14px", borderRadius: 999, border: `1px solid ${LINE}`, background: "#fff", boxShadow: "0 1px 2px rgba(11,18,32,0.05)" }}
        >
          ← Dashboard
        </Link>
        <h1 style={{ margin: 0, fontSize: 22, letterSpacing: "-0.025em", color: INK, fontWeight: 800 }}>Temple P&amp;L</h1>
        <span style={{ marginLeft: "auto", fontSize: 9.5, fontWeight: 800, letterSpacing: "0.09em", color: MUTED, border: `1px solid ${LINE}`, background: "#fff", borderRadius: 999, padding: "4px 10px" }}>
          DEV ONLY
        </span>
      </div>

      {/* Period presets. */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", margin: "14px 0 18px" }}>
        {PNL_PRESETS.map((p) => {
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
        })}
      </div>

      <PnlClient report={report} />
    </div>
  );
}
