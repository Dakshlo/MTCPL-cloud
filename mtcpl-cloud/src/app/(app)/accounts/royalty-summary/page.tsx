/**
 * Daksh May 2026 — cross-vendor royalty summary peek.
 *
 * Dad asked: instead of opening each vendor's private-notes panel
 * one-by-one to see royalty flow, he wants one screen with
 * day/week/month totals across every vendor. This page is the
 * answer — owner/developer only, gated behind the same 125500
 * passphrase as the Royalty Approval queue.
 *
 * Thin server wrapper: verifies role, renders the client. All
 * the work happens in royalty-summary-client.tsx (passphrase
 * prompt, date range picker, granularity tabs, bucket table).
 */

import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { RoyaltySummaryClient } from "./royalty-summary-client";
import { getRoyaltySummaryAction } from "../actions";

export default async function RoyaltySummaryPage() {
  const { profile } = await requireAuth();
  if (profile.role !== "owner" && profile.role !== "developer") {
    redirect("/accounts");
  }
  return <RoyaltySummaryClient summaryAction={getRoyaltySummaryAction} />;
}
