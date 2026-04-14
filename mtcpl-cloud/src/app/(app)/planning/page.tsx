import { PlanningWorkbench } from "@/components/planning-workbench";
import { requireAuth } from "@/lib/auth";
import { createDataClient } from "@/lib/supabase/server";
import { approvePlanAction } from "./actions";

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
    .select("id, label, temple, stone, quality, length_ft, width_ft, thickness_ft, status")
    .eq("status", "open")
    .order("created_at", { ascending: false });

  if (selectedSlabIds && selectedSlabIds.length > 0) {
    slabQuery = slabQuery.in("id", selectedSlabIds);
  }

  const [{ data: blocks, error: blockError }, { data: slabs, error: slabError }] = await Promise.all([
    supabase
      .from("blocks")
      .select("id, stone, yard, category, quality, length_ft, width_ft, height_ft, status")
      .eq("status", "available")
      .order("created_at", { ascending: false }),
    slabQuery,
  ]);

  if (blockError) throw new Error(blockError.message);
  if (slabError)  throw new Error(slabError.message);

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
      <PlanningWorkbench approveAction={approvePlanAction} blocks={blocks ?? []} slabs={slabs ?? []} />
    </>
  );
}
