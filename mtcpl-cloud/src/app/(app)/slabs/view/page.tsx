import { requireAuth } from "@/lib/auth";
import { createDataClient } from "@/lib/supabase/server";
import { SlabSelector } from "./slab-selector";

export default async function SlabViewPage({
  searchParams,
}: {
  searchParams: Promise<{ temple?: string; stone?: string; priority?: string; status?: string; q?: string; quality?: string }>;
}) {
  // Entry roles (block_entry / slab_entry) cannot access this page
  const { profile } = await requireAuth(["owner", "team_head", "senior_incharge"]);
  const supabase = await createDataClient(profile.role);
  const params = await searchParams;

  // Default to "open" only; "all" shows open+planned
  const statusParam = params.status ?? "open";

  // Paginated fetch — Supabase's PostgREST enforces a server-side
  // db-max-rows=1000 cap. Single .limit() calls over that silently
  // truncate, hiding older temples' slabs. Loop in 1000-row pages.
  type SlabRow = {
    id: string; label: string; temple: string; stone: string | null;
    length_ft: number; width_ft: number; thickness_ft: number;
    status: string; priority: boolean | null; priority_note: string | null;
    quality: string | null; created_at: string | null;
  };
  async function fetchAllSlabs(): Promise<SlabRow[]> {
    const PAGE = 1000;
    const CAP = 50000;
    const all: SlabRow[] = [];
    for (let offset = 0; offset < CAP; offset += PAGE) {
      let q = supabase
        .from("slab_requirements")
        .select("id, label, temple, stone, length_ft, width_ft, thickness_ft, status, priority, priority_note, quality, created_at")
        .order("priority", { ascending: false })
        .order("created_at", { ascending: true })
        .range(offset, offset + PAGE - 1);
      if (statusParam === "all") {
        q = q.in("status", ["open", "planned"]);
      } else if (statusParam === "planned") {
        q = q.eq("status", "planned");
      } else {
        q = q.eq("status", "open");
      }
      if (params.temple) q = q.eq("temple", params.temple);
      if (params.stone) q = q.eq("stone", params.stone);
      if (params.quality === "A" || params.quality === "B") q = q.eq("quality", params.quality);
      if (params.quality === "none") q = q.is("quality", null);

      const { data, error } = await q;
      if (error) throw new Error(error.message);
      if (!data || data.length === 0) break;
      all.push(...(data as SlabRow[]));
      if (data.length < PAGE) break;
    }
    return all;
  }
  const slabs = await fetchAllSlabs();

  // Pinned urgent section — respects the currently-active status filter
  // so urgent slabs rise to the top of whatever view the user is in.
  //   • Open tab    → pinned = urgent-open   (nothing to accidentally re-plan)
  //   • Planned tab → pinned = urgent-planned (quick visibility of priority work-in-progress)
  //   • Both tab    → pinned = both          (urgent-everything at the top)
  // The query intentionally ignores stone/temple/quality/search filters
  // so urgent slabs always show even when the user narrows by other
  // dimensions — that was the original purpose of this side-fetch.
  const urgentStatusIn =
    statusParam === "all"     ? ["open", "planned"] :
    statusParam === "planned" ? ["planned"] :
                                ["open"];

  const { data: urgentSlabs } = await supabase
    .from("slab_requirements")
    .select("id, label, temple, stone, length_ft, width_ft, thickness_ft, status, priority, priority_note, quality, created_at")
    .eq("priority", true)
    .in("status", urgentStatusIn)
    .order("created_at", { ascending: true });

  // Merge urgent slabs into the list (deduplicate by ID)
  const slabList = (() => {
    const base = slabs ?? [];
    const urgentToAdd = (urgentSlabs ?? []).filter(u => !base.some(s => s.id === u.id));
    return [...urgentToAdd, ...base];
  })();

  const [{ data: temples }, { data: stoneTypes }] = await Promise.all([
    supabase.from("temples").select("name").eq("is_active", true).order("name"),
    supabase.from("stone_types").select("name").order("sort_order").order("name"),
  ]);
  const templeNames = (temples ?? []).map(t => t.name);
  const allTemples = [...new Set(slabList.map(s => s.temple))].sort();
  const stoneNames = (stoneTypes ?? []).map(s => s.name);

  return (
    <SlabSelector
      slabs={slabList}
      temples={[...new Set([...allTemples, ...templeNames])].sort()}
      activeFilters={{ ...params, status: statusParam }}
      stoneNames={stoneNames.length > 0 ? stoneNames : undefined}
    />
  );
}
