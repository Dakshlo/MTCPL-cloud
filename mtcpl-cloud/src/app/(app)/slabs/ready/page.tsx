import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { ReadySlabsClient } from "./ready-client";

// Per Daksh's note: the Ready Sizes page is the cutting team's
// VERIFICATION view — "what we cut, what came out of which block."
// Previously the query was `status='cut_done'` only, which made
// slabs vanish the moment the carving team picked them up. That
// broke the cutting team's audit ability — they couldn't go back
// and check whether yesterday's MT-B-248 actually produced 11 slabs.
//
// New behaviour: include EVERY post-cut status in the query so a
// slab stays visible from the moment it's cut all the way through
// dispatch. The status badge on each row makes the current
// lifecycle position obvious; a status filter on the client lets
// the cutting team narrow to "just cut" / "in carving" /
// "completed" / etc.
//
// The carving team's ASSIGNMENT workflow lives at
// /slabs/ready/for-carving (sidebar label "Ready Sizes Stock",
// under the CARVING section). That page queries cut_done only —
// slabs drop from that view as soon as they're assigned.
const POST_CUT_STATUSES = [
  "cut_done",
  "carving_assigned",
  "carving_in_progress",
  "completed",
  "dispatched",
];

export default async function ReadySlabsPage() {
  const { profile } = await requireAuth(["owner", "team_head", "block_slab_entry", "carving_head"]);
  void profile;

  const admin = createAdminSupabaseClient();

  const [{ data, error }, { data: stoneTypeRows }] = await Promise.all([
    admin
      .from("slab_requirements")
      .select(
        "id, label, temple, stone, quality, length_ft, width_ft, thickness_ft, status, priority, created_at, updated_at, source_block_id",
      )
      .in("status", POST_CUT_STATUSES)
      .order("updated_at", { ascending: false }),
    admin.from("stone_types").select("name").order("name"),
  ]);

  if (error) throw new Error(error.message);

  const stoneNames = (stoneTypeRows ?? []).map((s) => s.name);
  const templeNames = [...new Set((data ?? []).map((s) => s.temple))].sort();

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Total Ready Sizes</h1>
          <p className="muted">
            Cutting verification — the complete list of slabs cut from any block,
            sorted by most-recent. Lifecycle status is in the Status column;
            filter by date / vendor / stone / grade or export to Excel. For the
            actionable bucket-by-bucket view (cut → carving → completed), use{" "}
            <strong>Ready Sizes Stock</strong> in the sidebar.
          </p>
        </div>
      </div>

      <ReadySlabsClient
        slabs={data ?? []}
        stoneNames={stoneNames}
        templeNames={templeNames}
        mode="verification"
      />
    </>
  );
}
