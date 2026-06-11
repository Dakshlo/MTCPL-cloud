import { redirect } from "next/navigation";
import Link from "next/link";
import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { getProfilesMap } from "@/lib/profiles";
import { canReadRequiredSizes } from "@/lib/cutting-permissions";
import { SlabGrid } from "./slab-grid";
import { SlabSearchBar } from "./slab-search-bar";
import { ImportBatchesButton, type ImportBatch, type ImportBatchRowPreview } from "./import-batches-button";

// Entry roles see only their own additions; senior roles see everything
const ENTRY_ROLES = ["slab_entry", "block_slab_entry"] as const;

export default async function SlabsPage() {
  // Gate via canReadRequiredSizes — entry roles + senior roles. The
  // helper is in cutting-permissions so other surfaces (block detail,
  // slab forms) can share the same audience.
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
  // Mig 076 — senior_incharge has the same slab edit access as
  // team_head (Rajesh-tier; was inherited from his prior role).
  const canEdit = ["developer", "owner", "team_head", "senior_incharge", "slab_entry", "block_slab_entry"].includes(profile.role);
  // Excel bulk import is gated to the slab-write roles (matches the
  // /slabs/import page's ALLOWED) — block_slab_entry adds via the block
  // flow, not here, so it doesn't get the button.
  const canImport = ["developer", "owner", "team_head", "senior_incharge", "slab_entry"].includes(profile.role);
  const slabList = slabs;
  const templeList = temples ?? [];
  // Fallback: if stone_types query failed, use hardcoded defaults so form still works
  const stoneList = (stoneTypes && stoneTypes.length > 0)
    ? stoneTypes
    : [{ id: "pink", name: "PinkStone" }, { id: "white", name: "WhiteStone" }];
  const labels = (labelRows ?? []).map(r => r.name);

  // Mig 122 — import batches for the 🗂 Batches modal (newest first).
  // Entry roles see their own submissions; senior roles see everything.
  let batchQuery = admin
    .from("slab_import_batches")
    .select("id, temple, stone, rows, row_count, slab_count, file_name, status, submitted_by, submitted_at, reviewed_by, reviewed_at, review_note")
    .order("submitted_at", { ascending: false })
    .limit(40);
  if (isEntryRole) batchQuery = batchQuery.eq("submitted_by", profile.id);
  const { data: batchRows } = await batchQuery;
  type BatchRow = {
    id: string; temple: string; stone: string; rows: ImportBatchRowPreview[] | null;
    row_count: number | null; slab_count: number | null; file_name: string | null;
    status: string; submitted_by: string | null; submitted_at: string | null;
    reviewed_by: string | null; reviewed_at: string | null; review_note: string | null;
  };
  const importBatches: ImportBatch[] = ((batchRows ?? []) as BatchRow[]).map((b) => ({
    id: b.id,
    temple: b.temple,
    stone: b.stone,
    rows: Array.isArray(b.rows) ? b.rows : [],
    rowCount: b.row_count ?? 0,
    slabCount: b.slab_count ?? 0,
    fileName: b.file_name,
    status: (["pending", "approved", "rejected"].includes(b.status) ? b.status : "pending") as ImportBatch["status"],
    submittedByName: b.submitted_by ? (profilesMap[b.submitted_by] ?? null) : null,
    submittedAt: b.submitted_at,
    reviewedByName: b.reviewed_by ? (profilesMap[b.reviewed_by] ?? null) : null,
    reviewedAt: b.reviewed_at,
    reviewNote: b.review_note,
  }));

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Required Sizes</h1>
          <p className="muted">Track required sizes by temple. Use View Inventory to select and send to planning.</p>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {canImport && (
            <Link href="/slabs/import" className="secondary-button">
              📥 Import from Excel
            </Link>
          )}
          {/* Mig 122 — all import batches (pending approval / approved /
              rejected) with row preview + Excel download. */}
          {(canImport || ["carving_head"].includes(profile.role)) && (
            <ImportBatchesButton batches={importBatches} />
          )}
          <Link href="/slabs/view" className="secondary-button">
            View Inventory →
          </Link>
        </div>
      </div>

      {/* Mig 122 — the manual Add-Slab form is retired. Slabs are added
          ONLY via Import from Excel, and each import needs approval from
          owner / senior incharge / carving head before the slabs appear. */}
      {canImport && (
        <div className="banner">
          ➕ Adding slabs now goes through <strong>📥 Import from Excel</strong> — fill the template, upload, review,
          and the batch is sent for <strong>approval</strong> (owner / senior incharge / carving head). Slabs appear
          here once approved. Track every batch under <strong>🗂 Batches</strong>.
        </div>
      )}
      {canEdit && templeList.length === 0 && (
        <div className="banner">
          No temples configured yet.{" "}
          <Link href="/settings" style={{ color: "var(--gold-dark)", fontWeight: 600 }}>
            Go to Settings → Temple Codes
          </Link>{" "}
          to add temples before importing slabs.
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
            ? "You haven't added any slab requirements yet. Use 📥 Import from Excel above."
            : "No open slabs yet. Use 📥 Import from Excel above — slabs appear once the batch is approved."}
        </div>
      ) : (
        <SlabGrid slabs={slabList} temples={templeList} stoneTypes={stoneList} canEdit={canEdit} profilesMap={profilesMap} labels={labels} />
      )}
    </>
  );
}
