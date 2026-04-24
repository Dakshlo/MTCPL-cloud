/**
 * Challan Archive — browse every challan ever issued.
 *
 * Lists approved + delivered dispatches (i.e. every "real" challan, not
 * still-provisional drafts). Filters by truck / temple / stone; sorts by
 * challan number, temple, dispatched date. Each row links into the
 * existing /dispatch/[id]/print page.
 *
 * Developer + owner access.
 */

import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { getProfilesMap } from "@/lib/profiles";
import { ChallanArchiveClient, type ChallanRow } from "./archive-client";

function cft(l: number, w: number, t: number): number {
  return (l * w * t) / 1728;
}

export default async function ChallanPage() {
  await requireAuth(["developer", "owner"]);
  const admin = createAdminSupabaseClient();

  // ── Fetch every approved or delivered dispatch. Paginated in 1000-row
  // chunks so the PostgREST db-max-rows=1000 cap doesn't silently truncate
  // long histories (same pattern we use across the app).
  type DispatchRow = {
    id: string;
    challan_number: number | null;
    temple: string;
    vehicle_no: string | null;
    driver_name: string | null;
    driver_phone: string | null;
    dispatched_at: string;
    expected_delivery_date: string | null;
    delivered_at: string | null;
    receiver_name: string | null;
    delivery_note: string | null;
    notes: string | null;
    dispatched_by: string | null;
    delivered_by: string | null;
    approved_by: string | null;
    approved_at: string | null;
  };

  async function fetchAllDispatches(): Promise<DispatchRow[]> {
    const PAGE = 1000;
    const all: DispatchRow[] = [];
    for (let offset = 0; offset < 50000; offset += PAGE) {
      const { data } = await admin
        .from("dispatches")
        .select(
          "id, challan_number, temple, vehicle_no, driver_name, driver_phone, dispatched_at, expected_delivery_date, delivered_at, receiver_name, delivery_note, notes, dispatched_by, delivered_by, approved_by, approved_at",
        )
        .not("approved_at", "is", null)
        .order("challan_number", { ascending: false })
        .range(offset, offset + PAGE - 1);
      if (!data || data.length === 0) break;
      all.push(...(data as DispatchRow[]));
      if (data.length < PAGE) break;
    }
    return all;
  }

  const dispatches = await fetchAllDispatches();
  const dispatchIds = dispatches.map((d) => d.id);

  // ── Slab counts + stone mix per dispatch, via a single aggregate query.
  // We pull dispatch_logs joined with slab_requirements so we can compute
  // per-dispatch slabCount, total CFT, and the set of stones carried.
  let logRows: Array<{
    dispatch_id: string | null;
    slab_requirement_id: string | null;
    stone: string | null;
    length_ft: number | null;
    width_ft: number | null;
    thickness_ft: number | null;
  }> = [];
  if (dispatchIds.length > 0) {
    // Paginate this one too — if 500 dispatches × 20 slabs each, we're at 10k logs.
    for (let offset = 0; offset < 100000; offset += 1000) {
      const { data } = await admin
        .from("dispatch_logs")
        .select("dispatch_id, slab_requirement_id, slab:slab_requirements(stone, length_ft, width_ft, thickness_ft)")
        .in("dispatch_id", dispatchIds)
        .range(offset, offset + 999);
      if (!data || data.length === 0) break;
      for (const row of data) {
        // Supabase PostgREST joins can return either a single object or
        // an array depending on FK cardinality — handle both shapes.
        const rawSlab = (row as { slab: unknown }).slab;
        const slab = Array.isArray(rawSlab) ? rawSlab[0] ?? null : rawSlab ?? null;
        const s = slab as { stone?: string | null; length_ft?: number | null; width_ft?: number | null; thickness_ft?: number | null } | null;
        logRows.push({
          dispatch_id: row.dispatch_id,
          slab_requirement_id: row.slab_requirement_id,
          stone: s?.stone ?? null,
          length_ft: s?.length_ft ?? null,
          width_ft: s?.width_ft ?? null,
          thickness_ft: s?.thickness_ft ?? null,
        });
      }
      if (data.length < 1000) break;
    }
  }

  // Aggregate: per-dispatch slabCount, totalCft, stones Set
  const aggByDispatch = new Map<
    string,
    { slabCount: number; totalCft: number; stones: Set<string> }
  >();
  for (const row of logRows) {
    if (!row.dispatch_id) continue;
    const agg = aggByDispatch.get(row.dispatch_id) ?? {
      slabCount: 0,
      totalCft: 0,
      stones: new Set<string>(),
    };
    agg.slabCount += 1;
    if (row.length_ft && row.width_ft && row.thickness_ft) {
      agg.totalCft += cft(Number(row.length_ft), Number(row.width_ft), Number(row.thickness_ft));
    }
    if (row.stone) agg.stones.add(row.stone);
    aggByDispatch.set(row.dispatch_id, agg);
  }

  const profilesMap = await getProfilesMap();

  // ── Shape client rows
  const rows: ChallanRow[] = dispatches.map((d) => {
    const agg = aggByDispatch.get(d.id);
    return {
      id: d.id,
      challan_number: d.challan_number,
      temple: d.temple,
      vehicle_no: d.vehicle_no,
      driver_name: d.driver_name,
      driver_phone: d.driver_phone,
      dispatched_at: d.dispatched_at,
      expected_delivery_date: d.expected_delivery_date,
      delivered_at: d.delivered_at,
      receiver_name: d.receiver_name,
      delivery_note: d.delivery_note,
      dispatcher_name: d.dispatched_by ? profilesMap[d.dispatched_by] ?? null : null,
      approver_name: d.approved_by ? profilesMap[d.approved_by] ?? null : null,
      delivered_by_name: d.delivered_by ? profilesMap[d.delivered_by] ?? null : null,
      slabCount: agg?.slabCount ?? 0,
      totalCft: Number((agg?.totalCft ?? 0).toFixed(2)),
      stones: agg ? [...agg.stones].sort() : [],
    };
  });

  // Distinct temples + stones for filter dropdowns — pulled from the rows
  // themselves so dropdowns only show values that actually appear.
  const templeSet = new Set<string>();
  const stoneSet = new Set<string>();
  for (const r of rows) {
    if (r.temple) templeSet.add(r.temple);
    for (const s of r.stones) stoneSet.add(s);
  }
  const temples = [...templeSet].sort();
  const stones = [...stoneSet].sort();

  return <ChallanArchiveClient rows={rows} temples={temples} stones={stones} />;
}
