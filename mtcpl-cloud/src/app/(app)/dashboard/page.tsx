import { requireAuth } from "@/lib/auth";
import { createServerSupabaseClient } from "@/lib/supabase/server";

async function getCount(table: string) {
  const supabase = await createServerSupabaseClient();
  const { count } = await supabase.from(table).select("*", { count: "exact", head: true });
  return count ?? 0;
}

export default async function DashboardPage() {
  await requireAuth(["owner", "planner", "dispatch"]);

  const [blocks, slabs, carving, dispatches] = await Promise.all([
    getCount("blocks"),
    getCount("slab_requirements"),
    getCount("carving_items"),
    getCount("dispatch_logs")
  ]);

  const supabase = await createServerSupabaseClient();
  const { data: pendingSlabs } = await supabase
    .from("slab_requirements")
    .select("id, label, temple, status")
    .order("created_at", { ascending: false })
    .limit(10);

  return (
    <>
      <section className="page-card">
        <h1>Owner Dashboard</h1>
        <p className="muted">Live shared data pulled from Supabase instead of local browser storage.</p>

        <div className="metrics-grid">
          <div className="metric-card">
            <span>Blocks in stock</span>
            <strong>{blocks}</strong>
          </div>
          <div className="metric-card">
            <span>Open slab requirements</span>
            <strong>{slabs}</strong>
          </div>
          <div className="metric-card">
            <span>Carving active</span>
            <strong>{carving}</strong>
          </div>
          <div className="metric-card">
            <span>Dispatched total</span>
            <strong>{dispatches}</strong>
          </div>
        </div>
      </section>

      <section className="page-card" style={{ marginTop: 16 }}>
        <h2>Latest slab requirements</h2>
        <table className="list-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>Label</th>
              <th>Temple</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {(pendingSlabs ?? []).map((item) => (
              <tr key={item.id}>
                <td>{item.id}</td>
                <td>{item.label}</td>
                <td>{item.temple}</td>
                <td>{item.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}
