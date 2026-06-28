"use server";

/**
 * DPR section loader — lets the client tab bar fetch a section's data on demand
 * (and prefetch the others) so switching tabs is instant, with no full-page
 * reload. Each builder is the same one the page uses for first paint.
 */

import { requireAuth } from "@/lib/auth";
import { buildBlockAddedReport } from "@/lib/dpr-block-added";
import { buildBlockCuttedReport } from "@/lib/dpr-block-cutted";
import { buildCarvingDoneReport } from "@/lib/dpr-carving-done";
import { buildDispatchedReport } from "@/lib/dpr-dispatched";
import type { DprSection } from "@/lib/dpr-section";

export async function loadDprSectionAction(key: string): Promise<DprSection> {
  const { profile } = await requireAuth();
  if (!["owner", "developer"].includes(profile.role)) throw new Error("Not allowed");
  if (key === "dispatched") return buildDispatchedReport();
  if (key === "carving_done") return buildCarvingDoneReport();
  if (key === "block_cutted") return buildBlockCuttedReport();
  return buildBlockAddedReport();
}
