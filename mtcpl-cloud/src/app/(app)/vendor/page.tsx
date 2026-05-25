/**
 * Vendor cockpit — mobile-first CNC supervisor view.
 *
 * The vendor (e.g. Vivek) supervises N CNC machines. They land here
 * and see:
 *   1. Top: vendor + live machine status totals
 *   2. Queue: slabs assigned but not yet loaded — sorted by urgency
 *      then assigned_at
 *   3. Machines: a grid of cards (one per CNC) — colour-coded by
 *      status. Idle → "Load slab" CTA. Carving → slab info +
 *      countdown. Maintenance → reason + "Resolve" CTA.
 *   4. Recent completed: last 10 unloaded jobs (awaiting team review)
 *
 * Server-renders all data; client component (vendor-cockpit-client)
 * owns the modals and the live timer ticking.
 */

import { cookies } from "next/headers";
import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { VendorCockpitClient, type CarvingJobLite, type CncMachineLive, type SlabLite, type HeldSlabLite } from "./cockpit-client";

type SearchParams = Promise<{ vendor_id?: string; toast?: string }>;

export default async function VendorPortalPage({ searchParams }: { searchParams: SearchParams }) {
  // Vendor portal also accessible by carving_head + dev/owner so they
  // can see what their vendors are doing without role-switching.
  const { profile } = await requireAuth([
    "vendor",
    "developer",
    "owner",
    "carving_head",
    "senior_incharge",
  ]);
  const params = await searchParams;
  const admin = createAdminSupabaseClient();

  // Daksh May 2026 round 2 — carving_head + senior_incharge see /vendor
  // as read-only ("Global My Jobs" oversight view). They can browse the
  // floor + drop-into different vendors via the picker, but action
  // buttons are hidden. Owner stays write-capable (dad uses /vendor for
  // occasional intervention); the vendor themselves keeps full access
  // to their own cockpit.
  const readOnlyCockpit =
    profile.role === "carving_head" || profile.role === "senior_incharge";

  // Resolve which vendor we're viewing.
  // - Vendor role: scoped to their own vendor_id, UNLESS their
  //   profile has managed_vendor_ids set (mig 077). When that
  //   array is populated and ?vendor_id is in it, the vendor user
  //   gets to act as that other vendor too — Daksh: "Alkesh is
  //   unavailable, give Mohit access to Alkesh's cockpit so we can
  //   manage that." Switcher is offered as a sidebar entry.
  // - Other roles: pick from ?vendor_id=... → cookie (sticky pick) →
  //   first CNC vendor (alphabetical fallback).
  //
  // Daksh May 2026 — the cookie tier is the fix for the "every
  // action snaps the page back to ALKESH" bug. Server actions
  // redirect to /vendor without a query string, dropping the
  // ?vendor_id=. The dropdown writes mtcpl_vendor_pick when staff
  // change the selection; we read it here so the choice survives
  // every load/hold/complete action. The cookie is validated below
  // against actual vendor access — if it points to a deleted or
  // inactive vendor, we drop through to the alphabetical default.
  const managedVendorIds = profile.managed_vendor_ids ?? [];
  let vendorId: string | null = profile.vendor_id ?? null;
  if (profile.role === "vendor") {
    // Mig 077 — vendor users with managed_vendor_ids can drop into
    // those other cockpits via ?vendor_id=. Any other id (including
    // none) means stay on their own.
    if (params.vendor_id && managedVendorIds.includes(params.vendor_id)) {
      vendorId = params.vendor_id;
    }
  } else {
    if (params.vendor_id) {
      vendorId = params.vendor_id;
    } else {
      const cookieStore = await cookies();
      const stickyPick = cookieStore.get("mtcpl_vendor_pick")?.value ?? null;
      if (stickyPick) {
        // Validate the sticky pick still resolves to an active CNC
        // vendor before honouring it. Avoids landing on a stale
        // cookie pointing at a deleted/inactive vendor.
        const { data: pickRow } = await admin
          .from("vendors")
          .select("id")
          .eq("id", stickyPick)
          .eq("is_active", true)
          .maybeSingle();
        if (pickRow) vendorId = stickyPick;
      }
      if (!vendorId) {
        const { data: firstVendor } = await admin
          .from("vendors")
          .select("id")
          .eq("vendor_type", "CNC")
          .eq("is_active", true)
          .order("name")
          .limit(1)
          .maybeSingle();
        vendorId = (firstVendor as { id?: string } | null)?.id ?? null;
      }
    }
  }

  // No vendor binding — fall back to a friendly empty page.
  if (!vendorId) {
    return (
      <div style={{ padding: 24 }}>
        <h1 style={{ margin: 0, fontSize: 22 }}>My CNC Cockpit</h1>
        <p className="muted" style={{ marginTop: 8, fontSize: 13 }}>
          No vendor binding for your profile. Contact the team office.
        </p>
      </div>
    );
  }

  const [
    { data: vendor },
    { data: machines },
    { data: queueAndActive },
    { data: completedRecent },
    { data: vendorPickerRows },
    { data: stoneTypes },
  ] = await Promise.all([
    admin
      .from("vendors")
      .select("id, name, vendor_type, is_active")
      .eq("id", vendorId)
      .maybeSingle(),
    admin
      .from("cnc_machines")
      .select("id, machine_code, operator_name, status, is_active, current_carving_item_id, maintenance_reason, maintenance_flagged_at, machine_type")
      .eq("vendor_id", vendorId)
      .eq("is_active", true)
      .order("machine_code"),
    // Queue (carving_assigned, no machine) + Active (carving_in_progress)
    // + On Hold (carving_on_hold, mig 069) pulled together so we can
    // split client-side. Held slabs need the held_at + held_reason +
    // held_from_machine_id fields surfaced for the On Hold tray.
    // Mig 070 — also surface transferred_from_* so Pending stock can
    // render the "Transferred from X" badge + Accept/Flag buttons
    // for inter-vendor transfers.
    admin
      .from("carving_items")
      .select(
        "id, slab_requirement_id, status, urgency, estimated_minutes, vendor_estimated_minutes, cnc_machine_id, loaded_at, assigned_at, note, received_at_vendor_at, requires_machine_type, batch_id, held_at, held_reason, held_from_machine_id, transferred_from_vendor_id, transferred_from_vendor_name, transferred_at",
      )
      .eq("vendor_id", vendorId)
      .in("status", ["carving_assigned", "carving_in_progress", "carving_on_hold"])
      // Daksh May 2026 round 3 — defensive filter for the recurring
      // "4 slabs on a 2-head" bug. completeAndUnloadAction stamps
      // completed_at + clears cnc_machine_id (ce01026), but
      // pre-ce01026 rows can still have status='carving_in_progress'
      // AND cnc_machine_id pointing at a machine AND completed_at set.
      // The cockpit grouped those onto the machine card, so a
      // running pair stacked on top of stale completed pair = 4 slabs
      // visible. Adding completed_at IS NULL drops the orphans without
      // a data migration.
      .is("completed_at", null)
      .order("assigned_at", { ascending: true }),
    admin
      .from("carving_items")
      .select("id, slab_requirement_id, completed_at, temporary_location, review_approved_at, review_notes")
      .eq("vendor_id", vendorId)
      .not("completed_at", "is", null)
      .order("completed_at", { ascending: false })
      .limit(10),
    // All active CNC + Manual vendors. Used for two purposes:
    //   1. Vendor picker for non-vendor roles (cockpit-switcher).
    //   2. Transfer-destination dropdown on the per-slab Problem
    //      modal — vendors can now transfer their own slabs to
    //      other vendors, so they need the list even though they're
    //      logged in as 'vendor' role.
    admin
      .from("vendors")
      .select("id, name, vendor_type")
      .in("vendor_type", ["CNC", "Manual"])
      .eq("is_active", true)
      .order("name"),
    // Stone palette definitions for the 3D slab thumbnails on
    // queue rows + machine cards. Same shape carving page uses.
    admin
      .from("stone_types")
      .select("id, name, color_top, color_front, color_side, sort_order, is_active")
      .order("sort_order")
      .order("name"),
  ]);

  if (!vendor) {
    return (
      <div style={{ padding: 24 }}>
        <h1 style={{ margin: 0, fontSize: 22 }}>Vendor not found</h1>
      </div>
    );
  }

  // Hydrate slab info for everything we'll display.
  const slabIds = [
    ...(queueAndActive ?? []).map((j) => (j as { slab_requirement_id: string }).slab_requirement_id),
    ...(completedRecent ?? []).map((j) => (j as { slab_requirement_id: string }).slab_requirement_id),
  ];
  const uniqueSlabIds = [...new Set(slabIds)];
  const slabById = new Map<string, SlabLite>();
  if (uniqueSlabIds.length > 0) {
    const { data: slabs } = await admin
      .from("slab_requirements")
      .select("id, label, temple, stone, length_ft, width_ft, thickness_ft, stock_location")
      .in("id", uniqueSlabIds);
    for (const s of (slabs ?? []) as Array<{
      id: string;
      label: string | null;
      temple: string | null;
      stone: string | null;
      length_ft: number | string;
      width_ft: number | string;
      thickness_ft: number | string;
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
        stock_location: s.stock_location,
      });
    }
  }

  // Reshape rows for the client component.
  const queue: CarvingJobLite[] = [];
  // Map machine_id → ALL active jobs on it. Used to be a single
  // entry per machine (only the last one in iteration order), which
  // lost the second slab on a 2-head pair. Now stored as an array
  // so the cockpit can render both slabs side-by-side and act on
  // either one independently (e.g. unload one mid-carving).
  const activeByMachine = new Map<string, CarvingJobLite[]>();
  // Mig 069 — on-hold tray. Slabs the vendor parked mid-carve so
  // they could free the machine for another piece. Surfaced by its
  // own peek modal in the cockpit; the slab keeps its vendor + its
  // held_from_machine so the reload modal can default back.
  const held: HeldSlabLite[] = [];
  for (const row of (queueAndActive ?? []) as Array<{
    id: string;
    slab_requirement_id: string;
    status: string;
    urgency: string;
    estimated_minutes: number | null;
    vendor_estimated_minutes: number | null;
    cnc_machine_id: string | null;
    loaded_at: string | null;
    assigned_at: string;
    note: string | null;
    received_at_vendor_at?: string | null;
    requires_machine_type?: string | null;
    batch_id?: string | null;
    held_at?: string | null;
    held_reason?: string | null;
    held_from_machine_id?: string | null;
    transferred_from_vendor_id?: string | null;
    transferred_from_vendor_name?: string | null;
    transferred_at?: string | null;
  }>) {
    const slab = slabById.get(row.slab_requirement_id) ?? null;
    const job: CarvingJobLite = {
      id: row.id,
      slab_id: row.slab_requirement_id,
      status: row.status,
      urgency: row.urgency === "urgent" ? "urgent" : "normal",
      estimated_minutes: row.estimated_minutes,
      vendor_estimated_minutes: row.vendor_estimated_minutes,
      cnc_machine_id: row.cnc_machine_id,
      loaded_at: row.loaded_at,
      assigned_at: row.assigned_at,
      note: row.note,
      slab,
      received_at_vendor_at: row.received_at_vendor_at ?? null,
      requires_machine_type: row.requires_machine_type ?? null,
      batch_id: row.batch_id ?? null,
      transferred_from_vendor_id: row.transferred_from_vendor_id ?? null,
      transferred_from_vendor_name: row.transferred_from_vendor_name ?? null,
      transferred_at: row.transferred_at ?? null,
    };
    if (row.status === "carving_on_hold") {
      held.push({
        id: row.id,
        slab_id: row.slab_requirement_id,
        urgency: job.urgency,
        requires_machine_type: row.requires_machine_type ?? null,
        held_at: row.held_at ?? null,
        held_reason: row.held_reason ?? null,
        held_from_machine_id: row.held_from_machine_id ?? null,
        slab,
      });
      continue;
    }
    if (row.status === "carving_assigned") queue.push(job);
    else if (row.cnc_machine_id) {
      const arr = activeByMachine.get(row.cnc_machine_id) ?? [];
      arr.push(job);
      activeByMachine.set(row.cnc_machine_id, arr);
    }
  }
  // Sort held: most-recently-held first so a quick flip-and-reload
  // shows up at the top of the tray.
  held.sort((a, b) => {
    const aT = a.held_at ? new Date(a.held_at).getTime() : 0;
    const bT = b.held_at ? new Date(b.held_at).getTime() : 0;
    return bT - aT;
  });
  // Sort the queue: urgent first, then oldest assigned first.
  queue.sort((a, b) => {
    if (a.urgency !== b.urgency) return a.urgency === "urgent" ? -1 : 1;
    return new Date(a.assigned_at).getTime() - new Date(b.assigned_at).getTime();
  });

  // Build machine cards with their currently-loaded job (if any).
  // Daksh May 2026 round 3 — head-count cap on current_jobs. Belt-
  // and-suspenders against the recurring "4 slabs on a 2-head" bug:
  // even if some unforeseen path leaves orphans pointing at the
  // machine, the card visually clamps to the machine_type's head
  // count (2 for multi_head_2, 1 for everything else). The
  // completed_at filter on the query above is the primary defence;
  // this cap catches anything that still slips through.
  const headCountFor = (t: string | null): number =>
    t === "multi_head_2" ? 2 : 1;
  const machineCards: CncMachineLive[] = ((machines ?? []) as Array<{
    id: string;
    machine_code: string;
    operator_name: string | null;
    status: string;
    current_carving_item_id: string | null;
    maintenance_reason: string | null;
    maintenance_flagged_at: string | null;
    machine_type: string | null;
  }>).map((m) => ({
    id: m.id,
    machine_code: m.machine_code,
    operator_name: m.operator_name,
    status:
      m.status === "carving" || m.status === "maintenance" || m.status === "inactive"
        ? m.status
        : "idle",
    current_jobs: (activeByMachine.get(m.id) ?? []).slice(0, headCountFor(m.machine_type)),
    maintenance_reason: m.maintenance_reason,
    maintenance_flagged_at: m.maintenance_flagged_at,
    machine_type:
      m.machine_type === "multi_head_2" || m.machine_type === "lathe"
        ? m.machine_type
        : "single_head",
  }));
  // Daksh May 2026 — natural-sort the machine grid so MA10 lands
  // after MA9, not between MA1 and MA2. The Postgres .order(
  // "machine_code") above gives a lexicographic sort which puts
  // MA10, MA11, MA12 right after MA1. Sort here by the trailing
  // integer with the alpha prefix as the tiebreak; falls back to
  // string compare when no digits are present so non-numeric codes
  // (rare but possible) don't break.
  function naturalKey(code: string): [string, number] {
    const m = code.match(/^([^\d]*)(\d+)/);
    if (!m) return [code, 0];
    return [m[1], parseInt(m[2], 10)];
  }
  machineCards.sort((a, b) => {
    const [ap, an] = naturalKey(a.machine_code);
    const [bp, bn] = naturalKey(b.machine_code);
    if (ap !== bp) return ap.localeCompare(bp);
    return an - bn;
  });

  const recent = ((completedRecent ?? []) as Array<{
    id: string;
    slab_requirement_id: string;
    completed_at: string | null;
    temporary_location: string | null;
    review_approved_at: string | null;
    review_notes: string | null;
  }>).map((r) => ({
    id: r.id,
    slab_id: r.slab_requirement_id,
    completed_at: r.completed_at,
    temporary_location: r.temporary_location,
    review_approved_at: r.review_approved_at,
    review_notes: r.review_notes,
    slab: slabById.get(r.slab_requirement_id) ?? null,
  }));

  const vendorRow = vendor as { id: string; name: string };
  // Drop the current vendor + ensure shape matches client type.
  //
  // Mig 077 — for a vendor user (Mohit), narrow the switcher list to
  // their own vendor_id + each entry in managed_vendor_ids. That way
  // Mohit's cockpit shows a flip between his cockpit and Alkesh's
  // (the only two he's allowed to act on), not the org-wide list.
  const allowedSwitchIds = new Set<string>(
    profile.role === "vendor"
      ? [
          ...(profile.vendor_id ? [profile.vendor_id] : []),
          ...(profile.managed_vendor_ids ?? []),
        ]
      : ((vendorPickerRows as { id: string }[] | null) ?? []).map((v) => v.id),
  );
  const otherVendors = (
    (vendorPickerRows as { id: string; name: string; vendor_type: string }[] | null) ?? []
  )
    .filter((v) => v.id !== vendorId && allowedSwitchIds.has(v.id))
    .map((v) => ({ id: v.id, name: v.name, vendor_type: v.vendor_type }));

  // Mig 077 — show the switcher to managed-vendor users too, even
  // though their role is "vendor". The list above is already
  // scoped to vendors they can act on.
  const hasManagedVendors = (profile.managed_vendor_ids ?? []).length > 0;

  return (
    <VendorCockpitClient
      vendor={{ id: vendorRow.id, name: vendorRow.name }}
      machines={machineCards}
      queue={queue}
      held={held}
      recent={recent}
      otherVendors={otherVendors}
      isStaffView={profile.role !== "vendor" || hasManagedVendors}
      readOnly={readOnlyCockpit}
      toast={params.toast ?? null}
      stoneTypes={stoneTypes ?? []}
    />
  );
}
