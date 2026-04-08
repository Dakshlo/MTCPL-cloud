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
  const [{ data: pendingSlabs }, { data: blockRows }, { data: vendorRows }, { data: slabRows }] = await Promise.all([
    supabase
      .from("slab_requirements")
      .select("id, label, temple, status")
      .order("created_at", { ascending: false })
      .limit(10),
    supabase.from("blocks").select("id, stone, status"),
    supabase.from("carving_items").select("vendor_name, status, due_at, completed_at"),
    supabase.from("slab_requirements").select("status")
  ]);

  const byStone = (blockRows ?? []).reduce<Record<string, number>>((acc, row) => {
    acc[row.stone] = (acc[row.stone] || 0) + 1;
    return acc;
  }, {});

  const slabPipeline = (slabRows ?? []).reduce<Record<string, number>>((acc, row) => {
    acc[row.status] = (acc[row.status] || 0) + 1;
    return acc;
  }, {});

  const vendorSummary = Object.values(
    (vendorRows ?? []).reduce<Record<string, { name: string; pending: number; active: number; done: number; overdue: number }>>((acc, row) => {
      if (!acc[row.vendor_name]) {
        acc[row.vendor_name] = { name: row.vendor_name, pending: 0, active: 0, done: 0, overdue: 0 };
      }

      if (row.status === "carving_assigned") acc[row.vendor_name].pending += 1;
      if (row.status === "carving_in_progress") acc[row.vendor_name].active += 1;
      if (row.status === "completed" || row.status === "dispatched") acc[row.vendor_name].done += 1;
      if (row.due_at && !row.completed_at && new Date(row.due_at).getTime() < Date.now()) acc[row.vendor_name].overdue += 1;
      return acc;
    }, {})
  ).sort((a, b) => b.done - a.done || b.active - a.active || a.pending - b.pending);

  const topVendor = vendorSummary[0];

  return (
    <>
      <section className="page-card dashboard-hero">
        <div className="dashboard-hero-copy">
          <div className="dashboard-chip">Owner Command Center</div>
          <h1>Performance Dashboard</h1>
          <p className="muted">Track block stock, slab flow, vendor output, and delivery risk from one place.</p>
        </div>

        <div className="dashboard-spotlight">
          <span className="muted">Most productive vendor</span>
          <strong>{topVendor?.name || "No work yet"}</strong>
          <p className="muted">
            {topVendor ? `${topVendor.done} done · ${topVendor.active} active · ${topVendor.pending} pending` : "Assign carving work to start vendor tracking."}
          </p>
        </div>
      </section>

      <section className="metrics-grid dashboard-metrics">
        <div className="metric-card dashboard-metric-strong">
          <span>Total blocks</span>
          <strong>{blocks}</strong>
        </div>
        <div className="metric-card">
          <span>Total slabs</span>
          <strong>{slabs}</strong>
        </div>
        <div className="metric-card">
          <span>Carving items</span>
          <strong>{carving}</strong>
        </div>
        <div className="metric-card">
          <span>Dispatch logs</span>
          <strong>{dispatches}</strong>
        </div>
      </section>

      <section className="two-col dashboard-grid">
        <div className="page-card dashboard-panel">
          <div className="section-heading">
            <h2 style={{ margin: 0 }}>Stock by Stone</h2>
            <p className="muted">Current inventory mix</p>
          </div>

          <div className="bar-stack">
            {Object.entries(byStone).map(([stone, count]) => {
              const max = Math.max(...Object.values(byStone), 1);
              return (
                <div className="bar-row" key={stone}>
                  <div className="bar-row-head">
                    <strong>{stone}</strong>
                    <span>{count}</span>
                  </div>
                  <div className="bar-track">
                    <div className="bar-fill" style={{ width: `${(count / max) * 100}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="page-card dashboard-panel">
          <div className="section-heading">
            <h2 style={{ margin: 0 }}>Slab Pipeline</h2>
            <p className="muted">Where current work is sitting</p>
          </div>

          <div className="pipeline-grid">
            {Object.entries(slabPipeline).map(([status, count]) => (
              <div className="pipeline-card" key={status}>
                <span>{status.replaceAll("_", " ")}</span>
                <strong>{count}</strong>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="two-col dashboard-grid" style={{ marginTop: 16 }}>
        <div className="page-card dashboard-panel">
          <div className="section-heading">
            <h2 style={{ margin: 0 }}>Vendor Performance</h2>
            <p className="muted">Pending, active, done and overdue work</p>
          </div>

          <div className="vendor-report-list">
            {(vendorSummary ?? []).map((vendor) => (
              <div className="vendor-report-row" key={vendor.name}>
                <div>
                  <strong>{vendor.name}</strong>
                  <p className="muted">{vendor.pending} pending · {vendor.active} active · {vendor.done} done</p>
                </div>
                <div className="vendor-badges">
                  <span className="role-pill summary-pill pending-pill">P {vendor.pending}</span>
                  <span className="role-pill summary-pill active-pill">A {vendor.active}</span>
                  <span className="role-pill summary-pill done-pill">D {vendor.done}</span>
                  {vendor.overdue ? <span className="role-pill overdue-pill">Overdue {vendor.overdue}</span> : null}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="page-card dashboard-panel">
          <div className="section-heading">
            <h2 style={{ margin: 0 }}>Latest Slab Requirements</h2>
            <p className="muted">Newest demand entering the pipeline</p>
          </div>
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
        </div>
      </section>
    </>
  );
}
