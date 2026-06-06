import { redirect } from "next/navigation";
import Link from "next/link";
import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import {
  canAccessCarvingPage,
  canAddExternalCutSlab,
  canSeeAwaitingReview,
} from "@/lib/cutting-permissions";
import { CarvingDashboardClient } from "./dashboard-client";
import { VendorsManagerPeek } from "./vendors-manager-peek";
import { CockpitSidebarToggle } from "@/components/cockpit-sidebar-toggle";
import {
  ExternalCutSlabsPanel,
  type ExternalSlab,
} from "./add-external-cut-slab";

type Tab = "unassigned" | "active" | "review" | "done";

export default async function CarvingDashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; temple?: string; mode?: string }>;
}) {
  // Mig 074 — widen requireAuth so vendors with can_assign_carving
  // can reach the page; canAccessCarvingPage covers dev/owner/
  // carving_head + flag holders. Use requireAuth() with no role
  // list (any signed-in user) then gate via the helper, since the
  // flag check needs the full profile.
  const { profile } = await requireAuth();
  if (!canAccessCarvingPage(profile)) redirect("/");
  const reviewAccess = canSeeAwaitingReview(profile);
  const admin = createAdminSupabaseClient();
  const params = await searchParams;
  let tab: Tab = (params.tab as Tab) || "unassigned";
  // Vendor-with-flag users can't see Awaiting Review — bounce them
  // to Unassigned if they try to deep-link there.
  if (tab === "review" && !reviewAccess) tab = "unassigned";
  const templeFilter = params.temple ?? "";
  // Daksh June 2026 — CNC / Outsource mode toggle. Default 'cnc' keeps
  // the page byte-identical for the CNC flow; 'outsource' filters the
  // Active/Approval/Done datasets to Outsource vendors (in-memory, no
  // SQL change) and switches on the Outsource affordances.
  //
  // The Outsource flow (toggle, Work Orders, Challans, Receive, jobwork
  // rate) belongs to the office team only: owner / dev / carving_head /
  // senior_incharge. A CNC operator (vendor role + can_assign_carving,
  // e.g. Mohit) keeps the CNC carving-vendor flow exactly as before — so
  // ?mode=outsource is IGNORED for him (a stray bookmark can't open it)
  // and the toggle is hidden below.
  const canUseOutsource =
    profile.role === "developer" ||
    profile.role === "owner" ||
    profile.role === "carving_head" ||
    profile.role === "senior_incharge";
  const mode: "cnc" | "outsource" =
    canUseOutsource && params.mode === "outsource" ? "outsource" : "cnc";
  const wantVendorType = mode === "outsource" ? "Outsource" : "CNC";

  // Paginated fetcher for unassigned slabs — Supabase's PostgREST
  // caps single .select() at 1000 rows. Once cut_done count crosses
  // that, the page silently truncated (the user noticed exactly
  // 500). Loop in 1000-row pages so we always get the full set.
  type UnassignedRow = {
    id: string;
    label: string | null;
    temple: string;
    stone: string | null;
    length_ft: number;
    width_ft: number;
    thickness_ft: number;
    status: string;
    priority: boolean | null;
    source_block_id: string | null;
    updated_at: string | null;
    /** Migration 020 — last known physical location set by the cutter
     *  at finish-block time. Shows as a 📍 chip on each card so the
     *  carving head can scan where every cut slab currently sits. */
    stock_location: string | null;
  };
  async function fetchAllUnassignedSlabs(): Promise<UnassignedRow[]> {
    const PAGE = 1000;
    const out: UnassignedRow[] = [];
    for (let offset = 0; offset < 50000; offset += PAGE) {
      const { data, error } = await admin
        .from("slab_requirements")
        .select(
          "id, label, temple, stone, length_ft, width_ft, thickness_ft, status, priority, source_block_id, updated_at, stock_location",
        )
        .eq("status", "cut_done")
        .order("priority", { ascending: false })
        .order("created_at", { ascending: true })
        .range(offset, offset + PAGE - 1);
      if (error) throw new Error(error.message);
      if (!data || data.length === 0) break;
      out.push(...(data as UnassignedRow[]));
      if (data.length < PAGE) break;
    }
    return out;
  }

  // Load everything we need for all tabs in parallel
  const [
    unassignedSlabsAll,
    { data: activeJobs },
    { data: reviewJobs },
    { data: doneJobs },
    { data: vendors },
    { data: machines },
    { data: stoneTypes },
  ] = await Promise.all([
    fetchAllUnassignedSlabs(),
    admin
      .from("carving_items")
      .select(
        // Daksh June 2026 — also pull held_at / held_reason so the
        // Active tab can render the on-hold slabs with a proper
        // "⏸ ON HOLD" ribbon + reason (was selecting neither, and
        // held slabs weren't fetched at all — see the status filter
        // change just below).
        "id, slab_requirement_id, vendor_id, vendor_name, vendor_type, status, urgency, due_at, assigned_at, completed_at, progress_phase, cnc_machine_id, loaded_at, vendor_estimated_minutes, estimated_minutes, received_at_vendor_at, requires_machine_type, requires_cnc_axes, claimed_by, claimed_at, dropoff_note, held_at, held_reason",
      )
      // Daksh June 2026 — include carving_on_hold so paused slabs
      // still appear on the Active tab. Previously the Active fetch
      // was carving_assigned + carving_in_progress only, so a slab
      // put on hold from the vendor cockpit silently vanished from
      // the carving head's Active view (it only lived in the cockpit
      // On-Hold tray). They're active work — just paused — so they
      // belong here too, with a clear hold indicator.
      .in("status", ["carving_assigned", "carving_in_progress", "carving_on_hold"])
      .order("assigned_at", { ascending: false }),
    admin
      .from("carving_items")
      // completed_on_cnc_machine_id (mig 075) — the machine that DID
      // the carving, preserved at unload (cnc_machine_id is nulled
      // when the slab comes off the bed). The Carving Done Approval
      // card uses it to show which CNC produced the slab. (Daksh)
      .select("id, slab_requirement_id, vendor_id, vendor_name, vendor_type, status, due_at, assigned_at, completed_at, cnc_machine_id, completed_on_cnc_machine_id")
      .not("completed_at", "is", null)
      .is("review_approved_at", null)
      .order("completed_at", { ascending: false }),
    admin
      .from("carving_items")
      // Mig 080/081 follow-on (Daksh) — pull the reviewer's approve
      // attachment (review_image_path) + structured quality flag +
      // notes so the Carving Done card / peek can SHOW the photo the
      // reviewer took at sign-off. completed_on_cnc_machine_id is the
      // carving machine (cnc_machine_id is already nulled by now).
      .select("id, slab_requirement_id, vendor_id, vendor_name, vendor_type, status, due_at, assigned_at, completed_at, review_approved_at, cnc_machine_id, completed_on_cnc_machine_id, location, ready_to_dispatch_at, review_image_path, review_image_paths, review_quality_flag, review_notes")
      .not("review_approved_at", "is", null)
      .order("review_approved_at", { ascending: false })
      .limit(200),
    // Carving page surfaces CNC + Outsource vendors. (Outsource carvers
    // were re-introduced in Phase 4 — they don't have machines and
    // use a simpler bypass workflow, but the carving head still
    // needs to assign work to them.) Outsource is paused; block_vendor
    // type is for the block side and must never appear here.
    //
    // We pull ALL CNC + Outsource vendors (including inactive) so the
    // manage peek modal can show + reactivate them. The Assign modal
    // filters inactive ones out client-side.
    admin
      .from("vendors")
      .select("id, name, vendor_type, is_active")
      .in("vendor_type", ["CNC", "Outsource"])
      .order("name"),
    // Pull live machine status too so the assign modal can show
    // "Vivek · 3/10 free · 8 queued" per vendor. machine_type also
    // surfaces in the per-machine pills (single / 2-head / lathe).
    admin
      .from("cnc_machines")
      .select("id, vendor_id, machine_code, is_active, status, machine_type, cnc_axes")
      .eq("is_active", true),
    // Stone palettes for 3D slab thumbnails on the cards
    admin
      .from("stone_types")
      .select("id, name, color_top, color_front, color_side, sort_order, is_active")
      .order("sort_order")
      .order("name"),
  ]);

  // Daksh May 2026 round 2 — data for the ExternalCutSlabs peek view.
  //   • templesForExternal: master list used by the temple dropdown
  //     (temple-wise selection mirrors Required Sizes).
  //   • externalSlabsForPanel: every externally-added slab still in
  //     Unassigned (source_block_id IS NULL + status='cut_done'). The
  //     panel groups them by temple and exposes Edit + Delete inline.
  // Both fetched only when the viewer can actually use the panel so
  // vendor-with-flag and other callers keep the payload trimmed.
  const canAddExternal = canAddExternalCutSlab(profile);
  const [
    { data: templesForExternal },
    { data: externalSlabsRaw },
    { data: assignedExternalRaw },
  ] = canAddExternal
    ? await Promise.all([
        admin
          .from("temples")
          .select("id, name, code_prefix, default_stone")
          .order("name"),
        admin
          .from("slab_requirements")
          .select(
            // Mig 081 follow-on — include batch_id so the External
            // Cut Slabs panel can group multi-add slabs together
            // and surface batch-level Edit/Delete affordances.
            "id, temple, stone, length_ft, width_ft, thickness_ft, label, description, stock_location, quality, priority, batch_id",
          )
          .is("source_block_id", null)
          .eq("status", "cut_done")
          .order("temple")
          .order("id"),
        // Daksh June 2026 — external slabs that have ALREADY moved past
        // unassigned (assigned / carving / done / dispatched). They're
        // not lost — they're in the carving flow — but the panel now
        // shows them read-only so the user can confirm what they added.
        // External = source_block_id IS NULL; "assigned" = any post-cut
        // status other than cut_done.
        admin
          .from("slab_requirements")
          .select(
            "id, temple, stone, length_ft, width_ft, thickness_ft, label, status, updated_at",
          )
          .is("source_block_id", null)
          .in("status", ["carving_assigned", "carving_in_progress", "completed", "dispatched", "rejected"])
          .order("updated_at", { ascending: false })
          .limit(200),
      ])
    : [{ data: null }, { data: null }, { data: null }];
  const externalSlabsForPanel: ExternalSlab[] = (
    (externalSlabsRaw ?? []) as Array<{
      id: string;
      temple: string;
      stone: string | null;
      length_ft: number | string;
      width_ft: number | string;
      thickness_ft: number | string;
      label: string | null;
      description: string | null;
      stock_location: string | null;
      quality: string | null;
      priority: boolean | null;
      batch_id: string | null;
    }>
  ).map((s) => ({
    id: s.id,
    temple: s.temple,
    stone: s.stone ?? "",
    length_ft: Number(s.length_ft) || 0,
    width_ft: Number(s.width_ft) || 0,
    thickness_ft: Number(s.thickness_ft) || 0,
    label: s.label,
    description: s.description,
    stock_location: s.stock_location,
    quality: s.quality,
    priority: s.priority === true,
    batch_id: s.batch_id,
  }));

  // Read-only "already assigned" external slabs for the panel.
  const assignedExternalSlabs = (
    (assignedExternalRaw ?? []) as Array<{
      id: string;
      temple: string;
      stone: string | null;
      length_ft: number | string;
      width_ft: number | string;
      thickness_ft: number | string;
      label: string | null;
      status: string;
    }>
  ).map((s) => ({
    id: s.id,
    temple: s.temple,
    stone: s.stone ?? "",
    length_ft: Number(s.length_ft) || 0,
    width_ft: Number(s.width_ft) || 0,
    thickness_ft: Number(s.thickness_ft) || 0,
    label: s.label,
    status: s.status,
  }));

  // Enrich jobs with temple + slab label — job rows on carving_items
  // don't carry temple, so we join via slab_requirement_id.
  const allJobSlabReqIds = [
    ...(activeJobs ?? []).map((j) => j.slab_requirement_id),
    ...(reviewJobs ?? []).map((j) => j.slab_requirement_id),
    ...(doneJobs ?? []).map((j) => j.slab_requirement_id),
  ].filter(Boolean);
  const uniqueSlabReqIds = [...new Set(allJobSlabReqIds)];

  // Pull dimensions + stone + description so the dashboard cards
  // can render a 3D thumbnail and surface free-text per-slab notes
  // (e.g. "NE corner, set 2"). Stone name is the key into stoneTypes
  // for the palette; dimensions drive the proportions of the box.
  let slabInfoMap = new Map<
    string,
    {
      temple: string;
      label: string | null;
      description: string | null;
      stone: string | null;
      length_ft: number;
      width_ft: number;
      thickness_ft: number;
      stock_location: string | null;
    }
  >();
  if (uniqueSlabReqIds.length > 0) {
    const { data: slabRows } = await admin
      .from("slab_requirements")
      .select("id, temple, label, description, stone, length_ft, width_ft, thickness_ft, stock_location")
      .in("id", uniqueSlabReqIds);
    for (const s of slabRows ?? []) {
      slabInfoMap.set(s.id, {
        temple: s.temple ?? "(no temple)",
        label: s.label,
        description: (s as { description?: string | null }).description ?? null,
        stone: s.stone ?? null,
        length_ft: Number(s.length_ft) || 0,
        width_ft: Number(s.width_ft) || 0,
        thickness_ft: Number(s.thickness_ft) || 0,
        stock_location: (s as { stock_location?: string | null }).stock_location ?? null,
      });
    }
  }

  function enrich<J extends { slab_requirement_id: string; cnc_machine_id?: string | null }>(job: J) {
    const info = slabInfoMap.get(job.slab_requirement_id);
    return {
      ...job,
      temple: info?.temple ?? "(no temple)",
      slab_label: info?.label ?? null,
      slab_description: info?.description ?? null,
      stone: info?.stone ?? null,
      length_ft: info?.length_ft ?? 0,
      width_ft: info?.width_ft ?? 0,
      thickness_ft: info?.thickness_ft ?? 0,
      // Last known physical location — set by the cutter operator at
      // finish-block time (migration 020). Surfaces on in-transit
      // pills so the carving head / vendor know where to fetch
      // the slab from before it lands at the shade.
      slab_stock_location: info?.stock_location ?? null,
      vendor_type: (job as unknown as { vendor_type: string }).vendor_type as "CNC" | "Outsource",
    };
  }

  const activeJobsEnriched = (activeJobs ?? []).map(enrich);
  const reviewJobsEnriched = (reviewJobs ?? []).map(enrich);
  const doneJobsEnriched = (doneJobs ?? []).map(enrich);

  // Mode-filtered views (CNC vs Outsource) for the job tabs + counts +
  // client. In-memory filter only — the SQL above is unchanged, so the
  // CNC flow stays byte-identical. Unassigned (cut_done slabs) has no
  // vendor type yet, so it is shared across both modes. The full
  // *Enriched arrays are kept for the per-vendor machine-count logic.
  const activeForMode = activeJobsEnriched.filter((j) => j.vendor_type === wantVendorType);
  const reviewForMode = reviewJobsEnriched.filter((j) => j.vendor_type === wantVendorType);
  const doneForMode = doneJobsEnriched.filter((j) => j.vendor_type === wantVendorType);

  // Build list of all temples across every dataset for the filter dropdown.
  const templeSet = new Set<string>();
  for (const s of unassignedSlabsAll ?? []) if (s.temple) templeSet.add(s.temple);
  for (const j of activeForMode) if (j.temple) templeSet.add(j.temple);
  for (const j of reviewForMode) if (j.temple) templeSet.add(j.temple);
  for (const j of doneForMode) if (j.temple) templeSet.add(j.temple);
  const templeNames = [...templeSet].sort();

  // Per-vendor live counts for the Assign modal — count by status.
  // status values come from cnc_machines.status: 'idle' | 'carving'
  // | 'maintenance' | 'inactive'.
  const machineCountsByVendor = new Map<
    string,
    { idle: number; carving: number; maintenance: number; total: number }
  >();
  for (const m of machines ?? []) {
    const counts = machineCountsByVendor.get(m.vendor_id) ?? {
      idle: 0,
      carving: 0,
      maintenance: 0,
      total: 0,
    };
    counts.total += 1;
    const st = (m as { status?: string }).status ?? "idle";
    if (st === "carving") counts.carving += 1;
    else if (st === "maintenance") counts.maintenance += 1;
    else counts.idle += 1;
    machineCountsByVendor.set(m.vendor_id, counts);
  }

  // Per-vendor queue depth (carving_items still waiting to be loaded).
  const queuedByVendor = new Map<string, number>();
  for (const j of activeJobsEnriched) {
    if (j.status === "carving_assigned") {
      queuedByVendor.set(j.vendor_id, (queuedByVendor.get(j.vendor_id) ?? 0) + 1);
    }
  }

  // Active jobs (queued + in-progress) per vendor, for the manage
  // peek modal display.
  const activeJobsByVendor = new Map<string, number>();
  for (const j of activeJobsEnriched) {
    activeJobsByVendor.set(j.vendor_id, (activeJobsByVendor.get(j.vendor_id) ?? 0) + 1);
  }

  // Vendor rows for the manage peek modal — includes inactive ones
  // so they can be reactivated. Drop block_vendor leftovers in case
  // the data has any sneak-throughs (the query already filters).
  const vendorsForPeek = (vendors ?? []).map((v) => {
    const counts = machineCountsByVendor.get(v.id) ?? { idle: 0, carving: 0, maintenance: 0, total: 0 };
    return {
      id: v.id,
      name: v.name,
      // Mig 091 follow-on — carry the type so the Manage Vendors peek
      // can filter its list by the CNC / Outsource toggle.
      vendor_type: (v.vendor_type === "Outsource" ? "Outsource" : "CNC") as "CNC" | "Outsource",
      is_active: v.is_active,
      machines: counts.total,
      busy: counts.carving,
      maintenance: counts.maintenance,
      free: counts.idle,
      active_jobs: activeJobsByVendor.get(v.id) ?? 0,
    };
  });

  // Enrich vendors with their machines (incl. live status) + live
  // counts. The per-machine status flows through to the assign modal
  // so the carving head can see exactly which CNCs are free / busy /
  // in maintenance before picking a vendor. Inactive vendors are
  // dropped here — you can't assign to a deactivated vendor.
  const vendorsEnriched = (vendors ?? [])
    .filter((v) => v.is_active)
    .map((v) => {
      const counts = machineCountsByVendor.get(v.id) ?? { idle: 0, carving: 0, maintenance: 0, total: 0 };
      return {
        id: v.id,
        name: v.name,
        vendor_type: v.vendor_type as "CNC" | "Outsource",
        machines: (machines ?? [])
          .filter((m) => m.vendor_id === v.id)
          .map((m) => {
            const st = (m as { status?: string }).status ?? "idle";
            const mt = (m as { machine_type?: string }).machine_type ?? "single_head";
            // Mig 079 — pass cnc_axes through. NULL on lathes,
            // 3/4/5 on CNCs.
            const rawAxes = (m as { cnc_axes?: number | null }).cnc_axes;
            const axes =
              rawAxes === 4 || rawAxes === 5 || rawAxes === 3 ? rawAxes : null;
            return {
              id: m.id,
              machine_code: m.machine_code,
              status:
                st === "carving" || st === "maintenance" || st === "inactive"
                  ? (st as "carving" | "maintenance" | "inactive")
                  : ("idle" as const),
              machine_type:
                mt === "multi_head_2" || mt === "lathe"
                  ? (mt as "multi_head_2" | "lathe")
                  : ("single_head" as const),
              cnc_axes: axes,
            };
          }),
        live: {
          free: counts.idle,
          busy: counts.carving,
          maintenance: counts.maintenance,
          total: counts.total,
          queued: queuedByVendor.get(v.id) ?? 0,
        },
      };
    });

  // Build a machine-code map for display
  const machineCodeById: Record<string, string> = {};
  for (const m of machines ?? []) machineCodeById[m.id] = m.machine_code;

  const counts = {
    unassigned: (unassignedSlabsAll ?? []).length,
    active: activeForMode.length,
    review: reviewForMode.length,
    done: doneForMode.length,
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20, paddingBottom: 32 }}>
      {/* Mig 074 — vendor-with-flag (Mohit) needs to hide the global
          sidebar here too once they've navigated into Carving Jobs,
          mirroring the cockpit. Default = expanded so the sidebar
          they just used to land on this page stays visible until
          they tap Hide menu. */}
      {profile.role === "vendor" && profile.can_assign_carving === true && (
        <CockpitSidebarToggle defaultCollapsed={false} />
      )}

      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <h1 style={{ margin: 0, fontSize: 22 }}>Carving Jobs</h1>
            <span className="role-pill" style={{ background: "var(--gold)", color: "#fff", fontWeight: 700, fontSize: 10 }}>
              DEV-ONLY
            </span>
          </div>
          <p className="muted" style={{ margin: "4px 0 0", fontSize: 13 }}>
            Phase 2 module · assign cut slabs to carving vendors, track progress, approve and dispatch
          </p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          {canAddExternal && (
            <ExternalCutSlabsPanel
              temples={(templesForExternal ?? []) as Array<{
                id: string;
                name: string;
                code_prefix: string;
                default_stone?: string | null;
              }>}
              stoneTypes={(stoneTypes ?? []) as Array<{ id?: string; name: string }>}
              externalSlabs={externalSlabsForPanel}
              assignedExternalSlabs={assignedExternalSlabs}
            />
          )}
          {/* Mig 081 follow-on (Daksh) — Manage Vendors button gated.
              Mohit (role='vendor' + can_assign_carving) was seeing
              this button on the topbar; he should only assign /
              monitor, never edit the vendor roster. The four roles
              that legitimately add or rename vendors: owner / dev /
              carving_head / senior_incharge. */}
          {(profile.role === "developer" ||
            profile.role === "owner" ||
            profile.role === "carving_head" ||
            profile.role === "senior_incharge") && (
            <VendorsManagerPeek vendors={vendorsForPeek} />
          )}
          {/* Work orders + Jobwork challans — Outsource mode only
              (owner/dev/head/senior). */}
          {mode === "outsource" &&
            (profile.role === "developer" ||
              profile.role === "owner" ||
              profile.role === "carving_head" ||
              profile.role === "senior_incharge") && (
              <>
                <Link
                  href="/carving/work-orders"
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "8px 14px",
                    fontSize: 12,
                    fontWeight: 700,
                    color: "#92400e",
                    background: "rgba(146,64,14,0.10)",
                    border: "1px solid rgba(146,64,14,0.35)",
                    borderRadius: 8,
                    textDecoration: "none",
                  }}
                >
                  🏭 Work Orders
                </Link>
                <Link
                  href="/carving/challans"
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "8px 14px",
                    fontSize: 12,
                    fontWeight: 700,
                    color: "#fff",
                    background: "#92400e",
                    borderRadius: 8,
                    textDecoration: "none",
                  }}
                >
                  🧾 Challans
                </Link>
              </>
            )}
        </div>
      </div>

      {/* CNC / Outsource mode toggle — splits the whole page by vendor
          type. CNC = existing machine flow (byte-identical); Outsource =
          simplified jobwork flow. Preserves the current tab + temple.
          Daksh June 2026 — gated to the office team (owner / dev /
          carving_head / senior_incharge). A CNC operator (Mohit) never
          sees it; his page stays CNC-only, exactly as before. */}
      {canUseOutsource && (
      <div
        style={{
          display: "inline-flex",
          gap: 4,
          padding: 4,
          background: "var(--surface-alt)",
          border: "1px solid var(--border)",
          borderRadius: 10,
          alignSelf: "flex-start",
        }}
      >
        {(
          [
            { key: "cnc", label: "🏭 CNC Carving" },
            { key: "outsource", label: "🤝 Outsource Carving" },
          ] as const
        ).map((m) => {
          const active = mode === m.key;
          const p = new URLSearchParams();
          p.set("mode", m.key);
          p.set("tab", tab);
          if (templeFilter) p.set("temple", templeFilter);
          return (
            <Link
              key={m.key}
              href={`/carving?${p.toString()}`}
              style={{
                padding: "8px 18px",
                fontSize: 13,
                fontWeight: 800,
                color: active ? "#fff" : "var(--muted)",
                background: active
                  ? m.key === "outsource"
                    ? "#92400e"
                    : "var(--gold-dark)"
                  : "transparent",
                borderRadius: 8,
                textDecoration: "none",
                transition: "background 0.12s, color 0.12s",
              }}
            >
              {m.label}
            </Link>
          );
        })}
      </div>
      )}

      {/* Tabs — solid pill style. Active tab = filled gold; inactive
          = soft hover. Single colour family so the carving head's eye
          isn't pulled in four directions like the old per-tab tints. */}
      <div
        style={{
          display: "inline-flex",
          gap: 4,
          padding: 4,
          background: "var(--surface-alt)",
          border: "1px solid var(--border)",
          borderRadius: 10,
        }}
      >
        {(
          [
            { key: "unassigned", label: "Unassigned", count: counts.unassigned },
            { key: "active", label: "Active", count: counts.active },
            // Mig 074 — hide Carving Done Approval for vendor-with-flag
            // users; they don't sign off on their own work.
            // Mig 076 — renamed from "Awaiting Review" per Daksh:
            // the slabs aren't awaiting anything, carving is done +
            // needs sign-off. Server key stays 'review' so bookmarks
            // keep working.
            ...(reviewAccess
              ? [{ key: "review" as const, label: "Carving Done Approval", count: counts.review }]
              : []),
            { key: "done", label: "Carving Done", count: counts.done },
          ] as Array<{ key: Tab; label: string; count: number }>
        ).map((t) => {
          const active = tab === t.key;
          // Preserve temple filter when switching tabs
          const hrefParams = new URLSearchParams();
          hrefParams.set("tab", t.key);
          hrefParams.set("mode", mode);
          if (templeFilter) hrefParams.set("temple", templeFilter);
          return (
            <Link
              key={t.key}
              href={`/carving?${hrefParams.toString()}`}
              style={{
                padding: "8px 16px",
                fontSize: 13,
                fontWeight: 700,
                color: active ? "#fff" : "var(--muted)",
                background: active ? "var(--gold-dark)" : "transparent",
                borderRadius: 8,
                textDecoration: "none",
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                transition: "background 0.12s, color 0.12s",
              }}
            >
              {t.label}
              <span
                style={{
                  background: active ? "rgba(255,255,255,0.25)" : "var(--bg)",
                  color: active ? "#fff" : "var(--muted)",
                  border: active ? "none" : "1px solid var(--border)",
                  borderRadius: 999,
                  fontSize: 11,
                  fontWeight: 700,
                  padding: "1px 8px",
                  minWidth: 22,
                  textAlign: "center",
                  fontFamily: "ui-monospace, monospace",
                }}
              >
                {t.count}
              </span>
            </Link>
          );
        })}
      </div>

      <CarvingDashboardClient
        tab={tab}
        mode={mode}
        unassignedSlabs={unassignedSlabsAll ?? []}
        activeJobs={activeForMode}
        reviewJobs={reviewAccess ? reviewForMode : []}
        doneJobs={doneForMode}
        vendors={vendorsEnriched}
        machineCodeById={machineCodeById}
        templeNames={templeNames}
        templeFilter={templeFilter}
        stoneTypes={stoneTypes ?? []}
      />
    </div>
  );
}
