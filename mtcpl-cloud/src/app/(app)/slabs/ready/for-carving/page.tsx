import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { POST_CUT_STATUSES } from "@/lib/slab-statuses";
import { canAccessCarvingPage } from "@/lib/cutting-permissions";
import { CockpitSidebarToggle } from "@/components/cockpit-sidebar-toggle";
import { ReadySlabsClient } from "../ready-client";

// Carving team's slab-pickup + lifecycle-bucket view. Sister page to
// /slabs/ready (Total Ready Sizes) — same query (POST_CUT_STATUSES),
// same table UI, plus the lifecycle filter chip row at the top so the
// carving team can flip between buckets:
//
//   "Cut · awaiting carving" — default. The pickable bucket.
//                              "Assign →" button on each row.
//   "Carving assigned"       — already given to a vendor. No action.
//   "Being carved"           — vendor is working on it.
//   "Carving done"           — back from vendor, ready to dispatch.
//   "Dispatched"             — gone.
//   "Broken / rejected"      — destroyed during carving. Audit only.
//
// Total Ready Sizes drops the chip row (just a flat list); this page
// keeps it so the carving team has the at-a-glance breakdown.

export default async function ReadyForCarvingPage() {
  // Mig 074 round 2 — widen the gate so vendor-with-flag (Mohit) can
  // reach this page from the sidebar. Page itself is read + Assign;
  // the Assign action posts to /carving where the same flag check
  // applies on the action.
  const { profile } = await requireAuth();
  if (!canAccessCarvingPage(profile)) redirect("/");

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
      {/* Mig 074 — vendor-with-flag (Mohit) needs the same Hide menu
          affordance as on the cockpit / carving page, since this page
          is now in his sidebar. Default = expanded so the sidebar stays
          visible until he taps to hide. */}
      {profile.role === "vendor" && profile.can_assign_carving === true && (
        <CockpitSidebarToggle defaultCollapsed={false} />
      )}

      <div className="page-header" style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
        <div>
          <h1>Ready Sizes Stock</h1>
          <p className="muted">
            Carving team&apos;s stockpile view, bucketed by lifecycle.
            Default lands on <strong>Cut · awaiting carving</strong> —
            click any other chip above the table to peek at slabs
            already assigned, being carved, completed, or dispatched.
            Assign → routes to <Link href="/carving" style={{ color: "var(--gold-dark)", fontWeight: 600 }}>Carving Jobs</Link>.
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
