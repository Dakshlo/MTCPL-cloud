/**
 * Production DPR (Daily Production Report) — Daksh, June 2026.
 *
 * For a chosen period (day / week / month / year) returns, per pipeline
 * STAGE, every item that ENTERED that stage in the window — itemised by
 * CODE with quantity and CFT.
 *
 * LEGACY (June 2026): the /reports/dpr screen was redesigned into section
 * tabs (src/lib/dpr-*.ts) and no longer uses this builder — only the
 * /api/reports/dpr.xlsx export still calls it, so the two now diverge.
 *
 * Stage → window-key mapping (all verified against schema + migrations):
 *   1 Block added        blocks.created_at                         (block code)
 *   2 Block cutting       audit_logs action='cutting_started'       (block code)
 *   3 Cutting done        cut_session_blocks status='done'.updated_at → its slabs (slab code)
 *   3a Carving — CNC      carving_items.assigned_at, vendor_type='CNC'   (slab code)
 *   3b Carving — Outsource carving_items.assigned_at, vendor_type≠'CNC'  (slab code)
 *   4 Ready to dispatch   carving_items.ready_to_dispatch_at ∪ slab_requirements.direct_dispatched_at
 *   5 Dispatched          dispatches.dispatched_at  (challan made / truck assembled)
 *   6 Out for delivery    dispatches.approved_at    (truck approved & sent)
 *   7 Unloaded on site    slab_requirements.site_unloaded_at        (slab code)
 *   8 Installed           slab_requirements.installed_at            (slab code)
 *
 * CFT EVERYWHERE = (d1*d2*d3)/1728 — the *_ft columns hold INCHES
 * (legacy naming), so /1728 converts in³→ft³. All numerics are
 * String()→Number() coerced (PostgREST returns numerics as strings).
 *
 * Every query paginates (PostgREST silently caps .select() at 1000
 * rows; a month easily exceeds that).
 */

import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import type { CutterReportPeriod } from "@/lib/cutter-cost-report";
import { POST_CUT_STATUSES } from "@/lib/slab-statuses";

export type DprPeriod = CutterReportPeriod;

export type DprStageKey =
  | "block_added"
  | "block_cutting"
  | "cutting_done"
  | "carving_cnc"
  | "carving_outsource"
  | "carving_done"
  | "dispatched"
  | "unloaded"
  | "installed";

export type DprItemKind = "block" | "slab";

export type DprItem = {
  /** block id or slab id — the human-readable code. */
  code: string;
  qty: number;
  cft: number;
  /** optional context shown after the code (vendor, temple, …). */
  meta?: string;
};

export type DprStage = {
  key: DprStageKey;
  label: string;
  kind: DprItemKind;
  items: DprItem[];
  totalQty: number;
  totalCft: number;
  note?: string;
};

export type DprReport = {
  period: DprPeriod;
  stages: DprStage[];
  generatedAt: string;
};

// ── helpers ─────────────────────────────────────────────────────────

const cftOf = (l: unknown, w: unknown, t: unknown): number =>
  (Number(l) * Number(w) * Number(t)) / 1728;

const uniq = (xs: string[]): string[] => [...new Set(xs)];

/** Period bounds in IST → absolute ISO (exclusive upper bound). Same
 *  idiom as cutter-cost-report.ts. Filter with .gte(startIso).lt(endIso). */
function windowIso(period: DprPeriod): { startIso: string; endIso: string } {
  const startIso = new Date(`${period.startDate}T00:00:00+05:30`).toISOString();
  const [ey, em, ed] = period.endDate.split("-").map(Number);
  const exclusiveEndMs =
    Date.UTC(ey, em - 1, ed) + 86_400_000 - 5.5 * 60 * 60 * 1000;
  const endIso = new Date(exclusiveEndMs).toISOString();
  return { startIso, endIso };
}

type Rangeable = {
  range: (from: number, to: number) => PromiseLike<{ data: unknown[] | null }>;
};

