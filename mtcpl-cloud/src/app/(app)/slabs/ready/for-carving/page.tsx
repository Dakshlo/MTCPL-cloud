import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { getProfilesMap } from "@/lib/profiles";
import { canAccessCarvingPage } from "@/lib/cutting-permissions";
import { CockpitSidebarToggle } from "@/components/cockpit-sidebar-toggle";
import { CarvingStockClient, type StockSlab, type ColorKind } from "./carving-stock-client";

// ──────────────────────────────────────────────────────────────────
// Ready Sizes Stock — read-only carving stock board (Daksh, June 2026)
//
// Reworked from the old cut_done assign-table into a temple-grouped,
// colour-coded card board for the carving department. Shows EVERY live
// slab on the system (any status except broken/rejected) and colours
// each card by who it's assigned to:
//   normal = unassigned · blue = CNC vendor · yellow = outsource vendor
//   · greyed = carving done.
// Read-only — the assign workflow still lives on /carving (Carving Jobs).
// ──────────────────────────────────────────────────────────────────

export const dynamic = "force-dynamic";

// Statuses a slab can carry while it's still "alive". We deliberately
// drop `rejected` (broken during carving) — it's not stock the carving
// team can act on.
const ALIVE_STATUSES = [
  "open",
  "planned",
  "cutting",
  "cut_done",
  "carving_assigned",
  "carving_in_progress",
  "completed",
  "dispatched",
] as const;
const DONE_STATUSES = new Set(["completed", "dispatched"]);

export default async function ReadyForCarvingPage() {
  const { profile } = await requireAuth();
  if (!canAccessCarvingPage(profile)) redirect("/");

  const admin = createAdminSupabaseClient();

  type SlabRow = {
    id: string;
    label: string | null;
    description: string | null;
    temple: string;
    stone: string | null;
    quality: string | null;
    length_ft: number;
    width_ft: number;
    thickness_ft: number;
    status: string;
    priority: boolean | null;
    created_at: string | null;
    updated_at: string | null;
    created_by: string | null;
    source_block_id: string | null;
  };

  // Paginated fetch — PostgREST caps a single query at 1000 rows; the
  // open backlog alone is several thousand. Walk 1000-row pages.
  async function fetchAllSlabs(): Promise<SlabRow[]> {
    const PAGE = 1000;
    const MAX = 60000;
    const out: SlabRow[] = [];
    for (let offset = 0; offset < MAX; offset += PAGE) {
      const { data, error } = await admin
        .from("slab_requirements")
        .select(
          "id, label, description, temple, stone, quality, length_ft, width_ft, thickness_ft, status, priority, created_at, updated_at, created_by, source_block_id",
        )
        .in("status", ALIVE_STATUSES)
        .order("created_at", { ascending: false })
        .range(offset, offset + PAGE - 1);
      if (error) throw new Error(error.message);
      if (!data || data.length === 0) break;
      out.push(...(data as SlabRow[]));
      if (data.length < PAGE) break;
    }
    return out;
  }

  // carving_items denormalises vendor_name + vendor_type, so no join
  // needed. One row per slab (slab_requirement_id is unique).
  type CarvingRow = {
    slab_requirement_id: string;
    vendor_name: string | null;
    vendor_type: "CNC" | "Outsource" | null;
    status: string | null;
    completed_at: string | null;
    review_approved_at: string | null;
  };
  async function fetchAllCarving(): Promise<CarvingRow[]> {
    const PAGE = 1000;
    const MAX = 60000;
    const out: CarvingRow[] = [];
    for (let offset = 0; offset < MAX; offset += PAGE) {
      const { data, error } = await admin
        .from("carving_items")
        .select("slab_requirement_id, vendor_name, vendor_type, status, completed_at, review_approved_at")
        .range(offset, offset + PAGE - 1);
      if (error) throw new Error(error.message);
      if (!data || data.length === 0) break;
      out.push(...(data as CarvingRow[]));
      if (data.length < PAGE) break;
    }
    return out;
  }

  const [slabRows, carvingRows, profilesMap] = await Promise.all([
    fetchAllSlabs(),
    fetchAllCarving(),
    getProfilesMap(),
  ]);

  // Map: slabId → carving assignment (authoritative).
  const carvingBySlab = new Map<string, CarvingRow>();
  for (const c of carvingRows) {
    if (c.slab_requirement_id) carvingBySlab.set(c.slab_requirement_id, c);
  }

  // Outsource pre-cut work orders — fills in slabs assigned to an
  // outside vendor before they reach a carving_item. Skip cancelled
  // lines + cancelled/rejected work orders.
  const woVendorBySlab = new Map<string, string>();
  {
    const { data: woItems } = await admin
      .from("carving_work_order_items")
      .select("slab_requirement_id, line_status, carving_work_orders(vendor_name, status)")
      .neq("line_status", "cancelled")
      .not("slab_requirement_id", "is", null);
    for (const r of (woItems ?? []) as Array<{
      slab_requirement_id: string | null;
      carving_work_orders:
        | { vendor_name: string | null; status: string | null }
        | { vendor_name: string | null; status: string | null }[]
        | null;
    }>) {
      const sid = r.slab_requirement_id;
      if (!sid) continue;
      const wo = Array.isArray(r.carving_work_orders) ? r.carving_work_orders[0] : r.carving_work_orders;
      if (!wo || wo.status === "cancelled" || wo.status === "rejected") continue;
      if (wo.vendor_name && !woVendorBySlab.has(sid)) woVendorBySlab.set(sid, wo.vendor_name);
    }
  }

  const slabs: StockSlab[] = slabRows.map((s) => {
    const ci = carvingBySlab.get(s.id);
    const woVendor = woVendorBySlab.get(s.id) ?? null;
    const done = DONE_STATUSES.has(s.status) || !!ci?.review_approved_at;

    let colorKind: ColorKind;
    let vendorName: string | null = null;
    if (done) {
      colorKind = "done";
      vendorName = ci?.vendor_name ?? null;
    } else if (ci?.vendor_type === "CNC") {
      colorKind = "cnc";
      vendorName = ci.vendor_name;
    } else if (ci?.vendor_type === "Outsource" || woVendor) {
      colorKind = "outsource";
      vendorName = ci?.vendor_name ?? woVendor;
    } else {
      colorKind = "normal";
    }

    return {
      id: s.id,
      label: s.label ?? "",
      description: s.description,
      temple: s.temple,
      stone: s.stone,
      quality: s.quality,
      length_ft: s.length_ft,
      width_ft: s.width_ft,
      thickness_ft: s.thickness_ft,
      status: s.status,
      priority: s.priority ?? false,
      created_at: s.created_at,
      updated_at: s.updated_at,
      created_by: s.created_by,
      source_block_id: s.source_block_id,
      colorKind,
      vendorName,
    };
  });

  return (
    <>
      {profile.role === "vendor" && profile.can_assign_carving === true && (
        <CockpitSidebarToggle defaultCollapsed={false} />
      )}

      <div className="page-header" style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
        <div>
          <h1>Ready Sizes Stock</h1>
          <p className="muted" style={{ margin: "2px 0 0", fontSize: 13 }}>
            Every live slab on the system, temple-wise — colour-coded by who it&apos;s assigned to. Read-only.
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

      <CarvingStockClient slabs={slabs} profilesMap={profilesMap} />
    </>
  );
}
