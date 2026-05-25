/**
 * Mig 060 — Various Costing landing. Two sub-cards:
 *   1. CNC Costing  → existing carving monthly report at
 *      /carving/reports (cost-per-SFT/CFT broken down per CNC vendor).
 *   2. Cutter Costing → the new mig 060 report at
 *      /reports/various-costing/cutter (aggregate cost-per-CFT for
 *      the cutting machines).
 *
 * Auth: canViewVariousCosting (= can view either sub-report). The
 * sub-cards themselves gate to whichever the user can actually open.
 */

import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import {
  canViewCncCosts,
  canViewCutterCosts,
  canViewVariousCosting,
} from "@/lib/expenses-permissions";

export default async function VariousCostingLanding() {
  const { profile } = await requireAuth();
  if (!canViewVariousCosting(profile)) {
    redirect("/");
  }
  const canCnc = canViewCncCosts(profile);
  const canCutter = canViewCutterCosts(profile);

  return (
    <section style={{ paddingBottom: 24 }}>
      <header
        style={{
          padding: "20px 24px",
          marginBottom: 18,
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: 14,
        }}
      >
        <div style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
          Reports
        </div>
        <div style={{ fontSize: 24, fontWeight: 800, color: "var(--text)", letterSpacing: "-0.01em" }}>
          Various Costing
        </div>
        <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 4 }}>
          Cost-per-unit reports for production. Pick the department.
        </div>
      </header>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
          gap: 14,
        }}
      >
        <CostingCard
          href="/reports/various-costing/cnc"
          enabled={canCnc}
          icon="🛠"
          tone="#7c3aed"
          title="CNC Costing"
          subtitle="Cost per SFT / CFT — carving department"
          description="Focused dashboard with daily / weekly / monthly / yearly views. KPI tiles, per-vendor breakdown, expense categories. The full Excel-style report is one click away from there."
        />
        <CostingCard
          href="/reports/various-costing/cutter"
          enabled={canCutter}
          icon="✂"
          tone="#0ea5e9"
          title="Cutter Costing"
          subtitle="Cost per CFT — cutting department (aggregate)"
          description="Aggregate cost-per-CFT for the cutting machines. Pulls expenses + depreciation; divides by CFT of blocks completed in the period."
        />
      </div>
    </section>
  );
}

function CostingCard({
  href,
  enabled,
  icon,
  tone,
  title,
  subtitle,
  description,
}: {
  href: string;
  enabled: boolean;
  icon: string;
  tone: string;
  title: string;
  subtitle: string;
  description: string;
}) {
  const inner = (
    <div
      style={{
        padding: "22px 22px 24px",
        background: enabled ? "var(--surface)" : "var(--bg)",
        border: `1px solid ${enabled ? "var(--border)" : "var(--border)"}`,
        borderRadius: 14,
        position: "relative",
        overflow: "hidden",
        opacity: enabled ? 1 : 0.55,
        transition: "transform 0.12s, box-shadow 0.12s",
        cursor: enabled ? "pointer" : "not-allowed",
        textDecoration: "none",
        color: "inherit",
        display: "block",
      }}
    >
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          bottom: 0,
          width: 4,
          background: tone,
        }}
      />
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
        <div
          style={{
            width: 40,
            height: 40,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 22,
            background: tone + "1a",
            color: tone,
            borderRadius: 10,
          }}
        >
          {icon}
        </div>
        <div>
          <div style={{ fontSize: 17, fontWeight: 800, color: "var(--text)" }}>{title}</div>
          <div style={{ fontSize: 12, color: "var(--muted)" }}>{subtitle}</div>
        </div>
      </div>
      <div style={{ fontSize: 13, color: "var(--muted)", lineHeight: 1.5, marginBottom: 12 }}>
        {description}
      </div>
      <div
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          padding: "6px 12px",
          fontSize: 12,
          fontWeight: 700,
          color: enabled ? "var(--gold)" : "var(--muted)",
          background: enabled ? "var(--bg)" : "transparent",
          border: `1px solid ${enabled ? "var(--gold)" : "var(--border)"}`,
          borderRadius: 999,
        }}
      >
        {enabled ? "Open report →" : "No access"}
      </div>
    </div>
  );
  if (!enabled) return inner;
  return (
    <Link href={href} style={{ textDecoration: "none", color: "inherit" }}>
      {inner}
    </Link>
  );
}