/** Page through a whole filtered table (1000-row PostgREST cap). The
 *  factory must produce a builder ending in .order(<unique col>). */
async function fetchAll<T>(make: () => Rangeable): Promise<T[]> {
  const PAGE = 1000;
  const out: T[] = [];
  let offset = 0;
  for (let guard = 0; guard < 1000; guard++) {
    const { data } = await make().range(offset, offset + PAGE - 1);
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < PAGE) break;
    offset += PAGE;
  }
  return out;
}

/** Chunked .in() lookup that ALSO paginates within each chunk — a
 *  300-id chunk on source_block_id can still return >1000 rows. */
async function chunkInBy<T>(
  ids: string[],
  make: (chunk: string[]) => Rangeable,
  chunkSize = 300,
): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += chunkSize) {
    const chunk = ids.slice(i, i + chunkSize);
    if (chunk.length === 0) break;
    let offset = 0;
    for (let guard = 0; guard < 1000; guard++) {
      const { data } = await make(chunk).range(offset, offset + 999);
      const rows = (data ?? []) as T[];
      out.push(...rows);
      if (rows.length < 1000) break;
      offset += 1000;
    }
  }
  return out;
}

type AdminClient = ReturnType<typeof createAdminSupabaseClient>;
type SlabDim = { id: string; length_ft: number; width_ft: number; thickness_ft: number };

/** slab ids → CFT map (chunked + paginated dims lookup). */
async function cftBySlab(admin: AdminClient, ids: string[]): Promise<Map<string, number>> {
  const rows = await chunkInBy<SlabDim>(uniq(ids), (chunk) =>
    admin
      .from("slab_requirements")
      .select("id, length_ft, width_ft, thickness_ft")
      .in("id", chunk)
      .order("id"),
  );
  const map = new Map<string, number>();
  for (const s of rows) map.set(s.id, cftOf(s.length_ft, s.width_ft, s.thickness_ft));
  return map;
}

function makeStage(
  key: DprStageKey,
  label: string,
  kind: DprItemKind,
  items: DprItem[],
  note?: string,
): DprStage {
  items.sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));
  return {
    key,
    label,
    kind,
    items,
    totalQty: items.reduce((s, i) => s + i.qty, 0),
    totalCft: items.reduce((s, i) => s + i.cft, 0),
    note,
  };
}

// ── per-stage builders ──────────────────────────────────────────────

async function blockAdded(admin: AdminClient, w: { startIso: string; endIso: string }) {
  type Row = { id: string; length_ft: number; width_ft: number; height_ft: number };
  const rows = await fetchAll<Row>(() =>
    admin
      .from("blocks")
      .select("id, length_ft, width_ft, height_ft")
      .gte("created_at", w.startIso)
      .lt("created_at", w.endIso)
      .order("id"),
  );
  return makeStage(
    "block_added",
    "Block added",
    "block",
    rows.map((b) => ({ code: b.id, qty: 1, cft: cftOf(b.length_ft, b.width_ft, b.height_ft) })),
  );
}

async function blockCutting(admin: AdminClient, w: { startIso: string; endIso: string }) {
  const logs = await fetchAll<{ entity_id: string }>(() =>
    admin
      .from("audit_logs")
      .select("entity_id")
      .eq("action", "cutting_started")
      .eq("entity_type", "cut_session_block")
      .gte("created_at", w.startIso)
      .lt("created_at", w.endIso)
      // created_at + entity_id (both definitely present) — a stable,
      // near-unique sort for .range() paging without assuming a PK column.
      .order("created_at")
      .order("entity_id"),
  );
  const csbIds = uniq(logs.map((l) => l.entity_id).filter(Boolean));
  const csb = await chunkInBy<{ id: string; block_id: string }>(csbIds, (chunk) =>
    admin.from("cut_session_blocks").select("id, block_id").in("id", chunk).order("id"),
  );
  const blockIds = uniq(csb.map((r) => r.block_id));
  type B = { id: string; length_ft: number; width_ft: number; height_ft: number };
  const dims = await chunkInBy<B>(blockIds, (chunk) =>
    admin.from("blocks").select("id, length_ft, width_ft, height_ft").in("id", chunk).order("id"),
  );
  const cftMap = new Map(dims.map((b) => [b.id, cftOf(b.length_ft, b.width_ft, b.height_ft)]));
  return makeStage(
    "block_cutting",
    "Block cutting (started)",
    "block",
    blockIds.map((id) => ({ code: id, qty: 1, cft: cftMap.get(id) ?? 0 })),
    "When a block is first placed on the cutter.",
  );
}

