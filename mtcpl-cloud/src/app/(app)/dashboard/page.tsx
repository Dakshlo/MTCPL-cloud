import { requireAuth } from "@/lib/auth";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export default async function DashboardPage() {
  await requireAuth(["owner", "planner", "dispatch", "carving_assigner"]);

  const supabase = await createServerSupabaseClient();
  const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();

  const [
    { count: totalBlocks },
    { count: availableBlocks },
    { count: reservedBlocks },
    { count: openSlabs },
    { count: activeSessions },
    { data: onlineUsers }
  ] = await Promise.all([
    supabase.from("blocks").select("*", { count: "exact", head: true }),
    supabase.from("blocks").select("*", { count: "exact", head: true }).eq("status", "available"),
    supabase.from("blocks").select("*", { count: "exact", head: true }).eq("status", "reserved"),
    supabase.from("slab_requirements").select("*", { count: "exact", head: true }).eq("status", "open"),
    supabase.from("cut_sessions").select("*", { count: "exact", head: true }).eq("status", "in_progress"),
    supabase.from("profiles").select("id, full_name, role").gte("last_seen_at", fiveMinAgo)
  ]);

  const metrics = [
    { label: "Fresh Blocks",         value: availableBlocks ?? 0,  hint: "Ready for planning",       accent: "accent-green" },
    { label: "Slabs in Queue",      value: openSlabs ?? 0,         hint: "Open requirements",        accent: "accent-orange" },
    { label: "Active Cut Sessions", value: activeSessions ?? 0,    hint: "Currently in progress",    accent: "accent-blue" },
    { label: "Used Blocks",         value: reservedBlocks ?? 0,    hint: "Committed to sessions",    accent: "" }
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

      {/* Who's online */}
      <div style={{ marginTop: 20, padding: "12px 16px", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#22c55e", display: "inline-block", boxShadow: "0 0 0 2px #dcfce7" }} />
          <strong style={{ fontSize: 13 }}>
            {(onlineUsers ?? []).length === 0 ? "No one else online" : `${(onlineUsers ?? []).length} user${(onlineUsers ?? []).length > 1 ? "s" : ""} online now`}
          </strong>
        </span>
        {(onlineUsers ?? []).map(u => (
          <span key={u.id} className="role-pill" style={{ fontSize: 11 }}>
            {u.full_name || "—"} · {u.role.replace("_", " ")}
          </span>
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
