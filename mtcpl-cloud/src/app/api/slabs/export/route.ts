import { NextRequest, NextResponse } from "next/server";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { POST_CUT_STATUSES } from "@/lib/slab-statuses";
import { cutDoneDateByBlock } from "@/lib/cut-done-date";
import * as XLSX from "xlsx";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const admin = createAdminSupabaseClient();

  const { searchParams } = req.nextUrl;
  const stone   = searchParams.get("stone")   || "";
  const temple  = searchParams.get("temple")  || "";
  const quality = searchParams.get("quality") || "";
  const search  = searchParams.get("search")  || "";
  const from    = searchParams.get("from")    || "";
  const to      = searchParams.get("to")      || "";

  // Match the in-app /slabs/ready page: a slab is part of "ready sizes"
  // verification list from the moment it's cut all the way through
  // dispatch (including broken/rejected). Filtering to cut_done only
  // would silently drop slabs the moment they enter carving — see
  // MT-B-246 bug. POST_CUT_STATUSES is the shared canonical set.
  type Row = {
    id: string; label: string | null; temple: string; stone: string | null; quality: string | null;
    length_ft: number; width_ft: number; thickness_ft: number; status: string; priority: boolean;
    source_block_id: string | null; created_at: string | null; updated_at: string | null;
  };

  // Paginated fetch — PostgREST caps a single select at 1000 rows, so the
  // export was silently truncating. Column filters run in the query; the
  // date range is applied below against the DERIVED cut date (not updated_at).
  const all: Row[] = [];
  const PAGE = 1000;
  for (let offset = 0; offset < 50000; offset += PAGE) {
    let query = admin
      .from("slab_requirements")
      .select("id, label, temple, stone, quality, length_ft, width_ft, thickness_ft, status, priority, source_block_id, created_at, updated_at")
      .in("status", POST_CUT_STATUSES)
      .order("id")
      .range(offset, offset + PAGE - 1);
    if (stone)  query = query.eq("stone", stone);
    if (temple) query = query.eq("temple", temple);
    if (quality === "A" || quality === "B") query = query.eq("quality", quality);
    const { data, error } = await query;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!data || data.length === 0) break;
    all.push(...(data as Row[]));
    if (data.length < PAGE) break;
  }

  // Real cut-done date (NOT updated_at, which moves on every later edit).
  const cutDates = await cutDoneDateByBlock(admin, all.map((s) => s.source_block_id));
  const cutDoneOf = (s: Row): string | null =>
    (s.source_block_id ? cutDates.get(s.source_block_id) : undefined) ?? s.created_at ?? s.updated_at;

  function fmtDate(iso: string | null) {
    if (!iso) return "";
    return new Date(iso).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric" });
  }

  // Filter by the REAL cut date, then search/quality.
  let slabs = all;
  if (from) slabs = slabs.filter((s) => { const c = cutDoneOf(s); return !!c && c >= from + "T00:00:00Z"; });
  if (to)   slabs = slabs.filter((s) => { const c = cutDoneOf(s); return !!c && c <= to + "T23:59:59Z"; });
  if (search) {
    const q = search.toLowerCase();
    slabs = slabs.filter((s) =>
      (s.id ?? "").toLowerCase().includes(q) ||
      (s.label ?? "").toLowerCase().includes(q) ||
      (s.temple ?? "").toLowerCase().includes(q) ||
      (s.stone ?? "").toLowerCase().includes(q),
    );
  }
  if (quality === "none") slabs = slabs.filter((s) => !s.quality);

  const rows = slabs.map((s) => {
    const l = Number(s.length_ft), w = Number(s.width_ft), t = Number(s.thickness_ft);
    const cft = ((l * w * t) / 1728).toFixed(2);
    return {
      "Size Code":       s.id,
      "Temple":          s.temple,
      "Label":           s.label ?? "",
      "Stone":           s.stone ?? "",
      "Quality":         s.quality ?? "",
      "Length (in)":     l,
      "Width (in)":      w,
      "Thickness (in)":  t,
      "Volume (CFT)":    Number(cft),
      "Priority":        s.priority ? "Yes" : "No",
      "Added Date":      fmtDate(s.created_at),
      "Cut Done Date":   fmtDate(cutDoneOf(s)),
    };
  });

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
