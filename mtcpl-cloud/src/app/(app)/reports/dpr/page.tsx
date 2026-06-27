/**
 * Production DPR — owner/developer report.
 *
 * Redesigned (Daksh, June 2026) into SECTION tabs instead of a period
 * toggle. Scope: MTCPL plant now; site-wise later. First section is
 * "Block Added" — a spreadsheet-style grid (stone → vendor) with Daily /
 * 7 Days / Month / All Time columns. More sections (Block Cutted, …) land
 * one at a time. Section data lives in src/lib/dpr-*.ts.
 */

import { redirect } from "next/navigation";

import { requireAuth } from "@/lib/auth";
import { buildBlockAddedReport } from "@/lib/dpr-block-added";
import { BlockAddedGrid } from "./block-added-grid";

export const dynamic = "force-dynamic";

type Search = Promise<Record<string, string | string[] | undefined>>;

const SECTIONS = [
  { key: "block_added", label: "Block Added", live: true },
  { key: "block_cutted", label: "Block Cutted", live: false },
] as const;

export default async function DprPage({ searchParams }: { searchParams: Search }) {
  const { profile } = await requireAuth();
  if (!["owner", "developer"].includes(profile.role)) redirect("/");

  const sp = await searchParams;
  const reqSection = typeof sp.section === "string" ? sp.section : "block_added";
  const section = SECTIONS.find((s) => s.key === reqSection && s.live) ? reqSection : "block_added";

  const report = await buildBlockAddedReport();

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

      {/* Section tabs */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 14 }}>
        {SECTIONS.map((s) =>
          s.live ? (
            <SectionTab key={s.key} href={`/reports/dpr?section=${s.key}`} active={section === s.key}>
              {s.label}
            </SectionTab>
          ) : (
            <Chip key={s.key} soon>{s.label}</Chip>
          ),
        )}
      </div>

      {/* Active section */}
      {section === "block_added" && (
        <>
          <div style={{ fontSize: 12, color: "var(--muted)", margin: "0 2px 8px" }}>
            💡 Click any CFT cell to flip it to the block count.
          </div>
          <BlockAddedGrid report={report} />
          <div style={{ marginTop: 12, fontSize: 11, color: "var(--muted)" }}>
            Generated {new Date(report.generatedAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} ·
            CFT = L×W×H ÷ 1728 · stone-wise → vendor-wise (no-vendor blocks shown under &ldquo;NO VENDOR&rdquo;) ·
            marble is tonnage-based (no CFT) so those cells show the block count ·
            Daily = today, 7 Days = last 7 days, Month = this calendar month (IST).
          </div>
        </>
      )}
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

function SectionTab({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  // Plain anchor (full reload) — section switch refetches server data.
  return (
    <a
      href={href}
      style={{
        padding: "8px 16px", fontSize: 12.5, fontWeight: 800, borderRadius: 8,
        textTransform: "uppercase", letterSpacing: "0.04em", textDecoration: "none",
        background: active ? "var(--gold)" : "var(--bg)",
        color: active ? "#fff" : "var(--text)",
        border: `1px solid ${active ? "var(--gold-dark)" : "var(--border)"}`,
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </a>
  );
}
