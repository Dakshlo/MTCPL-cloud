/**
 * Mig 064 — Royalty Approval queue (owner / developer).
 *
 * Reached from the Tasks pill on the top bar. The page itself
 * is a thin server component — it just verifies the role gate
 * and renders the client component. The client component handles
 * the passphrase prompt (125500), fetches the pending list via
 * server action, and offers per-row Approve / Reject buttons.
 */

import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { RoyaltyApprovalsClient } from "./royalty-approvals-client";
import {
  approveRoyaltyEntryAction,
  listPendingRoyaltyEntriesAction,
  rejectRoyaltyEntryAction,
} from "../actions";

export default async function RoyaltyApprovalsPage() {
  const { profile } = await requireAuth();
  if (profile.role !== "owner" && profile.role !== "developer") {
    redirect("/accounts");
  }
  return (
    <RoyaltyApprovalsClient
      listAction={listPendingRoyaltyEntriesAction}
      approveAction={approveRoyaltyEntryAction}
      rejectAction={rejectRoyaltyEntryAction}
    />
  );
}
