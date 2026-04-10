import { requireAuth } from "@/lib/auth";
import { createServerSupabaseClient } from "@/lib/supabase/server";

async function getCount(table: string) {
  const supabase = await createServerSupabaseClient();
  const { count } = await supabase.from(table).select("*", { count: "exact", head: true });
  return count ?? 0;
}

export default async function DashboardPage() {
  await requireAuth(["owner", "planner"]);

  const supabase = await createServerSupabaseClient();
  const [totalBlocks, slabsInQueue, activeCutSessions, reservedBlocks] = await Promise.all([
    getCount("blocks"),
    supabase.from("slab_requirements").select("*", { count: "exact", head: true }).eq("status", "open"),
    supabase.from("cut_sessions").select("*", { count: "exact", head: true }).eq("status", "in_progress"),
    supabase.from("blocks").select("*", { count: "exact", head: true }).eq("status", "reserved")
  ]);

  return (
    <section className="records-stack">
      <div className="page-card">
        <div className="page-heading">
          <div>
            <h1>Dashboard</h1>
            <p className="muted">A focused operating snapshot of the current block-to-cutting pipeline.</p>
          </div>
        </div>
      </div>

      <section className="metrics-grid">
        <div className="metric-card">
          <span>Total Blocks</span>
          <strong>{totalBlocks}</strong>
        </div>
        <div className="metric-card">
          <span>Slabs in Queue</span>
          <strong>{slabsInQueue.count ?? 0}</strong>
        </div>
        <div className="metric-card">
          <span>Active Cut Sessions</span>
          <strong>{activeCutSessions.count ?? 0}</strong>
        </div>
        <div className="metric-card">
          <span>Blocks Reserved</span>
          <strong>{reservedBlocks.count ?? 0}</strong>
        </div>
      </section>
    </section>
  );
}
