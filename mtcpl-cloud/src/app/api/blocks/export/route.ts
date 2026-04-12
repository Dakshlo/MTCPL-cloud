import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import * as XLSX from "xlsx";

export async function GET(req: NextRequest) {
  const supabase = await createServerSupabaseClient();

  const { searchParams } = req.nextUrl;
  const from = searchParams.get("from") || "";
  const to = searchParams.get("to") || "";

  let query = supabase
    .from("blocks")
    .select("id, stone, yard, category, length_ft, width_ft, height_ft, status, truck_no, vendor_name, bill_no, created_at, updated_at")
    .order("created_at", { ascending: false });

  if (from) query = query.gte("created_at", from + "T00:00:00Z");
  if (to) query = query.lte("created_at", to + "T23:59:59Z");

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const rows = (data ?? []).map(b => {
    const l = Number(b.length_ft), w = Number(b.width_ft), h = Number(b.height_ft);
    const cft = ((l * w * h) / 1728).toFixed(2);
    function fmtDate(iso: string | null) {
      if (!iso) return "";
      return new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
    }
    return {
      "Block Code": b.id,
      "Stone": b.stone,
      "Yard": b.yard,
      "Category": b.category,
      "Length (in)": l,
      "Width (in)": w,
      "Height (in)": h,
      "Volume (CFT)": Number(cft),
      "Status": b.status,
      "Truck No.": b.truck_no ?? "",
      "Vendor / Supplier": b.vendor_name ?? "",
      "Bill No.": b.bill_no ?? "",
      "Added Date": fmtDate(b.created_at),
      "Last Updated": fmtDate(b.updated_at),
    };
  });

  const ws = XLSX.utils.json_to_sheet(rows);

  // Column widths
  ws["!cols"] = [
    { wch: 18 }, // Block Code
    { wch: 12 }, // Stone
    { wch: 6 },  // Yard
    { wch: 10 }, // Category
    { wch: 12 }, // Length
    { wch: 12 }, // Width
    { wch: 12 }, // Height
    { wch: 14 }, // CFT
    { wch: 12 }, // Status
    { wch: 16 }, // Truck No.
    { wch: 22 }, // Vendor
    { wch: 16 }, // Bill No.
    { wch: 14 }, // Added Date
    { wch: 14 }, // Updated
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Blocks");

  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

  const fromLabel = from || "all";
  const toLabel = to || "all";
  const filename = `blocks-${fromLabel}-to-${toLabel}.xlsx`;

  return new NextResponse(buf, {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
