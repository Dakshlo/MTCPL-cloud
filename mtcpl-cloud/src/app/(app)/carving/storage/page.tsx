// Mig 125 — Temporary Storage for the carving backlog. Owner / developer /
// carving_head can park the cut-done "ready to assign" slabs out of the
// Unassigned list (a historical backlog that was really already carved &
// shipped) and bring back the few that are genuinely needed. Parked slabs
// keep status='cut_done' — nothing else changes.

import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { StorageClient, type ParkedSlab } from "./storage-client";

export const dynamic = "force-dynamic";

const ALLOWED = ["owner", "developer", "carving_head"];

export default async function CarvingStoragePage() {
  const { profile } = await requireAuth();
  if (!ALLOWED.includes(profile.role)) redirect("/carving");
  const admin = createAdminSupabaseClient();

  // Count of slabs still in the Unassigned list (cut_done, not parked).
  const { count: unassignedCount } = await admin
    .from("slab_requirements")
    .select("*", { count: "exact", head: true })
    .eq("status", "cut_done")
    .eq("is_parked", false);

  // All parked slabs (paginated past the 1000-row cap).
  async function fetchParked(): Promise<ParkedSlab[]> {
    const PAGE = 1000;
    const out: ParkedSlab[] = [];
    for (let offset = 0; offset < 50000; offset += PAGE) {
      const { data, error } = await admin
        .from("slab_requirements")
        .select("id, label, temple, stone, length_ft, width_ft, thickness_ft, parked_at")
        .eq("status", "cut_done")
        .eq("is_parked", true)
        .order("temple", { ascending: true })
        .order("id", { ascending: true })
        .range(offset, offset + PAGE - 1);
      if (error) throw new Error(error.message);
      if (!data || data.length === 0) break;
      for (const r of data as Array<{ id: string; label: string | null; temple: string; stone: string | null; length_ft: number; width_ft: number; thickness_ft: number; parked_at: string | null }>) {
        out.push({
          id: r.id, label: r.label ?? "", temple: r.temple, stone: r.stone,
          l: Number(r.length_ft) || 0, w: Number(r.width_ft) || 0, t: Number(r.thickness_ft) || 0,
          parkedAt: r.parked_at,
        });
      }
      if (data.length < PAGE) break;
    }
    return out;
  }

  const parked = await fetchParked();

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, paddingBottom: 40 }}>
      <div>
        <Link href="/carving" style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)", textDecoration: "none" }}>← Carving Jobs</Link>
        <h1 style={{ margin: "6px 0 0", fontSize: 22 }}>🗄 Temporary Storage</h1>
        <p className="muted" style={{ margin: "2px 0 0", fontSize: 13, maxWidth: 760 }}>
          Park the cut-done backlog out of the carving <strong>Unassigned</strong> list. Parked slabs keep their data
          (status stays <strong>cut done</strong>) — they&apos;re just hidden from assignment. Bring any back when you
          actually need to assign it.
        </p>
      </div>
      <StorageClient parked={parked} unassignedCount={unassignedCount ?? 0} />
    </div>
  );
}
