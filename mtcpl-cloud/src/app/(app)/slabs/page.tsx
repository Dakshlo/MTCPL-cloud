import Link from "next/link";
import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { getProfilesMap } from "@/lib/profiles";
import { AddSlabForm } from "./add-slab-form";
import { SlabGrid } from "./slab-grid";

// Entry roles see only their own additions; senior roles see everything
const ENTRY_ROLES = ["slab_entry", "block_slab_entry"] as const;

export default async function SlabsPage() {
  const { profile } = await requireAuth(["owner", "team_head", "slab_entry", "block_slab_entry"]);
  const admin = createAdminSupabaseClient();

  const isEntryRole = (ENTRY_ROLES as readonly string[]).includes(profile.role);

  // Safety cap — slab_requirements won't realistically exceed this across all
  // open+planned rows. If it ever does, the section heading will still say
  // "N Required Sizes" reflecting what's shown, and we add pagination then.
  // Keep in sync with the planning workbench (`.limit(2000)` in planning/page.tsx)
  // so both pages see the same universe of slabs.
  const SLAB_QUERY_LIMIT = 5000;

  let slabQuery = admin
    .from("slab_requirements")
    .select("id, label, description, temple, stone, quality, length_ft, width_ft, thickness_ft, status, priority, batch_id, created_at, updated_at, created_by")
    .in("status", ["open", "planned"])
    .order("priority", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(SLAB_QUERY_LIMIT);

  // Entry roles see only what they personally added
  if (isEntryRole) slabQuery = slabQuery.eq("created_by", profile.id);

  const [{ data: slabs, error }, { data: temples }, { data: allIds }, { data: stoneTypes }, { data: labelRows }] = await Promise.all([
    slabQuery,
    admin.from("temples").select("id, name, code_prefix, default_stone").eq("is_active", true).order("name"),
    // Supabase's JS client caps .select() at 1000 rows by default. Without
    // an explicit limit, a heavy-batch temple (e.g. ROHTAK with 400+ rows)
    // can fill half the cap on its own and push other temples' high-number
    // IDs off the end — generateSlabCode then misreads MAX and suggests a
    // base-code that's already taken, blowing up with a pkey violation.
    // Explicit high cap keeps us in "fetch everything" territory while
    // leaving room to grow. The ids list is short strings; 100k rows is
    // still under a megabyte of payload.
    admin.from("slab_requirements").select("id").limit(100000),
    admin.from("stone_types").select("id, name").order("name"),
    admin.from("slab_labels").select("name").eq("is_active", true).order("name"),
  ]);

  if (error) throw new Error(error.message);

  const profilesMap = await getProfilesMap();
  const canEdit = ["developer", "owner", "team_head", "slab_entry", "block_slab_entry"].includes(profile.role);
  const slabList = slabs ?? [];
  const templeList = temples ?? [];
  // Fallback: if stone_types query failed, use hardcoded defaults so form still works
  const stoneList = (stoneTypes && stoneTypes.length > 0)
    ? stoneTypes
    : [{ id: "pink", name: "PinkStone" }, { id: "white", name: "WhiteStone" }];
  const existingIds = (allIds ?? []).map(r => r.id);
  const labels = (labelRows ?? []).map(r => r.name);

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
        <AddSlabForm temples={templeList} existingIds={existingIds} stoneTypes={stoneList} labels={labels} />
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
