import { redirect } from "next/navigation";
import Link from "next/link";
import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { getProfilesMap } from "@/lib/profiles";
import { canReadRequiredSizes } from "@/lib/cutting-permissions";
import { AddSlabForm } from "./add-slab-form";
import { SlabGrid } from "./slab-grid";
import { SlabSearchBar } from "./slab-search-bar";

// Entry roles see only their own additions; senior roles see everything
const ENTRY_ROLES = ["slab_entry", "block_slab_entry"] as const;

export default async function SlabsPage() {
  // Mig 074 — gate via canReadRequiredSizes so vendor-with-flag
  // (e.g. Mohit) gets read access in addition to the original
  // entry / senior roles. canReadRequiredSizes encapsulates the
  // role + flag check.
  const { profile } = await requireAuth();
  if (!canReadRequiredSizes(profile)) redirect("/");
  const admin = createAdminSupabaseClient();

  const isEntryRole = (ENTRY_ROLES as readonly string[]).includes(profile.role);

  // Safety cap — outer ceiling on the paginated fetcher below. Realistic
  // open+planned slab count won't approach this; the cap just prevents an
  // infinite loop if something goes sideways.
  const SLAB_QUERY_LIMIT = 50000;

  // Paginated slab fetch — Supabase's PostgREST enforces a server-side
  // db-max-rows cap (1000 on this project). Client-side .limit(5000) is
  // silently truncated to 1000, and since we ORDER BY newest-first, the
  // oldest temples' slabs fall off the bottom once the total grows. That
  // broke /slabs: after crossing ~1000 open+planned slabs, older temples
  // (MAHAKALI, AASTA, AASTHALAXMI, SALASAR, …) vanished from the page
  // even though their rows still exist in the DB.
  //
  // Fix: fetch in 1000-row pages using .range() until we've got everything.
  type SlabRow = {
    id: string; label: string; description?: string | null;
    temple: string; stone: string | null; quality: string | null;
    length_ft: number; width_ft: number; thickness_ft: number;
    status: string; priority: boolean; batch_id?: string | null;
    created_at: string | null; updated_at: string | null; created_by: string | null;
  };
  async function fetchAllOpenSlabs(): Promise<SlabRow[]> {
    const PAGE = 1000;
    const all: SlabRow[] = [];
    for (let offset = 0; offset < SLAB_QUERY_LIMIT; offset += PAGE) {
      let q = admin
        .from("slab_requirements")
        .select("id, label, description, temple, stone, quality, length_ft, width_ft, thickness_ft, status, priority, batch_id, created_at, updated_at, created_by")
        .in("status", ["open", "planned"])
        .order("priority", { ascending: false })
        .order("created_at", { ascending: false })
        .range(offset, offset + PAGE - 1);
      if (isEntryRole) q = q.eq("created_by", profile.id);
      const { data, error: pageErr } = await q;
      if (pageErr) throw new Error(pageErr.message);
      if (!data || data.length === 0) break;
      // Coerce nullable columns to the non-null shape SlabGrid expects
      for (const row of data) {
        all.push({
          ...(row as SlabRow),
          label: (row as { label: string | null }).label ?? "",
          priority: (row as { priority: boolean | null }).priority ?? false,
        });
      }
      if (data.length < PAGE) break; // last page, short
    }
    return all;
  }

  const [slabs, { data: temples }, { data: stoneTypes }, { data: labelRows }] = await Promise.all([
    fetchAllOpenSlabs(),
    admin.from("temples").select("id, name, code_prefix, default_stone").eq("is_active", true).order("name"),
    admin.from("stone_types").select("id, name").order("name"),
    admin.from("slab_labels").select("name").eq("is_active", true).order("name"),
  ]);

  const profilesMap = await getProfilesMap();
  const canEdit = ["developer", "owner", "team_head", "slab_entry", "block_slab_entry"].includes(profile.role);
  const slabList = slabs;
  const templeList = temples ?? [];
  // Fallback: if stone_types query failed, use hardcoded defaults so form still works
  const stoneList = (stoneTypes && stoneTypes.length > 0)
    ? stoneTypes
    : [{ id: "pink", name: "PinkStone" }, { id: "white", name: "WhiteStone" }];
  const labels = (labelRows ?? []).map(r => r.name);

  // Per-prefix highest-ID lookup for the "next code" form preview.
  // Fetched one row per prefix via ORDER BY id DESC LIMIT 1 — this
  // sidesteps Supabase's PostgREST db-max-rows cap (which truncates
  // any .select() over 1000 rows) by only asking for exactly one row
  // per temple. Even with 10k+ slabs across all temples, this is
  // ~10 parallel single-row queries. Zero-padded 4-digit numeric
  // component means string DESC == numeric DESC.
  const uniquePrefixes = [...new Set(templeList.map(t => t.code_prefix).filter(Boolean))];
  const maxIdByPrefixEntries = await Promise.all(
    uniquePrefixes.map(async (pfx) => {
      const { data } = await admin
        .from("slab_requirements")
        .select("id")
        .like("id", `${pfx}-%`)
        .order("id", { ascending: false })
        .limit(1)
        .maybeSingle();
      return [pfx, data?.id ?? null] as const;
    })
  );
  const maxIdByPrefix: Record<string, string | null> = Object.fromEntries(maxIdByPrefixEntries);

  const totalOpen = slabList.filter(s => s.status === "open").length;
  const priorityCount = slabList.filter(s => s.priority).length;
  const templeGroups = [...new Set(slabList.map(s => s.temple))].length;

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Required Sizes</h1>
          <p className="muted">Track required sizes by temple. Use View Inventory to select and send to planning.</p>
        </div>
        <Link href="/slabs/view" className="secondary-button">
          View Inventory →
        </Link>
      </div>

      {/* Add form */}
      {canEdit && templeList.length > 0 && (
        <AddSlabForm temples={templeList} maxIdByPrefix={maxIdByPrefix} stoneTypes={stoneList} labels={labels} />
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

      {/* Search bar — sits between the AddSlabForm and the slab grid.
          Collapsed by default; click to open a center-peek modal that
          searches across id / label / temple / stone / dimensions. */}
      {slabList.length > 0 && (
        <SlabSearchBar slabs={slabList} />
      )}

      {/* Inventory */}
      <div className="section-heading">
        <div>
          <h2>{slabList.length} Required Sizes</h2>
          <p>
            {isEntryRole
              ? "Showing only sizes you added · Click to edit"
              : "Priority first · Click to edit · Or use View Inventory to send to Plan Generator"}
          </p>
        </div>
      </div>

      {slabList.length === 0 ? (
        <div className="banner">
          {isEntryRole
            ? "You haven't added any slab requirements yet. Add your first one above."
            : "No open slabs yet. Add your first slab requirement above."}
        </div>
      ) : (
        <SlabGrid slabs={slabList} temples={templeList} stoneTypes={stoneList} canEdit={canEdit} profilesMap={profilesMap} labels={labels} />
      )}
    </>
  );
}
