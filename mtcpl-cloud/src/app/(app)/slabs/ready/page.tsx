import { requireAuth } from "@/lib/auth";
import { createDataClient } from "@/lib/supabase/server";
import { ReadySlabsClient } from "./ready-client";

export default async function ReadySlabsPage() {
  const { profile } = await requireAuth(["owner", "team_head", "slab_entry", "block_slab_entry"]);
  const supabase = await createDataClient(profile.role);

  const { data, error } = await supabase
    .from("slab_requirements")
    .select("id, label, temple, stone, quality, length_ft, width_ft, thickness_ft, status, priority, created_at, updated_at")
    .eq("status", "cut_done")
    .order("updated_at", { ascending: false });

  if (error) throw new Error(error.message);

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Ready Slabs</h1>
          <p className="muted">Slabs that have been cut and are ready for dispatch or use.</p>
        </div>
      </div>
      <ReadySlabsClient slabs={data ?? []} />
    </>
  );
}