async function cuttingDone(admin: AdminClient, w: { startIso: string; endIso: string }) {
  const done = await fetchAll<{ block_id: string }>(() =>
    admin
      .from("cut_session_blocks")
      .select("block_id")
      .eq("status", "done")
      .gte("updated_at", w.startIso)
      .lt("updated_at", w.endIso)
      .order("id"),
  );
  const blockIds = uniq(done.map((d) => d.block_id));
  type S = SlabDim & { status: string };
  const slabs = await chunkInBy<S>(
    blockIds,
    (chunk) =>
      admin
        .from("slab_requirements")
        .select("id, length_ft, width_ft, thickness_ft, status")
        .in("source_block_id", chunk)
        .order("id"),
    200,
  );
  // Canonical "physically produced" set — POST_CUT_STATUSES keeps a
  // rejected slab credited to its source block (it WAS cut) and drops
  // not-yet-cut 'planned' slabs. Matches cutter-cost-report.ts so the
  // two never diverge (review w8ksgkj64).
  const postCut = POST_CUT_STATUSES as readonly string[];
  const items = slabs
    .filter((s) => postCut.includes(s.status))
    .map((s) => ({ code: s.id, qty: 1, cft: cftOf(s.length_ft, s.width_ft, s.thickness_ft) }));
  return makeStage("cutting_done", "Cutting done", "slab", items, "Slabs produced from blocks finished cutting.");
}

async function carvingSplit(admin: AdminClient, w: { startIso: string; endIso: string }) {
  type Row = { slab_requirement_id: string; vendor_type: string | null; vendor_name: string | null };
  const rows = await fetchAll<Row>(() =>
    admin
      .from("carving_items")
      .select("slab_requirement_id, vendor_type, vendor_name")
      .gte("assigned_at", w.startIso)
      .lt("assigned_at", w.endIso)
      .order("id"),
  );
  const cftMap = await cftBySlab(admin, rows.map((r) => r.slab_requirement_id));
  const cnc: DprItem[] = [];
  const outsource: DprItem[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    if (seen.has(r.slab_requirement_id)) continue;
    seen.add(r.slab_requirement_id);
    const item: DprItem = {
      code: r.slab_requirement_id,
      qty: 1,
      cft: cftMap.get(r.slab_requirement_id) ?? 0,
      meta: r.vendor_name ?? undefined,
    };
    if (r.vendor_type === "CNC") cnc.push(item);
    else outsource.push(item);
  }
  return [
    makeStage("carving_cnc", "Carving — CNC", "slab", cnc),
    makeStage("carving_outsource", "Carving — Outsource", "slab", outsource),
  ];
}

