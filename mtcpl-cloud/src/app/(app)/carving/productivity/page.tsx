/**
 * CNC Productivity — which machine is pulling its weight.
 *
 * Built for Daksh's dad (Oct 2026): most productive machine top to
 * bottom, over 7 days or a month, so a machine doing less than the same
 * kind of machine stands out and can be chased.
 *
 * Owner/developer, the same gate as the CNC Logbook card it sits behind.
 */

import Link from "next/link";
import { redirect } from "next/navigation";

import { requireAuth } from "@/lib/auth";
import { loadCncProductivity, PERIODS } from "@/lib/cnc-productivity";
import { ProductivityView } from "./productivity-client";

export const dynamic = "force-dynamic";

type SearchParams = Promise<{ period?: string; rank?: string }>;

export default async function CncProductivityPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const { profile } = await requireAuth();
  if (profile.role !== "owner" && profile.role !== "developer") redirect("/dashboard");

  const sp = await searchParams;
  const periodKey = PERIODS.some((p) => p.key === sp.period) ? (sp.period as string) : "7d";
  const rankBy = sp.rank === "cft" ? "cft" : "pieces";
  const report = await loadCncProductivity(periodKey, rankBy);

  return (
    <section className="page-fluid" style={{ paddingBottom: 60 }}>
      <header style={{ display: "flex", alignItems: "flex-start", gap: 14, marginBottom: 18, flexWrap: "wrap" }}>
        <div style={{ minWidth: 0 }}>
          <div
            style={{
              fontSize: 11, fontWeight: 800, letterSpacing: "0.1em",
              textTransform: "uppercase", color: "var(--muted)", marginBottom: 5,
            }}
          >
            🗺️ Carving routes
          </div>
          <h1 style={{ fontSize: 27, fontWeight: 800, letterSpacing: "-0.5px", margin: 0 }}>
            CNC Productivity
          </h1>
        </div>
        <Link
          href="/dashboard"
          style={{
            marginLeft: "auto", padding: "10px 16px", fontSize: 13, fontWeight: 700,
            borderRadius: 11, textDecoration: "none", whiteSpace: "nowrap",
            border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)",
          }}
        >
          ← Dashboard
        </Link>
      </header>

      <ProductivityView report={report} />
    </section>
  );
}
