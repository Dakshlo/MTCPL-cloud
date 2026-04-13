import Link from "next/link";
import { requireAuth } from "@/lib/auth";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { ReportClient } from "./report-client";

export default async function BlockReportPage() {
  await requireAuth(["owner", "team_head", "developer"]);
  // Admin client bypasses RLS so developer can see all blocks too
  const admin = createAdminSupabaseClient();

  const { data, error } = await admin
    .from("blocks")
    .select("id, stone, yard, category, quality, length_ft, width_ft, height_ft, status, truck_no, vendor_name, bill_no, created_at, updated_at")
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);

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

      <ReportClient blocks={data ?? []} />
    </>
  );
}