async function carvingDone(admin: AdminClient, w: { startIso: string; endIso: string }) {
  const ci = await fetchAll<{ slab_requirement_id: string }>(() =>
    admin
      .from("carving_items")
      .select("slab_requirement_id")
      .not("ready_to_dispatch_at", "is", null)
      .gte("ready_to_dispatch_at", w.startIso)
      .lt("ready_to_dispatch_at", w.endIso)
      .order("id"),
  );
  const direct = await fetchAll<{ id: string }>(() =>
    admin
      .from("slab_requirements")
      .select("id")
      .not("direct_dispatched_at", "is", null)
      .gte("direct_dispatched_at", w.startIso)
      .lt("direct_dispatched_at", w.endIso)
      .order("id"),
  );
  const slabIds = uniq([...ci.map((r) => r.slab_requirement_id), ...direct.map((r) => r.id)]);
  const cftMap = await cftBySlab(admin, slabIds);
  return makeStage(
    "carving_done",
    "Carving done → ready to dispatch",
    "slab",
    slabIds.map((id) => ({ code: id, qty: 1, cft: cftMap.get(id) ?? 0 })),
    "Released for dispatch (includes direct-dispatch slabs that skipped carving).",
  );
}

async function dispatchStage(
  admin: AdminClient,
  w: { startIso: string; endIso: string },
  column: "dispatched_at" | "approved_at",
  key: DprStageKey,
  label: string,
  note: string,
) {
  const disp = await fetchAll<{ id: string }>(() =>
    admin
      .from("dispatches")
      .select("id")
      .not(column, "is", null)
      .gte(column, w.startIso)
      .lt(column, w.endIso)
      .order("id"),
  );
  const dispIds = uniq(disp.map((d) => d.id));
  const logs = await chunkInBy<{ slab_requirement_id: string | null }>(dispIds, (chunk) =>
    admin
      .from("dispatch_logs")
      .select("slab_requirement_id")
      .in("dispatch_id", chunk)
      .order("id"),
  );
  const slabIds = uniq(logs.map((l) => l.slab_requirement_id).filter((x): x is string => !!x));
  const cftMap = await cftBySlab(admin, slabIds);
  return makeStage(
    key,
    label,
    "slab",
    slabIds.map((id) => ({ code: id, qty: 1, cft: cftMap.get(id) ?? 0 })),
    `${dispIds.length} truck${dispIds.length === 1 ? "" : "s"} · ${note}`,
  );
}

async function siteSlabStage(
  admin: AdminClient,
  w: { startIso: string; endIso: string },
  column: "site_unloaded_at" | "installed_at",
  key: DprStageKey,
  label: string,
) {
  const rows = await fetchAll<SlabDim>(() =>
    admin
      .from("slab_requirements")
      .select("id, length_ft, width_ft, thickness_ft")
      .not(column, "is", null)
      .gte(column, w.startIso)
      .lt(column, w.endIso)
      .order("id"),
  );
  return makeStage(
    key,
    label,
    "slab",
    rows.map((s) => ({ code: s.id, qty: 1, cft: cftOf(s.length_ft, s.width_ft, s.thickness_ft) })),
  );
}

// ── orchestrator ────────────────────────────────────────────────────

export async function buildProductionDpr(period: DprPeriod): Promise<DprReport> {
  const admin = createAdminSupabaseClient();
  const w = windowIso(period);

  const [
    sBlockAdded,
    sBlockCutting,
    sCuttingDone,
    sCarving,
    sCarvingDone,
    sDispatched,
    sUnloaded,
    sInstalled,
  ] = await Promise.all([
    blockAdded(admin, w),
    blockCutting(admin, w),
    cuttingDone(admin, w),
    carvingSplit(admin, w),
    carvingDone(admin, w),
    // Daksh: "dispatched" and "out for delivery" are the same event here,
    // so a single Dispatched stage keyed on approved_at (truck actually
    // approved & sent — excludes provisional loads not yet sent).
    dispatchStage(admin, w, "approved_at", "dispatched", "Dispatched", "approved & sent"),
    siteSlabStage(admin, w, "site_unloaded_at", "unloaded", "Unloaded on site"),
    siteSlabStage(admin, w, "installed_at", "installed", "Installed"),
  ]);

  return {
    period,
    stages: [
      sBlockAdded,
      sBlockCutting,
      sCuttingDone,
      ...sCarving,
      sCarvingDone,
      sDispatched,
      sUnloaded,
      sInstalled,
    ],
    generatedAt: new Date().toISOString(),
  };
}
