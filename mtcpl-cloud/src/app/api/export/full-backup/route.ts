import { NextResponse } from "next/server";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import * as XLSX from "xlsx";

// Allow this route to take longer than the default 10s — full backup can run
// 20-40s on a database with 50k+ rows.
export const maxDuration = 300; // 5 minutes
export const dynamic = "force-dynamic";

// Developer-only full system backup — every business-critical table in raw
// DB format, ready to INSERT directly back into Supabase via the Table
// Editor's "Insert from CSV/Excel" if data is ever lost.
//
// IMPORTANT: PostgREST caps each query at 1000 rows by default (the
// db-max-rows setting). Without `.range()` pagination, slab_requirements
// silently truncated at row 1000 and the backup was useless. Every fetch
// here uses `fetchAllPages()` which loops in 1000-row chunks until the
// table is fully drained.
export async function GET() {
  // ── Auth ─────────────────────────────────────────────────────────
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (profile?.role !== "developer") {
    return NextResponse.json({ error: "Forbidden — developer only" }, { status: 403 });
  }

  const admin = createAdminSupabaseClient();

  // ── Pagination helper ────────────────────────────────────────────
  // Drains a table 1000 rows at a time. Stops as soon as a page returns
  // fewer than `PAGE_SIZE` rows (= last page) so we never spin forever.
  // Hard-capped at 500k rows total per table to be safe.
  const PAGE_SIZE = 1000;
  const HARD_CAP = 500_000;

  async function fetchAllPages<T = Record<string, unknown>>(
    table: string,
    columns: string = "*",
    orderColumn: string | null = "created_at",
  ): Promise<T[]> {
    const out: T[] = [];
    for (let offset = 0; offset < HARD_CAP; offset += PAGE_SIZE) {
      let q = admin.from(table).select(columns);
      if (orderColumn) q = q.order(orderColumn, { ascending: true });
      const { data, error } = await q.range(offset, offset + PAGE_SIZE - 1);
      if (error) {
        // Don't fail the whole backup if one table errors (e.g. column
        // doesn't exist on this branch). Log and move on with what we have.
        console.warn(`[backup] ${table} page ${offset}: ${error.message}`);
        break;
      }
      if (!data || data.length === 0) break;
      out.push(...(data as unknown as T[]));
      if (data.length < PAGE_SIZE) break;
    }
    return out;
  }

  // ── Fetch every table in parallel ────────────────────────────────
  // Tables grouped by domain. Order matches sheet order in the workbook.
  const [
    blocks,
    slabRequirements,
    slabLabels,
    cutSessions,
    cutSessionBlocks,
    cutSessionSlabs,
    marbleTruckEntries,
    dispatches,
    dispatchLogs,
    carvingItems,
    carvingJobEvents,
    cncMachines,
    temples,
    vendors,
    stoneTypes,
    profiles,
    auditLogs,
  ] = await Promise.all([
    fetchAllPages("blocks"),
    fetchAllPages("slab_requirements"),
    fetchAllPages("slab_labels"),
    fetchAllPages("cut_sessions"),
    fetchAllPages("cut_session_blocks"),
    fetchAllPages("cut_session_slabs"),
    fetchAllPages("marble_truck_entries"),
    fetchAllPages("dispatches"),
    fetchAllPages("dispatch_logs"),
    fetchAllPages("carving_items"),
    fetchAllPages("carving_job_events"),
    fetchAllPages("cnc_machines"),
    fetchAllPages("temples", "*", "name"),
    fetchAllPages("vendors", "*", "name"),
    fetchAllPages("stone_types", "*", "name"),
    fetchAllPages(
      "profiles",
      "id, full_name, phone, role, is_active, created_at, updated_at, last_seen_at",
      "full_name",
    ),
    fetchAllPages("audit_logs"),
  ]);

  // ── Sheet builder ────────────────────────────────────────────────
  // Flattens JSONB / array columns to JSON strings so Excel can display
  // them and so re-import via Supabase Table Editor preserves structure
  // (the editor parses JSON strings into JSONB on insert).
  function makeSheet(rows: Record<string, unknown>[]) {
    if (!rows || rows.length === 0) {
      // Empty sheet still gets one placeholder row so Supabase import
      // doesn't choke on a totally blank sheet.
      return XLSX.utils.json_to_sheet([{ _empty: "" }]);
    }
    const flat = rows.map((row) =>
      Object.fromEntries(
        Object.entries(row).map(([k, v]) => [
          k,
          v === null || v === undefined
            ? ""
            : typeof v === "object"
              ? JSON.stringify(v)
              : v,
        ]),
      ),
    );
    return XLSX.utils.json_to_sheet(flat);
  }

  // ── Build workbook ───────────────────────────────────────────────
  const wb = XLSX.utils.book_new();

  // First sheet = a small manifest so the user can verify completeness
  // at a glance. Lists every table with its row count and the export
  // timestamp. If a sheet says "1547 rows" and Excel shows 1547, the
  // backup is good. If Excel shows 1000, we're hitting the truncation
  // bug again.
  const exportedAt = new Date().toISOString();
  const manifest = [
    { table: "blocks", rows: blocks.length },
    { table: "slab_requirements", rows: slabRequirements.length },
    { table: "slab_labels", rows: slabLabels.length },
    { table: "cut_sessions", rows: cutSessions.length },
    { table: "cut_session_blocks", rows: cutSessionBlocks.length },
    { table: "cut_session_slabs", rows: cutSessionSlabs.length },
    { table: "marble_truck_entries", rows: marbleTruckEntries.length },
    { table: "dispatches", rows: dispatches.length },
    { table: "dispatch_logs", rows: dispatchLogs.length },
    { table: "carving_items", rows: carvingItems.length },
    { table: "carving_job_events", rows: carvingJobEvents.length },
    { table: "cnc_machines", rows: cncMachines.length },
    { table: "temples", rows: temples.length },
    { table: "vendors", rows: vendors.length },
    { table: "stone_types", rows: stoneTypes.length },
    { table: "profiles", rows: profiles.length },
    { table: "audit_logs", rows: auditLogs.length },
  ];
  const totalRows = manifest.reduce((s, m) => s + m.rows, 0);
  const manifestSheet = XLSX.utils.json_to_sheet([
    { table: "_exported_at", rows: exportedAt },
    { table: "_total_rows", rows: totalRows },
    { table: "", rows: "" },
    ...manifest,
  ]);
  XLSX.utils.book_append_sheet(wb, manifestSheet, "_manifest");

  // Data sheets — sheet name = table name so re-import is a one-click
  // operation in Supabase Table Editor.
  XLSX.utils.book_append_sheet(wb, makeSheet(blocks), "blocks");
  XLSX.utils.book_append_sheet(wb, makeSheet(slabRequirements), "slab_requirements");
  XLSX.utils.book_append_sheet(wb, makeSheet(slabLabels), "slab_labels");
  XLSX.utils.book_append_sheet(wb, makeSheet(cutSessions), "cut_sessions");
  XLSX.utils.book_append_sheet(wb, makeSheet(cutSessionBlocks), "cut_session_blocks");
  XLSX.utils.book_append_sheet(wb, makeSheet(cutSessionSlabs), "cut_session_slabs");
  XLSX.utils.book_append_sheet(wb, makeSheet(marbleTruckEntries), "marble_truck_entries");
  XLSX.utils.book_append_sheet(wb, makeSheet(dispatches), "dispatches");
  XLSX.utils.book_append_sheet(wb, makeSheet(dispatchLogs), "dispatch_logs");
  XLSX.utils.book_append_sheet(wb, makeSheet(carvingItems), "carving_items");
  XLSX.utils.book_append_sheet(wb, makeSheet(carvingJobEvents), "carving_job_events");
  XLSX.utils.book_append_sheet(wb, makeSheet(cncMachines), "cnc_machines");
  XLSX.utils.book_append_sheet(wb, makeSheet(temples), "temples");
  XLSX.utils.book_append_sheet(wb, makeSheet(vendors), "vendors");
  XLSX.utils.book_append_sheet(wb, makeSheet(stoneTypes), "stone_types");
  XLSX.utils.book_append_sheet(wb, makeSheet(profiles), "profiles");
  XLSX.utils.book_append_sheet(wb, makeSheet(auditLogs), "audit_logs");

  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

  const ts = exportedAt.replace(/[:.]/g, "-").slice(0, 19);
  const filename = `mtcpl-full-backup-${ts}.xlsx`;

  return new NextResponse(buf, {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
      // Surface the row totals to the auto-backup component so it can
      // log "backed up N rows" without re-parsing the workbook.
      "X-Backup-Total-Rows": String(totalRows),
      "X-Backup-Tables": String(manifest.length),
    },
  });
}
