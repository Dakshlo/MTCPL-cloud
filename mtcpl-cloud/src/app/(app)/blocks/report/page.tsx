import Link from "next/link";
import { requireAuth } from "@/lib/auth";
import { loadReportBlocks } from "./load-report-blocks";
import { ReportClient } from "./report-client";

export default async function BlockReportPage() {
  await requireAuth(["owner", "team_head", "senior_incharge", "developer"]);
  // loadReportBlocks uses the admin client (bypasses RLS so developer sees
  // every block) and pages past PostgREST's silent 1000-row cap — this report
  // used to stop at 1000 and hide ~500 blocks. Shared with the embed route.
  const { blocks, stoneNames, stoneCategoryMap } = await loadReportBlocks();

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

      <ReportClient blocks={blocks} stoneNames={stoneNames} stoneCategoryMap={stoneCategoryMap} />
    </>
  );
}
