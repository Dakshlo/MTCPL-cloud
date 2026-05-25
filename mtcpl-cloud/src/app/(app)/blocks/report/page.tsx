import Link from "next/link";
import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { ReportClient } from "./report-client";
import type { StoneCategory } from "@/lib/stone-categories";

export default async function BlockReportPage() {
  await requireAuth(["owner", "team_head", "senior_incharge", "developer"]);
  // Admin client bypasses RLS so developer can see all blocks too
  const admin = createAdminSupabaseClient();

  const [{ data, error }, { data: stoneTypeRows }] = await Promise.all([
    admin
      .from("blocks")
      .select(
        "id, stone, yard, category, quality, length_ft, width_ft, height_ft, tonnes, truck_entry_id, status, truck_no, vendor_name, bill_no, created_at, updated_at",
      )
      .order("created_at", { ascending: false }),
    admin
      .from("stone_types")
      .select("name, stone_category")
      .order("name"),
  ]);

  if (error) throw new Error(error.message);

  const stoneNames = (stoneTypeRows ?? []).map((s) => s.name);

  // Build stone-name → category map so the client can render marble rows
  // with tonnes instead of dimensions.
  const stoneCategoryMap: Record<string, StoneCategory> = {};
  for (const s of stoneTypeRows ?? []) {
    const cat = (s as { stone_category?: string }).stone_category;
    stoneCategoryMap[(s as { name: string }).name] = cat === "marble" ? "marble" : "sandstone";
  }

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Block Report</h1>
          <p className="muted">Full inventory including all statuses — filter, sort and export to Excel.</p>
        </div>
        <Link href="/blocks" className="ghost-button" style={{ textDecoration: "none" }}>
          ← Back to Blocks
        </Link>
      </div>

      <ReportClient blocks={data ?? []} stoneNames={stoneNames} stoneCategoryMap={stoneCategoryMap} />
    </>
  );
}
