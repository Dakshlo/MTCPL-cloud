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
import { POWER_CUT_REASON } from "@/lib/carving-power-cut";
import { VendorCockpitClient, type CarvingJobLite, type CncMachineLive, type SlabLite, type HeldSlabLite, type ReworkPendingItem, type RejectedItem } from "./cockpit-client";

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
    //
    // Mig 082 follow-on (Daksh, June 2026) — also honour the sticky
    // pick cookie for managed-vendor users. Without this, every
    // server action (Load / Hold / Mark complete) redirects back
    // to /vendor with no query string, falls through to
    // profile.vendor_id, and snaps the cockpit back to the
    // operator's own view — even though they were just working on
    // Alkesh's. Bug: "for cnc operator manthan he have two vendor
    // cockpit view his own and alkesh which is correct but the
    // thing is when he do anyting on any like alkesh he rediret
    // back to mohit." Fix: same cookie tier the staff branch uses,
    // gated on the cookie value actually being in the user's
    // managed_vendor_ids so they can't sticky into a cockpit they
    // shouldn't see.
    if (params.vendor_id && managedVendorIds.includes(params.vendor_id)) {
      vendorId = params.vendor_id;
    } else if (managedVendorIds.length > 0) {
      const cookieStore = await cookies();
      const stickyPick = cookieStore.get("mtcpl_vendor_pick")?.value ?? null;
      if (
        stickyPick &&
        (stickyPick === profile.vendor_id ||
          managedVendorIds.includes(stickyPick))
      ) {
        // Validate the sticky pick still resolves to an active
        // vendor (managed list could in theory drift). Drop back
        // to the user's own vendor if not.
        const { data: pickRow } = await admin
          .from("vendors")
          .select("id")
          .eq("id", stickyPick)
          .eq("is_active", true)
          .maybeSingle();
        if (pickRow) vendorId = stickyPick;
      }
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
    { data: rejectedRows },
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
        // Mig 080 — also pull review_decision / review_reworked_at /
        // review_image_path / review_notes so we can split rework
        // slabs into the new "Rework pending" window (separate from
        // the regular ready-to-load queue).
        "id, slab_requirement_id, status, urgency, estimated_minutes, vendor_estimated_minutes, cnc_machine_id, loaded_at, assigned_at, note, received_at_vendor_at, requires_machine_type, carving_sides, batch_id, held_at, held_reason, held_from_machine_id, transferred_from_vendor_id, transferred_from_vendor_name, transferred_at, review_decision, review_reworked_at, review_image_path, review_image_paths, review_notes",
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
    // Mig 080 — rejected items (status='carving_rejected'). Separate
    // query because the main carving_items fetch above is scoped to
    // ('carving_assigned', 'carving_in_progress', 'carving_on_hold').
    // The cockpit shows these in a read-only "Rejected" window with
    // image + reason; the vendor can't act on them, just look at
    // why so they can avoid the same issue next time.
    admin
      .from("carving_items")
      .select(
        "id, slab_requirement_id, review_decision, review_rejected_at, review_image_path, review_image_paths, review_notes",
      )
      .eq("vendor_id", vendorId)
      .eq("status", "carving_rejected")
      .order("review_rejected_at", { ascending: false })
      .limit(50),
    // All active CNC + Manual vendors. Used for two purposes:
    //   1. Vendor picker for non-vendor roles (cockpit-switcher).
    //   2. Transfer-destination dropdown on the per-slab Problem
    //      modal — vendors can now transfer their own slabs to
    //      other vendors, so they need the list even though they're
    //      logged in as 'vendor' role.
    admin
      .from("vendors")
      .select("id, name, vendor_type")
      .in("vendor_type", ["CNC", "Outsource"])
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

  // Hydrate slab info for everything we'll display — including the
  // new mig-080 rejected rows so the read-only Rejected window can
  // print "1.2 × 0.8 ft · Black Granite · Temple X" alongside the
  // reason + image.
  const slabIds = [
    ...(queueAndActive ?? []).map((j) => (j as { slab_requirement_id: string }).slab_requirement_id),
    ...(completedRecent ?? []).map((j) => (j as { slab_requirement_id: string }).slab_requirement_id),
    ...(rejectedRows ?? []).map((j) => (j as { slab_requirement_id: string }).slab_requirement_id),
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
  // Mig 080 — Rework Pending bucket. When the carving reviewer hits
  // "Rework Needed" the slab flips back to carving_in_progress with
  // cnc_machine_id cleared (returning it to the vendor) AND
  // review_decision='rework_needed' + review_reworked_at stamped. We
  // pull those out of the regular queue so the vendor sees them in a
  // dedicated window with the reviewer's image + reason. From there
  // they can reload onto a CNC (same Load flow) or re-mark complete.
  // Pre-080 rejects (carving_in_progress with review_notes but no
  // review_reworked_at) keep their old behaviour — they fall back
  // into the regular queue.
  const reworkPending: ReworkPendingItem[] = [];
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
    carving_sides?: number | null;
    batch_id?: string | null;
    held_at?: string | null;
    held_reason?: string | null;
    held_from_machine_id?: string | null;
    transferred_from_vendor_id?: string | null;
    transferred_from_vendor_name?: string | null;
    transferred_at?: string | null;
    review_decision?: string | null;
    review_reworked_at?: string | null;
    review_image_path?: string | null;
    review_image_paths?: string[] | null;
    review_notes?: string | null;
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
      carving_sides: row.carving_sides ?? 1,
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
        carving_sides: row.carving_sides ?? 1,
        held_at: row.held_at ?? null,
        held_reason: row.held_reason ?? null,
        held_from_machine_id: row.held_from_machine_id ?? null,
        slab,
      });
      continue;
    }
    // Mig 080 — Rework Pending. Reviewer hit "Rework Needed" → slab
    // is back at status='carving_assigned' with no machine (so the
    // existing Load flow accepts it), BUT review_decision='rework_needed'
    // + review_reworked_at stamped. We branch on the rework tags
    // BEFORE the regular queue.push below so the slab doesn't show
    // up in BOTH Ready to Load and Rework Pending at the same time.
    if (
      row.status === "carving_assigned" &&
      !row.cnc_machine_id &&
      row.review_decision === "rework_needed" &&
      row.review_reworked_at
    ) {
      reworkPending.push({
        id: row.id,
        slab_id: row.slab_requirement_id,
        urgency: job.urgency,
        requires_machine_type: row.requires_machine_type ?? null,
        carving_sides: row.carving_sides ?? 1,
        review_reworked_at: row.review_reworked_at ?? null,
        review_image_path: row.review_image_path ?? null,
        review_image_paths: row.review_image_paths ?? null,
        review_notes: row.review_notes ?? null,
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
  // Mig 080 — sort rework: most-recently-sent-back first.
  reworkPending.sort((a, b) => {
    const aT = a.review_reworked_at ? new Date(a.review_reworked_at).getTime() : 0;
    const bT = b.review_reworked_at ? new Date(b.review_reworked_at).getTime() : 0;
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

  // Mig 080 — Rejected window. Read-only on the vendor cockpit; the
  // vendor sees what they got rejected for + the reviewer's photo
  // so they can avoid the same issue on future slabs. No action
  // buttons — the slab is out of the active loop entirely.
  const rejected: RejectedItem[] = ((rejectedRows ?? []) as Array<{
    id: string;
    slab_requirement_id: string;
    review_decision: string | null;
    review_rejected_at: string | null;
    review_image_path: string | null;
    review_image_paths: string[] | null;
    review_notes: string | null;
  }>).map((r) => ({
    id: r.id,
    slab_id: r.slab_requirement_id,
    review_rejected_at: r.review_rejected_at,
    review_image_path: r.review_image_path,
    review_image_paths: r.review_image_paths,
    review_notes: r.review_notes,
    slab: slabById.get(r.slab_requirement_id) ?? null,
  }));

  // Daksh June 2026 — per-vendor carved output for the cockpit header,
  // CALENDAR-MONTH based: current month by default, with a button to
  // peek last month. APPROVAL-ONLY — counts only slabs the reviewer
  // APPROVED (review_approved_at, set on approve + CLEARED on rework /
  // reject), so unloaded-but-pending / reworked / rejected slabs never
  // count. SFT/CFT use the same formulas as the CNC cost report (dims
  // in inches: sft = l·w/144, cft = l·w·t/1728) so the numbers tie out.
  const MONTH_NAMES = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];
  async function carvedInWindow(
    startIso: string,
    endIso: string,
  ): Promise<{ sft: number; cft: number; slabs: number }> {
    const { data: appr } = await admin
      .from("carving_items")
      .select("slab_requirement_id, review_approved_at, carving_sides")
      .eq("vendor_id", vendorId)
      .not("review_approved_at", "is", null)
      .gte("review_approved_at", startIso)
      .lt("review_approved_at", endIso);
    const rowsAppr = (appr ?? []) as Array<{
      slab_requirement_id: string;
      carving_sides?: number | null;
    }>;
    const ids = [...new Set(rowsAppr.map((r) => r.slab_requirement_id))];
    let sft = 0;
    let cft = 0;
    if (ids.length > 0) {
      const { data: dims } = await admin
        .from("slab_requirements")
        .select("id, length_ft, width_ft, thickness_ft")
        .in("id", ids);
      const dimById = new Map<string, { l: number; w: number; t: number }>();
      for (const d of (dims ?? []) as Array<{
        id: string;
        length_ft: number | string;
        width_ft: number | string;
        thickness_ft: number | string;
      }>) {
        dimById.set(d.id, {
          l: Number(d.length_ft) || 0,
          w: Number(d.width_ft) || 0,
          t: Number(d.thickness_ft) || 0,
        });
      }
      for (const r of rowsAppr) {
        const dim = dimById.get(r.slab_requirement_id);
        if (!dim) continue;
        // Mig 088 — double-side carving counts output x2.
        const sides = Number(r.carving_sides) === 2 ? 2 : 1;
        sft += ((dim.l * dim.w) / 144) * sides;
        cft += ((dim.l * dim.w * dim.t) / 1728) * sides;
      }
    }
    return { sft, cft, slabs: rowsAppr.length };
  }

  // IST calendar-month bounds (IST = UTC+5:30). Date.UTC handles the
  // month roll-over / under-flow for the next + previous month.
  const IST_OFF = 5.5 * 60 * 60 * 1000;
  const istNow = new Date(Date.now() + IST_OFF);
  const istY = istNow.getUTCFullYear();
  const istMo = istNow.getUTCMonth(); // 0-based
  const thisMonthStart = new Date(Date.UTC(istY, istMo, 1) - IST_OFF).toISOString();
  const nextMonthStart = new Date(Date.UTC(istY, istMo + 1, 1) - IST_OFF).toISOString();
  const lastMonthStart = new Date(Date.UTC(istY, istMo - 1, 1) - IST_OFF).toISOString();
  const [carvedThisMonth, carvedLastMonth] = await Promise.all([
    carvedInWindow(thisMonthStart, nextMonthStart),
    carvedInWindow(lastMonthStart, thisMonthStart),
  ]);
  const thisMonthLabel = `${MONTH_NAMES[istMo]} ${istY}`;
  const lastMo = istMo === 0 ? 11 : istMo - 1;
  const lastMonthLabel = `${MONTH_NAMES[lastMo]} ${istMo === 0 ? istY - 1 : istY}`;

  // Daksh June 2026 — power-cut state. The global "all machines down"
  // button flags every running/idle machine into maintenance tagged
  // with POWER_CUT_REASON (carving/actions.ts). If ANY of this vendor's
  // machines carries that tag, the cockpit shows the "Power's back —
  // resume all" control + a banner instead of the down button.
  let powerCutActive = false;
  let powerCutSince: string | null = null;
  for (const m of (machines ?? []) as Array<{
    status: string;
    maintenance_reason: string | null;
    maintenance_flagged_at: string | null;
  }>) {
    if (m.status === "maintenance" && m.maintenance_reason === POWER_CUT_REASON) {
      powerCutActive = true;
      if (
        m.maintenance_flagged_at &&
        (!powerCutSince || m.maintenance_flagged_at < powerCutSince)
      ) {
        powerCutSince = m.maintenance_flagged_at;
      }
    }
  }

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

  // Daksh June 2026 — the transfer-destination dropdown (Problem /
  // transfer, from a Ready-to-load or running slab) must list EVERY
  // active CNC + Manual vendor, NOT just the ones this user can
  // switch into. Bug: Manthan (a vendor with managed access to
  // Alkesh) saw only his own + managed vendors as transfer targets,
  // while staff saw all of them. `otherVendors` above is deliberately
  // narrowed to the cockpit-switcher allow-list, so the transfer
  // picker needs its own full list — the same complete CNC + Manual
  // set every other role already gets.
  const transferVendors = (
    (vendorPickerRows as { id: string; name: string; vendor_type: string }[] | null) ?? []
  )
    .filter((v) => v.id !== vendorId)
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
      reworkPending={reworkPending}
      rejected={rejected}
      recent={recent}
      carvedThisMonth={carvedThisMonth}
      carvedLastMonth={carvedLastMonth}
      thisMonthLabel={thisMonthLabel}
      lastMonthLabel={lastMonthLabel}
      powerCutActive={powerCutActive}
      powerCutSince={powerCutSince}
      otherVendors={otherVendors}
      transferVendors={transferVendors}
      isStaffView={profile.role !== "vendor" || hasManagedVendors}
      readOnly={readOnlyCockpit}
      toast={params.toast ?? null}
      stoneTypes={stoneTypes ?? []}
    />
  );
}
