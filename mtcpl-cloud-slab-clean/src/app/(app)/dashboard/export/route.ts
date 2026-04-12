import { NextRequest } from "next/server";

import { requireAuth } from "@/lib/auth";
import { createServerSupabaseClient } from "@/lib/supabase/server";

function escapeCsv(value: unknown) {
  const text = String(value ?? "");
  if (/[",\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function csvSheet(title: string, headers: string[], rows: unknown[][]) {
  const sheetHeader = `# ${title}\n`;
  const headerLine = `${headers.map(escapeCsv).join(",")}\n`;
  const body = rows.map((row) => row.map(escapeCsv).join(",")).join("\n");
  return `${sheetHeader}${headerLine}${body}\n\n`;
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
  await requireAuth(["owner", "office", "dispatch"]);
  const supabase = await createServerSupabaseClient();

  const from = request.nextUrl.searchParams.get("from");
  const to = request.nextUrl.searchParams.get("to");
  const { fromIso, toIso } = asRange(from, to);

  const [templesRes, vendorsRes, slabsRes, photosRes, approvalRes, dispatchRes] = await Promise.all([
    supabase.from("temples").select("name, code_prefix, is_active, display_order").order("display_order"),
    supabase.from("vendors").select("name, vendor_type, is_active").order("name"),
    filterQuery(
      supabase
        .from("slabs")
        .select("slab_code, temple_name, component, group_name, stone_type, length_decimal_ft, width_decimal_ft, thickness_decimal_ft, cubic_ft, priority, needed_by, status, assigned_vendor_name, outside_price, created_at, updated_at"),
      "created_at",
      fromIso,
      toIso
    ).order("created_at"),
    filterQuery(
      supabase
        .from("vendor_completion_photos")
        .select("slab_id, file_path, file_url, uploaded_at"),
      "uploaded_at",
      fromIso,
      toIso
    ).order("uploaded_at"),
    filterQuery(
      supabase
        .from("approval_reviews")
        .select("slab_id, decision, review_note, reviewed_at"),
      "reviewed_at",
      fromIso,
      toIso
    ).order("reviewed_at"),
    filterQuery(
      supabase
        .from("dispatch_records")
        .select("slab_id, truck_no, site_name, dispatch_note, loaded_at"),
      "loaded_at",
      fromIso,
      toIso
    ).order("loaded_at")
  ]);

  const output =
    csvSheet(
      "Temples",
      ["Temple", "Prefix", "Active", "Display Order"],
      (templesRes.data ?? []).map((row) => [row.name, row.code_prefix, row.is_active, row.display_order])
    ) +
    csvSheet(
      "Vendors",
      ["Vendor", "Type", "Active"],
      (vendorsRes.data ?? []).map((row) => [row.name, row.vendor_type, row.is_active])
    ) +
    csvSheet(
      "Slabs",
      ["Code", "Temple", "Component", "Group", "Stone", "Length ft", "Width ft", "Thickness ft", "Cubic ft", "Priority", "Needed By", "Status", "Assigned Vendor", "Outside Price", "Created At", "Updated At"],
      (slabsRes.data ?? []).map((row) => [
        row.slab_code,
        row.temple_name,
        row.component,
        row.group_name,
        row.stone_type,
        row.length_decimal_ft,
        row.width_decimal_ft,
        row.thickness_decimal_ft,
        row.cubic_ft,
        row.priority,
        row.needed_by,
        row.status,
        row.assigned_vendor_name,
        row.outside_price,
        row.created_at,
        row.updated_at
      ])
    ) +
    csvSheet(
      "Vendor Photos",
      ["Slab ID", "File Path", "File URL", "Uploaded At"],
      (photosRes.data ?? []).map((row) => [row.slab_id, row.file_path, row.file_url, row.uploaded_at])
    ) +
    csvSheet(
      "Approvals",
      ["Slab ID", "Decision", "Review Note", "Reviewed At"],
      (approvalRes.data ?? []).map((row) => [row.slab_id, row.decision, row.review_note, row.reviewed_at])
    ) +
    csvSheet(
      "Dispatch",
      ["Slab ID", "Truck No", "Site Name", "Dispatch Note", "Loaded At"],
      (dispatchRes.data ?? []).map((row) => [row.slab_id, row.truck_no, row.site_name, row.dispatch_note, row.loaded_at])
    );

  const stamp = new Date().toISOString().slice(0, 10);
  return new Response(output, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="mtcpl-cloud-slab-export-${stamp}.csv"`
    }
  });
}
