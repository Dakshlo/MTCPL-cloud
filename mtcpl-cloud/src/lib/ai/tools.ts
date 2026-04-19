/**
 * Server-side tool definitions and handlers for the Ask AI chatbot.
 *
 * Each tool is:
 *   1. A JSON schema Claude sees (`.schema`),
 *   2. A handler that executes against Supabase and returns a plain JSON
 *      string Claude parses as `tool_result.content`.
 *
 * All tools are READ-ONLY. None of them mutate any row. Auth is enforced at
 * the /api/ask-ai route level before any tool can run.
 */

import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { runOptimization, type BlockRow, type SlabRow } from "@/lib/planning/packing";
import { facilityOfYard, YARDS_BY_FACILITY, type Facility } from "@/lib/yards";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function toCFT(cubicInches: number): number {
  return cubicInches / 1728;
}

function istRange(key: "today" | "yesterday" | "this_week" | "this_month") {
  const DAY = 24 * 60 * 60 * 1000;
  const IST = 5.5 * 60 * 60 * 1000;
  const nowMs = Date.now();
  const todayMidnight = Math.floor((nowMs + IST) / DAY) * DAY - IST;
  const weekStart = todayMidnight - 6 * DAY;
  const month = new Date(new Date(nowMs + IST).toISOString());
  const monthStartMs = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth(), 1)).getTime() - IST;

  if (key === "today") return { from: new Date(todayMidnight).toISOString(), to: new Date(todayMidnight + DAY).toISOString() };
  if (key === "yesterday") return { from: new Date(todayMidnight - DAY).toISOString(), to: new Date(todayMidnight).toISOString() };
  if (key === "this_week") return { from: new Date(weekStart).toISOString(), to: new Date(todayMidnight + DAY).toISOString() };
  return { from: new Date(monthStartMs).toISOString(), to: new Date(todayMidnight + DAY).toISOString() };
}

// ─── Tool schemas (what Claude sees) ─────────────────────────────────────────

