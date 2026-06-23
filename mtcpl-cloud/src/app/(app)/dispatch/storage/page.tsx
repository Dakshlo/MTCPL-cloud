// Mig 125 follow-on — Dispatch Storage. Park "ready to dispatch" (completed)
// slabs out of the Make Dispatch list to declutter; bring back when loading.
// Mirrors carving's Temporary Storage but for status=completed slabs.

import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { DispatchStorageClient, type ParkedSlab } from "./storage-client";

export const dynamic = "force-dynamic";

const ALLOWED = ["owner", "developer", "carving_head", "senior_incharge", "dispatch"];

export default async function DispatchStoragePage() {
  const { profile } = await requireAuth();
  if (!ALLOWED.includes(profile.role)) redirect("/dispatch");
  const admin = createAdminSupabaseClient();

  const { count: readyCount } = await admin
    .from("slab_requirements")
    .select("id", { count: "exact", head: true })
    .eq("status", "completed")
    .eq("is_parked", false);

  // Paginated (id tiebreaker → stable pages, no dup/drop).
  const parked: Array<Record<string, unknown>> = [];
  for (let off = 0; off < 60000; off += 1000) {
    const { data } = await admin
      .from("slab_requirements")
      .select("id, label, temple, stone, length_ft, width_ft, thickness_ft, parked_at")
      .eq("status", "completed")
      .eq("is_parked", true)
      .order("temple", { ascending: true })
      .order("id", { ascending: true })
      .range(off, off + 999);
    if (!data || data.length === 0) break;
    parked.push(...(data as Array<Record<string, unknown>>));
    if (data.length < 1000) break;
  }

  const rows: ParkedSlab[] = parked.map((s) => ({
    id: s.id as string,
    label: (s.label as string | null) ?? "",
    temple: ((s.temple as string | null) || "—").trim(),
    stone: (s.stone as string | null) ?? null,
    l: Number(s.length_ft) || 0,
    w: Number(s.width_ft) || 0,
    t: Number(s.thickness_ft) || 0,
    parkedAt: (s.parked_at as string | null) ?? null,
  }));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, paddingBottom: 40 }}>
      <div>
        <Link href="/dispatch?tab=ready" style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)", textDecoration: "none" }}>← Make Dispatch</Link>
        <h1 style={{ margin: "6px 0 0", fontSize: 22 }}>🗄 Dispatch Storage</h1>
        <p className="muted" style={{ margin: "2px 0 0", fontSize: 13, maxWidth: 720 }}>
          Park ready-to-dispatch slabs out of the <strong>Make Dispatch</strong> list to keep it clean. Parked slabs keep their data (still <strong>ready</strong>) — bring any back when you actually load them, or pull them straight into a dispatch with the <strong>🗄 dispatch storage</strong> toggle on the picker.
        </p>
      </div>
      <DispatchStorageClient parked={rows} readyCount={readyCount ?? 0} />
    </div>
  );
}
