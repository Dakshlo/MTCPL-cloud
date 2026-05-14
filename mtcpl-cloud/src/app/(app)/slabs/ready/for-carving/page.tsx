import Link from "next/link";
import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { ReadySlabsClient } from "../ready-client";

// Carving-team's slab-pickup surface. Sister page to /slabs/ready —
// same table UI, same filters — but the query is locked to
// `status='cut_done'`. The moment a slab gets assigned to carving
// (status → 'carving_assigned'), it drops off THIS view. The cutting
// team's /slabs/ready keeps showing it for verification.
//
// The actual assignment happens on /carving (Unassigned tab). The
// "Assign →" button on each row routes there; we don't duplicate the
// carving-assign modal here.
export default async function ReadyForCarvingPage() {
  await requireAuth(["developer", "owner", "carving_head"]);

  const admin = createAdminSupabaseClient();

  const [{ data, error }, { data: stoneTypeRows }] = await Promise.all([
    admin
      .from("slab_requirements")
      .select(
        "id, label, temple, stone, quality, length_ft, width_ft, thickness_ft, status, priority, created_at, updated_at, source_block_id",
      )
      .eq("status", "cut_done")
      .order("updated_at", { ascending: false }),
    admin.from("stone_types").select("name").order("name"),
  ]);

  if (error) throw new Error(error.message);

  const stoneNames = (stoneTypeRows ?? []).map((s) => s.name);
  const templeNames = [...new Set((data ?? []).map((s) => s.temple))].sort();

  return (
    <>
      <div className="page-header" style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
        <div>
          <h1>Ready for Carving</h1>
          <p className="muted">
            Cut slabs waiting to be assigned to a CNC or manual carving
            vendor. As soon as a slab is assigned, it drops from this
            list — find the full cut history (including assigned /
            in-carving / completed) on <Link href="/slabs/ready" style={{ color: "var(--gold-dark)", fontWeight: 600 }}>Ready Sizes</Link>.
          </p>
        </div>
        <Link
          href="/carving"
          style={{
            textDecoration: "none",
            fontSize: 13,
            padding: "8px 16px",
            background: "var(--gold)",
            color: "#fff",
            border: "1px solid var(--gold-dark)",
            borderRadius: 6,
            fontWeight: 700,
            whiteSpace: "nowrap",
            alignSelf: "flex-start",
          }}
        >
          🎨 Open Carving Jobs →
        </Link>
      </div>

      <ReadySlabsClient
        slabs={data ?? []}
        stoneNames={stoneNames}
        templeNames={templeNames}
        mode="for-carving"
      />
    </>
  );
}
