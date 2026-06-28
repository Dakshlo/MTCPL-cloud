/**
 * Production DPR — owner/developer report.
 *
 * Two scopes (chips top-right):
 *   • MTCPL — plant-wide, tabbed sections (Block Added / Block Cutted /
 *     Carving Done / Dispatched).
 *   • Site-wise — Block Cutted + Carving Done + Dispatched STACKED on one page
 *     (no tabs), each grouped by temple/site.
 * Section data lives in src/lib/dpr-*.ts.
 */

import { redirect } from "next/navigation";
import Link from "next/link";

import { requireAuth } from "@/lib/auth";
import { buildBlockAddedReport } from "@/lib/dpr-block-added";
import { buildBlockCuttedReport } from "@/lib/dpr-block-cutted";
import { buildCarvingDoneReport } from "@/lib/dpr-carving-done";
import { buildDispatchedReport } from "@/lib/dpr-dispatched";
import type { DprSection } from "@/lib/dpr-section";
import { DprTabs, type DprSectionKey } from "./dpr-tabs";
import { DprGrid } from "./dpr-grid";

export const dynamic = "force-dynamic";

type Search = Promise<Record<string, string | string[] | undefined>>;

const LIVE: DprSectionKey[] = ["block_added", "block_cutted", "carving_done", "dispatched"];

export default async function DprPage({ searchParams }: { searchParams: Search }) {
  const { profile } = await requireAuth();
  if (!["owner", "developer"].includes(profile.role)) redirect("/");

  const sp = await searchParams;
  const scope: "mtcpl" | "site" = sp.scope === "site" ? "site" : "mtcpl";

  const header = (
    <header
      style={{
        display: "flex", flexWrap: "wrap", alignItems: "center", gap: 14,
        padding: "16px 18px", marginBottom: 14,
        background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12,
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div style={eyebrow()}>Production DPR</div>
        <div style={{ fontSize: 22, fontWeight: 800, color: "var(--text)", letterSpacing: "-0.01em" }}>
          {scope === "site" ? "Site-wise Daily Production Report" : "MTCPL · Daily Production Report"}
        </div>
        <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>
          {scope === "site"
            ? "Block Cutted · Carving Done · Dispatched — temple-wise, all on one page."
            : "Plant-wide production by section."}
        </div>
      </div>
      <div style={{ display: "flex", gap: 6, marginLeft: "auto", flexWrap: "wrap", alignItems: "center" }}>
        <ScopeChip href="/reports/dpr?scope=mtcpl" active={scope === "mtcpl"}>MTCPL</ScopeChip>
        <ScopeChip href="/reports/dpr?scope=site" active={scope === "site"}>Site-wise</ScopeChip>
      </div>
    </header>
  );

  if (scope === "site") {
    const [cut, carve, disp] = await Promise.all([
      buildBlockCuttedReport(),
      buildCarvingDoneReport(),
      buildDispatchedReport(),
    ]);
    const stacked: Array<{ report: DprSection; title: string; shortUnit: string; longUnit: string }> = [
      { report: cut, title: "BLOCK CUTTED", shortUnit: "slab", longUnit: "slab" },
      { report: carve, title: "CARVING DONE", shortUnit: "slab", longUnit: "slab" },
      { report: disp, title: "DISPATCHED", shortUnit: "slab", longUnit: "slab" },
    ];
    return (
      <section style={{ paddingBottom: 24 }}>
        {header}
        <div style={{ fontSize: 12, color: "var(--muted)", margin: "0 2px 10px" }}>
          💡 Click any value cell to flip it to the slab count. Each section is grouped by temple.
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
          {stacked.map((s) => (
            <div key={s.title}>
              <div style={{ fontSize: 14, fontWeight: 800, color: "var(--text)", margin: "0 2px 6px", textTransform: "uppercase", letterSpacing: "0.04em" }}>
                {s.title}
              </div>
              <DprGrid report={s.report} title={s.title} shortUnit={s.shortUnit} longUnit={s.longUnit} />
            </div>
          ))}
        </div>
      </section>
    );
  }

  // MTCPL (tabbed) scope.
  const req = typeof sp.section === "string" ? sp.section : "block_added";
  const initialKey: DprSectionKey = (LIVE as string[]).includes(req) ? (req as DprSectionKey) : "block_added";
  const initialReport: DprSection =
    initialKey === "dispatched" ? await buildDispatchedReport()
      : initialKey === "carving_done" ? await buildCarvingDoneReport()
      : initialKey === "block_cutted" ? await buildBlockCuttedReport()
      : await buildBlockAddedReport();

  return (
    <section style={{ paddingBottom: 24 }}>
      {header}
      <DprTabs initialKey={initialKey} initialReport={initialReport} />
    </section>
  );
}

// ── primitives ──────────────────────────────────────────────────────
function eyebrow(): React.CSSProperties {
  return { fontSize: 11, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.07em" };
}

function ScopeChip({ href, active, children }: { href: string; active?: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      style={{
        padding: "8px 14px", fontSize: 12, fontWeight: 700, borderRadius: 8, textDecoration: "none",
        textTransform: "uppercase", letterSpacing: "0.05em",
        background: active ? "var(--gold)" : "var(--bg)",
        color: active ? "#fff" : "var(--text)",
        border: `1px solid ${active ? "var(--gold-dark)" : "var(--border)"}`,
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </Link>
  );
}