export const AI_TOOLS = [
  {
    name: "list_temples",
    description:
      "List every temple in the system with its count of open slab requirements. Use this first when the user mentions a temple whose exact spelling or casing you are unsure of.",
    input_schema: {
      type: "object" as const,
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: "get_inventory_snapshot",
    description:
      "Current block inventory. Returns counts + total CFT grouped by stone, yard, and facility (MTCPL/RIICO). Use for 'how many blocks do we have' style questions.",
    input_schema: {
      type: "object" as const,
      properties: {
        stone: { type: "string", description: "Filter to a stone type e.g. 'PinkStone'. Omit for all." },
        facility: { type: "string", enum: ["mtcpl", "riico"], description: "Filter to one facility. Omit for both." },
      },
      additionalProperties: false,
    },
  },
  {
    name: "get_temple_requirements",
    description:
      "Open slab_requirements for a specific temple. Returns total slab count, unique size list, and grouped counts by size. Pass 'all' to get the top 10 temples ranked by open slab count.",
    input_schema: {
      type: "object" as const,
      properties: {
        temple: { type: "string", description: "Exact temple name, or 'all' for the top 10." },
      },
      required: ["temple"],
      additionalProperties: false,
    },
  },
  {
    name: "get_cutting_activity",
    description:
      "Cutting activity (blocks finished cutting) in a time window. Returns block count, slabs cut, total CFT, and efficiency.",
    input_schema: {
      type: "object" as const,
      properties: {
        range: {
          type: "string",
          enum: ["today", "yesterday", "this_week", "this_month"],
          description: "Time window in IST.",
        },
      },
      required: ["range"],
      additionalProperties: false,
    },
  },
  {
    name: "run_plan_simulation",
    description:
      "Run the real cut-planning algorithm for a temple's open slabs against available blocks in the specified facility. Returns the minimum number of blocks needed and which blocks they are. ALWAYS use this for 'how many blocks do I need' questions — never estimate.",
    input_schema: {
      type: "object" as const,
      properties: {
        temple: { type: "string", description: "Exact temple name whose open slabs to plan for." },
        facility: {
          type: "string",
          enum: ["mtcpl", "riico"],
          description: "Facility whose blocks can be used. Defaults to MTCPL.",
        },
        kerf_mm: { type: "number", description: "Cutter kerf width in mm. Defaults to 6." },
      },
      required: ["temple"],
      additionalProperties: false,
    },
  },
];

// ─── Tool handler dispatcher ─────────────────────────────────────────────────

export async function runTool(name: string, input: Record<string, unknown>): Promise<string> {
  try {
    switch (name) {
      case "list_temples":
        return JSON.stringify(await listTemples());
      case "get_inventory_snapshot":
        return JSON.stringify(await getInventorySnapshot(input));
      case "get_temple_requirements":
        return JSON.stringify(await getTempleRequirements(input));
      case "get_cutting_activity":
        return JSON.stringify(await getCuttingActivity(input));
      case "run_plan_simulation":
        return JSON.stringify(await runPlanSimulation(input));
      default:
        return JSON.stringify({ error: `Unknown tool: ${name}` });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return JSON.stringify({ error: `Tool failed: ${msg}` });
  }
}

// ─── list_temples ────────────────────────────────────────────────────────────

async function listTemples() {
  const admin = createAdminSupabaseClient();
  const { data, error } = await admin
    .from("slab_requirements")
    .select("temple")
    .in("status", ["open", "planned"]);
  if (error) throw new Error(error.message);

  const counts = new Map<string, number>();
  for (const row of data ?? []) {
    if (!row.temple) continue;
    counts.set(row.temple, (counts.get(row.temple) ?? 0) + 1);
  }
  const temples = [...counts.entries()]
    .map(([temple, openSlabCount]) => ({ temple, openSlabCount }))
    .sort((a, b) => b.openSlabCount - a.openSlabCount);
  return { temples, totalTemples: temples.length };
}

// ─── get_inventory_snapshot ──────────────────────────────────────────────────

async function getInventorySnapshot(input: Record<string, unknown>) {
  const admin = createAdminSupabaseClient();
  const stoneFilter = typeof input.stone === "string" ? input.stone : undefined;
  const facilityFilter = input.facility === "mtcpl" || input.facility === "riico" ? (input.facility as Facility) : undefined;

  let query = admin
    .from("blocks")
    .select("id, stone, yard, category, length_ft, width_ft, height_ft, status")
    .in("status", ["available", "reserved"]);
  if (stoneFilter) query = query.eq("stone", stoneFilter);
  if (facilityFilter) query = query.in("yard", YARDS_BY_FACILITY[facilityFilter] as unknown as number[]);

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  type Row = { stone: string | null; yard: number; category: string | null; length_ft: number; width_ft: number; height_ft: number; status: string };
  const blocks = (data ?? []) as Row[];

  const byStone: Record<string, { count: number; cft: number }> = {};
  const byYard: Record<string, { count: number; cft: number }> = {};
  const byFacility: Record<Facility, { count: number; cft: number }> = {
    mtcpl: { count: 0, cft: 0 },
    riico: { count: 0, cft: 0 },
  };
  let totalCount = 0;
  let totalCft = 0;
  let availableCount = 0;
  let reservedCount = 0;

  for (const b of blocks) {
    const cft = toCFT(Number(b.length_ft) * Number(b.width_ft) * Number(b.height_ft));
    const stone = b.stone ?? "Unknown";
    byStone[stone] ??= { count: 0, cft: 0 };
    byStone[stone].count++;
    byStone[stone].cft += cft;

    const yardKey = `yard_${b.yard}`;
    byYard[yardKey] ??= { count: 0, cft: 0 };
    byYard[yardKey].count++;
    byYard[yardKey].cft += cft;

    const fac = facilityOfYard(b.yard);
    byFacility[fac].count++;
    byFacility[fac].cft += cft;

    totalCount++;
    totalCft += cft;
    if (b.status === "available") availableCount++;
    else if (b.status === "reserved") reservedCount++;
  }

  // Round CFT values for readability
  const round = (obj: Record<string, { count: number; cft: number }>) =>
    Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, { count: v.count, cft: Number(v.cft.toFixed(2)) }]));

  return {
    total: { count: totalCount, availableCount, reservedCount, cft: Number(totalCft.toFixed(2)) },
    byStone: round(byStone),
    byYard: round(byYard),
    byFacility: {
      mtcpl: { count: byFacility.mtcpl.count, cft: Number(byFacility.mtcpl.cft.toFixed(2)) },
      riico: { count: byFacility.riico.count, cft: Number(byFacility.riico.cft.toFixed(2)) },
    },
    filters: { stone: stoneFilter ?? "all", facility: facilityFilter ?? "all" },
  };
}

