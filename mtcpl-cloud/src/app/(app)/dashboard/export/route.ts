import { NextRequest } from "next/server";

import { requireAuth } from "@/lib/auth";
import { createServerSupabaseClient } from "@/lib/supabase/server";

function escapeXml(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function xmlCell(value: unknown) {
  return `<Cell><Data ss:Type="String">${escapeXml(value)}</Data></Cell>`;
}

function xmlWorksheet(name: string, headers: string[], rows: unknown[][]) {
  const headerRow = `<Row>${headers.map((header) => xmlCell(header)).join("")}</Row>`;
  const dataRows = rows.map((row) => `<Row>${row.map((cell) => xmlCell(cell)).join("")}</Row>`).join("");
  return `<Worksheet ss:Name="${escapeXml(name)}"><Table>${headerRow}${dataRows}</Table></Worksheet>`;
}

function asRange(from: string | null, to: string | null) {
  const fromIso = from ? new Date(`${from}T00:00:00.000Z`).toISOString() : null;
  const toIso = to ? new Date(`${to}T23:59:59.999Z`).toISOString() : null;
  return { fromIso, toIso };
}

function filterQuery<T extends { gte: Function; lte: Function }>(query: T, column: string, fromIso: string | null, toIso: string | null) {
  let next = query;
  if (fromIso) next = next.gte(column, fromIso);
  if (toIso) next = next.lte(column, toIso);
  return next;
}

export async function GET(request: NextRequest) {
  await requireAuth(["owner", "planner", "dispatch"]);
  const supabase = await createServerSupabaseClient();

  const from = request.nextUrl.searchParams.get("from");
  const to = request.nextUrl.searchParams.get("to");
  const { fromIso, toIso } = asRange(from, to);

  const [blocksRes, slabsRes, sessionsRes, cutBlocksRes, carvingRes, dispatchRes] = await Promise.all([
    filterQuery(
      supabase
        .from("blocks")
        .select("id, stone, yard, category, status, length_ft, width_ft, height_ft, trim_left_ft, trim_right_ft, trim_near_ft, trim_far_ft, created_at, updated_at"),
      "created_at",
      fromIso,
      toIso
    ).order("created_at", { ascending: true }),
    filterQuery(
      supabase
        .from("slab_requirements")
        .select("id, label, temple, stone, length_ft, width_ft, thickness_ft, source_block_id, status, created_at, updated_at"),
      "created_at",
      fromIso,
      toIso
    ).order("created_at", { ascending: true }),
    filterQuery(
      supabase
        .from("cut_sessions")
        .select("id, session_code, kerf_mm, status, created_at, approved_at"),
      "created_at",
      fromIso,
      toIso
    ).order("created_at", { ascending: true }),
    filterQuery(
      supabase
        .from("cut_session_blocks")
        .select("id, cut_session_id, block_id, status, restocked_block_id, worker_note, created_at, updated_at"),
      "created_at",
      fromIso,
      toIso
    ).order("created_at", { ascending: true }),
    filterQuery(
      supabase
        .from("carving_items")
        .select("id, slab_requirement_id, vendor_name, vendor_type, status, note, deadline_days, due_at, assigned_at, completed_at"),
      "assigned_at",
      fromIso,
      toIso
    ).order("assigned_at", { ascending: true }),
    filterQuery(
      supabase
        .from("dispatch_logs")
        .select("id, carving_item_id, slab_requirement_id, dispatch_note, dispatched_at"),
      "dispatched_at",
      fromIso,
      toIso
    ).order("dispatched_at", { ascending: true })
  ]);

  const workbook = `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:html="http://www.w3.org/TR/REC-html40">
${xmlWorksheet(
  "Blocks",
  ["ID", "Stone", "Yard", "Category", "Status", "Length ft", "Width ft", "Height ft", "Trim L", "Trim R", "Trim N", "Trim F", "Created At", "Updated At"],
  (blocksRes.data ?? []).map((row) => [
    row.id,
    row.stone,
    row.yard,
    row.category,
    row.status,
    row.length_ft,
    row.width_ft,
    row.height_ft,
    row.trim_left_ft,
    row.trim_right_ft,
    row.trim_near_ft,
    row.trim_far_ft,
    row.created_at,
    row.updated_at
  ])
)}
${xmlWorksheet(
  "Slabs",
  ["ID", "Label", "Temple", "Stone", "Length ft", "Width ft", "Thickness ft", "Source Block", "Status", "Created At", "Updated At"],
  (slabsRes.data ?? []).map((row) => [
    row.id,
    row.label,
    row.temple,
    row.stone,
    row.length_ft,
    row.width_ft,
    row.thickness_ft,
    row.source_block_id,
    row.status,
    row.created_at,
    row.updated_at
  ])
)}
${xmlWorksheet(
  "Cut Sessions",
  ["Session ID", "Session Code", "Kerf mm", "Status", "Created At", "Approved At"],
  (sessionsRes.data ?? []).map((row) => [row.id, row.session_code, row.kerf_mm, row.status, row.created_at, row.approved_at])
)}
${xmlWorksheet(
  "Cut Blocks",
  ["Record ID", "Cut Session ID", "Block ID", "Status", "Restocked Block", "Worker Note", "Created At", "Updated At"],
  (cutBlocksRes.data ?? []).map((row) => [
    row.id,
    row.cut_session_id,
    row.block_id,
    row.status,
    row.restocked_block_id,
    row.worker_note,
    row.created_at,
    row.updated_at
  ])
)}
${xmlWorksheet(
  "Carving",
  ["Record ID", "Slab ID", "Vendor", "Vendor Type", "Status", "Note", "Deadline Days", "Due At", "Assigned At", "Completed At"],
  (carvingRes.data ?? []).map((row) => [
    row.id,
    row.slab_requirement_id,
    row.vendor_name,
    row.vendor_type,
    row.status,
    row.note,
    row.deadline_days,
    row.due_at,
    row.assigned_at,
    row.completed_at
  ])
)}
${xmlWorksheet(
  "Dispatch",
  ["Record ID", "Carving Item ID", "Slab ID", "Dispatch Note", "Dispatched At"],
  (dispatchRes.data ?? []).map((row) => [row.id, row.carving_item_id, row.slab_requirement_id, row.dispatch_note, row.dispatched_at])
)}
</Workbook>`;

  const stamp = new Date().toISOString().slice(0, 10);
  return new Response(workbook, {
    headers: {
      "Content-Type": "application/vnd.ms-excel; charset=utf-8",
      "Content-Disposition": `attachment; filename="mtcpl-dashboard-export-${stamp}.xls"`
    }
  });
}
