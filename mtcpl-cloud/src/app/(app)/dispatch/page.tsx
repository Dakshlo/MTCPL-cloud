/**
 * Dispatch Station — server component.
 *
 * Loads everything needed for all four tabs in parallel and hands it
 * to the client component. Roles: developer / owner / carving_head.
 *
 * June 2026 makeover (Daksh): slab cards carry description + a
 * ready-since timer (carving approval time, or rework-cleared time if
 * the slab went through the Rework Tunnel), truck history feeds the
 * Provisional tab + the dispatch peek's quick-fill, and delivered rows
 * carry their two mandatory proof photos (mig 129).
 */

import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { getProfilesMap } from "@/lib/profiles";
import {
  DispatchClient,
  type ReadySlab,
  type ProvisionalRow,
  type OutForDeliveryRow,
  type DeliveredRow,
  type LegacyDispatch,
  type TruckTrip,
} from "./dispatch-client";
import type { StoneCategory } from "@/lib/stone-categories";

type Tab = "ready" | "provisional" | "out_for_delivery" | "delivered";

function toCftFromFtNums(l: number, w: number, h: number): number {
  return (l * w * h) / 1728;
}

export default async function DispatchPage({
  searchParams,
}: {
  searchParams: Promise<{
    tab?: string;
    dispatch_toast?: string;
    dispatch_error?: string;
  }>;
}) {
  await requireAuth(["developer", "owner", "carving_head"]);
  const { tab: tabParam, dispatch_toast: toastParam, dispatch_error: errorParam } = await searchParams;
  const initialTab: Tab =
    tabParam === "provisional" || tabParam === "out_for_delivery" || tabParam === "delivered"
      ? tabParam
      : "ready";

  const admin = createAdminSupabaseClient();

  const [
    { data: completedSlabs },
    { data: provisionalDispatches },
    { data: openDispatches },
    { data: closedDispatches },
    { data: allDispatchLogs },
    { data: stoneTypeRows },
    { data: departSlabsRaw },
  ] = await Promise.all([
    // Ready ("Make Dispatch") = status=completed slabs waiting to be packed
    admin
      .from("slab_requirements")
      .select("id, label, description, temple, stone, quality, length_ft, width_ft, thickness_ft, priority, status")
      .eq("status", "completed")
      .order("priority", { ascending: false })
      .order("updated_at", { ascending: true }),
    // Provisional = dispatch created but senior hasn't approved yet.
    admin
      .from("dispatches")
      .select(
        "id, challan_number, temple, vehicle_no, driver_name, driver_phone, dispatched_at, expected_delivery_date, dispatched_by, notes",
      )
      .is("approved_at", null)
      .is("delivered_at", null)
      .order("dispatched_at", { ascending: false }),
    // Out for Delivery = approved but not yet delivered.
    admin
      .from("dispatches")
      .select(
        "id, challan_number, temple, vehicle_no, driver_name, driver_phone, dispatched_at, expected_delivery_date, dispatched_by, notes, approved_at, approved_by, delivered_at",
      )
      .not("approved_at", "is", null)
      .is("delivered_at", null)
      .order("dispatched_at", { ascending: false }),
    // Delivered archive (last 200 by delivered_at). Mig 129 — includes
    // the two delivery-proof photo paths.
    admin
      .from("dispatches")
      .select(
        "id, challan_number, temple, vehicle_no, driver_name, driver_phone, dispatched_at, expected_delivery_date, dispatched_by, notes, approved_at, approved_by, delivered_at, delivered_by, receiver_name, delivery_note, proof_site_path, proof_challan_path",
      )
      .not("delivered_at", "is", null)
      .order("delivered_at", { ascending: false })
      .limit(200),
    // All dispatch_logs — used to derive per-dispatch slab counts AND
    // to identify "legacy" single-slab dispatches (dispatch_id=null).
    admin
      .from("dispatch_logs")
      .select("id, dispatch_id, slab_requirement_id, dispatched_by, dispatched_at, dispatch_note")
      .order("dispatched_at", { ascending: false }),
    // Stone categories — needed to render marble separately in the UI
    admin.from("stone_types").select("name, stone_category"),
    // Mig 097 — departed slabs: approved but held from dispatch. They now
    // live on the Rework Tunnel page; here we only need their ids (to
    // exclude from Make Dispatch) and the count for the header button.
    admin
      .from("slab_requirements")
      .select("id")
      .eq("status", "completed")
      .eq("dispatch_hold", true),
  ]);

  const profilesMap = await getProfilesMap();

  // Build stone category map for marble/sandstone separation
  const stoneCategoryMap: Record<string, StoneCategory> = {};
  for (const s of stoneTypeRows ?? []) {
    const cat = (s as { stone_category?: string }).stone_category;
    stoneCategoryMap[(s as { name: string }).name] = cat === "marble" ? "marble" : "sandstone";
  }

  // Map dispatch_id → slab ids; also collect every dispatched slab id.
  const logsByDispatch = new Map<string, string[]>();
  for (const log of allDispatchLogs ?? []) {
    if (!log.dispatch_id || !log.slab_requirement_id) continue;
    const arr = logsByDispatch.get(log.dispatch_id) ?? [];
    arr.push(log.slab_requirement_id);
    logsByDispatch.set(log.dispatch_id, arr);
  }

  const dispatchedSlabIds = new Set<string>();
  for (const ids of logsByDispatch.values()) for (const id of ids) dispatchedSlabIds.add(id);

  // Pull dims for all slabs that appear in any dispatch (open or closed)
  // so we can render CFT totals.
  const dispatchedSlabsMap = new Map<string, { l: number; w: number; t: number }>();
  if (dispatchedSlabIds.size > 0) {
    const { data: dispatchedSlabs } = await admin
      .from("slab_requirements")
      .select("id, length_ft, width_ft, thickness_ft")
      .in("id", [...dispatchedSlabIds]);
    for (const s of dispatchedSlabs ?? []) {
      dispatchedSlabsMap.set(s.id, {
        l: Number(s.length_ft),
        w: Number(s.width_ft),
        t: Number(s.thickness_ft),
      });
    }
  }

  function cftForDispatch(dispatchId: string): { count: number; cft: number } {
    const slabIds = logsByDispatch.get(dispatchId) ?? [];
    let cft = 0;
    for (const id of slabIds) {
      const s = dispatchedSlabsMap.get(id);
      if (s) cft += toCftFromFtNums(s.l, s.w, s.t);
    }
    return { count: slabIds.length, cft };
  }

  // ── Shape data for the client component

  // Mig 097 — departed (held) slab ids: excluded from Make Dispatch; the
  // slabs themselves live on /dispatch/rework now.
  const departIdSet = new Set(((departSlabsRaw ?? []) as Array<{ id: string }>).map((s) => s.id));
  const reworkCount = departIdSet.size;

  const readyRows = (completedSlabs ?? []).filter(
    (s) => !dispatchedSlabIds.has(s.id) && !departIdSet.has(s.id),
  );

  // Ready-since timer source: carving review approval time — or, if the
  // slab went through the Rework Tunnel, the moment the hold was cleared.
  const readySinceBySlab = new Map<string, { since: string | null; reworked: boolean }>();
  if (readyRows.length > 0) {
    const { data: ciRows } = await admin
      .from("carving_items")
      .select("slab_requirement_id, review_approved_at, depart_cleared_at")
      .in("slab_requirement_id", readyRows.map((s) => s.id));
    for (const r of (ciRows ?? []) as Array<{ slab_requirement_id: string; review_approved_at: string | null; depart_cleared_at: string | null }>) {
      readySinceBySlab.set(r.slab_requirement_id, {
        since: r.depart_cleared_at ?? r.review_approved_at,
        reworked: r.depart_cleared_at != null,
      });
    }
  }

  function shapeReadySlab(s: {
    id: string; label: string | null; description?: string | null; temple: string; stone: string | null;
    quality: string | null; length_ft: number; width_ft: number; thickness_ft: number; priority: boolean | null;
  }): ReadySlab {
    const L = Number(s.length_ft);
    const W = Number(s.width_ft);
    const T = Number(s.thickness_ft);
    const timer = readySinceBySlab.get(s.id);
    return {
      id: s.id,
      label: s.label,
      description: s.description ?? null,
      temple: s.temple,
      stone: s.stone,
      quality: s.quality ?? null,
      dimensions: `${L}×${W}×${T} in`,
      cft: toCftFromFtNums(L, W, T),
      priority: Boolean(s.priority),
      isMarble: stoneCategoryMap[s.stone ?? ""] === "marble",
      readySince: timer?.since ?? null,
      reworked: timer?.reworked ?? false,
    };
  }

  const readySlabs: ReadySlab[] = readyRows.map(shapeReadySlab);

  const provisional: ProvisionalRow[] = (provisionalDispatches ?? []).map((d) => {
    const { count, cft } = cftForDispatch(d.id);
    return {
      id: d.id,
      challan_number: (d as { challan_number?: number }).challan_number ?? null,
      temple: d.temple,
      vehicle_no: d.vehicle_no,
      driver_name: d.driver_name,
      driver_phone: d.driver_phone,
      dispatched_at: d.dispatched_at,
      expected_delivery_date: d.expected_delivery_date,
      dispatcher: d.dispatched_by ? profilesMap[d.dispatched_by] ?? null : null,
      notes: d.notes,
      slabCount: count,
      slabCftTotal: cft,
    };
  });

  const outForDelivery: OutForDeliveryRow[] = (openDispatches ?? []).map((d) => {
    const { count, cft } = cftForDispatch(d.id);
    return {
      id: d.id,
      challan_number: (d as { challan_number?: number }).challan_number ?? null,
      temple: d.temple,
      vehicle_no: d.vehicle_no,
      driver_name: d.driver_name,
      driver_phone: d.driver_phone,
      dispatched_at: d.dispatched_at,
      expected_delivery_date: d.expected_delivery_date,
      dispatcher: d.dispatched_by ? profilesMap[d.dispatched_by] ?? null : null,
      notes: d.notes,
      slabCount: count,
      slabCftTotal: cft,
    };
  });

  const proofUrl = (p: string | null | undefined) =>
    p ? admin.storage.from("dispatch_delivery_proofs").getPublicUrl(p).data.publicUrl : null;

  const delivered: DeliveredRow[] = (closedDispatches ?? []).map((d) => {
    const { count, cft } = cftForDispatch(d.id);
    return {
      id: d.id,
      challan_number: (d as { challan_number?: number }).challan_number ?? null,
      temple: d.temple,
      vehicle_no: d.vehicle_no,
      driver_name: d.driver_name,
      driver_phone: d.driver_phone,
      dispatched_at: d.dispatched_at,
      expected_delivery_date: d.expected_delivery_date,
      dispatcher: d.dispatched_by ? profilesMap[d.dispatched_by] ?? null : null,
      notes: d.notes,
      slabCount: count,
      slabCftTotal: cft,
      delivered_at: d.delivered_at!,
      delivered_by_name: d.delivered_by ? profilesMap[d.delivered_by] ?? null : null,
      receiver_name: d.receiver_name,
      delivery_note: d.delivery_note,
      proofSiteUrl: proofUrl((d as { proof_site_path?: string | null }).proof_site_path),
      proofChallanUrl: proofUrl((d as { proof_challan_path?: string | null }).proof_challan_path),
    };
  });

  // Truck history — every trip ever sent, newest first. Drives the
  // 🚚 Truck history peek (Provisional tab) and the recent-truck
  // quick-fill chips on the new-dispatch form.
  const truckHistory: TruckTrip[] = [
    ...(provisionalDispatches ?? []).map((d) => ({ d, status: "provisional" as const, when: d.dispatched_at })),
    ...(openDispatches ?? []).map((d) => ({ d, status: "on_road" as const, when: d.dispatched_at })),
    ...(closedDispatches ?? []).map((d) => ({ d, status: "delivered" as const, when: d.dispatched_at })),
  ]
    .filter((x) => x.d.vehicle_no)
    .sort((a, b) => new Date(b.when).getTime() - new Date(a.when).getTime())
    .map((x) => ({
      vehicle_no: x.d.vehicle_no as string,
      driver_name: x.d.driver_name,
      driver_phone: x.d.driver_phone,
      temple: x.d.temple,
      dispatched_at: x.d.dispatched_at,
      challan_number: (x.d as { challan_number?: number }).challan_number ?? null,
      status: x.status,
    }));

  // Legacy one-off dispatches: dispatch_logs rows with NULL dispatch_id.
  const legacyDispatches: LegacyDispatch[] = (allDispatchLogs ?? [])
    .filter((l) => !l.dispatch_id)
    .map((l) => ({
      slab_id: l.slab_requirement_id,
      dispatched_at: l.dispatched_at,
      dispatched_by_name: l.dispatched_by ? profilesMap[l.dispatched_by] ?? null : null,
      note: l.dispatch_note ?? null,
    }));

  // Per-provisional slab details for the EditSlabsModal.
  const provisionalSlabIds = (provisionalDispatches ?? [])
    .flatMap((d) => logsByDispatch.get(d.id) ?? []);
  const provisionalSlabDetails = new Map<string, ReadySlab>();
  if (provisionalSlabIds.length > 0) {
    const { data: slabRows } = await admin
      .from("slab_requirements")
      .select("id, label, description, temple, stone, quality, length_ft, width_ft, thickness_ft, priority")
      .in("id", provisionalSlabIds);
    for (const s of slabRows ?? []) {
      provisionalSlabDetails.set(s.id, shapeReadySlab(s));
    }
  }

  const provisionalSlabsByDispatch: Record<string, ReadySlab[]> = {};
  for (const d of provisionalDispatches ?? []) {
    const ids = logsByDispatch.get(d.id) ?? [];
    provisionalSlabsByDispatch[d.id] = ids
      .map((id) => provisionalSlabDetails.get(id))
      .filter((s): s is ReadySlab => s !== undefined);
  }

  return (
    <DispatchClient
      readySlabs={readySlabs}
      reworkCount={reworkCount}
      provisional={provisional}
      provisionalSlabsByDispatch={provisionalSlabsByDispatch}
      outForDelivery={outForDelivery}
      delivered={delivered}
      legacyDispatches={legacyDispatches}
      truckHistory={truckHistory}
      initialTab={initialTab}
      toast={toastParam ?? null}
      error={errorParam ?? null}
    />
  );
}
