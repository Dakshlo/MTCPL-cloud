/**
 * Embed-mode Block Report. Same data fetching as the standalone
 * /blocks/report page but without the page header / "Back to Blocks"
 * link — those would be redundant inside the PeekIframe modal that
 * hosts this route.
 *
 * Standalone /blocks/report still works (sidebar + header + back
 * button); this is just an alternate render for the modal.
 */

import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { ReportClient } from "@/app/(app)/blocks/report/report-client";
import type { StoneCategory } from "@/lib/stone-categories";

export default async function EmbedBlockReportPage() {
  await requireAuth(["owner", "team_head", "developer"]);
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
  const stoneCategoryMap: Record<string, StoneCategory> = {};
  for (const s of stoneTypeRows ?? []) {
    const cat = (s as { stone_category?: string }).stone_category;
    stoneCategoryMap[(s as { name: string }).name] = cat === "marble" ? "marble" : "sandstone";
  }

  return (
    <ReportClient blocks={data ?? []} stoneNames={stoneNames} stoneCategoryMap={stoneCategoryMap} />
  );
}