// ─── get_temple_requirements ─────────────────────────────────────────────────

async function getTempleRequirements(input: Record<string, unknown>) {
  const temple = typeof input.temple === "string" ? input.temple : "all";
  const admin = createAdminSupabaseClient();

  if (temple === "all") {
    const { data, error } = await admin
      .from("slab_requirements")
      .select("temple")
      .in("status", ["open", "planned"]);
    if (error) throw new Error(error.message);
    const counts = new Map<string, number>();
    for (const r of data ?? []) {
      if (!r.temple) continue;
      counts.set(r.temple, (counts.get(r.temple) ?? 0) + 1);
    }
    const topTemples = [...counts.entries()]
      .map(([temple, count]) => ({ temple, openSlabCount: count }))
      .sort((a, b) => b.openSlabCount - a.openSlabCount)
      .slice(0, 10);
    return { topTemples };
  }

  const { data, error } = await admin
    .from("slab_requirements")
    .select("id, label, stone, quality, priority, length_ft, width_ft, thickness_ft, status, deadline")
    .eq("temple", temple)
    .in("status", ["open", "planned"])
    .order("priority", { ascending: false });
  if (error) throw new Error(error.message);

  const rows = data ?? [];
  // Group by size signature for a compact summary
  const sizeGroups = new Map<string, { count: number; stone: string | null; quality: string | null; priorityCount: number }>();
  let priorityCount = 0;
  for (const r of rows) {
    const key = `${r.length_ft}×${r.width_ft}×${r.thickness_ft}|${r.stone ?? "any"}|${r.quality ?? "any"}`;
    const existing = sizeGroups.get(key);
    if (existing) {
      existing.count++;
      if (r.priority) existing.priorityCount++;
    } else {
      sizeGroups.set(key, { count: 1, stone: r.stone, quality: r.quality, priorityCount: r.priority ? 1 : 0 });
    }
    if (r.priority) priorityCount++;
  }

  const uniqueSizes = [...sizeGroups.entries()].map(([k, v]) => {
    const [dims] = k.split("|");
    return { size: dims + " in", ...v };
  });

  return {
    temple,
    openSlabCount: rows.length,
    priorityCount,
    uniqueSizes: uniqueSizes.sort((a, b) => b.count - a.count).slice(0, 20),
    slabs: rows.slice(0, 30).map((r) => ({
      id: r.id,
      label: r.label,
      size: `${r.length_ft} × ${r.width_ft} × ${r.thickness_ft} in`,
      stone: r.stone,
      quality: r.quality,
      priority: r.priority,
      status: r.status,
      deadline: r.deadline,
    })),
    note: rows.length > 30 ? `Showing 30 of ${rows.length} slabs — use uniqueSizes for a compact summary.` : undefined,
  };
}

// ─── get_cutting_activity ────────────────────────────────────────────────────

