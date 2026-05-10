import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { ReadySlabsClient } from "./ready-client";

export default async function ReadySlabsPage() {
  const { profile } = await requireAuth(["owner", "team_head", "block_slab_entry", "carving_head"]);
  void profile;

  const admin = createAdminSupabaseClient();

  const [{ data, error }, { data: stoneTypeRows }, { data: templeRows }] = await Promise.all([
    admin
      .from("slab_requirements")
      .select("id, label, temple, stone, quality, length_ft, width_ft, thickness_ft, status, priority, created_at, updated_at")
      .eq("status", "cut_done")
      .order("updated_at", { ascending: false }),
    admin.from("stone_types").select("name").order("name"),
    admin.from("temples").select("name").eq("is_active", true).order("name"),
  ]);

  if (error) throw new Error(error.message);

  const stoneNames = (stoneTypeRows ?? []).map(s => s.name);
  const templeNames = [...new Set((data ?? []).map(s => s.temple))].sort();

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Ready Sizes</h1>
          <p className="muted">Full inventory of cut-done sizes — filter, sort and export to Excel.</p>
        </div>
      </div>

      <ReadySlabsClient
        slabs={data ?? []}
        stoneNames={stoneNames}
        templeNames={templeNames}
      />
    </>
  );
}
