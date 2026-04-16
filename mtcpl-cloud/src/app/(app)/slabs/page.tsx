import Link from "next/link";
import { requireAuth } from "@/lib/auth";
import { createDataClient } from "@/lib/supabase/server";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { getProfilesMap } from "@/lib/profiles";
import { AddSlabForm } from "./add-slab-form";
import { SlabGrid } from "./slab-grid";
export default async function SlabsPage() {
  const { profile } = await requireAuth(["owner", "team_head", "slab_entry", "block_slab_entry"]);
  const supabase = await createDataClient(profile.role);
  const admin = createAdminSupabaseClient();

  const [{ data: slabs, error }, { data: temples }, { data: allIds }, { data: stoneTypes }] = await Promise.all([
    supabase
      .from("slab_requirements")
      .select("id, label, temple, stone, quality, length_ft, width_ft, thickness_ft, status, priority, created_at, updated_at, created_by")
      .in("status", ["open", "planned"])
      .order("priority", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(200),
    supabase.from("temples").select("id, name, code_prefix, default_stone").eq("is_active", true).order("name"),
    supabase.from("slab_requirements").select("id"),
    admin.from("stone_types").select("id, name").order("name"),
  ]);

  if (error) throw new Error(error.message);

  const profilesMap = await getProfilesMap();
  const canEdit = ["developer", "owner", "team_head", "slab_entry"].includes(profile.role);
  const slabList = slabs ?? [];
  const templeList = temples ?? [];
  // Fallback: if stone_types query failed, use hardcoded defaults so form still works
  const stoneList = (stoneTypes && stoneTypes.length > 0)
    ? stoneTypes
    : [{ id: "pink", name: "PinkStone" }, { id: "white", name: "WhiteStone" }];
  const existingIds = (allIds ?? []).map(r => r.id);

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

      {/* Add form */}
      {canEdit && templeList.length > 0 && (
        <AddSlabForm temples={templeList} existingIds={existingIds} stoneTypes={stoneList} />
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
        <SlabGrid slabs={slabList} temples={templeList} stoneTypes={stoneList} canEdit={canEdit} profilesMap={profilesMap} />
      )}
    </>
  );
}
