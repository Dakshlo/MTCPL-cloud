/**
 * Carving time — how long a component actually takes on the CNC.
 *
 * Reached from the CNC Logbook. Search a component (jali, pillar, jagati thar)
 * and it answers from the machine's own record: every load→unload span for
 * slabs carrying that label, as a typical (median) and average time, with the
 * spread, the per-unit rate, the sub-variants and the temple split.
 *
 * Same roles as the Logbook it hangs off.
 */

import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { loadCarvingSpans, indexComponents, searchCarvingTime, templesWithData } from "@/lib/carving-time";
import { CarvingTimeClient } from "./time-client";

export const dynamic = "force-dynamic";

const ALLOWED = ["developer", "owner", "carving_head", "senior_incharge", "tender_manager"];

const INK = "#0b1220";
const MUTED = "#8892a4";
const LINE = "#e6eaf0";

export default async function CarvingTimePage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; temple?: string }>;
}) {
  const { profile } = await requireAuth();
  if (!ALLOWED.includes(profile.role)) redirect("/carving");

  const sp = await searchParams;
  const query = (sp.q ?? "").trim();
  const temple = (sp.temple ?? "").trim() || null;

  const spans = await loadCarvingSpans();
  const result = searchCarvingTime(spans, query, temple);
  const index = indexComponents(spans, temple);
  const temples = templesWithData(spans);

  return (
    <div style={{ width: "100%", padding: "16px 22px 60px", background: "#f6f8fb", minHeight: "100vh" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 14 }}>
        <Link
          href="/carving/plan"
          style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: 12.5, fontWeight: 700, color: INK, textDecoration: "none", padding: "8px 14px", borderRadius: 999, border: `1px solid ${LINE}`, background: "#fff", boxShadow: "0 1px 2px rgba(11,18,32,0.05)" }}
        >
          ← CNC Logbook
        </Link>
        <h1 style={{ margin: 0, fontSize: 21, letterSpacing: "-0.025em", color: INK, fontWeight: 800 }}>Carving time</h1>
        <span style={{ fontSize: 11.5, color: MUTED }}>
          from {spans.length.toLocaleString("en-IN")} machine runs
        </span>
      </div>

      <CarvingTimeClient
        result={result}
        index={index}
        temples={temples}
        query={query}
        temple={temple}
      />
    </div>
  );
}
