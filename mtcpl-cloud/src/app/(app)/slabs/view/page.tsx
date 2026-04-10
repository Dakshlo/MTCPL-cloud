import { requireAuth } from "@/lib/auth";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { SlabSelector } from "./slab-selector";

export default async function SlabViewPage({
  searchParams,
}: {
  searchParams: Promise<{ temple?: string; stone?: string; priority?: string; status?: string; q?: string }>;
}) {
  await requireAuth(["owner", "planner", "slab_entry"]);
  const supabase = await createServerSupabaseClient();
  const params = await searchParams;

  let query = supabase
    .from("slab_requirements")
    .select("id, label, temple, stone, length_ft, width_ft, thickness_ft, status, priority, created_at")
    .in("status", ["open", "planned"])
    .order("priority", { ascending: false })
    .order("created_at", { ascending: true });

  if (params.temple) query = query.eq("temple", params.temple);
  if (params.stone)  query = query.eq("stone", params.stone);
  if (params.status) query = query.eq("status", params.status);

  const { data: slabs } = await query.limit(1000);
  const { data: temples } = await supabase.from("temples").select("name").eq("is_active", true).order("name");

  const slabList = slabs ?? [];
  const templeNames = (temples ?? []).map(t => t.name);
  const allTemples = [...new Set(slabList.map(s => s.temple))].sort();

  // Client-side text search is handled in SlabSelector
  return (
    <SlabSelector
      slabs={slabList}
      temples={[...new Set([...allTemples, ...templeNames])].sort()}
      activeFilters={params}
    />
  );
}
