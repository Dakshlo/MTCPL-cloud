// ──────────────────────────────────────────────────────────────────
// /tools — the CNC tool store (migs 227–232)
// ──────────────────────────────────────────────────────────────────
// ONE store for the whole plant, and exactly two jobs in the module:
//
//   this screen   the keeper fills the shelf — add a tool, add stock,
//                 correct a count, read the register.
//   the QR        everyone else takes, on their own phone, signed by a
//                 code to the number on their profile.
//
// Oct 2026 — the vendor screens, the paper-register typing grid and the
// per-tool pages were all dropped (Daksh: "drop all other features").
// Each was a second way to do one of those two jobs, and the clutter was
// costing more than the features were worth.
//
// DEVELOPER ONLY in v1. The gate is re-checked inside every server
// action; this redirect is the courtesy, not the control.
// ──────────────────────────────────────────────────────────────────

import { redirect } from "next/navigation";

import { requireAuth } from "@/lib/auth";
import { canManageCncToolStore, canUseCncTools } from "@/lib/cnc-tool-permissions";
import { loadStore } from "@/lib/cnc-tool-stock";

import { StoreClient } from "./store-client";

export const dynamic = "force-dynamic";

export default async function ToolStorePage() {
  const { profile } = await requireAuth();
  if (!canUseCncTools(profile)) redirect("/");

  const { tools, movements } = await loadStore();

  return (
    <StoreClient
      tools={tools}
      movements={movements.slice(0, 300)}
      canManage={canManageCncToolStore(profile)}
    />
  );
}
