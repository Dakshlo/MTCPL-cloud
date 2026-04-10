import { requireAuth } from "@/lib/auth";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export default async function DashboardPage() {
  await requireAuth(["owner", "planner", "dispatch", "carving_assigner"]);

  const supabase = await createServerSupabaseClient();

  const [
    { count: totalBlocks },
    { count: availableBlocks },
    { count: reservedBlocks },
    { count: openSlabs },
    { count: activeSessions }
  ] = await Promise.all([
    supabase.from("blocks").select("*", { count: "exact", head: true }),
    supabase.from("blocks").select("*", { count: "exact", head: true }).eq("status", "available"),
    supabase.from("blocks").select("*", { count: "exact", head: true }).eq("status", "reserved"),
    supabase.from("slab_requirements").select("*", { count: "exact", head: true }).eq("status", "open"),
    supabase.from("cut_sessions").select("*", { count: "exact", head: true }).eq("status", "in_progress")
  ]);

  const metrics = [
    { label: "Available Blocks",    value: availableBlocks ?? 0,  hint: "Ready for planning",       accent: "accent-green" },
    { label: "Slabs in Queue",      value: openSlabs ?? 0,         hint: "Open requirements",        accent: "accent-orange" },
    { label: "Active Cut Sessions", value: activeSessions ?? 0,    hint: "Currently in progress",    accent: "accent-blue" },
    { label: "Blocks Reserved",     value: reservedBlocks ?? 0,    hint: "Committed to sessions",    accent: "" }
  ];

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Dashboard</h1>
          <p className="muted">Live overview of your stone inventory and workflow status.</p>
        </div>
      </div>

      <div className="metrics-row">
        {metrics.map(m => (
          <div className={`metric-card ${m.accent}`} key={m.label}>
            <span>{m.label}</span>
            <strong>{m.value}</strong>
            <small>{m.hint}</small>
          </div>
        ))}
      </div>

      {totalBlocks === 0 && openSlabs === 0 ? (
        <div className="banner" style={{ marginTop: 8 }}>
          No data yet. Start by adding blocks to your inventory on the <strong>Blocks</strong> page.
        </div>
      ) : null}
    </>
  );
}
