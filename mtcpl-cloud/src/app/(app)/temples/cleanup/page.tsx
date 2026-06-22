// Admin cleanup — remove uncategorized open slabs (Daksh June 2026).
//
// Lists every temple that has OPEN slabs with NEITHER Category 1 nor
// Category 2 (the bare rows in the Temple View "Unassigned" group), with a
// per-temple Excel export + a confirmed soft-archive (status -> 'rejected',
// which the Temple View excludes entirely). Admin only.

import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { countUncategorizedOpenByTemple } from "@/lib/uncategorized-slabs";
import { CleanupClient, type TempleCount } from "./cleanup-client";

export const dynamic = "force-dynamic";

const ALLOWED = ["owner", "developer", "senior_incharge"];

export default async function TempleCleanupPage() {
  const { profile } = await requireAuth();
  if (!ALLOWED.includes(profile.role)) redirect("/temples");

  const admin = createAdminSupabaseClient();
  const counts = await countUncategorizedOpenByTemple(admin);
  const temples: TempleCount[] = Object.entries(counts)
    .map(([temple, count]) => ({ temple, count }))
    .filter((t) => t.count > 0)
    .sort((a, b) => b.count - a.count);
  const totalSlabs = temples.reduce((s, t) => s + t.count, 0);

  return (
    <div style={{ maxWidth: 820, margin: "0 auto", padding: "0 4px 40px", display: "flex", flexDirection: "column", gap: 14 }}>
      <div>
        <Link href="/temples" style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)", textDecoration: "none" }}>← Temple View</Link>
        <h1 style={{ margin: "6px 0 0", fontSize: 22 }}>🧹 Clean up uncategorized open slabs</h1>
        <p className="muted" style={{ margin: "4px 0 0", fontSize: 13, lineHeight: 1.6 }}>
          Slabs still at status <strong>Open</strong> (Pending) that have <strong>no Category 1 and no Category 2</strong> — the bare rows in the Temple View <strong>Unassigned</strong> group. Removing soft-archives them (status <strong>rejected</strong>): they disappear from Temple View entirely and stay recoverable. <strong>Download the Excel first</strong> — it&apos;s your record and a re-import source.
        </p>
      </div>

      {temples.length === 0 ? (
        <div className="banner">✅ All clear — no temple has open, fully-uncategorized slabs.</div>
      ) : (
        <>
          <div style={{ fontSize: 12.5, color: "var(--muted)", fontWeight: 600 }}>
            {temples.length} temple{temples.length === 1 ? "" : "s"} · {totalSlabs.toLocaleString("en-IN")} slab{totalSlabs === 1 ? "" : "s"} total
          </div>
          <CleanupClient temples={temples} />
        </>
      )}
    </div>
  );
}
