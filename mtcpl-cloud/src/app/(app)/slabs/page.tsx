import Link from "next/link";
import { requireAuth } from "@/lib/auth";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { AddSlabForm } from "./add-slab-form";
import { SlabGrid } from "./slab-grid";
import { generateSlabCode } from "./utils";

export default async function SlabsPage() {
  const { profile } = await requireAuth(["owner", "planner", "slab_entry", "block_entry"]);
  const supabase = await createServerSupabaseClient();

  const [{ data: slabs, error }, { data: temples }, { data: allIds }] = await Promise.all([
    supabase
      .from("slab_requirements")
      .select("id, label, temple, stone, length_ft, width_ft, thickness_ft, status, priority, created_at")
      .in("status", ["open", "planned"])
      .order("priority", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(200),
    supabase.from("temples").select("id, name, code_prefix").eq("is_active", true).order("name"),
    supabase.from("slab_requirements").select("id"),
  ]);

  if (error) throw new Error(error.message);

  const canEdit = ["owner", "planner", "slab_entry"].includes(profile.role);
  const slabList = slabs ?? [];
  const templeList = temples ?? [];
  const existingIds = (allIds ?? []).map(r => r.id);

  // Function to generate next code for a given prefix (passed to client)
  const suggestedCode = (prefix: string) => generateSlabCode(existingIds, prefix);

  const totalOpen = slabList.filter(s => s.status === "open").length;
  const priorityCount = slabList.filter(s => s.priority).length;
  const templeGroups = [...new Set(slabList.map(s => s.temple))].length;

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Slab Requirements</h1>
          <p className="muted">Track slab orders by temple. Use View Inventory to select and send to planning.</p>
        </div>
        <Link href="/slabs/view" className="secondary-button">
          View Inventory →
        </Link>
      </div>

      {/* Metrics */}
      <div className="metrics-row">
        <div className="metric-card accent-orange">
          <span>Open Slabs</span>
          <strong>{totalOpen}</strong>
          <small>awaiting planning</small>
        </div>
        <div className="metric-card">
          <span>Priority</span>
          <strong>{priorityCount}</strong>
          <small>marked urgent</small>
        </div>
        <div className="metric-card">
          <span>Temples</span>
          <strong>{templeGroups}</strong>
          <small>active groups</small>
        </div>
        <div className="metric-card accent-blue">
          <span>Planned</span>
          <strong>{slabList.filter(s => s.status === "planned").length}</strong>
          <small>in sessions</small>
        </div>
      </div>

      {/* Add form */}
      {canEdit && templeList.length > 0 && (
        <AddSlabForm temples={templeList} suggestedCode={suggestedCode} />
      )}
      {canEdit && templeList.length === 0 && (
        <div className="banner">
          No temples configured yet.{" "}
          <Link href="/settings" style={{ color: "var(--gold-dark)", fontWeight: 600 }}>
            Go to Settings → Temple Codes
          </Link>{" "}
          to add temples before entering slabs.
        </div>
      )}

      {/* Inventory */}
      <div className="section-heading">
        <div>
          <h2>{slabList.length} Slabs</h2>
          <p>Priority first · Click to edit · Or use View Inventory to send to Plan Generator</p>
        </div>
      </div>

      {slabList.length === 0 ? (
        <div className="banner">No open slabs yet. Add your first slab requirement above.</div>
      ) : (
        <SlabGrid slabs={slabList} temples={templeList} canEdit={canEdit} />
      )}
    </>
  );
}
