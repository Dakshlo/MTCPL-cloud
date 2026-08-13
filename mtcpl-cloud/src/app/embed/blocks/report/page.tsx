/**
 * Embed-mode Block Report. Same data as the standalone /blocks/report
 * page but without the page header / "Back to Blocks" link — those
 * would be redundant inside the PeekIframe modal that hosts this route
 * (opened from the dashboard).
 *
 * Standalone /blocks/report still works (sidebar + header + back
 * button); this is just an alternate render for the modal.
 *
 * Both routes now share loadReportBlocks() so the 1000-row pagination
 * fix can never drift between them again — see that file's header.
 */

import { requireAuth } from "@/lib/auth";
import { loadReportBlocks } from "@/app/(app)/blocks/report/load-report-blocks";
import { ReportClient } from "@/app/(app)/blocks/report/report-client";

export default async function EmbedBlockReportPage() {
  await requireAuth(["owner", "team_head", "developer"]);
  const { blocks, stoneNames, stoneCategoryMap, stonePalettes } = await loadReportBlocks();

  return (
    <ReportClient
      blocks={blocks}
      stoneNames={stoneNames}
      stoneCategoryMap={stoneCategoryMap}
      stonePalettes={stonePalettes}
    />
  );
}
