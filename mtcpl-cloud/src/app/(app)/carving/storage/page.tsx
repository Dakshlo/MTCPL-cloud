// Mig 125 — Main Storage (was carving "Temporary Storage"). Daksh June 2026:
// merged the old separate "Dispatch Storage" in here, so this is now the ONE
// storage for the whole plant. It holds two kinds of parked slab:
//   • cut-done parked  (kind "carving")  → bring back to Carving Unassigned
//   • ready  parked    (kind "dispatch") → bring back to Make Dispatch
// Parked slabs keep their status; is_parked just hides them from their list.

import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { StorageClient, type ParkedSlab } from "./storage-client";

export const dynamic = "force-dynamic";

// View access = anyone who can manage either storage. Per-slab bring-back +
// the two "move all" actions self-gate by role on the server.
const ALLOWED = ["owner", "developer", "carving_head", "senior_incharge", "dispatch"];
const CAN_CARVING = ["owner", "developer", "carving_head"];
const CAN_DISPATCH = ["owner", "developer", "carving_head", "senior_incharge", "dispatch"];

export default async function MainStoragePage() {
  const { profile } = await requireAuth();
  if (!ALLOWED.includes(profile.role)) redirect("/carving");
  const admin = createAdminSupabaseClient();

  // Backlog counts driving the two "move all" cards.
  const [{ count: unassignedCount }, { count: readyCount }] = await Promise.all([
    admin
      .from("slab_requirements")
      .select("*", { count: "exact", head: true })
      .eq("status", "cut_done")
      .eq("is_parked", false),
    admin
      .from("slab_requirements")
      .select("id", { count: "exact", head: true })
      .eq("status", "completed")
      .eq("is_parked", false)
      // Match parkAllReadyDispatchAction, which skips cancel-pending slabs —
      // else the "move all N ready" card overcounts what it will actually park.
      .is("cancel_requested_at", null),
  ]);

  // All parked slabs of either status (paginated past the 1000-row cap).
  async function fetchParked(status: "cut_done" | "completed", kind: ParkedSlab["kind"]): Promise<ParkedSlab[]> {
    const PAGE = 1000;
    const out: ParkedSlab[] = [];
    for (let offset = 0; offset < 60000; offset += PAGE) {
      const { data, error } = await admin
        .from("slab_requirements")
        .select("id, label, temple, stone, length_ft, width_ft, thickness_ft, parked_at")
        .eq("status", status)
        .eq("is_parked", true)
        .order("temple", { ascending: true })
        .order("id", { ascending: true })
        .range(offset, offset + PAGE - 1);
      if (error) throw new Error(error.message);
      if (!data || data.length === 0) break;
      for (const r of data as Array<{ id: string; label: string | null; temple: string | null; stone: string | null; length_ft: number; width_ft: number; thickness_ft: number; parked_at: string | null }>) {
        out.push({
          id: r.id, label: r.label ?? "", temple: (r.temple || "—").trim(), stone: r.stone,
          l: Number(r.length_ft) || 0, w: Number(r.width_ft) || 0, t: Number(r.thickness_ft) || 0,
          parkedAt: r.parked_at, kind,
        });
      }
      if (data.length < PAGE) break;
    }
    return out;
  }

  const [carvingParked, dispatchParked] = await Promise.all([
    fetchParked("cut_done", "carving"),
    fetchParked("completed", "dispatch"),
  ]);
  const parked = [...carvingParked, ...dispatchParked];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, paddingBottom: 40 }}>
      <div>
        <Link href="/carving" style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)", textDecoration: "none" }}>← Carving Jobs</Link>
        <h1 style={{ margin: "6px 0 0", fontSize: 22 }}>🗄 Main Storage</h1>
        <p className="muted" style={{ margin: "2px 0 0", fontSize: 13, maxWidth: 800 }}>
          The plant&apos;s single storage. Park slabs out of their working list to declutter, then bring back only what
          you need. By default <strong>cut-done</strong> slabs return to <strong>Carving Unassigned</strong> and{" "}
          <strong>ready</strong> slabs return to <strong>Make Dispatch</strong> — but the <strong>Bring back to</strong> chooser
          lets you send any slab to <em>either</em> list. Parked slabs keep all their data.
        </p>
      </div>
      <StorageClient
        parked={parked}
        unassignedCount={unassignedCount ?? 0}
        readyCount={readyCount ?? 0}
        canCarving={CAN_CARVING.includes(profile.role)}
        canDispatch={CAN_DISPATCH.includes(profile.role)}
      />
    </div>
  );
}
