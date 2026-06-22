import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { fetchUncategorizedOpenSlabs } from "@/lib/uncategorized-slabs";

// Excel record of the OPEN + fully-uncategorized slabs for a temple — the
// exact set the cleanup tool would soft-archive. Download this BEFORE
// removing so there's a permanent record (and a re-import source). Admin only.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED = ["owner", "developer", "senior_incharge"];

function fmtDate(iso: string | null): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric" });
  } catch {
    return "";
  }
}

export async function GET(req: NextRequest) {
  const { profile } = await requireAuth();
  if (!ALLOWED.includes(profile.role)) {
    return new Response("Not authorised", { status: 403 });
  }
  const temple = (new URL(req.url).searchParams.get("temple") ?? "").trim();
  if (!temple) return new Response("Missing temple", { status: 400 });

  const admin = createAdminSupabaseClient();
  const slabs = await fetchUncategorizedOpenSlabs(admin, temple);

  const rows = slabs.map((s) => ({
    "Size Code": s.id,
    "Temple": s.temple,
    "Label": s.label ?? "",
    "Description": s.description ?? "",
    "Additional Description": s.additional_description ?? "",
    "Category 1": s.component_section ?? "",
    "Category 2": s.component_element ?? "",
    "Stone": s.stone ?? "",
    "Quality": s.quality ?? "",
    "Length (in)": s.length_ft ?? "",
    "Width (in)": s.width_ft ?? "",
    "Height (in)": s.thickness_ft ?? "",
    "Priority": s.priority ? "Yes" : "No",
    "Status": s.status,
    "Added Date": fmtDate(s.created_at),
  }));
  // Always emit at least the header row so an empty result still produces a
  // valid file (sheet_to_json on [] gives a blank sheet).
  const ws = rows.length > 0
    ? XLSX.utils.json_to_sheet(rows)
    : XLSX.utils.aoa_to_sheet([[
        "Size Code", "Temple", "Label", "Description", "Additional Description",
        "Category 1", "Category 2", "Stone", "Quality",
        "Length (in)", "Width (in)", "Height (in)", "Priority", "Status", "Added Date",
      ]]);
  ws["!cols"] = [
    { wch: 12 }, { wch: 22 }, { wch: 18 }, { wch: 28 }, { wch: 22 },
    { wch: 16 }, { wch: 16 }, { wch: 13 }, { wch: 9 },
    { wch: 11 }, { wch: 11 }, { wch: 11 }, { wch: 9 }, { wch: 10 }, { wch: 13 },
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Removed Slabs");
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

  const safe = temple.replace(/[^a-z0-9]+/gi, "_") || "temple";
  return new NextResponse(buf, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="uncategorized-open-slabs-${safe}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
