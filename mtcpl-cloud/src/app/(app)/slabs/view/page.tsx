import { requireAuth } from "@/lib/auth";
import { createDataClient } from "@/lib/supabase/server";
import { SlabSelector } from "./slab-selector";

export default async function SlabViewPage({
  searchParams,
}: {
  searchParams: Promise<{ temple?: string; stone?: string; priority?: string; status?: string; q?: string; quality?: string }>;
}) {
  // Entry roles (block_entry / slab_entry) cannot access this page
  const { profile } = await requireAuth(["owner", "team_head"]);
  const supabase = await createDataClient(profile.role);
  const params = await searchParams;

  // Default to "open" only; "all" shows open+planned
  const statusParam = params.status ?? "open";

  let query = supabase
    .from("slab_requirements")
    .select("id, label, temple, stone, length_ft, width_ft, thickness_ft, status, priority, quality, created_at")
    .order("priority", { ascending: false })
    .order("created_at", { ascending: true });

  if (statusParam === "all") {
    query = query.in("status", ["open", "planned"]);
  } else if (statusParam === "planned") {
    query = query.eq("status", "planned");
  } else {
    query = query.eq("status", "open");
  }

  if (params.temple) query = query.eq("temple", params.temple);
  if (params.stone)  query = query.eq("stone", params.stone);
  if (params.quality === "A" || params.quality === "B") query = query.eq("quality", params.quality);
  if (params.quality === "none") query = query.is("quality", null);

  const { data: slabs } = await query.limit(1000);

  // Always fetch priority slabs regardless of filter so they always appear
  const { data: urgentSlabs } = await supabase
    .from("slab_requirements")
    .select("id, label, temple, stone, length_ft, width_ft, thickness_ft, status, priority, quality, created_at")
    .eq("priority", true)
    .in("status", ["open", "planned"])
    .order("created_at", { ascending: true });

  // Merge urgent slabs into the list (deduplicate by ID)
  const slabList = (() => {
    const base = slabs ?? [];
    const urgentToAdd = (urgentSlabs ?? []).filter(u => !base.some(s => s.id === u.id));
    return [...urgentToAdd, ...base];
  })();

  const { data: temples } = await supabase.from("temples").select("name").eq("is_active", true).order("name");
  const templeNames = (temples ?? []).map(t => t.name);
  const allTemples = [...new Set(slabList.map(s => s.temple))].sort();

  return (
    <SlabSelector
      slabs={slabList}
      temples={[...new Set([...allTemples, ...templeNames])].sort()}
      activeFilters={{ ...params, status: statusParam }}
    />
  );
}
