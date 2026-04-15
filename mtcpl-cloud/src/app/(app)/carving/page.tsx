import Link from "next/link";
import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { CarvingDashboardClient } from "./dashboard-client";

type Tab = "unassigned" | "active" | "review" | "done";

export default async function CarvingDashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  await requireAuth(["developer"]);
  const admin = createAdminSupabaseClient();
  const params = await searchParams;
  const tab: Tab = (params.tab as Tab) || "unassigned";

  // Load everything we need for all tabs in parallel
  const [
    { data: unassignedSlabs },
    { data: activeJobs },
    { data: reviewJobs },
    { data: doneJobs },
    { data: vendors },
    { data: machines },
  ] = await Promise.all([
    admin
      .from("slab_requirements")
      .select("id, label, temple, stone, length_ft, width_ft, thickness_ft, status, priority, source_block_id")
      .eq("status", "cut_done")
      .order("priority", { ascending: false })
      .order("created_at", { ascending: true })
      .limit(500),
    admin
      .from("carving_items")
      .select("id, slab_requirement_id, vendor_id, vendor_name, vendor_type, status, due_at, assigned_at, completed_at, progress_phase, cnc_machine_id")
      .in("status", ["carving_assigned", "carving_in_progress"])
      .order("assigned_at", { ascending: false }),
    admin
      .from("carving_items")
      .select("id, slab_requirement_id, vendor_id, vendor_name, vendor_type, status, due_at, assigned_at, completed_at, cnc_machine_id")
      .not("completed_at", "is", null)
      .is("review_approved_at", null)
      .order("completed_at", { ascending: false }),
    admin
      .from("carving_items")
      .select("id, slab_requirement_id, vendor_id, vendor_name, vendor_type, status, due_at, assigned_at, completed_at, review_approved_at, cnc_machine_id")
      .not("review_approved_at", "is", null)
      .order("review_approved_at", { ascending: false })
      .limit(200),
    admin
      .from("vendors")
      .select("id, name, vendor_type, is_active")
      .eq("is_active", true)
      .order("name"),
    admin
      .from("cnc_machines")
      .select("id, vendor_id, machine_code, is_active")
      .eq("is_active", true),
  ]);

  // Enrich vendors with their machines
  const vendorsEnriched = (vendors ?? []).map((v) => ({
    id: v.id,
    name: v.name,
    vendor_type: v.vendor_type as "CNC" | "Manual",
    machines: (machines ?? []).filter((m) => m.vendor_id === v.id).map((m) => ({
      id: m.id,
      machine_code: m.machine_code,
    })),
  }));

  // Build a machine-code map for display
  const machineCodeById = new Map<string, string>();
  for (const m of machines ?? []) machineCodeById.set(m.id, m.machine_code);

  const counts = {
    unassigned: (unassignedSlabs ?? []).length,
    active: (activeJobs ?? []).length,
    review: (reviewJobs ?? []).length,
    done: (doneJobs ?? []).length,
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20, paddingBottom: 32 }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <h1 style={{ margin: 0, fontSize: 22 }}>Carving Jobs</h1>
            <span className="role-pill" style={{ background: "var(--gold)", color: "#fff", fontWeight: 700, fontSize: 10 }}>
              DEV-ONLY
            </span>
          </div>
          <p className="muted" style={{ margin: "4px 0 0", fontSize: 13 }}>
            Phase 2 module · assign cut slabs to carving vendors, track progress, approve and dispatch
          </p>
        </div>
        <Link
          href="/carving/vendors"
          className="ghost-button"
          style={{ fontSize: 12, padding: "6px 14px", textDecoration: "none" }}
        >
          Manage Vendors →
        </Link>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 2, borderBottom: "2px solid var(--border)" }}>
        {([
          { key: "unassigned", label: "Unassigned", count: counts.unassigned, color: "#D97706" },
          { key: "active", label: "Active", count: counts.active, color: "#2563EB" },
          { key: "review", label: "Awaiting Review", count: counts.review, color: "#DC2626" },
          { key: "done", label: "Approved / Dispatched", count: counts.done, color: "#16A34A" },
        ] as Array<{ key: Tab; label: string; count: number; color: string }>).map((t) => {
          const active = tab === t.key;
          return (
            <Link
              key={t.key}
              href={`/carving?tab=${t.key}`}
              style={{
                textDecoration: "none",
                padding: "10px 18px",
                fontSize: 13,
                fontWeight: active ? 700 : 500,
                color: active ? t.color : "var(--muted)",
                borderBottom: active ? `2px solid ${t.color}` : "2px solid transparent",
                marginBottom: -2,
                display: "flex",
                alignItems: "center",
                gap: 8,
              }}
            >
              {t.label}
              <span
                style={{
                  fontSize: 11,
                  padding: "1px 8px",
                  borderRadius: 10,
                  background: active ? `${t.color}15` : "var(--surface-alt)",
                  color: active ? t.color : "var(--muted)",
                  fontWeight: 700,
                }}
              >
                {t.count}
              </span>
            </Link>
          );
        })}
      </div>

      {/* Tab content */}
      <CarvingDashboardClient
        tab={tab}
        unassignedSlabs={unassignedSlabs ?? []}
        activeJobs={activeJobs ?? []}
        reviewJobs={reviewJobs ?? []}
        doneJobs={doneJobs ?? []}
        vendors={vendorsEnriched}
        machineCodeById={Object.fromEntries(machineCodeById)}
      />
    </div>
  );
}
