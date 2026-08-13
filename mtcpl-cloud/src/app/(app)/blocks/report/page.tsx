import Link from "next/link";
import { requireAuth } from "@/lib/auth";
import { loadReportBlocks } from "./load-report-blocks";
import { ReportClient } from "./report-client";

// Where the "← Back" link points. The report is opened from more than one
// place (the dashboard tile and the /blocks page), and landing back on
// /blocks after opening it from the dashboard was disorienting. The opener
// passes ?from=… and we send them back where they were.
const BACK: Record<string, { href: string; label: string }> = {
  dashboard: { href: "/dashboard", label: "← Back to Dashboard" },
  blocks: { href: "/blocks", label: "← Back to Blocks" },
};

export default async function BlockReportPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string }>;
}) {
  await requireAuth(["owner", "team_head", "senior_incharge", "developer"]);
  // loadReportBlocks uses the admin client (bypasses RLS so developer sees
  // every block) and pages past PostgREST's silent 1000-row cap — this report
  // used to stop at 1000 and hide ~500 blocks. Shared with the embed route.
  const { blocks, stoneNames, stoneCategoryMap, stonePalettes } = await loadReportBlocks();

  const { from } = await searchParams;
  const back = BACK[from ?? "blocks"] ?? BACK.blocks;

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Block Report</h1>
          <p className="muted">Full inventory across every status — filter, sort and export to Excel.</p>
        </div>
        <Link href={back.href} className="ghost-button" style={{ textDecoration: "none" }}>
          {back.label}
        </Link>
      </div>

      <ReportClient
        blocks={blocks}
        stoneNames={stoneNames}
        stoneCategoryMap={stoneCategoryMap}
        stonePalettes={stonePalettes}
      />
    </>
  );
}
