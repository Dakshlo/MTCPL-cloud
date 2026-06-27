/**
 * Production DPR — owner/developer report.
 *
 * Section tabs (Block Added / Block Cutted / Carving Done), scope MTCPL now /
 * site-wise later. The FIRST section is server-rendered here for a fast first
 * paint; <DprTabs> then switches sections client-side (prefetched, no reload)
 * so tab switching is instant. Section data lives in src/lib/dpr-*.ts.
 */

import { redirect } from "next/navigation";

import { requireAuth } from "@/lib/auth";
import { buildBlockAddedReport } from "@/lib/dpr-block-added";
import { buildBlockCuttedReport } from "@/lib/dpr-block-cutted";
import { buildCarvingDoneReport } from "@/lib/dpr-carving-done";
import type { DprSection } from "@/lib/dpr-section";
import { DprTabs, type DprSectionKey } from "./dpr-tabs";

export const dynamic = "force-dynamic";

type Search = Promise<Record<string, string | string[] | undefined>>;

const LIVE: DprSectionKey[] = ["block_added", "block_cutted", "carving_done"];

export default async function DprPage({ searchParams }: { searchParams: Search }) {
  const { profile } = await requireAuth();
  if (!["owner", "developer"].includes(profile.role)) redirect("/");

  const sp = await searchParams;
  const req = typeof sp.section === "string" ? sp.section : "block_added";
  const initialKey: DprSectionKey = (LIVE as string[]).includes(req) ? (req as DprSectionKey) : "block_added";

  const initialReport: DprSection =
    initialKey === "carving_done" ? await buildCarvingDoneReport()
      : initialKey === "block_cutted" ? await buildBlockCuttedReport()
      : await buildBlockAddedReport();

  return (
    <section style={{ paddingBottom: 24 }}>
      {/* Header + scope */}
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
            MTCPL · Daily Production Report
          </div>
          <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>
            Plant-wide production. Site-wise DPR coming soon.
          </div>
        </div>
        <div style={{ display: "flex", gap: 6, marginLeft: "auto", flexWrap: "wrap", alignItems: "center" }}>
          <Chip active>MTCPL</Chip>
          <Chip soon>Site-wise</Chip>
        </div>
      </header>

      <DprTabs initialKey={initialKey} initialReport={initialReport} />
    </section>
  );
}

// ── primitives ──────────────────────────────────────────────────────
function eyebrow(): React.CSSProperties {
  return { fontSize: 11, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.07em" };
}

function Chip({ active, soon, children }: { active?: boolean; soon?: boolean; children: React.ReactNode }) {
  return (
    <span
      title={soon ? "Coming soon" : undefined}
      style={{
        padding: "8px 14px", fontSize: 12, fontWeight: 700, borderRadius: 8,
        textTransform: "uppercase", letterSpacing: "0.05em",
        background: active ? "var(--gold)" : "var(--bg)",
        color: active ? "#fff" : soon ? "var(--muted)" : "var(--text)",
        border: `1px solid ${active ? "var(--gold-dark)" : "var(--border)"}`,
        opacity: soon ? 0.6 : 1,
        cursor: soon ? "not-allowed" : "default",
        whiteSpace: "nowrap",
      }}
    >
      {children}{soon ? " · soon" : ""}
    </span>
  );
}
