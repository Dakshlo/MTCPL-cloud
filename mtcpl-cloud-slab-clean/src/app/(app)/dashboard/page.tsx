import { requireAuth } from "@/lib/auth";
import { SLAB_STATUS_LABELS, daysUntil } from "@/lib/slab";
import { createServerSupabaseClient } from "@/lib/supabase/server";

const FOCUS_STATUSES = [
  "entered",
  "ready_for_assignment",
  "assigned",
  "in_progress",
  "completed_pending_approval",
  "approved_ready_to_ship"
] as const;

export default async function DashboardPage() {
  await requireAuth(["owner", "office", "dispatch"]);
  const supabase = await createServerSupabaseClient();

  const [{ data: slabs, error }, { data: vendors }, { data: temples }, { data: dispatches }] = await Promise.all([
    supabase
      .from("slabs")
      .select("id, temple_name, priority, status, assigned_vendor_name, needed_by")
      .order("created_at", { ascending: false }),
    supabase.from("vendors").select("id, name, vendor_type, is_active").eq("is_active", true),
    supabase.from("temples").select("id, name, is_active").eq("is_active", true),
    supabase.from("dispatch_records").select("id, slab_id, loaded_at").order("loaded_at", { ascending: false })
  ]);

  if (error) throw new Error(error.message);

  const slabRows = slabs ?? [];
  const templeRows = temples ?? [];
  const vendorRows = vendors ?? [];
  const dispatchRows = dispatches ?? [];

  const overdue = slabRows.filter((slab) => slab.status !== "dispatched" && (daysUntil(slab.needed_by) ?? 99) < 0).length;
  const pendingApproval = slabRows.filter((slab) => slab.status === "completed_pending_approval").length;
  const readyToShip = slabRows.filter((slab) => slab.status === "approved_ready_to_ship").length;

  const byTemple = templeRows.map((temple) => {
    const count = slabRows.filter((slab) => slab.temple_name === temple.name && slab.status !== "dispatched").length;
    return { name: temple.name, count };
  });

  const byVendor = vendorRows.map((vendor) => {
    const assigned = slabRows.filter((slab) => slab.assigned_vendor_name === vendor.name && ["assigned", "in_progress", "denied_rework"].includes(slab.status)).length;
    const approvals = slabRows.filter((slab) => slab.assigned_vendor_name === vendor.name && slab.status === "completed_pending_approval").length;
    const approved = slabRows.filter((slab) => slab.assigned_vendor_name === vendor.name && slab.status === "approved_ready_to_ship").length;
    const dispatched = dispatchRows.filter((dispatch) =>
      slabRows.some((slab) => slab.id === dispatch.slab_id && slab.assigned_vendor_name === vendor.name)
    ).length;
    return { name: vendor.name, assigned, approvals, approved, dispatched };
  });

  const busiestVendor = byVendor.slice().sort((a, b) => b.assigned - a.assigned)[0];

  return (
    <>
      <section className="page-card dashboard-hero">
        <div className="dashboard-hero-copy">
          <div className="dashboard-chip">Fresh Workflow Board</div>
          <h1>Slab Operations Dashboard</h1>
          <p className="muted">
            This clean rebuild tracks slab intake, readiness, vendor workload, approval pressure, and dispatch readiness without the old cutting baggage.
          </p>
        </div>

        <div className="dashboard-spotlight">
          <span className="muted">Busiest vendor right now</span>
          <strong>{busiestVendor?.name || "No active vendor load"}</strong>
          <p className="muted">
            {busiestVendor ? `${busiestVendor.assigned} slabs are currently sitting in vendor working queues.` : "Once slabs are assigned, the heaviest vendor load will surface here."}
          </p>
        </div>
      </section>

      <section className="metrics-grid inventory-metrics-row">
        <article className="metric-card inventory-metric">
          <span>Active slabs</span>
          <strong>{slabRows.filter((slab) => slab.status !== "dispatched").length}</strong>
          <small>{templeRows.length} live temple streams</small>
        </article>
        <article className="metric-card inventory-metric dashboard-metric-strong">
          <span>Pending approval</span>
          <strong>{pendingApproval}</strong>
          <small>Completed by vendor and waiting for office review</small>
        </article>
        <article className="metric-card inventory-metric">
          <span>Ready to ship</span>
          <strong>{readyToShip}</strong>
          <small>Approved slabs waiting for dispatch entries</small>
        </article>
        <article className="metric-card inventory-metric">
          <span>Overdue slabs</span>
          <strong>{overdue}</strong>
          <small>Items whose needed date has already passed</small>
        </article>
      </section>

      <div className="two-col dashboard-grid">
        <section className="page-card dashboard-panel">
          <div className="section-heading">
            <h2 style={{ margin: 0 }}>Status Pipeline</h2>
            <p className="muted">How much work sits at each stage right now.</p>
          </div>

          <div className="pipeline-grid" style={{ marginTop: 16 }}>
            {FOCUS_STATUSES.map((status) => (
              <article className="pipeline-card" key={status}>
                <span>{SLAB_STATUS_LABELS[status]}</span>
                <strong>{slabRows.filter((slab) => slab.status === status).length}</strong>
              </article>
            ))}
          </div>
        </section>

        <section className="page-card dashboard-panel">
          <div className="section-heading">
            <h2 style={{ margin: 0 }}>Temple Load</h2>
            <p className="muted">A quick read of how much unfinished work each temple currently holds.</p>
          </div>

          <div className="bar-stack" style={{ marginTop: 16 }}>
            {byTemple.map((temple) => (
              <div key={temple.name}>
                <div className="bar-row-head">
                  <strong>{temple.name}</strong>
                  <span className="muted">{temple.count} slabs</span>
                </div>
                <div className="bar-track">
                  <div className="bar-fill" style={{ width: `${Math.max(8, Math.min(100, temple.count * 12))}%` }} />
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>

      <section className="page-card" style={{ marginTop: 16 }}>
        <div className="section-heading">
          <h2 style={{ margin: 0 }}>Vendor Workload</h2>
          <p className="muted">Working queue, pending approvals, approved stock, and dispatched volume per vendor.</p>
        </div>

        <div className="vendor-report-list" style={{ marginTop: 16 }}>
          {byVendor.map((vendor) => (
            <div className="vendor-report-row" key={vendor.name}>
              <div>
                <strong>{vendor.name}</strong>
                <p className="muted" style={{ margin: "4px 0 0" }}>
                  {vendor.assigned} working · {vendor.approvals} pending approval · {vendor.approved} ready to ship
                </p>
              </div>
              <div className="vendor-badges">
                <span className="role-pill">{vendor.assigned} active</span>
                <span className="role-pill">{vendor.approvals} approvals</span>
                <span className="role-pill">{vendor.dispatched} dispatched</span>
              </div>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
