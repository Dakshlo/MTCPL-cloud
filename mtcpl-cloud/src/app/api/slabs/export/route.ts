import { NextRequest, NextResponse } from "next/server";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import * as XLSX from "xlsx";

export async function GET(req: NextRequest) {
  const admin = createAdminSupabaseClient();

  const { searchParams } = req.nextUrl;
  const stone   = searchParams.get("stone")   || "";
  const temple  = searchParams.get("temple")  || "";
  const quality = searchParams.get("quality") || "";
  const search  = searchParams.get("search")  || "";
  const from    = searchParams.get("from")    || "";
  const to      = searchParams.get("to")      || "";

  let query = admin
    .from("slab_requirements")
    .select("id, label, temple, stone, quality, length_ft, width_ft, thickness_ft, priority, created_at, updated_at")
    .eq("status", "cut_done")
    .order("updated_at", { ascending: false });

  if (stone)  query = query.eq("stone", stone);
  if (temple) query = query.eq("temple", temple);
  if (quality === "A" || quality === "B") query = query.eq("quality", quality);
  if (from)   query = query.gte("updated_at", from + "T00:00:00Z");
  if (to)     query = query.lte("updated_at", to + "T23:59:59Z");

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  function fmtDate(iso: string | null) {
    if (!iso) return "";
    return new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
  }

  let rows = (data ?? []).map(s => {
    const l = Number(s.length_ft), w = Number(s.width_ft), t = Number(s.thickness_ft);
    const cft = ((l * w * t) / 1728).toFixed(2);
    return {
      "Size Code":       s.id,
      "Temple":          s.temple,
      "Label":           s.label,
      "Stone":           s.stone ?? "",
      "Quality":         s.quality ?? "",
      "Length (in)":     l,
      "Width (in)":      w,
      "Thickness (in)":  t,
      "Volume (CFT)":    Number(cft),
      "Priority":        s.priority ? "Yes" : "No",
      "Added Date":      fmtDate(s.created_at),
      "Cut Done Date":   fmtDate(s.updated_at),
    };
  });

  // Client-side search filter (if passed)
  if (search) {
    const q = search.toLowerCase();
    rows = rows.filter(r =>
      r["Size Code"].toLowerCase().includes(q) ||
      r["Label"].toLowerCase().includes(q) ||
      r["Temple"].toLowerCase().includes(q) ||
      r["Stone"].toLowerCase().includes(q)
    );
  }

  if (quality === "none") {
    rows = rows.filter(r => !r["Quality"]);
  }

  const ws = XLSX.utils.json_to_sheet(rows);

  ws["!cols"] = [
    { wch: 18 }, // Size Code
    { wch: 28 }, // Temple
    { wch: 20 }, // Label
    { wch: 12 }, // Stone
    { wch: 10 }, // Quality
    { wch: 12 }, // Length
    { wch: 12 }, // Width
    { wch: 14 }, // Thickness
    { wch: 14 }, // CFT
    { wch: 10 }, // Priority
    { wch: 14 }, // Added Date
    { wch: 14 }, // Cut Done Date
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Ready Sizes");

  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

  const fromLabel = from || "all";
  const toLabel   = to   || "all";
  const filename  = `ready-sizes-${fromLabel}-to-${toLabel}.xlsx`;

  return new NextResponse(buf, {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
