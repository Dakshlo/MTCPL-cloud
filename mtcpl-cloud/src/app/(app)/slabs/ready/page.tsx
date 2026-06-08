import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { POST_CUT_STATUSES } from "@/lib/slab-statuses";
import { ReadySlabsClient } from "./ready-client";

// Per Daksh's note: the Ready Sizes page is the cutting team's
// VERIFICATION view — "what we cut, what came out of which block."
// Previously the query was `status='cut_done'` only, which made
// slabs vanish the moment the carving team picked them up. That
// broke the cutting team's audit ability — they couldn't go back
// and check whether yesterday's MT-B-248 actually produced 11 slabs.
//
// Now uses the shared POST_CUT_STATUSES constant (src/lib/slab-statuses.ts)
// so a slab stays visible from the moment it's cut all the way through
// dispatch — and even after being rejected as a broken slab during
// carving. The status badge on each row makes the current lifecycle
// position obvious; a status filter on the client lets the cutting
// team narrow to "just cut" / "in carving" / "completed" / etc.
//
// The carving team's ASSIGNMENT workflow lives at
// /slabs/ready/for-carving (sidebar label "Ready Sizes Stock",
// under the CARVING section). That page queries cut_done only —
// slabs drop from that view as soon as they're assigned.

export default async function ReadySlabsPage() {
  const { profile } = await requireAuth(["owner", "team_head", "senior_incharge", "block_slab_entry", "carving_head"]);
  void profile;

  const admin = createAdminSupabaseClient();

  // Paginated fetch — PostgREST silently caps a single query at
  // db-max-rows (1000). The cutting team now has far more than 1000
  // post-cut slabs, so a flat query was hiding everything past the
  // first 1000. Walk 1000-row pages until exhausted. (Daksh June 2026.)
  type ReadySlabRow = {
    id: string;
    label: string;
    temple: string;
    stone: string | null;
    quality: string | null;
    length_ft: number;
    width_ft: number;
    thickness_ft: number;
    status: string;
    priority: boolean;
    created_at: string | null;
    updated_at: string | null;
    source_block_id: string | null;
  };
  async function fetchAllReadySlabs(): Promise<ReadySlabRow[]> {
    const PAGE = 1000;
    const MAX = 50000;
    const out: ReadySlabRow[] = [];
    for (let offset = 0; offset < MAX; offset += PAGE) {
      const { data, error } = await admin
        .from("slab_requirements")
        .select(
          "id, label, temple, stone, quality, length_ft, width_ft, thickness_ft, status, priority, created_at, updated_at, source_block_id",
        )
        .in("status", POST_CUT_STATUSES)
        .order("updated_at", { ascending: false })
        .range(offset, offset + PAGE - 1);
      if (error) throw new Error(error.message);
      if (!data || data.length === 0) break;
      out.push(...(data as ReadySlabRow[]));
      if (data.length < PAGE) break;
    }
    return out;
  }

  const [data, { data: stoneTypeRows }] = await Promise.all([
    fetchAllReadySlabs(),
    admin.from("stone_types").select("name").order("name"),
  ]);

  // Work-order assignment map — which slab is assigned to which vendor on a
  // LIVE outsource work order. Same pattern as the Push Urgent page: join
  // carving_work_order_items → carving_work_orders, skip cancelled lines and
  // cancelled/rejected work orders. This lets users WITHOUT push-page access
  // see (and filter by) what's already promised to a vendor, without giving
  // them the ability to push/assign anything. Read-only display only.
  const assignedVendorBySlab = new Map<string, string>();
  {
    const { data: woItems } = await admin
      .from("carving_work_order_items")
      .select("slab_requirement_id, line_status, carving_work_orders(vendor_name, status)")
      .neq("line_status", "cancelled")
      .not("slab_requirement_id", "is", null);
    for (const r of (woItems ?? []) as Array<{
      slab_requirement_id: string | null;
      carving_work_orders:
        | { vendor_name: string | null; status: string | null }
        | { vendor_name: string | null; status: string | null }[]
        | null;
    }>) {
      const sid = r.slab_requirement_id;
      if (!sid) continue;
      const wo = Array.isArray(r.carving_work_orders) ? r.carving_work_orders[0] : r.carving_work_orders;
      if (!wo || wo.status === "cancelled" || wo.status === "rejected") continue;
      if (wo.vendor_name && !assignedVendorBySlab.has(sid)) assignedVendorBySlab.set(sid, wo.vendor_name);
    }
  }

  const slabs = (data ?? []).map((s) => ({
    ...s,
    assignedVendor: assignedVendorBySlab.get(s.id) ?? null,
  }));

  const stoneNames = (stoneTypeRows ?? []).map((s) => s.name);
  const templeNames = [...new Set(slabs.map((s) => s.temple))].sort();

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Total Ready Sizes</h1>
        </div>
      </div>

      <ReadySlabsClient
        slabs={slabs}
        stoneNames={stoneNames}
        templeNames={templeNames}
        mode="verification"
      />
    </>
  );
}
