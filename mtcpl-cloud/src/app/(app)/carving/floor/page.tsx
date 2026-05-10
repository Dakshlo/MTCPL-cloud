/**
 * Carving Floor View — every CNC vendor's cockpit on one page.
 *
 * Built for two audiences:
 *   1. Carving head — wants the bird's-eye view of all operators at
 *      once. Default mode = grid; every vendor shown stacked.
 *   2. The owner's TV at home / shop floor display — wants a CCTV-
 *      style auto-rotate. Mode = TV shows ONE vendor at a time
 *      full-screen and advances every 20s.
 *
 * Server-fetches all the data each vendor's /vendor cockpit needs
 * (machines + queues + recent completes). Client component owns
 * the static-vs-TV mode toggle and the rotation timer.
 */

import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { FloorViewClient, type FloorVendor } from "./floor-client";

type Search = Promise<{ mode?: "grid" | "tv"; rotate?: string; vendor?: string }>;

export default async function CarvingFloorPage({ searchParams }: { searchParams: Search }) {
  const { profile } = await requireAuth([
    "developer",
    "owner",
    "carving_head",
  ]);
  void profile;
  const params = await searchParams;
  const initialMode: "grid" | "tv" = params.mode === "tv" ? "tv" : "grid";
  const initialRotateSec = Math.max(5, Math.min(120, Number(params.rotate) || 20));

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
    // Queue + active items across all CNC vendors.
    admin
      .from("carving_items")
      .select(
        "id, slab_requirement_id, vendor_id, status, urgency, estimated_minutes, vendor_estimated_minutes, cnc_machine_id, loaded_at, assigned_at",
      )
      .in("status", ["carving_assigned", "carving_in_progress"])
      .order("assigned_at", { ascending: true }),
    // Recent completed across all vendors — drives BOTH the "today's
    // output" stat and the "Last 24h completed" list per vendor on
    // the Floor View. We need slab_requirement_id so the list can
    // show which slab each row is.
    admin
      .from("carving_items")
      .select("id, vendor_id, slab_requirement_id, completed_at, review_approved_at")
      .not("completed_at", "is", null)
      .order("completed_at", { ascending: false })
      .limit(500),
  ]);

  // Cut-off for the "last 24h completed" list — only those rows
  // need slab info, and we filter the bigger `completed` set by
  // this timestamp before showing.
  const startOfTodayMs = new Date().setHours(0, 0, 0, 0);
  const last24hMs = Date.now() - 24 * 60 * 60 * 1000;

  // Slab info for queue + active + last-24h-completed rows so the
  // floor can show dimensions + temple beside each slab.
  const completedRecent24h = ((completed ?? []) as Array<{
    vendor_id: string; slab_requirement_id: string; completed_at: string | null;
  }>).filter((c) => c.completed_at && new Date(c.completed_at).getTime() >= last24hMs);

  const slabIds = [
    ...new Set([
      ...((jobs ?? []) as { slab_requirement_id: string }[]).map((j) => j.slab_requirement_id),
      ...completedRecent24h.map((c) => c.slab_requirement_id),
    ]),
  ];
  const slabById = new Map<string, {
    id: string;
    label: string | null;
    temple: string;
    stone: string | null;
    length_in: number;
    width_in: number;
    thickness_in: number;
  }>();
  if (slabIds.length > 0) {
    const { data: slabs } = await admin
      .from("slab_requirements")
      .select("id, label, temple, stone, length_ft, width_ft, thickness_ft")
      .in("id", slabIds);
    for (const s of (slabs ?? []) as Array<{
      id: string;
      label: string | null;
      temple: string | null;
      stone: string | null;
      length_ft: number | string;
      width_ft: number | string;
      thickness_ft: number | string;
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
    }
  }

  // Build per-vendor data shape consumed by the client component.
  const floorVendors: FloorVendor[] = ((vendors ?? []) as Array<{ id: string; name: string }>).map((v) => {
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
    }>).filter((j) => j.vendor_id === v.id);

    const queue = vJobs
      .filter((j) => j.status === "carving_assigned")
      .map((j) => ({
        id: j.id,
        slab_id: j.slab_requirement_id,
        urgency: (j.urgency === "urgent" ? "urgent" : "normal") as "urgent" | "normal",
        estimated_minutes: j.estimated_minutes,
        slab: slabById.get(j.slab_requirement_id) ?? null,
      }))
      .sort((a, b) => (a.urgency === b.urgency ? 0 : a.urgency === "urgent" ? -1 : 1));

    const activeByMachine = new Map<string, {
      id: string; slab_id: string;
      vendor_estimated_minutes: number | null;
      estimated_minutes: number | null;
      loaded_at: string | null;
      slab: typeof slabById extends Map<string, infer T> ? T | null : null;
    }>();
    for (const j of vJobs) {
      if (j.status === "carving_in_progress" && j.cnc_machine_id) {
        activeByMachine.set(j.cnc_machine_id, {
          id: j.id,
          slab_id: j.slab_requirement_id,
          vendor_estimated_minutes: j.vendor_estimated_minutes,
          estimated_minutes: j.estimated_minutes,
          loaded_at: j.loaded_at,
          slab: slabById.get(j.slab_requirement_id) ?? null,
        });
      }
    }

    const machineCards = vMachines.map((m) => {
      const mt = m.machine_type ?? "single_head";
      const st = m.status ?? "idle";
      return {
        id: m.id,
        machine_code: m.machine_code,
        operator_name: m.operator_name,
        status: (st === "carving" || st === "maintenance" || st === "inactive"
          ? st
          : "idle") as "idle" | "carving" | "maintenance" | "inactive",
        machine_type: (mt === "multi_head_2" || mt === "lathe"
          ? mt
          : "single_head") as "single_head" | "multi_head_2" | "lathe",
        maintenance_reason: m.maintenance_reason,
        maintenance_flagged_at: m.maintenance_flagged_at,
        current_job: activeByMachine.get(m.id) ?? null,
      };
    });

    // Today's completed count for the vendor (compares against IST
    // local midnight via JS Date — close enough for a TV display).
    const todayCompleted = ((completed ?? []) as Array<{
      vendor_id: string; completed_at: string | null;
    }>).filter((c) => c.vendor_id === v.id && c.completed_at)
      .filter((c) => new Date(c.completed_at!).getTime() >= startOfTodayMs).length;

    // Last-24h completed list — slab id + when, sorted newest first.
    const recentCompleted = completedRecent24h
      .filter((c) => c.vendor_id === v.id)
      .map((c) => ({
        slab_id: c.slab_requirement_id,
        completed_at: c.completed_at!,
        slab: slabById.get(c.slab_requirement_id) ?? null,
      }))
      .sort((a, b) => new Date(b.completed_at).getTime() - new Date(a.completed_at).getTime());

    const totals = {
      total: machineCards.length,
      idle: machineCards.filter((m) => m.status === "idle").length,
      carving: machineCards.filter((m) => m.status === "carving").length,
      maintenance: machineCards.filter((m) => m.status === "maintenance").length,
      queue: queue.length,
      today: todayCompleted,
    };

    return {
      id: v.id,
      name: v.name,
      machines: machineCards,
      queue,
      recentCompleted,
      totals,
    };
  });

  return (
    <FloorViewClient
      vendors={floorVendors}
      initialMode={initialMode}
      initialRotateSec={initialRotateSec}
      initialVendorId={params.vendor ?? null}
    />
  );
}
