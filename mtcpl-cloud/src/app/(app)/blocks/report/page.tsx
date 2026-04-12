import Link from "next/link";
import { requireAuth } from "@/lib/auth";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { ReportClient } from "./report-client";

export default async function BlockReportPage() {
  await requireAuth(["owner", "planner"]);
  const supabase = await createServerSupabaseClient();

  const { data, error } = await supabase
    .from("blocks")
    .select("id, stone, yard, category, length_ft, width_ft, height_ft, status, truck_no, vendor_name, bill_no, created_at, updated_at")
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
