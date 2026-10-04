// ──────────────────────────────────────────────────────────────────
// /tools — the CNC tool store (Migrations 227 + 228)
// ──────────────────────────────────────────────────────────────────
// ONE store for the whole plant. A tool added here is available to
// every CNC vendor; what each of them takes is recorded against them.
//
// This route is the MASTER view — the whole shelf, who has drawn what,
// and the full register. A vendor gets a different screen entirely
// (/tools/v/[vendorId]): a big Take button and their own recent
// takings, because, as Daksh put it, their job is not to study stock.
//
// DEVELOPER ONLY in v1. The gate is re-checked inside every server
// action; this redirect is the courtesy, not the control.
// ──────────────────────────────────────────────────────────────────

import { redirect } from "next/navigation";

import { requireAuth } from "@/lib/auth";
import {
  canManageCncToolStore,
  canSeeCncToolMaster,
  canUseCncTools,
} from "@/lib/cnc-tool-permissions";
import { listToolVendors, loadStore, takenByHistory } from "@/lib/cnc-tool-stock";

import { StoreClient } from "./store-client";

export const dynamic = "force-dynamic";

export default async function ToolStorePage() {
  const { profile } = await requireAuth();
  if (!canUseCncTools(profile)) redirect("/");

  // A vendor who lands here belongs on their own screen, not the
  // master one. (Unreachable in v1 — developer-only — but the routing
  // is correct from the start so going live is a permission edit.)
  if (!canSeeCncToolMaster(profile)) {
    const own = (profile as { vendor_id?: string | null }).vendor_id;
    if (own) redirect(`/tools/v/${own}`);
    redirect("/");
  }

  const [vendors, { tools, movements }] = await Promise.all([listToolVendors(), loadStore()]);

  return (
    <StoreClient
      vendors={vendors}
      tools={tools}
      movements={movements.slice(0, 300)}
      people={takenByHistory(movements, null)}
      canManage={canManageCncToolStore(profile)}
    />
  );
}
