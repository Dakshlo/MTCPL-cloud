// ──────────────────────────────────────────────────────────────────
// Carving Plan (mig 215) — Daksh, Aug 2026.
//
// The routing decisions Mohit used to keep in his head, as one board:
// how much work each carving route (CNC / Outsource / No carving) has,
// how far along it is, which slabs are still UNDECIDED (nil), whether
// the CNCs can absorb the pending load, and what went off-plan.
//
// All aggregation happens here on the server; the client gets compact
// pre-summed props (per-method cards, temple×method matrix, forecast,
// off-plan ids) plus the raw undecided rows for the quick-tag queue.
// ──────────────────────────────────────────────────────────────────

import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { fetchAllPaged } from "@/lib/paginate";
import {
  PlanClient,
  type MethodKey,
  type StageTotals,
  type MethodSummary,
  type TempleMethodRow,
  type UndecidedSlab,
  type CncForecast,
} from "./plan-client";

export const dynamic = "force-dynamic";

// Same office set as Ready Sizes Stock (sidebar) + the /carving outsource
// mode gate — the people who route slabs.
const ALLOWED = ["developer", "owner", "carving_head", "senior_incharge", "tender_manager"];

const cft = (l: number, w: number, t: number) => (l * w * t) / 1728;

export default async function CarvingPlanPage() {
  const { profile } = await requireAuth();
  if (!ALLOWED.includes(profile.role)) redirect("/carving");
  const admin = createAdminSupabaseClient();

  // ── Fetch A — every slab (paginated; Temple View walks the same ~10k+
  // rows). Total order via temple,id so no page-boundary row loss.
  type SlabRow = {
    id: string;
    temple: string;
    status: string;
    carving_method: string | null;
    length_ft: number | string;
    width_ft: number | string;
    thickness_ft: number | string;
    priority: boolean | null;
    label: string | null;
    stone: string | null;
    description: string | null;
    component_section: string | null;
    component_element: string | null;
  };
  const slabs = await fetchAllPaged<SlabRow>((from, to) =>
    admin
      .from("slab_requirements")
      .select("id, temple, status, carving_method, length_ft, width_ft, thickness_ft, priority, label, stone, description, component_section, component_element")
      .order("temple", { ascending: true })
      .order("id", { ascending: true })
      .range(from, to),
  );

  // ── Fetch B — carving_items (throughput + off-plan detection in one).
  type ItemRow = {
    slab_requirement_id: string | null;
    vendor_type: string | null;
    review_approved_at: string | null;
    carving_sides: number | null;
    status: string | null;
  };
  const items = await fetchAllPaged<ItemRow>((from, to) =>
    admin
      .from("carving_items")
      .select("slab_requirement_id, vendor_type, review_approved_at, carving_sides, status")
      .neq("status", "cancelled")
      .order("id", { ascending: true })
      .range(from, to),
  );

  // ── Fetch C — active CNC machine count (for the forecast card).
  const { data: machineRows } = await admin
    .from("cnc_machines")
    .select("id")
    .eq("is_active", true);
  const machineCount = (machineRows ?? []).length;

  // ── Bucketing (plan-specific — deliberately NOT temple-shared bucketOf:
  // that one files carving_on_hold under "pending").
  //   excluded    cancelled / rejected / carving_rejected
  //   not_yet_cut open / planned / cutting
  //   cut_waiting cut_done
  //   in_carving  carving_assigned / carving_in_progress / carving_on_hold
  //   done        completed / dispatched  (direct dispatch sets completed,
  //               so the same rule covers method 'none')
  const stageOf = (status: string): keyof StageTotals | null => {
    if (status === "cancelled" || status === "rejected" || status === "carving_rejected") return null;
    if (status === "open" || status === "planned" || status === "cutting") return "notCut";
    if (status === "cut_done") return "cutWaiting";
    if (status === "carving_assigned" || status === "carving_in_progress" || status === "carving_on_hold") return "inCarving";
    if (status === "completed" || status === "dispatched") return "done";
    return null;
  };
  const methodOf = (m: string | null): MethodKey =>
    m === "cnc" || m === "outsource" || m === "none" ? m : "nil";

  const emptyStage = (): StageTotals => ({
    notCut: { slabs: 0, cft: 0 },
    cutWaiting: { slabs: 0, cft: 0 },
    inCarving: { slabs: 0, cft: 0 },
    done: { slabs: 0, cft: 0 },
  });

  const summaries: Record<MethodKey, MethodSummary> = {
    cnc: { total: { slabs: 0, cft: 0 }, stages: emptyStage() },
    outsource: { total: { slabs: 0, cft: 0 }, stages: emptyStage() },
    none: { total: { slabs: 0, cft: 0 }, stages: emptyStage() },
    nil: { total: { slabs: 0, cft: 0 }, stages: emptyStage() },
  };

  // temple → method → per-stage — kept compact; the client renders the
  // matrix + expandable per-temple breakdown from this single structure.
  const templeMap = new Map<string, Record<MethodKey, MethodSummary>>();
  const dimsById = new Map<string, number>(); // slab id → raw cft (forecast join)
  const slabMeta = new Map<string, { method: MethodKey; stage: keyof StageTotals | null }>();
  const undecided: UndecidedSlab[] = [];

  for (const s of slabs) {
    const stage = stageOf(s.status);
    const m = methodOf(s.carving_method);
    const c = cft(Number(s.length_ft) || 0, Number(s.width_ft) || 0, Number(s.thickness_ft) || 0);
    dimsById.set(s.id, c);
    slabMeta.set(s.id, { method: m, stage });
    if (stage === null) continue; // cancelled/rejected — out of every total

    summaries[m].total.slabs += 1;
    summaries[m].total.cft += c;
    summaries[m].stages[stage].slabs += 1;
    summaries[m].stages[stage].cft += c;

    let t = templeMap.get(s.temple);
    if (!t) {
      t = {
        cnc: { total: { slabs: 0, cft: 0 }, stages: emptyStage() },
        outsource: { total: { slabs: 0, cft: 0 }, stages: emptyStage() },
        none: { total: { slabs: 0, cft: 0 }, stages: emptyStage() },
        nil: { total: { slabs: 0, cft: 0 }, stages: emptyStage() },
      };
      templeMap.set(s.temple, t);
    }
    t[m].total.slabs += 1;
    t[m].total.cft += c;
    t[m].stages[stage].slabs += 1;
    t[m].stages[stage].cft += c;

    // Undecided queue = nil slabs that still have a routing decision to make
    // (once a slab is done/dispatched the question is moot).
    if (m === "nil" && stage !== "done") {
      undecided.push({
        id: s.id,
        temple: s.temple,
        status: s.status,
        label: s.label,
        stone: s.stone,
        description: s.description,
        section: s.component_section,
        element: s.component_element,
        l: Number(s.length_ft) || 0,
        w: Number(s.width_ft) || 0,
        t: Number(s.thickness_ft) || 0,
        priority: s.priority === true,
      });
    }
  }

  const temples: TempleMethodRow[] = [...templeMap.entries()]
    .map(([temple, methods]) => ({ temple, methods }))
    .sort(
      (a, b) =>
        b.methods.cnc.total.cft + b.methods.outsource.total.cft + b.methods.none.total.cft + b.methods.nil.total.cft -
        (a.methods.cnc.total.cft + a.methods.outsource.total.cft + a.methods.none.total.cft + a.methods.nil.total.cft),
    );

  // ── CNC forecast — last-30-day approved CNC throughput, with the
  // carving_sides multiplier (a 2-side slab is twice the carved output).
  const dayMs = 24 * 3600 * 1000;
  const thirtyAgo = Date.now() - 30 * dayMs;
  // Per-day carved CFT, index 0 = 30 days ago … 29 = today, for the pace chart.
  const daily = new Array<number>(30).fill(0);
  let cncDoneCft30 = 0, cncDoneSlabs30 = 0;
  for (const it of items) {
    const sid = it.slab_requirement_id;
    if (!sid) continue;
    if (it.vendor_type === "CNC" && it.review_approved_at && Date.parse(it.review_approved_at) >= thirtyAgo) {
      const sides = it.carving_sides === 2 ? 2 : 1;
      const c = (dimsById.get(sid) ?? 0) * sides;
      cncDoneCft30 += c;
      cncDoneSlabs30 += 1;
      const idx = Math.min(29, Math.max(0, Math.floor((Date.parse(it.review_approved_at) - thirtyAgo) / dayMs)));
      daily[idx] += c;
    }
  }
  void slabMeta; // kept for future off-plan needs; not surfaced on the page

  // Pending CNC work = cnc-tagged slabs not yet done.
  const cncPending = {
    slabs:
      summaries.cnc.stages.notCut.slabs +
      summaries.cnc.stages.cutWaiting.slabs +
      summaries.cnc.stages.inCarving.slabs,
    cft:
      summaries.cnc.stages.notCut.cft +
      summaries.cnc.stages.cutWaiting.cft +
      summaries.cnc.stages.inCarving.cft,
  };

  const forecast: CncForecast = {
    machineCount,
    cncPending,
    cncDone30: { slabs: cncDoneSlabs30, cft: cncDoneCft30 },
    daily,
  };

  return (
    <PlanClient
      summaries={summaries}
      temples={temples}
      undecided={undecided}
      forecast={forecast}
    />
  );
}
