/**
 * Temple P&L (Daksh, Aug 2026) — revenue, allocated cost and margin per
 * temple, the first place the money-out and money-in sides of the business
 * meet.
 *
 * DEVELOPER ONLY. The allocation model is a judgement call (see the header
 * of lib/temple-pnl.ts) and the figures are easy to misread as audited
 * numbers, so this stays with Daksh until the model is agreed. Widening it
 * later is a one-line change to the gate below.
 */

import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { buildTemplePnl, pnlPeriodFromSearch, PNL_PRESETS } from "@/lib/temple-pnl";
import { PnlClient } from "./pnl-client";

export const dynamic = "force-dynamic";

export default async function TemplePnlPage({
  searchParams,
}: {
  searchParams: Promise<{ p?: string }>;
}) {
  const { profile } = await requireAuth();
  if (profile.role !== "developer") redirect("/dashboard");

  const sp = await searchParams;
  const period = pnlPeriodFromSearch(sp.p);
  const report = await buildTemplePnl(period);

  return (
    <div style={{ maxWidth: 1180, margin: "0 auto", padding: "16px 18px 56px" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 4 }}>
        <Link
          href="/dashboard"
          style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: 13, fontWeight: 700, color: "var(--text)", textDecoration: "none", padding: "8px 13px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--surface, #fff)" }}
        >
          ← Dashboard
        </Link>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
          <h1 style={{ margin: 0, fontSize: 21, letterSpacing: "-0.01em" }}>Temple P&amp;L</h1>
          <span style={{ fontSize: 11.5, color: "var(--muted)" }}>
            {report.period.label} · revenue actual, cost allocated
          </span>
        </div>
        <span style={{ marginLeft: "auto", fontSize: 9.5, fontWeight: 800, letterSpacing: "0.07em", color: "var(--muted)", border: "1px solid var(--border)", borderRadius: 6, padding: "3px 8px" }}>
          DEV ONLY
        </span>
      </div>

      {/* Period presets */}
      <div style={{ display: "flex", gap: 7, flexWrap: "wrap", margin: "14px 0 16px" }}>
        {PNL_PRESETS.map((p) => {
          const active = p.key === report.period.key;
          return (
            <Link
              key={p.key}
              href={`/reports/temple-pnl?p=${p.key}`}
              style={{
                fontSize: 12, fontWeight: 700, textDecoration: "none",
                padding: "7px 14px", borderRadius: 999,
                border: `1px solid ${active ? "var(--gold, #b8860b)" : "var(--border)"}`,
                background: active ? "rgba(180,140,60,0.12)" : "var(--surface, #fff)",
                color: active ? "var(--text)" : "var(--muted)",
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
