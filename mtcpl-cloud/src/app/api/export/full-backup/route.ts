import { NextResponse } from "next/server";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import * as XLSX from "xlsx";

// Developer-only full system backup — all tables in raw DB format,
// ready to INSERT directly back into Supabase.
export async function GET() {
  // Auth check — must be developer
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

  // Fetch all tables in parallel
  const [
    { data: blocks },
    { data: slabs },
    { data: cutSessions },
    { data: cutSessionBlocks },
    { data: cutSessionSlabs },
    { data: temples },
    { data: vendors },
    { data: profiles },
  ] = await Promise.all([
    admin.from("blocks").select("*").order("created_at"),
    admin.from("slab_requirements").select("*").order("created_at"),
    admin.from("cut_sessions").select("*").order("created_at"),
    admin.from("cut_session_blocks").select("*").order("created_at"),
    admin.from("cut_session_slabs").select("*").order("created_at"),
    admin.from("temples").select("*").order("name"),
    admin.from("vendors").select("*").order("name"),
    admin.from("profiles").select("id, full_name, phone, role, is_active, created_at, updated_at, last_seen_at").order("full_name"),
  ]);

  function makeSheet(rows: Record<string, unknown>[] | null) {
    if (!rows || rows.length === 0) return XLSX.utils.json_to_sheet([{}]);
    // Flatten any nested objects (e.g. JSONB columns) to JSON strings
    const flat = rows.map(row =>
      Object.fromEntries(
        Object.entries(row).map(([k, v]) => [
          k,
          v === null || v === undefined
            ? ""
            : typeof v === "object"
            ? JSON.stringify(v)
            : v,
        ])
      )
    );
    return XLSX.utils.json_to_sheet(flat);
  }

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, makeSheet(blocks as Record<string, unknown>[] | null), "blocks");
  XLSX.utils.book_append_sheet(wb, makeSheet(slabs as Record<string, unknown>[] | null), "slab_requirements");
  XLSX.utils.book_append_sheet(wb, makeSheet(cutSessions as Record<string, unknown>[] | null), "cut_sessions");
  XLSX.utils.book_append_sheet(wb, makeSheet(cutSessionBlocks as Record<string, unknown>[] | null), "cut_session_blocks");
  XLSX.utils.book_append_sheet(wb, makeSheet(cutSessionSlabs as Record<string, unknown>[] | null), "cut_session_slabs");
  XLSX.utils.book_append_sheet(wb, makeSheet(temples as Record<string, unknown>[] | null), "temples");
  XLSX.utils.book_append_sheet(wb, makeSheet(vendors as Record<string, unknown>[] | null), "vendors");
  XLSX.utils.book_append_sheet(wb, makeSheet(profiles as Record<string, unknown>[] | null), "profiles");

  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

  const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const filename = `mtcpl-full-backup-${ts}.xlsx`;

  return new NextResponse(buf, {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
