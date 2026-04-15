import { PlanningWorkbench } from "@/components/planning-workbench";
import { requireAuth } from "@/lib/auth";
import { createDataClient } from "@/lib/supabase/server";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { approvePlanAction } from "./actions";
import { ProcurementHeadsUp } from "./procurement-heads-up";

export default async function PlanningPage({
  searchParams,
}: {
  searchParams: Promise<{ slabs?: string; err?: string }>;
}) {
  const { profile } = await requireAuth(["owner", "team_head"]);

  const supabase = await createDataClient(profile.role);
  const params = await searchParams;
  const errorMsg = params.err ? decodeURIComponent(params.err) : null;

  const selectedSlabIds = params.slabs
    ? params.slabs.split(",").map((s) => s.trim()).filter(Boolean)
    : null;

  let slabQuery = supabase
    .from("slab_requirements")
    .select("id, label, temple, stone, quality, length_ft, width_ft, thickness_ft, status, priority")
    .eq("status", "open")
    .order("created_at", { ascending: false });

  if (selectedSlabIds && selectedSlabIds.length > 0) {
    slabQuery = slabQuery.in("id", selectedSlabIds);
  }

  const admin = createAdminSupabaseClient();
  const sinceIso = new Date(Date.now() - 180 * 24 * 3600 * 1000).toISOString();
  const [
    { data: blocks, error: blockError },
    { data: slabs, error: slabError },
    { data: stoneTypes },
    { data: historySlabs },
    { data: availableBlocks },
  ] = await Promise.all([
    supabase
      .from("blocks")
      .select("id, stone, yard, category, quality, length_ft, width_ft, height_ft, status")
      .eq("status", "available")
      .order("created_at", { ascending: false }),
    slabQuery,
    admin.from("stone_types").select("id, name, color_top, color_front, color_side").order("sort_order").order("name"),
    admin
      .from("slab_requirements")
      .select("length_ft, width_ft, stone")
      .in("status", ["cut_done", "completed"])
      .gte("updated_at", sinceIso)
      .limit(2000),
    admin
      .from("blocks")
      .select("stone, length_ft, width_ft, height_ft")
      .in("status", ["available", "reserved"]),
  ]);

  if (blockError) throw new Error(blockError.message);
  if (slabError)  throw new Error(slabError.message);

  // Procurement heads-up: per-stone p90 historical slab length vs. longest block in stock.
  const stoneLengths = new Map<string, number[]>();
  for (const s of historySlabs ?? []) {
    const stone = s.stone ?? "Unknown";
    const maxDim = Math.max(Number(s.length_ft), Number(s.width_ft));
    if (!stoneLengths.has(stone)) stoneLengths.set(stone, []);
    stoneLengths.get(stone)!.push(maxDim);
  }
  const longestInStock = new Map<string, number>();
  for (const b of availableBlocks ?? []) {
    const stone = b.stone ?? "Unknown";
    const maxDim = Math.max(Number(b.length_ft), Number(b.width_ft), Number(b.height_ft));
    if (maxDim > (longestInStock.get(stone) ?? 0)) longestInStock.set(stone, maxDim);
  }
  const procurementAlerts: Array<{ stone: string; p90: number; longestAvailable: number; sampleCount: number }> = [];
  for (const [stone, arr] of stoneLengths) {
    if (arr.length < 10) continue; // too little signal
    arr.sort((a, b) => a - b);
    const p90 = arr[Math.min(arr.length - 1, Math.floor(arr.length * 0.9))];
    const longestAvailable = longestInStock.get(stone) ?? 0;
    if (p90 > longestAvailable - 2) {
      procurementAlerts.push({
        stone,
        p90: Math.round(p90),
        longestAvailable: Math.round(longestAvailable),
        sampleCount: arr.length,
      });
    }
  }

  const ErrorBanner = errorMsg ? (
    <div style={{
      background: "rgba(220,38,38,0.07)",
      border: "1.5px solid rgba(220,38,38,0.3)",
      borderRadius: 8,
      padding: "12px 16px",
      marginBottom: 16,
      fontSize: 13,
      color: "#DC2626",
      fontWeight: 500,
      display: "flex",
      alignItems: "flex-start",
      gap: 8,
    }}>
      <span style={{ flexShrink: 0, marginTop: 1 }}>⚠️</span>
      <div>
        <strong>Approval failed:</strong> {errorMsg}
        <div style={{ marginTop: 6, fontSize: 12, color: "#B91C1C" }}>
          Go back to Slab View, reselect your slabs, and regenerate the plan.
        </div>
      </div>
    </div>
  ) : null;

  if (!selectedSlabIds) {
    return (
      <>
        {ErrorBanner}
        <ProcurementHeadsUp alerts={procurementAlerts} />
        <div className="page-content" style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: "60vh", textAlign: "center", gap: 16 }}>
          <div style={{ fontSize: 56, lineHeight: 1 }}>⌘</div>
          <h2 style={{ margin: 0 }}>No Slabs Selected</h2>
          <p className="muted" style={{ maxWidth: 400 }}>
            Go to Slab View, select the slabs you want to cut today, then click &ldquo;Send to Plan Generator&rdquo;.
          </p>
          <a href="/slabs/view" className="primary-button" style={{ textDecoration: "none", marginTop: 8 }}>
            Go to Slab View →
          </a>
        </div>
      </>
    );
  }

  return (
    <>
      {ErrorBanner}
      <ProcurementHeadsUp alerts={procurementAlerts} />
      <PlanningWorkbench approveAction={approvePlanAction} blocks={blocks ?? []} slabs={slabs ?? []} stoneTypes={stoneTypes ?? undefined} />
    </>
  );
}
