import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

// Mig 098 — Work Orders moved from a standalone page to a tab inside
// /carving (Outsource mode). This route now just forwards there, so the
// owner Tasks panel / topbar links and any old bookmarks keep working.
export default async function WorkOrdersRedirectPage({
  searchParams,
}: {
  searchParams: Promise<{ toast?: string }>;
}) {
  const sp = await searchParams;
  const toast = sp?.toast ? `&toast=${encodeURIComponent(sp.toast)}` : "";
  redirect(`/carving?mode=outsource&tab=workorders${toast}`);
}
