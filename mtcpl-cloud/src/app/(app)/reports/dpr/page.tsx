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
import { emptyWindows, type DprSection, type DprLine, type TempleSlice } from "@/lib/dpr-section";
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
    // Re-organise BY TEMPLE: one grid per temple, with BLOCK CUTTED / CARVING
    // DONE / DISPATCHED as labelled sub-sections inside it (Daksh).
    const cutBy = new Map((cut.byTemple ?? []).map((s) => [s.temple, s]));
    const carveBy = new Map((carve.byTemple ?? []).map((s) => [s.temple, s]));
    const dispBy = new Map((disp.byTemple ?? []).map((s) => [s.temple, s]));
    const temples = [...new Set([...cutBy.keys(), ...carveBy.keys(), ...dispBy.keys()])];
    const volOf = (t: string) =>
      (cutBy.get(t)?.total.allTime.cft ?? 0) + (carveBy.get(t)?.total.allTime.cft ?? 0) + (dispBy.get(t)?.total.allTime.cft ?? 0);
    temples.sort((a, b) => volOf(b) - volOf(a) || a.localeCompare(b));

    const generatedAt = cut.generatedAt;
    return (
      <section style={{ paddingBottom: 24 }}>
        {header}
        <div style={{ fontSize: 12, color: "var(--muted)", margin: "0 2px 10px" }}>
          💡 One temple per excel — each shows Block Cutted, Carving Done and Dispatched. Click any value cell to flip it to the slab count.
        </div>
        {temples.length === 0 ? (
          <div style={{ border: "1px solid #b6b6b6", borderRadius: 8, background: "#fff", padding: "16px 18px", fontSize: 13, color: "#555" }}>
            Nothing to show yet.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 26 }}>
            {temples.map((temple) => {
              const lines: DprLine[] = [];
              const add = (slice: TempleSlice | undefined, label: string) => {
                if (!slice || slice.lines.length === 0) return;
                lines.push({ tone: "group", label, windows: slice.total });
                lines.push(...slice.lines);
              };
              add(cutBy.get(temple), "BLOCK CUTTED");
              add(carveBy.get(temple), "CARVING DONE");
              add(dispBy.get(temple), "DISPATCHED");
              const section: DprSection = { lines, total: emptyWindows(), generatedAt };
              return (
                <div key={temple}>
                  <div style={{ fontSize: 15, fontWeight: 800, color: "var(--text)", margin: "0 2px 6px" }}>
                    🏛 {temple}
                  </div>
                  <DprGrid report={section} title={temple} shortUnit="slab" longUnit="slab" hideTotal />
                </div>
              );
            })}
          </div>
        )}
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
