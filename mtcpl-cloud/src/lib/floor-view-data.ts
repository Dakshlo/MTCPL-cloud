/**
 * Floor view data builder — produces the same `FloorVendor[]` shape
 * the /carving/floor page consumes. Extracted into a lib so the
 * Active tab on /carving can embed the cockpit view without
 * duplicating the queries.
 *
 * Returns a CURRENT-state snapshot: every active CNC vendor with
 * their machines, queue, and last-24h-completed list. No date
 * window arguments — the timestamps are fixed to "now".
 */

import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import type {
  FloorMachine,
  FloorQueueItem,
  FloorRecent,
  FloorSlab,
  FloorVendor,
} from "@/app/(app)/carving/floor/floor-client";

export async function buildFloorViewData(): Promise<FloorVendor[]> {
  const admin = createAdminSupabaseClient();

  const [
    { data: vendors },
    { data: machines },
    { data: jobs },
    { data: completed },
  ] = await Promise.all([
    admin
      .from("vendors")
      .select("id, name, vendor_type, is_active")
      .eq("vendor_type", "CNC")
      .eq("is_active", true)
      .order("name"),
    admin
      .from("cnc_machines")
      .select(
        "id, vendor_id, machine_code, operator_name, is_active, status, current_carving_item_id, maintenance_reason, maintenance_flagged_at, machine_type",
      )
      .eq("is_active", true)
      .order("machine_code"),
    admin
      .from("carving_items")
      .select(
        "id, slab_requirement_id, vendor_id, status, urgency, estimated_minutes, vendor_estimated_minutes, cnc_machine_id, loaded_at, assigned_at, received_at_vendor_at, requires_machine_type, batch_id",
      )
      .in("status", ["carving_assigned", "carving_in_progress"])
      .order("assigned_at", { ascending: true }),
    admin
      .from("carving_items")
      .select("id, vendor_id, slab_requirement_id, completed_at, review_approved_at")
      .not("completed_at", "is", null)
      .order("completed_at", { ascending: false })
      .limit(500),
  ]);

  // Cut-offs.
  const startOfTodayMs = new Date().setHours(0, 0, 0, 0);
  const last24hMs = Date.now() - 24 * 60 * 60 * 1000;

  // Last-24h-completed rows that need slab dimensions for display.
  const completedRecent24h = ((completed ?? []) as Array<{
    vendor_id: string; slab_requirement_id: string; completed_at: string | null;
  }>).filter((c) => c.completed_at && new Date(c.completed_at).getTime() >= last24hMs);

  const slabIds = [
    ...new Set([
      ...((jobs ?? []) as { slab_requirement_id: string }[]).map((j) => j.slab_requirement_id),
      ...completedRecent24h.map((c) => c.slab_requirement_id),
    ]),
  ];

  const slabById = new Map<string, FloorSlab>();
  // Side-channel for stock_location — we don't put it on FloorSlab
  // because the floor view's machine/recent cards don't need it.
  const slabStockLoc = new Map<string, string | null>();
  if (slabIds.length > 0) {
    const { data: slabs } = await admin
      .from("slab_requirements")
      .select("id, label, temple, stone, length_ft, width_ft, thickness_ft, stock_location")
      .in("id", slabIds);
    for (const s of (slabs ?? []) as Array<{
      id: string; label: string | null; temple: string | null; stone: string | null;
      length_ft: number | string; width_ft: number | string; thickness_ft: number | string;
      stock_location: string | null;
    }>) {
      slabById.set(s.id, {
        id: s.id,
        label: s.label,
        temple: s.temple ?? "—",
        stone: s.stone,
        length_in: Number(s.length_ft) || 0,
        width_in: Number(s.width_ft) || 0,
        thickness_in: Number(s.thickness_ft) || 0,
      });
      // Stash stock_location keyed by slab id so we can fill it on
      // queue items below.
      slabStockLoc.set(s.id, s.stock_location);
    }
  }

  return ((vendors ?? []) as Array<{ id: string; name: string }>).map((v) => {
    const vMachines = ((machines ?? []) as Array<{
      id: string; vendor_id: string; machine_code: string;
      operator_name: string | null; status: string;
      current_carving_item_id: string | null;
      maintenance_reason: string | null; maintenance_flagged_at: string | null;
      machine_type: string | null;
    }>).filter((m) => m.vendor_id === v.id);

    const vJobs = ((jobs ?? []) as Array<{
      id: string; slab_requirement_id: string; vendor_id: string; status: string;
      urgency: string; estimated_minutes: number | null;
      vendor_estimated_minutes: number | null;
      cnc_machine_id: string | null; loaded_at: string | null; assigned_at: string;
      received_at_vendor_at?: string | null;
      requires_machine_type?: string | null;
      batch_id?: string | null;
    }>).filter((j) => j.vendor_id === v.id);

    const queue: FloorQueueItem[] = vJobs
      .filter((j) => j.status === "carving_assigned")
      .map((j) => ({
        id: j.id,
        slab_id: j.slab_requirement_id,
        urgency: (j.urgency === "urgent" ? "urgent" : "normal") as "urgent" | "normal",
        estimated_minutes: j.estimated_minutes,
        slab: slabById.get(j.slab_requirement_id) ?? null,
        received_at_vendor: !!j.received_at_vendor_at,
        is_lathe: j.requires_machine_type === "lathe",
        stock_location: slabStockLoc.get(j.slab_requirement_id) ?? null,
        batch_id: j.batch_id ?? null,
      }))
      .sort((a, b) => (a.urgency === b.urgency ? 0 : a.urgency === "urgent" ? -1 : 1));

    // Accumulate ALL in-progress jobs per machine — a multi_head_2 runs two
    // slabs at once, and the wall display shows every loaded slab.
    const activeByMachine = new Map<string, FloorMachine["current_jobs"]>();
    for (const j of vJobs) {
      if (j.status === "carving_in_progress" && j.cnc_machine_id) {
        const arr = activeByMachine.get(j.cnc_machine_id) ?? [];
        arr.push({
          id: j.id,
          slab_id: j.slab_requirement_id,
          vendor_estimated_minutes: j.vendor_estimated_minutes,
          estimated_minutes: j.estimated_minutes,
          loaded_at: j.loaded_at,
          slab: slabById.get(j.slab_requirement_id) ?? null,
        });
        activeByMachine.set(j.cnc_machine_id, arr);
      }
    }

    const machineCards: FloorMachine[] = vMachines.map((m) => {
      const mt = m.machine_type ?? "single_head";
      const st = m.status ?? "idle";
      return {
        id: m.id,
        machine_code: m.machine_code,
        operator_name: m.operator_name,
        status: (st === "carving" || st === "maintenance" || st === "inactive"
          ? st
          : "idle") as FloorMachine["status"],
        machine_type: (mt === "multi_head_2" || mt === "lathe"
          ? mt
          : "single_head") as FloorMachine["machine_type"],
        maintenance_reason: m.maintenance_reason,
        maintenance_flagged_at: m.maintenance_flagged_at,
        current_jobs: activeByMachine.get(m.id) ?? [],
      };
    });

    const todayCompleted = ((completed ?? []) as Array<{
      vendor_id: string; completed_at: string | null;
    }>).filter((c) => c.vendor_id === v.id && c.completed_at)
      .filter((c) => new Date(c.completed_at!).getTime() >= startOfTodayMs).length;

    const recentCompleted: FloorRecent[] = completedRecent24h
      .filter((c) => c.vendor_id === v.id)
      .map((c) => ({
        slab_id: c.slab_requirement_id,
        completed_at: c.completed_at!,
        slab: slabById.get(c.slab_requirement_id) ?? null,
      }))
      .sort((a, b) => new Date(b.completed_at).getTime() - new Date(a.completed_at).getTime());

    return {
      id: v.id,
      name: v.name,
      machines: machineCards,
      queue,
      recentCompleted,
      totals: {
        total: machineCards.length,
        idle: machineCards.filter((m) => m.status === "idle").length,
        carving: machineCards.filter((m) => m.status === "carving").length,
        maintenance: machineCards.filter((m) => m.status === "maintenance").length,
        queue: queue.length,
        today: todayCompleted,
      },
    };
  });
}
