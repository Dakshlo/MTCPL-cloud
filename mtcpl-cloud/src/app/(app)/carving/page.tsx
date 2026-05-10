import Link from "next/link";
import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { CarvingDashboardClient } from "./dashboard-client";
import { VendorsManagerPeek } from "./vendors-manager-peek";

type Tab = "unassigned" | "active" | "review" | "done";

export default async function CarvingDashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; temple?: string }>;
}) {
  await requireAuth(["developer", "owner", "carving_head"]);
  const admin = createAdminSupabaseClient();
  const params = await searchParams;
  const tab: Tab = (params.tab as Tab) || "unassigned";
  const templeFilter = params.temple ?? "";

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
  };
  async function fetchAllUnassignedSlabs(): Promise<UnassignedRow[]> {
    const PAGE = 1000;
    const out: UnassignedRow[] = [];
    for (let offset = 0; offset < 50000; offset += PAGE) {
      const { data, error } = await admin
        .from("slab_requirements")
        .select(
          "id, label, temple, stone, length_ft, width_ft, thickness_ft, status, priority, source_block_id, updated_at",
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
      .select("id, slab_requirement_id, vendor_id, vendor_name, vendor_type, status, due_at, assigned_at, completed_at, progress_phase, cnc_machine_id")
      .in("status", ["carving_assigned", "carving_in_progress"])
      .order("assigned_at", { ascending: false }),
    admin
      .from("carving_items")
      .select("id, slab_requirement_id, vendor_id, vendor_name, vendor_type, status, due_at, assigned_at, completed_at, cnc_machine_id")
      .not("completed_at", "is", null)
      .is("review_approved_at", null)
      .order("completed_at", { ascending: false }),
    admin
      .from("carving_items")
      .select("id, slab_requirement_id, vendor_id, vendor_name, vendor_type, status, due_at, assigned_at, completed_at, review_approved_at, cnc_machine_id, location, ready_to_dispatch_at")
      .not("review_approved_at", "is", null)
      .order("review_approved_at", { ascending: false })
      .limit(200),
    // Carving page is now CNC-only. Manual / Outsource vendors are
    // paused for the Phase 3 CNC ops rollout — they'll come back
    // later if needed. block_vendor type is for the block side and
    // must never appear here.
    //
    // We pull ALL CNC vendors (including inactive) so the manage
    // peek modal can show + reactivate them. The Assign modal
    // filters out inactive ones client-side.
    admin
      .from("vendors")
      .select("id, name, vendor_type, is_active")
      .eq("vendor_type", "CNC")
      .order("name"),
    // Pull live machine status too so the assign modal can show
    // "Vivek · 3/10 free · 8 queued" per vendor. machine_type also
    // surfaces in the per-machine pills (single / 2-head / lathe).
    admin
      .from("cnc_machines")
      .select("id, vendor_id, machine_code, is_active, status, machine_type")
      .eq("is_active", true),
    // Stone palettes for 3D slab thumbnails on the cards
    admin
      .from("stone_types")
      .select("id, name, color_top, color_front, color_side, sort_order, is_active")
      .order("sort_order")
      .order("name"),
  ]);

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
    }
  >();
  if (uniqueSlabReqIds.length > 0) {
    const { data: slabRows } = await admin
      .from("slab_requirements")
      .select("id, temple, label, description, stone, length_ft, width_ft, thickness_ft")
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
      vendor_type: (job as unknown as { vendor_type: string }).vendor_type as "CNC" | "Manual",
    };
  }

  const activeJobsEnriched = (activeJobs ?? []).map(enrich);
  const reviewJobsEnriched = (reviewJobs ?? []).map(enrich);
  const doneJobsEnriched = (doneJobs ?? []).map(enrich);

  // Build list of all temples across every dataset for the filter dropdown.
  const templeSet = new Set<string>();
  for (const s of unassignedSlabsAll ?? []) if (s.temple) templeSet.add(s.temple);
  for (const j of activeJobsEnriched) if (j.temple) templeSet.add(j.temple);
  for (const j of reviewJobsEnriched) if (j.temple) templeSet.add(j.temple);
  for (const j of doneJobsEnriched) if (j.temple) templeSet.add(j.temple);
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
        vendor_type: v.vendor_type as "CNC" | "Manual",
        machines: (machines ?? [])
          .filter((m) => m.vendor_id === v.id)
          .map((m) => {
            const st = (m as { status?: string }).status ?? "idle";
            const mt = (m as { machine_type?: string }).machine_type ?? "single_head";
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
    active: activeJobsEnriched.length,
    review: reviewJobsEnriched.length,
    done: doneJobsEnriched.length,
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20, paddingBottom: 32 }}>
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
        <VendorsManagerPeek vendors={vendorsForPeek} />
      </div>

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
        {([
          { key: "unassigned", label: "Unassigned", count: counts.unassigned },
          { key: "active", label: "Active", count: counts.active },
          { key: "review", label: "Awaiting Review", count: counts.review },
          { key: "done", label: "Carving Done", count: counts.done },
        ] as Array<{ key: Tab; label: string; count: number }>).map((t) => {
          const active = tab === t.key;
          // Preserve temple filter when switching tabs
          const hrefParams = new URLSearchParams();
          hrefParams.set("tab", t.key);
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
        unassignedSlabs={unassignedSlabsAll ?? []}
        activeJobs={activeJobsEnriched}
        reviewJobs={reviewJobsEnriched}
        doneJobs={doneJobsEnriched}
        vendors={vendorsEnriched}
        machineCodeById={machineCodeById}
        templeNames={templeNames}
        templeFilter={templeFilter}
        stoneTypes={stoneTypes ?? []}
      />
    </div>
  );
}