async function getCuttingActivity(input: Record<string, unknown>) {
  const range = (input.range === "today" || input.range === "yesterday" || input.range === "this_week" || input.range === "this_month")
    ? input.range
    : "today";
  const { from, to } = istRange(range);
  const admin = createAdminSupabaseClient();

  const { data, error } = await admin
    .from("cut_session_blocks")
    .select("id, block_id, updated_at, layout")
    .eq("status", "done")
    .gte("updated_at", from)
    .lt("updated_at", to);
  if (error) throw new Error(error.message);

  const rows = data ?? [];
  let slabsCut = 0;
  let totalSlabCft = 0;
  let totalBlockCft = 0;

  for (const r of rows) {
    const layout = r.layout as { blk?: { l?: number; w?: number; h?: number }; placed?: Array<{ sw?: number; sh?: number; sd?: number }> } | null;
    const placed = layout?.placed ?? [];
    slabsCut += placed.length;
    for (const s of placed) {
      if (s.sw && s.sh && s.sd) totalSlabCft += toCFT(s.sw * s.sh * s.sd);
    }
    if (layout?.blk) {
      totalBlockCft += toCFT((layout.blk.l ?? 0) * (layout.blk.w ?? 0) * (layout.blk.h ?? 0));
    }
  }

  const efficiencyPct = totalBlockCft > 0 ? Math.round((totalSlabCft / totalBlockCft) * 100) : 0;

  return {
    range,
    from,
    to,
    blocksCut: rows.length,
    slabsCut,
    totalSlabCft: Number(totalSlabCft.toFixed(2)),
    totalBlockCft: Number(totalBlockCft.toFixed(2)),
    efficiencyPct,
    wasteCft: Number(Math.max(0, totalBlockCft - totalSlabCft).toFixed(2)),
  };
}

// ─── run_plan_simulation ─────────────────────────────────────────────────────

async function runPlanSimulation(input: Record<string, unknown>) {
  const temple = typeof input.temple === "string" ? input.temple : "";
  const facility: Facility = input.facility === "riico" ? "riico" : "mtcpl";
  const kerfMm = typeof input.kerf_mm === "number" ? input.kerf_mm : 6;

  if (!temple || temple === "all") {
    return { error: "Specify an exact temple name. Use list_temples to see options." };
  }

  const admin = createAdminSupabaseClient();

  // Fetch open slab_requirements for this temple
  const slabsRes = await admin
    .from("slab_requirements")
    .select("id, label, temple, stone, length_ft, width_ft, thickness_ft, status, quality, priority")
    .eq("temple", temple)
    .in("status", ["open", "planned"]);
  if (slabsRes.error) throw new Error(slabsRes.error.message);

  const slabs = (slabsRes.data ?? []) as SlabRow[];
  if (slabs.length === 0) {
    return { error: `No open slab requirements found for temple "${temple}". Try list_temples to check the exact name.` };
  }

  // Fetch available blocks in the facility
  const yardList = YARDS_BY_FACILITY[facility] as unknown as number[];
  const blocksRes = await admin
    .from("blocks")
    .select("id, stone, yard, category, length_ft, width_ft, height_ft, status, quality")
    .in("status", ["available", "reserved"])
    .in("yard", yardList);
  if (blocksRes.error) throw new Error(blocksRes.error.message);

  const blocks = (blocksRes.data ?? []) as BlockRow[];
  if (blocks.length === 0) {
    return { error: `No available blocks in facility ${facility.toUpperCase()}.` };
  }

  // Run the real algorithm
  const result = runOptimization(blocks, slabs, kerfMm);

  return {
    temple,
    facility,
    kerfMm,
    blocksNeeded: result.plan.length,
    blockIds: result.plan.map((p) => p.blk.id),
    slabsPlaced: result.plan.reduce((sum, p) => sum + p.placed.length, 0),
    totalSlabsRequested: slabs.length,
    unmetSlabCount: result.unmet.length,
    unmetSlabIds: result.unmet.slice(0, 10).map((u) => u.id),
    avgEfficiencyPct: result.plan.length > 0
      ? Math.round(result.plan.reduce((sum, p) => sum + p.eff, 0) / result.plan.length)
      : 0,
    totalWasteCuFt: Number(toCFT(result.totalWaste).toFixed(2)),
    planSummary: result.plan.slice(0, 10).map((p) => ({
      blockId: p.blk.id,
      blockSize: `${p.blk.l} × ${p.blk.w} × ${p.blk.h} in`,
      stone: p.blk.stone,
      slabsPlacedHere: p.placed.length,
      efficiencyPct: p.eff,
      hasRestockableRemainder: !!p.biggest,
    })),
  };
}
